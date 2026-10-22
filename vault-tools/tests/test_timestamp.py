"""信任字段的时刻：generated.at / verified[].at 的写入与格式。

OKF §5.2 的 at 是完整 ISO 8601 时间戳，不是日期。stamp 负责让
generated.at 跟着内容走，verify 负责往 verified 追加事件——两者互不牵制，
内容改动不会作废已有的确认。

跑： python3 vault-tools/tests/test_timestamp.py
"""

import contextlib
import io
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from core import frontmatter as fm  # noqa: E402
import stamp  # noqa: E402
from page import query as page_query  # noqa: E402
from page import verify as page_verify  # noqa: E402
from core import repo  # noqa: E402

T0 = "2026-09-06T09:00:00Z"
T1 = "2026-09-06T17:00:00Z"


class TestInstant(unittest.TestCase):

    def test_now_iso_是_UTC_的_ISO8601(self):
        self.assertRegex(repo.now_iso(), r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_合法时间戳(self):
        self.assertTrue(repo.is_iso_datetime(T0))

    def test_只有日期不算合法时间戳(self):
        self.assertFalse(repo.is_iso_datetime("2026-09-06"))

    def test_不存在的时刻被拒(self):
        self.assertFalse(repo.is_iso_datetime("2026-09-06T25:00:00Z"))

    def test_少了_Z_被拒(self):
        self.assertFalse(repo.is_iso_datetime("2026-09-06T09:00:00"))


class TestCheckRequiresDatetime(unittest.TestCase):

    def test_generated_的_at_必须是时间戳(self):
        self.assertTrue(repo.trust_problems({"by": "x", "at": "2026-09-06"}, []))

    def test_verified_的_at_必须是时间戳(self):
        self.assertTrue(repo.trust_problems({}, [{"by": "human:a", "at": "2026-09-06"}]))

    def test_合法时间戳不报问题(self):
        self.assertEqual(repo.trust_problems({"by": "x", "at": T0},
                                             [{"by": "human:a", "at": T1}]), [])


class TestWiring(unittest.TestCase):

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()
        self.p = self.root / "知识" / "甲.md"
        self.p.parent.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.root)

    def write(self, generated_at, verified):
        v = "verified: []" if not verified else "verified:\n" + "".join(
            f"  - {{by: {e['by']}, at: {e['at']}}}\n" for e in verified).rstrip()
        self.p.write_text(
            f"---\ntitle: 甲\ndescription: \ntags: []\nsource: []\nstatus: stable\n"
            f"generated: {{by: claude, at: {generated_at}}}\n{v}\n"
            f"created: 2026-09-06\nupdated: 2026-09-06\n---\n\n# 甲\n正文\n", encoding="utf-8")

    def quiet(self, fn, *a, **k):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = fn(*a, **k)
        return rc, buf.getvalue()

    def test_verify_写的是时间戳(self):
        self.write(T0, [])
        self.quiet(page_verify.verify, self.root, str(self.p), "human:a")
        self.assertTrue(repo.is_iso_datetime(fm.parse(self.p).verified[0]["at"]))

    def test_同一人再确认就再记一条_不去重(self):
        """「谁在何时看过」是事实；同一个人隔一年再看是新的事实。"""
        self.write(T0, [{"by": "human:a", "at": T1}])
        self.quiet(page_verify.verify, self.root, str(self.p), "human:a")
        self.assertEqual(len(fm.parse(self.p).verified), 2)

    def test_stamp_推进_generated_at(self):
        self.write(T0, [])
        self.quiet(stamp.stamp, self.root, all_files=True)
        self.assertNotEqual(fm.parse(self.p).generated["at"], T0)
        self.assertTrue(repo.is_iso_datetime(fm.parse(self.p).generated["at"]))

    def test_stamp_不改_generated_by_免得钩子里张冠李戴(self):
        self.write(T0, [])
        self.quiet(stamp.stamp, self.root, all_files=True)
        self.assertEqual(fm.parse(self.p).generated["by"], "claude")

    def test_stamp_显式指定_by_时才改归属(self):
        self.write(T0, [])
        self.quiet(stamp.stamp, self.root, all_files=True, by="human:b")
        self.assertEqual(fm.parse(self.p).generated["by"], "human:b")

    def test_stamp_不碰_verified(self):
        self.write(T0, [{"by": "human:a", "at": T0}])
        self.quiet(stamp.stamp, self.root, all_files=True)
        self.assertEqual(len(fm.parse(self.p).verified), 1)

    def test_确认写的是此刻(self):
        self.write(T0, [])
        before = repo.now_iso()
        self.quiet(page_verify.verify, self.root, str(self.p), "human:a")
        self.assertGreaterEqual(fm.parse(self.p).verified[0]["at"], before)

    def test_列表把没人工确认的页列出来(self):
        self.write(T1, [{"by": "claude", "at": T0}])
        _, msg = self.quiet(page_query.unverified, self.root)
        self.assertIn("机器确认", msg)

    def test_列表不把人工确认过的页列出来(self):
        self.write(T0, [{"by": "human:a", "at": T1}])
        _, msg = self.quiet(page_query.unverified, self.root)
        self.assertIn("全部", msg)


