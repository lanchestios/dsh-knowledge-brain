import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

// 技能写法规范（superpowers:writing-skills）：description 只写什么时候用，不概括流程——
// description 一概括流程，模型就照 description 做、不读正文。
// wiki/SKILL.md 每次往库里放东西都加载，命令详表挪到 commands.md 按需读。

const SKILLS = join(fileURLToPath(import.meta.url), '..', '..', 'vault-tools', 'skills')
const fm = (dir) => parseYaml(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(SKILLS, dir, 'SKILL.md'), 'utf8'))[1])
const dirs = readdirSync(SKILLS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)

// 挪节前 wiki/SKILL.md「命令」「怎么选」两节点名的全部子命令：挪过去一个都不能少
const SUBCOMMANDS = ['book deposit', 'book list', 'book new', 'book read', 'book split', 'check', 'document add', 'document cover', 'document fetch', 'document fidelity', 'document list', 'page anchor', 'page grow', 'page mark', 'page move', 'page new', 'page shrink', 'page tags', 'page unverified', 'page verify', 'stamp', 'tree', 'upgrade']

test('每个技能 description 以「在……时用」起、不概括流程、不过长；name 与目录同名', () => {
  for (const d of dirs) {
    const { name, description } = fm(d)
    assert.equal(name, d)
    assert.match(description, /^在.+时用/, `${d}: description 要以「在……时用」起`)
    assert.ok(description.length <= 500, `${d}: description ${description.length} 字过长`)
    assert.ok(!/(→|子 agent 顺序|判据：|第[一二三四]步)/.test(description), `${d}: description 在概括流程`)
  }
})

