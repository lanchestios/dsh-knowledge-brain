import { test } from 'vitest'
import assert from 'node:assert/strict'
import { toLarkPost, larkRows, imageUrls } from '../src/lark/post.ts'

test('Markdown 转飞书 post：标题/加粗/链接/列表使用飞书节点，不泄露标记', () => {
  const post = toLarkPost(`# 结论\n\n这是 **重点**，参见 [原文](https://example.com)。\n\n- 第一项\n- 第二项`)
  assert.equal(post.zh_cn.title, '')
  assert.deepEqual(post.zh_cn.content[0], [{ tag: 'text', text: '结论', style: ['bold'] }])
  assert.ok(post.zh_cn.content[1].some((x) => x.tag === 'text' && x.text === '重点' && x.style?.includes('bold')))
  assert.ok(post.zh_cn.content[1].some((x) => x.tag === 'a' && x.text === '原文' && x.href === 'https://example.com'))
  assert.equal(post.zh_cn.content[2][0].text, '• ')
  assert.ok(!JSON.stringify(post).includes('**'))
})

test('Markdown 转飞书 post：代码块和表格去掉围栏与表格分隔语法', () => {
  const post = toLarkPost('```ts\nconst n = 1\n```\n\n| 名称 | 状态 |\n| --- | --- |\n| Wiki | 完成 |')
  const json = JSON.stringify(post)
  assert.ok(json.includes('const n = 1'))
  assert.ok(json.includes('名称') && json.includes('Wiki'))
  assert.ok(!json.includes('```') && !json.includes('---'))
})

const KEYS = new Map([['asset/diagrams/a.png', 'img_a'], ['raw/书/b.png', 'img_b']])

test('图片：有 key 独占一行成 img 标签；无 key 仍是链接；不给 keys 行为不变', () => {
  const md = '先看 ![流程](asset/diagrams/a.png) 再说\n\n![外](https://x.com/y.png)'
  const post = toLarkPost(md, KEYS)
  assert.deepEqual(post.zh_cn.content, [
    [{ tag: 'text', text: '先看 ' }],
    [{ tag: 'img', image_key: 'img_a' }],
    [{ tag: 'text', text: ' 再说' }],
    [{ tag: 'a', text: '外', href: 'https://x.com/y.png' }],
  ])
  const plain = toLarkPost(md)
  assert.ok(!JSON.stringify(plain).includes('"img"'), '不给 keys 不出 img')
  assert.ok(!JSON.stringify(plain).includes('asset/diagrams/a.png'), '库内图拿不到 key 不发（链接别人打不开）')
  assert.ok(plain.zh_cn.content[1].some((x) => x.tag === 'a' && x.href === 'https://x.com/y.png'), '外链图照旧链接')
})

test('图片：larkRows 给出 { img, alt }；段首图不出空行', () => {
  const rows = larkRows('![流程图](asset/diagrams/a.png)\n\n正文', KEYS)
  assert.deepEqual(rows, [{ img: 'img_a', alt: '流程图' }, [{ tag: 'text', text: '正文' }]])
})

test('图片：列表项里带图——标记留在文字行，图独占一行，不出孤立「1. 」', () => {
  const rows = larkRows('1. 打开设置 ![](asset/diagrams/a.png)\n2. 点保存', KEYS)
  assert.deepEqual(rows, [
    [{ tag: 'text', text: '1. ' }, { tag: 'text', text: '打开设置 ' }],
    { img: 'img_a', alt: '' },
    [{ tag: 'text', text: '2. ' }, { tag: 'text', text: '点保存' }],
  ])
  const only = larkRows('- ![示意](raw/书/b.png)', KEYS)
  assert.deepEqual(only, [{ img: 'img_b', alt: '示意' }], '整项只有图：不出「• 」空行')
})

test('图片：同一张图出现两次，两处都出 img', () => {
  const rows = larkRows('![a](asset/diagrams/a.png)\n\n中间\n\n![a](asset/diagrams/a.png)', KEYS)
  assert.equal(rows.filter((r) => !Array.isArray(r)).length, 2)
})

test('imageUrls：按出现顺序去重，只收图片不收链接', () => {
  assert.deepEqual(
    imageUrls('![a](asset/a.png) [链](asset/b.png) ![c](https://x/c.png)\n\n- ![a2](asset/a.png)'),
    ['asset/a.png', 'https://x/c.png'],
  )
})

test('图片：列表项以图开头——有序标记单独一行留在图前（编号不丢）；无序项只有图不出「•」', () => {
  const rows = larkRows('1. ![](asset/diagrams/a.png)\n2. 点保存', KEYS)
  assert.deepEqual(rows, [
    [{ tag: 'text', text: '1.' }],
    { img: 'img_a', alt: '' },
    [{ tag: 'text', text: '2. ' }, { tag: 'text', text: '点保存' }],
  ])
  const after = larkRows('1. ![](asset/diagrams/a.png) 后文', KEYS)
  assert.deepEqual(after[0], [{ tag: 'text', text: '1.' }])
  assert.deepEqual(after[1], { img: 'img_a', alt: '' })
  assert.ok(after[2].some((e) => e.text.includes('后文')))
})

test('库内图没 key：整张不发，不留链接、不出孤立列表标记、不吐 markdown 原文', () => {
  assert.deepEqual(larkRows('先看 ![流程](asset/diagrams/a.png)再说'), [[{ tag: 'text', text: '先看 ' }, { tag: 'text', text: '再说' }]])
  assert.deepEqual(larkRows('- ![示意](raw/书/b.png)\n- 第二项'), [[{ tag: 'text', text: '• ' }, { tag: 'text', text: '第二项' }]])
  assert.ok(!JSON.stringify(larkRows('![](asset/diagrams/a.png)')).includes('asset/'))
})
