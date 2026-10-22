"""fidelity.py 的单元测试 —— 只测纯函数，不碰文件系统。

跑： python3 vault-tools/tests/test_fidelity.py
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from document import fidelity  # noqa: E402


class TestTokens(unittest.TestCase):
    """从素材里抽出「必须保留」的 token。"""

    def test_抽表格的单元格文本(self):
        md = "| 字段 | 描述 |\n|---|---|\n| order_id | 订单号 |"
        self.assertLessEqual({"字段", "描述", "order_id", "订单号"},
                             fidelity.tokens(md))

    def test_抽数字与百分比(self):
        md = "渗透率达 70%，共 3500 万用户"
        self.assertLessEqual({"70%", "3500"}, fidelity.tokens(md))

    def test_抽反引号里的标识符(self):
        self.assertIn("business_id", fidelity.tokens("字段 `business_id` 是业务线"))

    def test_抽小节标题(self):
        self.assertIn("优惠计算模型", fidelity.tokens("### 优惠计算模型\n正文"))

    def test_表格分隔行不算_token(self):
        self.assertNotIn("---", fidelity.tokens("| a |\n|---|\n| b |"))

    def test_太短的词不算_token(self):
        # 单字与两字虚词噪音太大，不作为保真依据
        self.assertNotIn("的", fidelity.tokens("| 的 | 了 |\n|---|---|\n| a | b |"))

    def test_图片与链接地址不算_token(self):
        md = "![](raw/document/2026-09-07/x/images/01.jpg)"
        self.assertEqual(set(), {t for t in fidelity.tokens(md) if "asset" in t})

    def test_抽加粗小标题(self):
        self.assertIn("后台分类", fidelity.tokens("**后台分类**\n描述内容"))


class TestExemptions(unittest.TestCase):
    """页里声明的保真豁免。"""

    def test_解析豁免声明(self):
        page = "<!-- 保真豁免: 通用域 —— 定义错误，见边界与批评 -->"
        self.assertEqual({"通用域"}, fidelity.exemptions(page))

    def test_多条豁免都被解析(self):
        page = ("<!-- 保真豁免: A —— 理由甲 -->\n"
                "<!-- 保真豁免: B —— 理由乙 -->")
        self.assertEqual({"A", "B"}, fidelity.exemptions(page))

    def test_没写理由的豁免不算数(self):
        # 豁免必须带理由，否则等于偷偷删内容
        self.assertEqual(set(), fidelity.exemptions("<!-- 保真豁免: A -->"))


class TestMissing(unittest.TestCase):
    """缺失清单。"""

    def test_页里有的_token_不算缺失(self):
        self.assertEqual([], fidelity.missing("| order_id |\n|---|\n| 订单号 |",
                                              "正文提到 order_id 与订单号"))

    def test_页里没有的_token_算缺失(self):
        self.assertIn("订单号", fidelity.missing("| 订单号 |\n|---|\n| x |",
                                                "正文只提到 x"))

    def test_已豁免的_token_不算缺失(self):
        src = "| 通用域 |\n|---|\n| x |"
        page = "正文提到 x\n<!-- 保真豁免: 通用域 —— 定义错误 -->"
        self.assertEqual([], fidelity.missing(src, page))

    def test_无理由的豁免声明不能让_token_通过(self):
        # 不带理由的豁免不合法，既不豁免、也不能通过子串匹配隐藏缺失
        src = "| 库存阈值 |\n|---|\n| x |"
        page = "正文未提及\n<!-- 保真豁免: 库存阈值 -->"
        self.assertIn("库存阈值", fidelity.missing(src, page))

    def test_有理由的豁免正常生效(self):
        src = "| 库存阈值 |\n|---|\n| x |"
        page = "正文未提及\n<!-- 保真豁免: 库存阈值 —— 已废弃 -->"
        self.assertEqual([], fidelity.missing(src, page))

    def test_页面正文真的写了_token_时通过不受豁免影响(self):
        src = "| 库存阈值 | 其他字段 |\n|---|---|\n| a | b |"
        page = "正文提到库存阈值\n<!-- 保真豁免: 其他字段 —— 理由 -->"
        self.assertEqual([], fidelity.missing(src, page))


if __name__ == "__main__":
    unittest.main(verbosity=2)
