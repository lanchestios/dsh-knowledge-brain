// test/equivalence.test.js —— 手术等价性模糊测试：随机库 × 随机操作序列，
// 每步 applyDocOps 后与全新 buildModel 逐字段对比；html 缓存验「渲染输入变了 → 条目必不在」。
// 失败信息带 seed 与步号：本地复现用 test.only + 固定 seed。
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { buildModel } from '../src/core/model.ts';
import { DocStore } from '../src/core/vault/docstore.ts';
import { applyDocOps } from '../src/core/vault/ops.ts';
import { BlockHtmlCache } from '../src/core/vault/blockcache.ts';
import { resolveName } from '../src/core/vault/graph.ts';

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

const AREAS = ['thought', 'anatomy', 'knowledge', 'work'];
const DIRS = ['', 'ML', 'notes/deep', '项目'];
const NAMES = ['甲', '乙', '丙', '项目', '书', '概览', 'index', 'A', 'B', 'x1', 'x2', 'ML'];
const PATHS = ['knowledge/ML', 'knowledge/ML/甲', 'work/项目/乙', 'thought/A', 'knowledge/没有'];

const fmOf = (r, name) =>
  `---\ntitle: ${r() < 0.3 ? name + '稿' : name}\nstatus: ${pick(r, ['stable', 'draft'])}\ntags: [${pick(r, ['概念', '笔记', ''])}]\ncreated: 2026-09-0${1 + Math.floor(r() * 9)}\n---\n`;
const bodyOf = (r, names) => {
  const lines = [];
  for (let i = 0; i < 3 + Math.floor(r() * 4); i++) {
    const n = r() < 0.25 ? pick(r, PATHS) : pick(r, names);
    lines.push(pick(r, [`看 [[${n}]] 一眼`, `详见 [[${n}#锚|别名]]`, `普通一句话`, `嵌 ![](asset/a${Math.floor(r() * 3)}.png)`]));
  }
  if (r() < 0.3) lines.push('## 读的顺序', '', `1. [[${pick(r, names)}]]`, `2. [[${pick(r, names)}]]`);
  if (r() < 0.2) lines.push('```', `[[围栏里的${pick(r, NAMES)}不算]]`, '```');
  return lines.join('\n') + '\n';
};

const genVault = (dir, r) => {
  fs.mkdirSync(path.join(dir, '.wiki'));
  fs.writeFileSync(path.join(dir, '.wiki', 'wiki.json'),
    JSON.stringify({ version: 3, parts: { thought: { order: 1 }, anatomy: { order: 2 }, knowledge: { order: 3 }, work: { order: 4 } } }));
  for (const a of AREAS) fs.mkdirSync(path.join(dir, a));
  if (r() < 0.5) {                                    // 一个带 index 的文件夹
    fs.mkdirSync(path.join(dir, 'knowledge', 'ML'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'knowledge', 'ML', '.folder.json'), JSON.stringify({ index: '概览', children: {} }));
  }
  const live = new Set();
  for (let i = 0; i < 10 + Math.floor(r() * 10); i++) {
    const sub = pick(r, DIRS);   // 只 pick 一次：ternary 里二次 pick 会拼出 '//'（POSIX 落盘折叠 → 假 clobber）
    const rel = `${pick(r, AREAS)}${sub ? '/' + sub : ''}/${pick(r, NAMES)}${r() < 0.4 ? '' : i}.md`;
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, fmOf(r, rel.split('/').pop().replace(/\.md$/, '')) + bodyOf(r, NAMES));
    live.add(rel);
  }
  return live;
};

// 逐字段对比（ops.test 的 equiv 全量版：多 dead 定序、map docs 序、fallback、aliases 效果都过 docs 序体现）
const at = (x) => JSON.stringify(x);

const equiv = (m, dir, seed, step) => {
  const f = buildModel(dir);
  assert.deepEqual([...m.byId.keys()].sort(), [...f.byId.keys()].sort(), `seed${seed} step${step} byId 键集`);
  for (const [id, d] of f.byId) for (const k of ['title', 'tags', 'status', 'created', '_content', 'offline'])
    assert.equal(at(m.byId.get(id)?.[k]), at(d[k]), `seed${seed} step${step} ${id}.${k}`);
  const shape = (n) => ({ name: n.name, dir: n.dir, docId: n.doc?._id ?? null, count: n.count, items: (n.items ?? []).map(shape), children: [...n.children.keys()].sort() });
  assert.deepEqual(shape(m.g.root), shape(f.g.root), `seed${seed} step${step} 树形状`);
  assert.deepEqual(m.g.order.map((d) => d._id), f.g.order.map((d) => d._id), `seed${seed} step${step} 导览序`);
  assert.deepEqual(m.g.fallback.map((x) => x.node.name), f.g.fallback.map((x) => x.node.name), `seed${seed} step${step} fallback`);
  const bl = (g) => at([...g.backlinks].map(([k, l]) => [k, l.map((b) => [b.doc._id, b.snippet])]).sort());
  assert.equal(bl(m.g), bl(f.g), `seed${seed} step${step} 反链`);
  const mp = (g) => at([...g.map].map(([k, e]) => [k, e.count, e.docs.map((d) => d._id)]).sort());
  assert.equal(mp(m.g), mp(f.g), `seed${seed} step${step} 名字映射`);
  const dd = (x) => at([...x.dead].map(([t, e]) => [t, e.reason, e.candidates.map((d) => d._id), e.count, e.from.map((y) => [y.doc._id, y.count])]).sort());
  assert.equal(dd(m), dd(f), `seed${seed} step${step} dead`);
  for (const q of ['甲', '乙', 'index', '概念']) {
    const a = m.search.ms.search(q).map((x) => x.id).sort();
    const b = f.search.ms.search(q).map((x) => x.id).sort();
    assert.deepEqual(a, b, `seed${seed} step${step} search:${q}`);
  }
};

