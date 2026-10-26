"""信任层：frontmatter 的行内 mapping、身份解析、verified 追加。

跑： python3 vault-tools/tests/test_trust.py
"""

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from core import frontmatter as fm  # noqa: E402
from core import repo  # noqa: E402


class TestInlineMapping(unittest.TestCase):
    """frontmatter 解析器要认 {k: v} 行内 mapping。"""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp()).resolve()

    def tearDown(self):
        shutil.rmtree(self.dir)

    def page(self, body):
        p = self.dir / "x.md"
        p.write_text(f"---\n{body}\n---\n\n正文\n", encoding="utf-8")
        return fm.parse(p)

    def test_标量字段照旧(self):
        self.assertEqual(self.page("title: 甲").fields["title"], "甲")

    def test_行内列表照旧(self):
        self.assertEqual(self.page("tags: [a, b]").fields["tags"], ["a", "b"])

    def test_块列表照旧(self):
        self.assertEqual(self.page("source:\n  - a/b.md\n  - c/d.md").fields["source"],
                         ["a/b.md", "c/d.md"])

    def test_行内_mapping_解析成字典(self):
        got = self.page("generated: {by: claude-opus-5, at: 2026-09-06}").fields["generated"]
        self.assertEqual(got, {"by": "claude-opus-5", "at": "2026-09-06"})

    def test_值里带冒号的_actor_不会被截断(self):
        got = self.page("generated: {by: human:lanchestios, at: 2026-09-06}").fields["generated"]
        self.assertEqual(got["by"], "human:lanchestios")

    def test_块列表里的_mapping_逐项解析(self):
        got = self.page("verified:\n"
                        "  - {by: human:a, at: 2026-09-06}\n"
                        "  - {by: process:nightly, at: 2027-03-01}").fields["verified"]
        self.assertEqual(got, [{"by": "human:a", "at": "2026-09-06"},
                               {"by": "process:nightly", "at": "2027-03-01"}])

    def test_空_mapping(self):
        self.assertEqual(self.page("generated: {}").fields["generated"], {})

    def test_page_暴露_generated_与_verified(self):
        p = self.page("generated: {by: x, at: 2026-09-06}\n"
                      "verified:\n  - {by: human:a, at: 2026-09-06}")
        self.assertEqual(p.generated["by"], "x")
        self.assertEqual(p.verified, [{"by": "human:a", "at": "2026-09-06"}])

    def test_没有信任字段时给出空值而不是报错(self):
        p = self.page("title: 甲")
        self.assertEqual(p.generated, {})
        self.assertEqual(p.verified, [])


class TestRenderTrust(unittest.TestCase):
    """render 要能把信任字段写回去，且字段顺序固定。"""

    def test_generated_渲染成行内_mapping(self):
        got = fm.render({"title": "甲", "generated": {"by": "x", "at": "2026-09-06"}})
        self.assertIn("generated: {by: x, at: 2026-09-06}", got)

    def test_verified_渲染成块列表(self):
        got = fm.render({"title": "甲",
                         "verified": [{"by": "human:a", "at": "2026-09-06"},
                                      {"by": "human:a", "at": "2027-03-01"}]})
        self.assertIn("verified:\n  - {by: human:a, at: 2026-09-06}\n"
                      "  - {by: human:a, at: 2027-03-01}", got)

    def test_空_verified_渲染成空列表(self):
        self.assertIn("verified: []", fm.render({"title": "甲", "verified": []}))

    def test_信任字段排在时间字段之前(self):
        got = fm.render({"title": "甲", "generated": {"by": "x", "at": "d"},
                         "verified": [], "created": "d", "updated": "d"})
        keys = [ln.split(":")[0] for ln in got.splitlines() if ":" in ln]
        self.assertLess(keys.index("generated"), keys.index("created"))
        self.assertLess(keys.index("verified"), keys.index("created"))

    def test_解析与渲染往返不丢信息(self):
        fields = {"title": "甲", "tags": ["x"], "source": [],
                  "generated": {"by": "human:a", "at": "2026-09-06"},
                  "verified": [{"by": "human:a", "at": "2026-09-06"}],
                  "created": "2026-09-06", "updated": "2026-09-06"}
        d = Path(tempfile.mkdtemp()).resolve()
        try:
            p = d / "x.md"
            p.write_text(fm.render(fields) + "\n\n# 甲\n", encoding="utf-8")
            back = fm.parse(p)
            for k, v in fields.items():
                self.assertEqual(back.fields[k], v, k)
        finally:
            shutil.rmtree(d)


