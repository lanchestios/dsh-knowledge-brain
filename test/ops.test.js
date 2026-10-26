// test/ops.test.js —— 手术单元：真建一个临时库 + DocStore + buildModel(dir, store)，动文件后走 doChange，
// 与全新 buildModel(dir) 逐字段比（等价性契约的单点版；模糊网在 test/equivalence.test.js）
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { buildModel } from '../src/core/model.ts';
import { DocStore } from '../src/core/vault/docstore.ts';
import { doChange, doCreate, doUnlink, applyDocOps, applyAssets, applyRaws, applyAnchors } from '../src/core/vault/ops.ts';

const mk = (build) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-ops-')); build(dir); return dir; };
const wiki = (dir) => { fs.mkdirSync(path.join(dir, '.wiki')); fs.writeFileSync(path.join(dir, '.wiki', 'wiki.json'), '{ "version": 1, "parts": { "knowledge": { "order": 1 }, "work": { "order": 2 } } }'); fs.mkdirSync(path.join(dir, 'knowledge')); fs.mkdirSync(path.join(dir, 'work')); };
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const equiv = (m, dir) => {                       // 逐字段：byId/nodeOf 结构/backlinks/map/order/dead
  const f = buildModel(dir);
  assert.deepEqual([...m.byId.keys()].sort(), [...f.byId.keys()].sort());
  for (const [id, d] of f.byId) for (const k of ['title', 'tags', 'status', '_content']) assert.equal(JSON.stringify(m.byId.get(id)?.[k]), JSON.stringify(d[k]), id + '.' + k);
  const shape = (n) => ({ name: n.name, dir: n.dir, docId: n.doc?._id ?? null, count: n.count, items: (n.items ?? []).map(shape), children: [...n.children.keys()].sort() });
  assert.deepEqual(shape(m.g.root), shape(f.g.root));
  assert.deepEqual(m.g.order.map((d) => d._id), f.g.order.map((d) => d._id));
  const bl = (g) => JSON.stringify([...g.backlinks].map(([k, l]) => [k, l.map((b) => [b.doc._id, b.snippet])]).sort());
  assert.equal(bl(m.g), bl(f.g));
  const mp = (g) => JSON.stringify([...g.map].map(([k, e]) => [k, e.count, e.docs.map((d) => d._id)]).sort());
  assert.equal(mp(m.g), mp(f.g));
  const dd = (x) => JSON.stringify([...x.dead].map(([t, e]) => [t, e.reason, e.candidates.map((d) => d._id), e.count, e.from.map((y) => [y.doc._id, y.count])]).sort());
  assert.equal(dd(m), dd(f));
  // search 抽样：目标名与正文词各搜一次
  for (const q of ['甲', '乙', '正文']) assert.equal(JSON.stringify(m.search.ms.search(q).map((r) => r.id).sort()), JSON.stringify(f.search.ms.search(q).map((r) => r.id).sort()), 'search:' + q);
};

test('普通编辑：反链拼接 + snippet 重算 + dead 增删 + 搜索重加，与重建逐字段一致', () => {
  const dir = mk((d) => { wiki(d);
    fs.writeFileSync(path.join(d, 'knowledge/甲.md'), '---\ntitle: 甲\ncreated: 2026-09-01\n---\n提到 [[乙]]。');
    fs.writeFileSync(path.join(d, 'knowledge/乙.md'), '---\ntitle: 乙\ncreated: 2026-09-02\n---\n回看 [[甲]]。');
    fs.writeFileSync(path.join(d, 'work/w.md'), '---\ntitle: w\ncreated: 2026-09-03\n---\n看 [[甲]] 与 [[乙]]。');
  });
  try {
    const st = new DocStore(dir);
    const m = buildModel(dir, st);
    assert.ok(m.g.backlinks.get('knowledge/甲.md')?.length >= 1);
    // 编辑 乙：链接从 [[甲]] 换成指向自己的新页 [[丙]]（造 dead）
    fs.writeFileSync(path.join(dir, 'knowledge/乙.md'), '---\ntitle: 乙\ncreated: 2026-09-02\n---\n指向 [[丙]]。');
    const r = doChange(m, 'knowledge/乙.md');
    assert.ok(r.ids.includes('knowledge/乙.md'));
    assert.ok(r.ids.includes('knowledge/甲.md'), '甲的反链列表变了，必须在 ids 里');
    assert.equal(r.flags.graph, true, '链接集变了');
    assert.ok(m.dead.has('丙'));
    equiv(m, dir);
    // 再编辑回去：dead 消失、反链恢复
    fs.writeFileSync(path.join(dir, 'knowledge/乙.md'), '---\ntitle: 乙\ncreated: 2026-09-02\n---\n回看 [[甲]]。');
    doChange(m, 'knowledge/乙.md');
    assert.ok(!m.dead.has('丙'));
    equiv(m, dir);
  } finally { rm(dir); }
});

