"""wiki upgrade：读写库版本（wiki.json）、逐级跑升级脚本（每级写版本、失败停在上一级）、CLI 分派、check 的「版本：」。

跑： python3 vault-tools/tests/test_upgrade.py
"""

import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lib"))
sys.path.insert(0, str(HERE))

from check import check  # noqa: E402
from core import conf  # noqa: E402
import init  # noqa: E402
from core import folders  # noqa: E402
import init  # noqa: E402
from core import repo  # noqa: E402
from upgrade import upgrade  # noqa: E402
from _vault import fill_top  # noqa: E402

WIKI = HERE.parent / "bin" / "wiki"
FM = "---\ntitle: {t}\ndescription: 摘要\ntags: []\nsource: []\ncreated: 2026-10-12\nupdated: 2026-10-12\n---\n\n{t} 的正文。\n"


class Base(unittest.TestCase):
    """fill_top 建的是当前版本的库（wiki.json + 各层 .folder.json）。"""

    def setUp(self):
        pin = mock.patch.object(init, "WIKI_VERSION", 5)   # 本文件测通用流程（当前没有任何升级脚本）
        pin.start()
        self.addCleanup(pin.stop)
        self.root = Path(tempfile.mkdtemp()).resolve()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        fill_top(self.root)
        self.json = self.root / conf.WIKI_CONF

    def tearDown(self):
        shutil.rmtree(self.root)

    def up(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = upgrade.run(self.root)
        return rc, buf.getvalue()

    def page(self, rel):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(FM.format(t=p.stem), encoding="utf-8")


class TestVersionIO(Base):
    def test_读_wiki_json(self):
        self.assertEqual(upgrade.read_version(self.root), init.WIKI_VERSION)
        for bad in ('{"version": "3"}', '{"version": 3.0}', '{"version": true}', '{"parts": {}}', "{坏", "[3]"):
            self.json.write_text(bad, encoding="utf-8")
            self.assertIsNone(upgrade.read_version(self.root), bad)

    def test_写_wiki_json_只改_version(self):
        upgrade.write_version(self.root, 7)
        self.assertEqual(json.loads(self.json.read_text(encoding="utf-8")), conf.default_wiki(7))
        self.assertTrue(self.json.read_text(encoding="utf-8").startswith('{\n  "version": 7,\n  "parts": {\n'))

    def test_current_就是_init_的常量(self):
        self.assertEqual(upgrade.current(), init.WIKI_VERSION)


class TestRun(Base):
    def test_已是最新_退出0_不改文件(self):
        self.page("知识/散页.md")                       # 没补齐的也不碰：升级只在版本低时跑
        snap = {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file() and ".git" not in p.parts}
        rc, text = self.up()
        self.assertEqual(rc, 0)
        self.assertIn("✓ 已是 v5，不用升级", text)
        after = {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file() and ".git" not in p.parts}
        self.assertEqual(after, snap)

    def test_库比工具新_退出1(self):
        upgrade.write_version(self.root, 6)
        rc, text = self.up()
        self.assertEqual(rc, 1)
        self.assertIn("✗ 库版本 v6 比工具认的 v5 新，先升级 dsh-knowledge-brain 插件", text)
        self.assertEqual(upgrade.read_version(self.root), 6)

    def test_读不出版本_退出1_不改文件(self):
        self.json.write_text('{"parts": {}}', encoding="utf-8")
        rc, text = self.up()
        self.assertEqual(rc, 1)
        self.assertIn("读不出 version", text)
        self.assertEqual(self.json.read_text(encoding="utf-8"), '{"parts": {}}')

    def test_逐级执行_每级写版本_第二级失败停在_v2(self):
        ran = []

        def step(n, problems):
            def run(root, out):
                ran.append((n, upgrade.read_version(root)))
                return problems
            return SimpleNamespace(DESC=f"第 {n} 级", run=run)

        upgrade.write_version(self.root, 1)
        steps = {2: step(2, []), 3: step(3, ["文件夹配置：假问题"])}
        with mock.patch.object(init, "WIKI_VERSION", 3), mock.patch.object(upgrade, "_load_step", steps.get):
            rc, text = self.up()
        self.assertEqual(rc, 1)
        self.assertEqual(ran, [(2, 1), (3, 2)], "两级都跑、第二级跑时版本已写成 2")
        self.assertEqual(upgrade.read_version(self.root), 2)
        self.assertIn("✓ 升级 v1 → v2：第 2 级", text)
        self.assertIn("✗ 文件夹配置：假问题", text)
        self.assertIn("✗ 升级停在 v2：v2 → v3 没完成", text)

        ran.clear()
        steps[3] = step(3, [])
        with mock.patch.object(init, "WIKI_VERSION", 3), mock.patch.object(upgrade, "_load_step", steps.get):
            rc, text = self.up()
        self.assertEqual(rc, 0, text)
        self.assertEqual(ran, [(3, 2)], "从 v2 接着升，不重跑 v2")
        self.assertEqual(upgrade.read_version(self.root), 3)
        self.assertIn("✓ 已升到 v3", text)

    def test_缺升级脚本_退出1(self):
        upgrade.write_version(self.root, 4)                # 真加载器：upgrades/ 下没有脚本
        rc, text = self.up()
        self.assertEqual(rc, 1)
        self.assertIn("✗ 缺少 v4 → v5 的升级脚本", text)
        self.assertEqual(upgrade.read_version(self.root), 4)


class TestCli(Base):
    def setUp(self):
        super().setUp()
        mock.patch.stopall()
        upgrade.write_version(self.root, init.WIKI_VERSION)

    def wiki(self, *args):
        return subprocess.run([sys.executable, str(WIKI), *args], cwd=self.root, capture_output=True, text=True)

    def test_wiki_upgrade_分派(self):
        r = self.wiki("upgrade")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn(f"✓ 已是 v{init.WIKI_VERSION}，不用升级", r.stdout)
        upgrade.write_version(self.root, 2)
        r = self.wiki("upgrade")
        self.assertEqual(r.returncode, 1)
        self.assertIn("✗ 缺少 v2 → v3 的升级脚本", r.stdout)

    def test_USAGE_有_upgrade(self):
        self.assertIn("upgrade", self.wiki("--help").stdout)


class TestCheckVersion(Base):
    def check(self, **kw):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = check.run(self.root, **kw)
        return rc, buf.getvalue()

    def test_等于当前_不报(self):
        rc, text = self.check()
        self.assertEqual(rc, 0, text)
        self.assertNotIn("版本：", text)

    def test_版本低_报错且排在最前(self):
        upgrade.write_version(self.root, 4)
        (self.root / "多余.txt").write_text("x", encoding="utf-8")       # 另有一条顶层错误
        rc, text = self.check()
        self.assertEqual(rc, 1)
        self.assertTrue(text.startswith("✗ 版本：库是 v4，工具是 v5——先跑 wiki upgrade"), text)

    def test_版本高_报错(self):
        upgrade.write_version(self.root, 6)
        rc, text = self.check()
        self.assertEqual(rc, 1)
        self.assertIn("✗ 版本：库是 v6，比工具认的 v5 新——先升级 dsh-knowledge-brain 插件", text)

    def test_读不出_报错(self):
        for t in ('{"parts": {}}', None):
            if t is None:
                self.json.unlink()
            else:
                self.json.write_text(t, encoding="utf-8")
            rc, text = self.check()
            self.assertEqual(rc, 1)
            self.assertIn("✗ 版本：.wiki/wiki.json 读不出 version（缺失或格式不对）", text)

    def test_wiki_json_字段必填(self):
        self.json.write_text(json.dumps({"version": 3, "parts": {"认知": {"order": 1}, "学习": {"order": 1, "x": 1},
                                                                 "知识": {}, "别的": {"order": 4}}, "extra": 1},
                                        ensure_ascii=False), encoding="utf-8")
        text = self.check()[1]
        for msg in ("配置：.wiki/wiki.json 有不认识的字段 —— extra", "配置：.wiki/wiki.json 的 parts 缺 系统", "配置：.wiki/wiki.json 的 parts 缺 经历",
                    "配置：.wiki/wiki.json 的 parts 有不是沉淀区的 别的", "配置：.wiki/wiki.json 的 学习 有不认识的字段 —— x",
                    "配置：.wiki/wiki.json 的 order 1 重复 —— 认知、学习", "配置：.wiki/wiki.json 的 知识 缺字段 —— order"):
            self.assertIn(msg, text)

    def test_new_skeleton_新建的_wiki_json_带当前版本(self):
        self.json.unlink()
        with redirect_stdout(io.StringIO()):
            init.new_skeleton(self.root)
        self.assertEqual(json.loads(self.json.read_text(encoding="utf-8")), conf.default_wiki(upgrade.current()))
        self.assertNotIn("版本：", self.check()[1])


if __name__ == "__main__":
    unittest.main()