class TestActor(unittest.TestCase):
    """身份解析：--by > WIKI_ACTOR > human:<git user.name>。"""

    def setUp(self):
        self.saved = os.environ.pop("WIKI_ACTOR", None)
        self.root = Path(tempfile.mkdtemp()).resolve()

    def tearDown(self):
        os.environ.pop("WIKI_ACTOR", None)
        if self.saved is not None:
            os.environ["WIKI_ACTOR"] = self.saved
        shutil.rmtree(self.root)

    def test_显式参数优先级最高(self):
        os.environ["WIKI_ACTOR"] = "从环境来的"
        self.assertEqual(repo.actor(self.root, "显式给的"), "显式给的")

    def test_没有参数时用环境变量(self):
        os.environ["WIKI_ACTOR"] = "claude-opus-5"
        self.assertEqual(repo.actor(self.root), "claude-opus-5")

    def test_都没有时退回_git_用户并加_human_前缀(self):
        repo.git(self.root, "init", "-q", check=False)
        repo.git(self.root, "config", "user.name", "张三", check=False)
        self.assertEqual(repo.actor(self.root), "human:张三")

    def test_git_也没有时退回未知(self):
        # 隔离全局/系统 git 配置，否则读到的是真人的 user.name
        os.environ["GIT_CONFIG_GLOBAL"] = os.devnull
        os.environ["GIT_CONFIG_SYSTEM"] = os.devnull
        try:
            self.assertEqual(repo.actor(self.root), "human:unknown")
        finally:
            os.environ.pop("GIT_CONFIG_GLOBAL", None)
            os.environ.pop("GIT_CONFIG_SYSTEM", None)

    def test_已经带前缀的身份不会被重复加前缀(self):
        self.assertEqual(repo.actor(self.root, "human:李四"), "human:李四")


