import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 插件包根：从自身位置向上找 package.json 所在目录。三种安装形态下都成立——dev 仓直跑
// （本文件在 src/host/，上两级是仓根）、web profile 的 link: 软链（Node 默认 realpath，
// import.meta.url 落在 dev 仓本体）、desktop profile 的 git+https 实体目录（产物在 lib/，上一级）。
// wiki 工具链（vault-tools/）就从包里取，不在库里存代码副本。
// 只许 host 侧引用：client 产物是 CJS，进了它的 import 图构建时会栽在 import.meta 上。
const selfDir = dirname(fileURLToPath(import.meta.url))

export const pkgRoot = () => {
  let d = selfDir
  while (!existsSync(join(d, 'package.json'))) {
    const up = dirname(d)
    if (up === d) throw new Error('pkg: package.json not found upward')
    d = up
  }
  return d
}
export const vaultTools = (...p: string[]) => join(pkgRoot(), 'vault-tools', ...p)
