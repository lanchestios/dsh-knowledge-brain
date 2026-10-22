"""库版本升级脚本：一级一个模块 v<N>.py，表示「从 N-1 升到 N」。

每个模块提供：
  DESC: str                        这一级做了什么（wiki upgrade 打印「✓ 升级 v{N-1} → v{N}：<DESC>」）
  run(root, out) -> list[str]      做升级；返回要人改的问题（空 = 这一级成功）。必须可重复跑。
新增一级：两处 WIKI_VERSION（lib/init.py、插件 src/core/vault/init.ts）加一，再加 v<新>.py。
"""
