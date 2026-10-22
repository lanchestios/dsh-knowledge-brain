// MCP / wiki-ops 测试共用的小库：两个前缀相近的文件夹（ML / ML2）、一个范围外文件夹（X），
// 跨文件夹的 prev/next 与反链、同名页（梯度）、标题异于目录名的区索引（所知区）、asset 与 raw 图片引用、一张超限图、一条越界软链。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildModel } from '../src/core/model.ts'

export const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

export function makeVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-mcp-'))
  fs.mkdirSync(path.join(dir, '.git'))
  for (const a of ['thought', 'anatomy', 'knowledge', 'work']) fs.mkdirSync(path.join(dir, a))
  fs.mkdirSync(path.join(dir, '.wiki'))
  fs.writeFileSync(path.join(dir, '.wiki', 'wiki.json'), '{ "version": 1, "parts": { "thought": { "order": 1 }, "anatomy": { "order": 2 }, "knowledge": { "order": 3 }, "work": { "order": 4 } } }')
  const put = (rel, fm, body, title = path.basename(rel, '.md')) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), `---\ntitle: ${title}\n${fm}---\n${body}`)
  }
  const file = (rel, buf) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), buf) }
  put('knowledge/knowledge.md', '', '总览', '所知区')   // 区索引标题 ≠ 目录名：scope 下 crumb 不得带出它
  put('knowledge/ML/ML.md', 'tags: [ml]\n',
    '机器学习总览，梯度 ![图](../../asset/ml/a.png) ![素材图](../../raw/document/书/img/r.png) ![矢量](../../asset/ml/v.svg) ![大](../../asset/ml/big.png) ![链](../../asset/ml/link.png)')
  put('knowledge/ML/梯度.md', 'tags: [ml, 优化]\n', '梯度下降，见 [[秘密]]。')
  put('knowledge/ML2/近似.md', 'tags: [ml]\n', '前缀相近的文件夹，梯度 [[knowledge/ML/梯度]]')
  put('knowledge/X/秘密.md', 'tags: [私]\n', '梯度 秘密内容，引用 [[knowledge/ML/梯度]] ![x](../../asset/x/s.png)')
  put('knowledge/X/梯度.md', '', '同名页 梯度')
  file('asset/ml/a.png', PNG)
  file('asset/ml/v.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
  file('asset/ml/big.png', Buffer.alloc(5 * 1024 * 1024 + 1))
  file('asset/x/s.png', PNG)
  file('asset/ml/other.png', PNG)                       // 没有任何页引用
  file('raw/document/书/img/r.png', PNG)
  fs.symlinkSync('/etc/hosts', path.join(dir, 'asset/ml/link.png'))
  const m = buildModel(dir)
  return { dir, m, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}