test('wiki/SKILL.md 不再内联命令详表，commands.md 收齐全部子命令', () => {
  const main = readFileSync(join(SKILLS, 'wiki', 'SKILL.md'), 'utf8')
  assert.ok(!/^## 命令$/m.test(main) && !/^## 怎么选$/m.test(main))
  assert.ok(main.includes('[commands.md](commands.md)'))
  const cmds = readFileSync(join(SKILLS, 'wiki', 'commands.md'), 'utf8')
  assert.match(cmds, /^# 命令/)
  for (const c of SUBCOMMANDS) assert.ok(cmds.includes(`wiki ${c}`), `commands.md 缺 wiki ${c}`)
})

test('wiki 主文件说门面是读写规则、指到「怎么读」；不再单说门面是写作规则', () => {
  const main = readFileSync(join(SKILLS, 'wiki', 'SKILL.md'), 'utf8')
  assert.ok(!/门面是写作规则/.test(main))
  assert.match(main, /读写规则/)
  assert.match(main, /怎么读/)
})

test('wiki-read 写明：调用方就是本会话时，上下文包只作内部材料，对外照调用方自己的口径作答', () => {
  const s = readFileSync(join(SKILLS, 'wiki-read', 'SKILL.md'), 'utf8')
  assert.match(s, /内部材料/)
  assert.match(s, /不原样发/)
})

test('wiki 只留读写共用的区定义与库务；只给写作用的文件在 wiki-write 下，图类型逐个拆进 diagram-reference', () => {
  for (const f of ['writing.md', 'diagrams.md', 'metadata.md', 'anchors.md']) {
    assert.ok(!existsSync(join(SKILLS, 'wiki', f)), `wiki/${f} 应挪走`)
    assert.ok(existsSync(join(SKILLS, 'wiki-write', f)), `wiki-write/${f} 缺`)
  }
  for (const f of ['excalidraw.md', 'mermaid.md', 'infographic.md', 'formula.md', 'html-embed.md']) {
    assert.ok(existsSync(join(SKILLS, 'wiki-write', 'diagram-reference', f)), `diagram-reference/${f} 缺`)
  }
  for (const f of ['SKILL.md', 'commands.md', 'sources.md', 'ordering.md', 'onboarding.md']) assert.ok(existsSync(join(SKILLS, 'wiki', f)), f)
})

test('技能目录里的相对 md 链接都指得到文件', () => {
  const bad = []
  const walk = (d) => readdirSync(d).flatMap((e) => { const p = join(d, e); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [] })
  for (const f of walk(SKILLS)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\]\(([^)#?\s]+\.md)(?:#[^)]*)?\)/g)) {
      if (/^(https?:|asset\/)|</.test(m[1])) continue
      if (!existsSync(join(dirname(f), m[1]))) bad.push(`${f.slice(SKILLS.length + 1)} → ${m[1]}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('wiki-read 自带区判据，兜底不再指 wiki 技能', () => {
  const s = readFileSync(join(SKILLS, 'wiki-read', 'SKILL.md'), 'utf8')
  assert.ok(!/`wiki` 技能的六区/.test(s))
})

test('行业矩阵：wiki 规则二与 commands 指到系统门面的先例长成；wiki-write 场景表有矩阵一行', () => {
  const main = readFileSync(join(SKILLS, 'wiki', 'SKILL.md'), 'utf8')
  const cmds = readFileSync(join(SKILLS, 'wiki', 'commands.md'), 'utf8')
  for (const t of [main, cmds]) assert.match(t, /先例长成见 `系统\/系统\.md`/)
  const w = readFileSync(join(SKILLS, 'wiki-write', 'SKILL.md'), 'utf8')
  assert.match(w, /^\| 写行业矩阵的跨平台读法页 \| `系统\/<X>行业矩阵\/` \|/m)
})

test('diagrams.md：只剩选形式路由，各图类型的写法逐个拆进 diagram-reference', () => {
  const s = readFileSync(join(SKILLS, 'wiki-write', 'diagrams.md'), 'utf8')
  // 选型表：架构图与关系图（含 ER）都指 excalidraw 图位
  assert.match(s, /\|\s*架构图[^|]*\|\s*excalidraw 图位/)
  assert.match(s, /\|\s*关系图（实体关系、域连通）[^|]*\|\s*excalidraw 图位/)
  assert.match(s, /\|\s*领域模型的 ER 图[^|]*\|\s*excalidraw 图位/)
  // mermaid 只留流程图/谱系/时间轴，正文不再把架构图、关系图指给 mermaid 或 html
  assert.match(s, /流程图、谱系、时间轴/)
  assert.ok(!/架构图、流程图、谱系、时间轴 \| mermaid/.test(s))
  assert.ok(!/关系图.*html 嵌入/.test(s), '关系图不再走 html 嵌入')
  // 每种形式指到 diagram-reference/<类型>.md
  for (const f of ['excalidraw', 'mermaid', 'infographic', 'formula', 'html-embed']) {
    assert.ok(s.includes(`diagram-reference/${f}.md`), `路由缺 diagram-reference/${f}.md`)
  }
  // 路由自身不再展开任何类型的写法（只留自己的「选哪种形式」）
  for (const sec of ['## excalidraw 图位', '## mermaid', '## infographic', '## 公式', '## html 嵌入']) {
    assert.ok(!s.includes(sec), `路由页不留 ${sec}`)
  }
})

test('diagram-reference/excalidraw.md：放图位三步、骨架、简单图人画/复杂图生成器、自动高度、风格不特指某张图', () => {
  const s = readFileSync(join(SKILLS, 'wiki-write', 'diagram-reference', 'excalidraw.md'), 'utf8')
  assert.match(s, /asset\/diagrams\/<日期>\/<名>\.excalidraw/)
  assert.match(s, /"type":"excalidraw","version":2/)
  assert.match(s, /"viewBackgroundColor":"#ffffff"/, '骨架纸底暖白')
  assert.match(s, /简单图[^—]*在编辑态/, '简单图仍由人在编辑态画')
  assert.match(s, /生成器＋校验器/, '复杂图走生成器＋校验器')
  assert.match(s, /先写校验器再写生成器/, '先校验器后生成器的次序写明')
  assert.ok(!/\?h=</.test(s), 'excalidraw 不写定高用法（?h=<…>），一律自动高度')
  assert.ok(!/业务域关系|x3-domain-links/.test(s), '风格不指名某张图')
  assert.match(s, /走肘线/, '走线纪律在内')
})

test('diagram-reference：mermaid / infographic / formula / html-embed 各自收拢', () => {
  const m = readFileSync(join(SKILLS, 'wiki-write', 'diagram-reference', 'mermaid.md'), 'utf8')
  assert.match(m, /流程图、谱系、时间轴/, 'mermaid 职责收口')
  const i = readFileSync(join(SKILLS, 'wiki-write', 'diagram-reference', 'infographic.md'), 'utf8')
  assert.match(i, /sequence-ascending-steps/, 'infographic 模板清单在内')
  const f = readFileSync(join(SKILLS, 'wiki-write', 'diagram-reference', 'formula.md'), 'utf8')
  assert.match(f, /\\\$/, '公式美元转义在内')
  const h = readFileSync(join(SKILLS, 'wiki-write', 'diagram-reference', 'html-embed.md'), 'utf8')
  assert.match(h, /\?h=/, 'html 嵌入高度纪律在内')
  assert.match(h, /data-dsh-theme/, '嵌入件明暗跟宿主纪律在内')
})

test('writing.md 附件节：excalidraw 图位列进受管附件', () => {
  const s = readFileSync(join(SKILLS, 'wiki-write', 'writing.md'), 'utf8')
  assert.match(s, /excalidraw 图位/)
})