class TestStampOnlyOnContentChange(unittest.TestCase):
    """generated.at 跟着**内容**走。

    verify 本身要改文件（写 verified），如果 stamp 见文件变了就推进
    generated.at，确认完一提交就当场作废——这个类锁死那个回归。
    """

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()
        repo.git(self.root, "init", "-q", ".", check=False)
        repo.git(self.root, "config", "user.email", "t@t", check=False)
        repo.git(self.root, "config", "user.name", "t", check=False)
        self.p = self.root / "知识" / "甲.md"
        self.p.parent.mkdir(parents=True)
        self.write(body="正文原样", verified=[], desc="摘要")
        self.commit()

    def tearDown(self):
        shutil.rmtree(self.root)

    def write(self, body, verified, desc, at=T0):
        v = "verified: []" if not verified else "verified:\n" + "".join(
            f"  - {{by: {e['by']}, at: {e['at']}}}\n" for e in verified).rstrip()
        self.p.write_text(
            f"---\ntitle: 甲\ndescription: {desc}\ntags: []\nsource: []\nstatus: stable\n"
            f"generated: {{by: claude, at: {at}}}\n{v}\n"
            f"created: 2026-09-06\nupdated: 2026-09-06\n---\n\n# 甲\n{body}\n",
            encoding="utf-8")

    def commit(self):
        repo.git(self.root, "add", "-A", check=False)
        repo.git(self.root, "commit", "-qm", "x", check=False)

    def stamp(self):
        with contextlib.redirect_stdout(io.StringIO()):
            stamp.stamp(self.root, all_files=True)
        return fm.parse(self.p).generated["at"]

    def test_正文变了才推进(self):
        self.write(body="正文改过了", verified=[], desc="摘要")
        self.assertNotEqual(self.stamp(), T0)

    def test_只写了_verified_不推进(self):
        self.write(body="正文原样", verified=[{"by": "human:a", "at": T1}], desc="摘要")
        self.assertEqual(self.stamp(), T0)

    def test_摘要变了要推进(self):
        self.write(body="正文原样", verified=[], desc="换了个摘要")
        self.assertNotEqual(self.stamp(), T0)

    def test_确认之后再提交_那条确认原样留着(self):
        """端到端锁死：verify → stamp（钩子）不得动 verified 一个字。

        这里曾经有过一个陷阱：stamp 会把 generated.at 推到确认之后，于是
        「verify 完紧接着提交」必然把刚记下的确认判成过期。过期判定已经
        整个去掉，这条用来防止它以任何形式回来。
        """
        with contextlib.redirect_stdout(io.StringIO()):
            page_verify.verify(self.root, str(self.p), "human:a")
            before = fm.parse(self.p).verified
            stamp.stamp(self.root, all_files=True)
        self.assertEqual(fm.parse(self.p).verified, before)

    def test_没进过版本库的新页照常推进(self):
        新 = self.root / "知识" / "乙.md"
        新.write_text(self.p.read_text(encoding="utf-8"), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            stamp.stamp(self.root, all_files=True)
        self.assertNotEqual(fm.parse(新).generated["at"], T0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