test('改文件夹 index：子树页 prev/next 变 → ids 含子树，flags.tree', () => {
  const dir = mk((d) => { wiki(d);
    fs.mkdirSync(path.join(d, 'knowledge', 'ML'), { recursive: true });
    fs.writeFileSync(path.join(d, 'knowledge/ML/ML.md'), '---\ntitle: ML\ncreated: 2026-09-01\n---\n## 读的顺序\n\n1. [[B]]\n2. [[A]]\n');
    fs.writeFileSync(path.join(d, 'knowledge/ML/A.md'), '---\ntitle: A\ncreated: 2026-09-01\n---\n');
    fs.writeFileSync(path.join(d, 'knowledge/ML/B.md'), '---\ntitle: B\ncreated: 2026-09-02\n---\n');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    const first = m.g.order.map((x) => x._id);
    // 导览序倒过来：A 提到 B 前面
    fs.writeFileSync(path.join(dir, 'knowledge/ML/ML.md'), '---\ntitle: ML\ncreated: 2026-09-01\n---\n## 读的顺序\n\n1. [[A]]\n2. [[B]]\n');
    const r = doChange(m, 'knowledge/ML/ML.md');
    assert.equal(r.flags.tree, true);
    for (const id of ['knowledge/ML/ML.md', 'knowledge/ML/A.md', 'knowledge/ML/B.md']) assert.ok(r.ids.includes(id), id);
    equiv(m, dir);
    assert.notDeepEqual(m.g.order.map((x) => x._id), first, '导览序真的变了');
  } finally { rm(dir); }
});

test('改区 index 标题：全区 crumb 变 → ids 含全区、全区重进搜索', () => {
  const dir = mk((d) => { wiki(d);
    fs.writeFileSync(path.join(d, 'knowledge/knowledge.md'), '---\ntitle: 所知\ncreated: 2026-09-01\n---\n');
    fs.writeFileSync(path.join(d, 'knowledge/A.md'), '---\ntitle: 甲\ncreated: 2026-09-01\n---\n');
    fs.writeFileSync(path.join(d, 'work/W.md'), '---\ntitle: w\ncreated: 2026-09-01\n---\n');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    fs.writeFileSync(path.join(dir, 'knowledge/knowledge.md'), '---\ntitle: 新知\ncreated: 2026-09-01\n---\n');
    const r = doChange(m, 'knowledge/knowledge.md');
    assert.equal(r.flags.tree, true);
    assert.ok(r.ids.includes('knowledge/A.md'), '全区页 crumb 变了');
    assert.ok(!r.ids.includes('work/W.md'), '别区不受牵连');
    equiv(m, dir);
    assert.ok(JSON.stringify(m.search.ms.search('新知')).includes('knowledge/A.md'), 'crumb 按新区名重加');
  } finally { rm(dir); }
});

test('frontmatter 变（status）→ flags.stats；只改正文不变 frontmatter → 无 stats', () => {
  const dir = mk((d) => { wiki(d);
    fs.writeFileSync(path.join(d, 'knowledge/A.md'), '---\ntitle: 甲\nstatus: stable\ncreated: 2026-09-01\n---\n正文。');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    fs.writeFileSync(path.join(dir, 'knowledge/A.md'), '---\ntitle: 甲\nstatus: draft\ncreated: 2026-09-01\n---\n正文。');
    assert.equal(doChange(m, 'knowledge/A.md').flags.stats, true);
    equiv(m, dir);
    fs.writeFileSync(path.join(dir, 'knowledge/A.md'), '---\ntitle: 甲\nstatus: draft\ncreated: 2026-09-01\n---\n正文改了一字。');
    const r2 = doChange(m, 'knowledge/A.md');
    assert.notEqual(r2.flags.stats, true);
    equiv(m, dir);
    // 只变 frontmatter source:（落到 WikiDoc.sources）→ 也算 stats
    fs.writeFileSync(path.join(dir, 'knowledge/A.md'), '---\ntitle: 甲\nstatus: draft\ncreated: 2026-09-01\nsource: ref-a\n---\n正文改了一字。');
    assert.equal(doChange(m, 'knowledge/A.md').flags.stats, true, 'source: 只此一字变 → stats');
    equiv(m, dir);
  } finally { rm(dir); }
});

test('新建于新目录：目录链建起、反链进目标页、与重建一致', () => {
  const dir = mk((d) => { wiki(d);
    fs.writeFileSync(path.join(d, 'knowledge/甲.md'), '---\ntitle: 甲\ncreated: 2026-09-01\n---\n想写 [[乙]]。');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    assert.ok(m.dead.has('乙'));
    fs.mkdirSync(path.join(dir, 'knowledge', '新'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'knowledge/新/乙.md'), '---\ntitle: 乙\ncreated: 2026-09-02\n---\n你好。');
    const r = doCreate(m, 'knowledge/新/乙.md');
    assert.ok(r.ids.includes('knowledge/新/乙.md'));
    assert.ok(r.ids.includes('knowledge/甲.md'), '甲的 [[乙]] 从死链翻成反链，必须在 ids 里');
    assert.ok(!m.dead.has('乙'), '死链复活');
    assert.ok(m.html instanceof Map);
    equiv(m, dir);
  } finally { rm(dir); }
});

test('解析翻转链 0→1→2→1：复活、歧义、收敛全程与重建一致', () => {
  const dir = mk((d) => { wiki(d);
    fs.writeFileSync(path.join(d, 'knowledge/L.md'), '---\ntitle: l\ncreated: 2026-09-01\n---\n看 [[乙]]。');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    assert.equal(m.dead.get('乙').reason, 'missing');           // 0：死链
    fs.writeFileSync(path.join(dir, 'knowledge/乙.md'), '---\ntitle: 乙\ncreated: 2026-09-02\n---\n');
    doCreate(m, 'knowledge/乙.md');
    assert.ok(!m.dead.has('乙'), '1：复活');
    assert.ok(m.g.backlinks.get('knowledge/乙.md')?.some((b) => b.doc._id === 'knowledge/L.md'));
    equiv(m, dir);
    fs.writeFileSync(path.join(dir, 'work', '乙.md'), '---\ntitle: 乙\ncreated: 2026-09-03\n---\n');
    doCreate(m, 'work/乙.md');
    // 2：跨区同名——不再就近：L 的 [[乙]] 翻成歧义死链，反链撤掉
    assert.equal(m.dead.get('乙')?.reason, 'ambiguous', '2：同名即歧义');
    assert.ok(!m.g.backlinks.get('knowledge/乙.md')?.some((b) => b.doc._id === 'knowledge/L.md'), '歧义不进反链');
    assert.ok(!m.g.backlinks.get('work/乙.md'));
    equiv(m, dir);
    fs.unlinkSync(path.join(dir, 'work/乙.md'));
    const r = doUnlink(m, 'work/乙.md');
    assert.ok(!m.dead.has('乙'), '1：收敛回唯一');
    assert.ok(r.ids.includes('knowledge/L.md'), 'L 的解析又翻了，必须在 ids 里');
    equiv(m, dir);
  } finally { rm(dir); }
});

test('删掉末页：空目录链剪枝（对齐重建语义——空目录不留节点）', () => {
  const dir = mk((d) => { wiki(d);
    fs.mkdirSync(path.join(d, 'knowledge', '深', '处'), { recursive: true });
    fs.writeFileSync(path.join(d, 'knowledge/深/处/only.md'), '---\ntitle: 只\ncreated: 2026-09-01\n---\n');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    fs.unlinkSync(path.join(dir, 'knowledge', '深', '处', 'only.md'));
    fs.rmdirSync(path.join(dir, 'knowledge', '深', '处'));
    fs.rmdirSync(path.join(dir, 'knowledge', '深'));
    const r = doUnlink(m, 'knowledge/深/处/only.md');
    assert.deepEqual(r.ids, ['knowledge/深/处/only.md']);
    assert.ok(!m.g.root.children.get('knowledge')?.children?.get('深'), '空目录链已剪');
    equiv(m, dir);
  } finally { rm(dir); }
});

test('applyAssets：嵌入该 asset 的页 html 缓存被作废，别的页不动', () => {
  const dir = mk((d) => { wiki(d);
    fs.mkdirSync(path.join(d, 'asset'));
    fs.writeFileSync(path.join(d, 'asset/a.html'), '<p>1</p>');
    fs.writeFileSync(path.join(d, 'knowledge/A.md'), '---\ntitle: 甲\ncreated: 2026-09-01\n---\n嵌 ![](asset/a.html?h=100)。');
    fs.writeFileSync(path.join(d, 'knowledge/B.md'), '---\ntitle: 乙\ncreated: 2026-09-01\n---\n没嵌。');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    m.html.set('knowledge/A.md', Promise.resolve({ html: '旧', toc: [] }));   // 模拟已渲染
    m.html.set('knowledge/B.md', Promise.resolve({ html: '旧', toc: [] }));
    const r = applyAssets(m, ['asset/a.html']);
    assert.deepEqual(r.ids, ['knowledge/A.md']);
    assert.ok(!m.html.has('knowledge/A.md'), '嵌入页条目必不在（欠失效才是 bug）');
    assert.ok(m.html.has('knowledge/B.md'), '无关页缓存保留');
    equiv(m, dir);                                     // 模型数据没变
  } finally { rm(dir); }
});

test('applyRaws：raw 下出现同名素材 → missing 翻 unpublished，ids 含写该名的页', () => {
  const dir = mk((d) => { wiki(d);
    fs.writeFileSync(path.join(d, 'knowledge/A.md'), '---\ntitle: 甲\ncreated: 2026-09-01\n---\n想引 [[某素材]]。');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    assert.equal(m.dead.get('某素材').reason, 'missing');
    fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'raw/某素材.md'), '素材正文');
    const r = applyRaws(m, ['raw/某素材.md']);
    assert.equal(m.dead.get('某素材').reason, 'unpublished');
    assert.ok(r.ids.includes('knowledge/A.md'));
    assert.equal(r.flags.documents, true);
    equiv(m, dir);
    fs.unlinkSync(path.join(dir, 'raw/某素材.md'));
    applyRaws(m, ['raw/某素材.md']);
    assert.equal(m.dead.get('某素材').reason, 'missing', '素材没了翻回来');
    equiv(m, dir);
  } finally { rm(dir); }
});

test('applyAnchors：重读 anchors，ids=前缀命中页、stats 置位', () => {
  const dir = mk((d) => {   // 本例自带骨架：anchors 只认 anatomy 区（复刻 baselinesFor 的硬过滤）
    fs.mkdirSync(path.join(d, '.wiki'));
    fs.writeFileSync(path.join(d, '.wiki', 'wiki.json'), '{ "version": 1, "parts": { "anatomy": { "order": 1 }, "work": { "order": 2 } } }');
    fs.mkdirSync(path.join(d, 'anatomy'));
    fs.mkdirSync(path.join(d, 'work'));
    fs.writeFileSync(path.join(d, 'anatomy/P.md'), '---\ntitle: p\ncreated: 2026-09-01\n---\n');
    fs.writeFileSync(path.join(d, 'work/W.md'), '---\ntitle: w\ncreated: 2026-09-01\n---\n');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    fs.writeFileSync(path.join(dir, '.wiki', 'anchors.conf'), '[anatomy/P.md]\n某仓 /tmp/r abc123\n');
    const r = applyAnchors(m);
    assert.deepEqual(r.ids, ['anatomy/P.md']);
    assert.equal(r.flags.stats, true);
    assert.equal(m.anchors[0].repos[0].commit, 'abc123');
  } finally { rm(dir); }
});

test('C1：doCreate 撞上已有页 → 转 doChange 语义，名字映射不进重复条目', () => {
  const dir = mk((d) => { wiki(d);
    fs.writeFileSync(path.join(d, 'knowledge/乙.md'), '---\ntitle: 乙\ncreated: 2026-09-02\n---\n回看 [[甲]]。');
    fs.writeFileSync(path.join(d, 'knowledge/甲.md'), '---\ntitle: 甲\ncreated: 2026-09-01\n---\n看 [[乙]]。');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    // 删了又建（同路径、新内容）：直接喂 doCreate——引擎防抖窗 last-event-wins 后到达的形态
    fs.unlinkSync(path.join(dir, 'knowledge/乙.md'));
    fs.writeFileSync(path.join(dir, 'knowledge/乙.md'), '---\ntitle: 乙\ncreated: 2026-09-02\n---\n改指 [[丙]]。');
    const r = doCreate(m, 'knowledge/乙.md');
    assert.ok(r.ids.includes('knowledge/乙.md'));
    const e = m.g.map.get('乙');
    assert.equal(e.count, 1, '不进重复条目');
    assert.equal(e.docs.length, 1);
    assert.equal(e.docs[0], m.byId.get('knowledge/乙.md'), '映射里挂的是换后的新 doc 对象');
    equiv(m, dir);
  } finally { rm(dir); }
});

test('I2：created-only 编辑重排兄弟序 → flags.tree + 被挤邻居进 ids；纯正文编辑两者皆无', () => {
  const dir = mk((d) => { wiki(d);
    fs.writeFileSync(path.join(d, 'knowledge/A.md'), '---\ntitle: A\ncreated: 2026-09-05\n---\n');
    fs.writeFileSync(path.join(d, 'knowledge/B.md'), '---\ntitle: B\ncreated: 2026-09-01\n---\n');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    assert.deepEqual(m.g.order.map((x) => x._id), ['knowledge/B.md', 'knowledge/A.md'], '初始按 created 排：B 先');
    // created-only：A 提到与 B 同日 → 平手按名序 A < B，A 挤到 B 前，B 的 prev 变了
    fs.writeFileSync(path.join(dir, 'knowledge/A.md'), '---\ntitle: A\ncreated: 2026-09-01\n---\n');
    const r = doChange(m, 'knowledge/A.md');
    assert.equal(r.flags.tree, true, '导览序重排了');
    assert.ok(r.ids.includes('knowledge/B.md'), '被挤的 B prev 变了，必须在 ids 里');
    assert.deepEqual(m.g.order.map((x) => x._id), ['knowledge/A.md', 'knowledge/B.md']);
    equiv(m, dir);
    // 纯正文编辑：序不动 → 无 tree
    fs.writeFileSync(path.join(dir, 'knowledge/A.md'), '---\ntitle: A\ncreated: 2026-09-01\n---\n加一句。');
    const r2 = doChange(m, 'knowledge/A.md');
    assert.notEqual(r2.flags.tree, true);
    equiv(m, dir);
  } finally { rm(dir); }
});

test('applyDocOps：改名（unlink+create 同批）等价重建', () => {
  const dir = mk((d) => { wiki(d);
    fs.writeFileSync(path.join(d, 'knowledge/甲.md'), '---\ntitle: 甲\ncreated: 2026-09-01\n---\n看 [[乙]]。');
    fs.writeFileSync(path.join(d, 'knowledge/乙.md'), '---\ntitle: 乙\ncreated: 2026-09-02\n---\n回 [[甲]]。');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    fs.renameSync(path.join(dir, 'knowledge/乙.md'), path.join(dir, 'knowledge/乙二.md'));
    const r = applyDocOps(m, [
      { op: 'unlink', rel: 'knowledge/乙.md' },
      { op: 'create', rel: 'knowledge/乙二.md' },
    ]);
    assert.ok(r.ids.includes('knowledge/甲.md'), '甲的 [[乙]] 翻成死链，必须在 ids 里');
    equiv(m, dir);
  } finally { rm(dir); }
});

test('路径链：目标页建出 / 删掉时翻转，与重建一致', () => {
  const dir = mk((d) => { wiki(d);
    fs.writeFileSync(path.join(d, 'knowledge/L.md'), '---\ntitle: l\ncreated: 2026-09-01\n---\n看 [[work/甲]] 与 [[knowledge/深]]。');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    assert.equal(m.dead.get('work/甲').reason, 'missing');
    fs.writeFileSync(path.join(dir, 'work/甲.md'), '---\ntitle: 甲\ncreated: 2026-09-02\n---\n');
    const r = doCreate(m, 'work/甲.md');
    assert.ok(!m.dead.has('work/甲'), '建出即命中');
    assert.ok(r.ids.includes('knowledge/L.md'), '路径链所在页必须在 ids 里');
    equiv(m, dir);
    fs.mkdirSync(path.join(dir, 'knowledge/深'));
    fs.writeFileSync(path.join(dir, 'knowledge/深/深.md'), '---\ntitle: 深\ncreated: 2026-09-03\n---\n');
    doCreate(m, 'knowledge/深/深.md');
    assert.ok(!m.dead.has('knowledge/深'), '文件夹页按文件夹路径命中');
    equiv(m, dir);
    fs.unlinkSync(path.join(dir, 'work/甲.md'));
    doUnlink(m, 'work/甲.md');
    assert.equal(m.dead.get('work/甲').reason, 'missing');
    equiv(m, dir);
  } finally { rm(dir); }
});

test('路径链写成 .index 后缀：不再剥，按字面判死链，增量与重建一致', () => {
  const dir = mk((d) => { wiki(d);
    fs.writeFileSync(path.join(d, 'knowledge/L.md'), '---\ntitle: l\ncreated: 2026-09-01\n---\n看 [[work/甲.index]]。');
  });
  try {
    const m = buildModel(dir, new DocStore(dir));
    fs.writeFileSync(path.join(dir, 'work/甲.md'), '---\ntitle: 甲\ncreated: 2026-09-02\n---\n');
    doCreate(m, 'work/甲.md');
    assert.equal(m.dead.get('work/甲.index')?.reason, 'missing');
    equiv(m, dir);
  } finally { rm(dir); }
});
