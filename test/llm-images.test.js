import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModel } from '../src/core/model.ts';
import { rootImages, pageForLlm, resolvePage } from '../src/core/llm.ts';

// 读页时把图片路径规整成库根路径：答案阶段已不知道图抄自哪一页，源头规整才能消歧
test('rootImages：章节相对图改库根；已是库根 / 外链 / 越出库的保持原样', () => {
  const body = [
    '![流程](images/flow.png)',
    '![根](asset/images/a.png)',
    '![外](https://example.com/x.png)',
    '![越界](../../../etc/x.png)',
    '![带题](images/t.png "标题")',
  ].join('\n')
  const out = rootImages('raw/某书/第3章.md', body).split('\n')
  assert.equal(out[0], '![流程](raw/某书/images/flow.png)')
  assert.equal(out[1], '![根](asset/images/a.png)')
  assert.equal(out[2], '![外](https://example.com/x.png)')
  assert.equal(out[3], '![越界](../../../etc/x.png)')
  assert.equal(out[4], '![带题](raw/某书/images/t.png "标题")')
})

test('rootImages：空格 / 括号转义（markdown 能解析），中文原样（模型好抄）', () => {
  assert.equal(rootImages('raw/书/章.md', '![a](<图 片/x (1).png>)'), '![a](raw/书/图%20片/x%20%281%29.png)')
  assert.equal(rootImages('raw/书/章.md', '![a](图片/x.png)'), '![a](raw/书/图片/x.png)')
})

test('rootImages：非库内页面的相对图解析不到，保持原样；普通链接不动', () => {
  assert.equal(rootImages('认知/甲.md', '![x](images/a.png)'), '![x](images/a.png)')
  assert.equal(rootImages('raw/书/章.md', '[链](images/a.png)'), '[链](images/a.png)')
})

// model 只收四区页（raw/ 不进 model，书的章节走 wiki_raw，见 Task 1 Step 3 第二段）
test('pageForLlm：四区页里指向 asset 的相对图规整成库根', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-img-'))
  try {
    mkdirSync(join(dir, '认知'), { recursive: true })
    writeFileSync(join(dir, '认知', '甲.md'), '---\ntitle: 甲\n---\n\n见图 ![流程](../asset/images/flow.png)\n', 'utf8')
    const m = buildModel(dir)
    const r = resolvePage(m, '认知/甲.md')
    assert.ok('doc' in r)
    assert.match(pageForLlm(m, r.doc).body, /!\[流程\]\(asset\/images\/flow\.png\)/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('rootImages：文件名带括号（截图(1).png）整段识别并转义', () => {
  assert.equal(rootImages('raw/书/章.md', '![a](images/x(1).png)'), '![a](raw/书/images/x%281%29.png)')
})
