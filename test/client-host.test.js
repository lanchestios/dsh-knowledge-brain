import { test } from 'vitest';
import assert from 'node:assert/strict';
import { assetRel, assetUrl } from '../src/client/lib/asset.ts';
import { touches } from '../src/client/lib/edit.ts';

test('assetRel 浏览器版：与 core/render.ts 同规则（只认落在 asset//raw/ 下的解析结果）', () => {
  assert.equal(assetRel('认知/甲.md', 'asset/img/x.png'), 'asset/img/x.png');
  assert.equal(assetRel('认知/甲.md', 'raw/d.md'), 'raw/d.md');
  assert.equal(assetRel('认知/sub/甲.md', '../../asset/i.png'), 'asset/i.png', '文档相对上跳回 asset/ 才重写');
  assert.equal(assetRel('认知/sub/甲.md', '../img.png'), null, '解析结果在 asset//raw/ 之外 → null（章节旁图片走页面相对路径，不重写）');
  assert.equal(assetRel('认知/甲.md', 'asset/x.html?h=560'), 'asset/x.html');   // ?h= 不进路径
  assert.equal(assetRel('a/b.md', 'https://x/y.png'), null);
  assert.equal(assetRel('a/b.md', '#anchor'), null);
  assert.equal(assetUrl('asset/x.png'), 'api/wiki.asset?path=' + encodeURIComponent('asset/x.png'));
});

test('touches 搬家不丢语义', () => {
  assert.equal(touches('a.md', { kind: 'structural' }), true);
  assert.equal(touches('a.md', { kind: 'patch', ids: ['a.md'], flags: {} }), true);
  assert.equal(touches('a.md', { kind: 'patch', ids: [], flags: {} }), false);
  assert.equal(touches('raw/x.md', { kind: 'patch', ids: [], flags: { documents: true } }), true);
});