const fingerprint = (m, id) => {
  const d = m.byId.get(id); if (!d) return null;
  const links = (m.g.linksOf.get(id) ?? []).map((l) => [l.target, resolveName(m.g, l.target)?._id ?? null]);   // 链接解析结果用真函数
  return at([d._content, links, m.embedOf.get(id) ?? []]);
};

test('模糊：30 个种子 × 40 步随机操作，每步等价 + html 失效性质', { timeout: 120_000 }, () => {
  for (let seed = 1; seed <= 30; seed++) {
    const r = mulberry32(seed);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-fuzz-${seed}-`));
    try {
      const live = genVault(dir, r);
      const st = new DocStore(dir);
      const m = buildModel(dir, st);
      for (const id of live) { m.html.set(id, Promise.resolve({ html: '哨', toc: [] })); m.blockHtml.set(id, new BlockHtmlCache()) }   // 预置全量缓存条目（两套一起）
      for (let step = 1; step <= 40; step++) {
        const before = new Map([...live].map((id) => [id, fingerprint(m, id)]));
        const ops = [];
        const roll = r();
        if (roll < 0.45 && live.size) {                       // 编辑
          const rel = pick(r, [...live]);
          fs.writeFileSync(path.join(dir, rel), fmOf(r, rel.split('/').pop().replace(/\.md$/, '')) + bodyOf(r, NAMES));
          ops.push({ op: 'change', rel });
        } else if (roll < 0.7) {                              // 新建（同名概率高 → 歧义/翻转）
          let rel = '';
          while (rel === '' || live.has(rel)) {
            const sub = pick(r, DIRS);   // 只 pick 一次：见 genVault 注释
            rel = `${pick(r, AREAS)}${sub ? '/' + sub : ''}/${pick(r, NAMES)}${r() < 0.4 ? '' : 'n' + step}.md`;
          }
          fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
          fs.writeFileSync(path.join(dir, rel), fmOf(r, rel.split('/').pop().replace(/\.md$/, '')) + bodyOf(r, NAMES));
          live.add(rel);
          ops.push({ op: 'create', rel });
        } else if (roll < 0.9 && live.size > 3) {             // 删除
          const rel = pick(r, [...live]);
          fs.unlinkSync(path.join(dir, rel));
          live.delete(rel);
          ops.push({ op: 'unlink', rel });
        } else if (live.size > 2) {                           // 改名 = unlink + create
          const from = pick(r, [...live]);
          const dirOf = from.split('/').slice(0, -1).join('/');
          let to = `${dirOf}/${pick(r, NAMES)}${r() < 0.4 ? '' : 'r' + step}.md`;
          while (live.has(to)) to = `${dirOf}/${pick(r, NAMES)}${r() < 0.4 ? '' : 'r' + step}.md`;
          fs.renameSync(path.join(dir, from), path.join(dir, to));
          live.delete(from); live.add(to);
          ops.push({ op: 'unlink', rel: from }, { op: 'create', rel: to });
        }
        applyDocOps(m, ops);
        equiv(m, dir, seed, step);
        // html 性质：指纹变了（或页没了）的 id，缓存条目必不在；没变的可以还在
        for (const [id, fp] of before) {
          const now = fingerprint(m, id);
          if (at([fp]) !== at([now])) assert.ok(!m.html.has(id), `seed${seed} step${step} ${id} 指纹变了缓存还在（欠失效）`);
        }
        // 双删性质：html 与 blockHtml 在同六个点位一起失效——两套缓存的在场集合永不分叉
        for (const id of [...m.byId.keys()]) assert.equal(m.html.has(id), m.blockHtml.has(id), `seed${seed} step${step} ${id} html/blockHtml 失效不同步`);
        for (const id of [...m.byId.keys()]) { m.html.set(id, Promise.resolve({ html: '哨', toc: [] })); m.blockHtml.set(id, new BlockHtmlCache()) }   // 回填，下一步继续验
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
