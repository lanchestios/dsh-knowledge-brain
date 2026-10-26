// 监听忽略规则（给 chokidar 的 ignored 谓词）。与 CLI 的 SCOPE_EXCLUDE 对齐：
// raw/project 下是外部克隆，结构检查与建页都不管它，监听纯属浪费。真实库实证：
// 递归监听整棵 raw/ 会把 5000+ 克隆目录塞进 FSEvents，触发 EMFILE（syscall=watch）
// 刷屏且拖慢启动；排除后 5496 → 193 个目录、ready 102s → 120ms、错误归零。
import path from 'node:path'

export function watchIgnored(dir: string): (p: string) => boolean {
  const proj = path.join(dir, 'raw', 'project')
  const prefix = proj + path.sep
  return (p) => p === proj || p.startsWith(prefix) || path.basename(p) === '.DS_Store'
}
