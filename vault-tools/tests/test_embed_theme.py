"""嵌入件明暗：asset/ 下自带样式的 html 必须按宿主的 data-dsh-theme 切明暗、不自己写 color-scheme、背景透明。

跑： python3 vault-tools/tests/test_embed_theme.py
"""

import io
import contextlib
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from check import check  # noqa: E402
from core import repo  # noqa: E402

OK_VARS = """<!doctype html><html><head><style>
:root{--ink:#111}
@media (prefers-color-scheme: dark){:root{--ink:#eee}}
html[data-dsh-theme="dark"]{--ink:#eee}
html[data-dsh-theme="light"]{--ink:#111}
body{margin:0;background:transparent;color:var(--ink)}
</style></head><body>x</body></html>"""


class TestEmbedTheme(unittest.TestCase):

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()

    def tearDown(self):
        shutil.rmtree(self.root)

    def errs(self, html, rel="asset/explorables/2026-10-14/试.html"):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(html, encoding="utf-8")
        out = repo.Out()
        with contextlib.redirect_stdout(io.StringIO()) as buf:
            check._check_embed_theme(self.root, out)
        return out.errors, buf.getvalue()

    def test_变量挂_data_dsh_theme_合规(self):
        self.assertEqual(self.errs(OK_VARS)[0], 0)

    def test_light_dark_写法合规(self):
        html = "<html><head><style>body{background:transparent;color:light-dark(#111,#eee)}</style></head><body></body></html>"
        self.assertEqual(self.errs(html)[0], 0)

    def test_没有样式的页不管(self):
        self.assertEqual(self.errs("<p>x</p>")[0], 0)

    def test_只跟系统不跟宿主报错(self):
        html = OK_VARS.replace('html[data-dsh-theme="dark"]{--ink:#eee}\nhtml[data-dsh-theme="light"]{--ink:#111}\n', "")
        n, text = self.errs(html)
        self.assertEqual(n, 1, text)
        self.assertIn("嵌入件：明暗没跟宿主", text)

    def test_自己写_color_scheme_报错(self):
        n, text = self.errs(OK_VARS.replace(":root{--ink:#111}", ":root{color-scheme:light;--ink:#111}"))
        self.assertEqual(n, 1, text)
        self.assertIn("嵌入件：自己声明了 color-scheme", text)

    def test_媒体查询里的_prefers_color_scheme_不算(self):
        self.assertEqual(self.errs(OK_VARS)[0], 0)

    def test_html_body_背景不透明报错(self):
        for decl in ("body{background:#f8f9f6}", "html,body{background-color:var(--paper)}", "html { background: white }"):
            n, text = self.errs(OK_VARS.replace("</style>", decl + "</style>"))
            self.assertEqual(n, 1, decl + "\n" + text)
            self.assertIn("嵌入件：页面背景不透明", text)

    def test_html_body_背景透明或别的元素有背景不管(self):
        for decl in ("html{background:transparent}", "body{background:none}", ".card{background:#fff}", ".x body{background:#fff}"):
            self.assertEqual(self.errs(OK_VARS.replace("</style>", decl + "</style>"))[0], 0, decl)

    def test_raw_下的_html_不管(self):
        self.assertEqual(self.errs("<style>body{background:#fff}</style>", rel="raw/document/2026-10-14/x.html")[0], 0)


if __name__ == "__main__":
    unittest.main()