class TestVerifiedAppend(unittest.TestCase):
    """wiki verify 往 verified 追加事件，不覆盖历史。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()

    def tearDown(self):
        shutil.rmtree(self.root)

    def page(self, body):
        p = self.root / "知识" / "x.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f"---\n{body}\n---\n\n# 甲\n", encoding="utf-8")
        return p

    def test_首次确认写入一条(self):
        p = self.page("title: 甲\nverified: []")
        fm.append_verified(p, "human:a", "2026-09-06")
        self.assertEqual(fm.parse(p).verified, [{"by": "human:a", "at": "2026-09-06"}])

    def test_同一人再确认会追加而不是覆盖(self):
        p = self.page("title: 甲\n"
                      "generated: {by: claude, at: 2027-01-01T00:00:00Z}\n"
                      "verified:\n  - {by: human:a, at: 2026-09-06T09:00:00Z}")
        self.assertTrue(fm.append_verified(p, "human:a", "2027-03-01T00:00:00Z"))
        self.assertEqual(fm.parse(p).verified,
                         [{"by": "human:a", "at": "2026-09-06T09:00:00Z"},
                          {"by": "human:a", "at": "2027-03-01T00:00:00Z"}])

    def test_每次确认都记一条_不按人去重(self):
        """确认是事件，不是状态；同一个人再看一遍是新的事实。"""
        p = self.page("title: 甲\n"
                      "generated: {by: claude, at: 2026-09-06T09:00:00Z}\n"
                      "verified:\n  - {by: human:a, at: 2026-09-06T10:00:00Z}")
        self.assertTrue(fm.append_verified(p, "human:a", "2026-09-06T11:00:00Z"))
        self.assertEqual(len(fm.parse(p).verified), 2)

    def test_没有_verified_字段时新建一个(self):
        p = self.page("title: 甲")
        fm.append_verified(p, "human:a", "2026-09-06")
        self.assertEqual(fm.parse(p).verified, [{"by": "human:a", "at": "2026-09-06"}])

    def test_正文一字不动(self):
        p = self.page("title: 甲\nverified: []")
        fm.append_verified(p, "human:a", "2026-09-06")
        self.assertTrue(p.read_text(encoding="utf-8").endswith("\n\n# 甲\n"))


class TestTrustTier(unittest.TestCase):
    """OKF 的三级信任由 verified 推导，不存储。"""

    def test_没有_verified_是未确认(self):
        self.assertEqual(repo.trust_tier([]), "未确认")

    def test_只有非人类确认是机器确认(self):
        self.assertEqual(repo.trust_tier([{"by": "process:nightly", "at": "d"}]), "机器确认")

    def test_有人类确认就是人工确认(self):
        self.assertEqual(repo.trust_tier([{"by": "process:x", "at": "d"},
                                          {"by": "human:a", "at": "d"}]), "人工确认")


class TestTrustProblems(unittest.TestCase):
    """信任字段是可选的；但一旦出现，格式得对——这属于结构校验。"""

    def test_两个字段都没有不算问题(self):
        self.assertEqual(repo.trust_problems({}, []), [])

    def test_generated_缺_by_是问题(self):
        self.assertEqual(len(repo.trust_problems({"at": "2026-09-06T09:00:00Z"}, [])), 1)

    def test_generated_缺_at_是问题(self):
        self.assertEqual(len(repo.trust_problems({"by": "x"}, [])), 1)

    def test_generated_只给日期不给时刻是问题(self):
        self.assertEqual(len(repo.trust_problems({"by": "x", "at": "2026-09-06"}, [])), 1)

    def test_合法的_generated_没问题(self):
        self.assertEqual(repo.trust_problems({"by": "x", "at": "2026-09-06T09:00:00Z"}, []), [])

    def test_verified_条目缺字段是问题(self):
        self.assertEqual(len(repo.trust_problems({}, [{"by": "human:a"}])), 1)

    def test_verified_日期格式不对是问题(self):
        self.assertEqual(len(repo.trust_problems({}, [{"by": "human:a", "at": "昨天"}])), 1)

    def test_多条问题逐条报出(self):
        # generated 缺 by + at 格式错，verified 同理，共四条
        self.assertEqual(len(repo.trust_problems({"at": "坏"}, [{"at": "也坏"}])), 4)

    def test_合法的_verified_没问题(self):
        self.assertEqual(repo.trust_problems({}, [{"by": "human:a", "at": "2026-09-06T09:00:00Z"}]), [])


class TestDateValidation(unittest.TestCase):
    """日期校验要真的校验，不能只匹配形状。

    is_iso_date 现在只管 created / updated；generated / verified 的 at
    是时间戳，走 is_iso_datetime。
    """

    def test_不存在的月份日期被拒(self):
        self.assertFalse(repo.is_iso_date("2026-13-45"))

    def test_二月三十号被拒(self):
        self.assertFalse(repo.is_iso_date("2026-02-30"))

    def test_没有横杠的紧凑写法也被拒(self):
        self.assertFalse(repo.is_iso_date("20260906"))

    def test_闰年二月二十九合法(self):
        self.assertTrue(repo.is_iso_date("2028-02-29"))

    def test_平年二月二十九被拒(self):
        self.assertFalse(repo.is_iso_date("2026-02-29"))

    def test_合法日期通过(self):
        self.assertTrue(repo.is_iso_date("2026-09-06"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
