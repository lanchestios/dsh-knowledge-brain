// src/core/vault/ops.ts
// 手术原语（引擎私有层）：create/change/unlink 对 Model 就地补丁。
// 单一定义规则：snippet、解析、导览序全部调 graph.ts 的导出——这里只做「搬哪几块」，
// 不做「怎么算」；等价性由 test/equivalence.test.js 钉死。
import { baseName, crumbOf, deadInfo, displayName, refinalize, resolveName, snippetOf, vaultPathOf, type DocLink } from './graph';
import { rawNames, readAnchors, type WikiDoc } from './vault';
import { plainText } from '../search';
import type { Model } from '../model';

export interface Flags { tree?: boolean; stats?: boolean; graph?: boolean; documents?: boolean }
export interface OpResult { ids: string[]; flags: Flags }

// 整页 html 与块级 blockHtml 同点位一起失效（spec §四：不发明新失效语义，包住既有六处）
function invalidateRender(m: Model, id: string) {
  m.html.delete(id);
  m.blockHtml.delete(id);
}

// 本页对各目标的贡献：复刻建图规则——自链不算、父 index 链子页不算、同源只取首次出现；
// dead 按出现次数计（与建图 deadBy 逐条 ++ 同口径）
interface Contrib { back: Map<string, { doc: any; snippet: string }>; deadCount: Map<string, number> }
function contribute(m: Model, rel: string, links: DocLink[]): Contrib {
  const back = new Map<string, { doc: any; snippet: string }>();
  const deadCount = new Map<string, number>();
  const seen = new Set<string>();
  const doc = m.byId.get(rel);
  for (const l of links) {
    const d = resolveName(m.g, l.target);
    if (!d) { deadCount.set(l.target, (deadCount.get(l.target) ?? 0) + 1); continue }
    if (d._id === rel || seen.has(d._id)) continue;
    seen.add(d._id);
    const node = m.g.nodeOf.get(d._id);
    if (node && node.parent && node.parent.doc && node.parent.doc._id === rel) continue;
    back.set(d._id, { doc, snippet: snippetOf(l.line, m.g, d) });
  }
  return { back, deadCount };
}

// 把「旧贡献 → 新贡献」的差落进模型：反链列表按来源过滤重排；dead 按 count 差分
function spliceDiff(m: Model, rel: string, oldC: Contrib, newC: Contrib) {
  const targets = new Set([...oldC.back.keys(), ...newC.back.keys()]);
  for (const id of targets) {
    const list = m.g.backlinks.get(id) ?? [];
    const kept = list.filter((b: any) => b.doc._id !== rel);
    const add = newC.back.get(id);
    if (add) kept.push(add);
    kept.sort((a: any, b: any) => baseName(a.doc).localeCompare(baseName(b.doc), 'zh') || a.doc._id.localeCompare(b.doc._id));
    if (kept.length) m.g.backlinks.set(id, kept); else m.g.backlinks.delete(id);
  }
  const names = new Set([...oldC.deadCount.keys(), ...newC.deadCount.keys()]);
  for (const t of names) {
    const delta = (newC.deadCount.get(t) ?? 0) - (oldC.deadCount.get(t) ?? 0);
    if (delta) deadAdjust(m, t, rel, delta);
  }
}

function deadAdjust(m: Model, t: string, srcRel: string, delta: number) {
  let e = m.dead.get(t);
  if (!e) {
    if (delta <= 0) return;
    const why = deadInfo(m.g, m.raws, t);
    e = { target: t, reason: why.reason, candidates: why.candidates, count: 0, from: [] };
    m.dead.set(t, e);
  }
  e.count += delta;
  const at = e.from.findIndex((f: any) => f.doc._id === srcRel);
  if (at >= 0) {
    const c = e.from[at].count + delta;
    if (c <= 0) e.from.splice(at, 1); else e.from[at] = { doc: e.from[at].doc, count: c };
  } else if (delta > 0 && m.byId.get(srcRel)) {
    e.from.push({ doc: m.byId.get(srcRel), count: delta });
  }
  e.from.sort((a: any, b: any) => m.g.indexOf.get(a.doc._id) - m.g.indexOf.get(b.doc._id));
  if (e.count <= 0) m.dead.delete(t); else refreshDeadReason(m, t);
  syncDeadArray(m);
}

function refreshDeadReason(m: Model, t: string) {
  const e = m.dead.get(t); if (!e) return;
  const why = deadInfo(m.g, m.raws, t);
  e.reason = why.reason;
  e.candidates = [...why.candidates].sort((a: any, b: any) => m.g.indexOf.get(a._id) - m.g.indexOf.get(b._id));
}

// 收尾不变量：refinalize 会重排导览序（indexOf 重编号）、create/unlink 会动名字映射，
// 既有 dead 条目的 from/candidates 定序与 reason 都以这两者为据——每步操作结束统一重排
// 重算，未触碰的条目也与重建一致（否则停留在最后一次 deadAdjust 那一刻的快照，与重建分叉；
// equivalence fuzz 抓到的真 bug）。O(|dead|)，dead 规模与页数同级，毫秒内。
function finalizeDead(m: Model) {
  for (const t of [...m.dead.keys()]) {
    refreshDeadReason(m, t);
    m.dead.get(t)!.from.sort((a: any, b: any) => m.g.indexOf.get(a.doc._id) - m.g.indexOf.get(b.doc._id));
  }
  syncDeadArray(m);
}

// m.dead（Map，render 读）与 g.dead（数组，定序视图）保持一致
function syncDeadArray(m: Model) {
  m.g.dead = [...m.dead.values()].sort((a: any, b: any) => b.count - a.count || a.target.localeCompare(b.target, 'zh'));
}

// 同路径换 doc 对象：byId、树节点、名字映射里挂的还是旧引用，一并换掉
function swapDocRefs(m: Model, rel: string, oldDoc: any, newDoc: any) {
  m.byId.set(rel, newDoc);
  const node = m.g.nodeOf.get(rel);
  if (node) node.doc = newDoc;
  const keys = new Set([baseName(newDoc)]);
  if (node?.dir) keys.add(node.name);                       // 文件夹 index 的别名条目
  for (const key of keys) {
    const e = m.g.map.get(key); if (!e) continue;
    const i = e.docs.indexOf(oldDoc);
    if (i >= 0) e.docs[i] = newDoc;
    if (e.doc === oldDoc) e.doc = newDoc;
  }
}

// MiniSearch 增量：discard 未知 id 会 throw，先查 texts；删页走 discard+texts.delete
function reindex(m: Model, ids: string[]) {
  for (const id of ids) {
    const d = m.byId.get(id);
    if (!d) {
      if (m.search.texts.has(id)) { try { m.search.ms.discard(id) } catch { /* 不在索引就算了 */ } m.search.texts.delete(id) }
      continue;
    }
    if (m.search.texts.has(id)) { try { m.search.ms.discard(id) } catch { /* 同上 */ } }
    const node = m.g.nodeOf.get(id);
    const text = plainText(d._content || '');
    m.search.texts.set(id, text);
    m.search.ms.add({ id, title: displayName(node), crumb: crumbOf(node), text });
  }
}

export function doChange(m: Model, rel: string): OpResult {
  const unit = m.store ? m.store.get(rel) : null;
  if (!unit) return doUnlink(m, rel);                       // 读不回 = 文件没了
  const oldDoc = m.byId.get(rel);
  if (!oldDoc) return doCreate(m, rel);                     // 防御：没见过按建
  const oldLinks = m.g.linksOf.get(rel) ?? [];
  const oldC = contribute(m, rel, oldLinks);
  swapDocRefs(m, rel, oldDoc, unit.doc);
  m.g.linksOf.set(rel, unit.links);
  m.embedOf.set(rel, unit.embeds);
  invalidateRender(m, rel);
  // 排序敏感快照：created 进 sortKey（兄弟序平手判定），frontmatter-only 编辑也可能重排
  // 导览序、动邻居的 prev/next——refinalize 前拍下 order 与相邻对，之后比对（O(N)，refinalize 本就 O(N)）
  const orderBefore: string[] = m.g.order.map((d: any) => d._id as string);
  const pnBefore = orderBefore.map((id, i) => [orderBefore[i - 1] ?? null, orderBefore[i + 1] ?? null] as [string | null, string | null]);
  refinalize(m.g);
  const orderAfter: string[] = m.g.order.map((d: any) => d._id as string);
  const movedIds: string[] = [];
  if (orderBefore.length !== orderAfter.length || orderBefore.some((id, i) => id !== orderAfter[i])) {
    // 每页 (prev,next) 相邻对变了就记下（prev/next = order 相邻，见 graph.prevNext）
    const posAfter = new Map<string, number>(orderAfter.map((id, i) => [id, i] as const));
    for (let i = 0; i < orderBefore.length; i++) {
      const j = posAfter.get(orderBefore[i]);
      if (j === undefined) continue;                          // 防御：change 不增删页，理论上不会走到
      if (pnBefore[i][0] !== (orderAfter[j - 1] ?? null) || pnBefore[i][1] !== (orderAfter[j + 1] ?? null)) movedIds.push(orderBefore[i]);
    }
  }
  const newC = contribute(m, rel, unit.links);
  spliceDiff(m, rel, oldC, newC);
  finalizeDead(m);
  // 载荷：自己 + 反链列表变了的页；链接目标集变了才算 graph 面
  const ids = new Set<string>([rel]);
  for (const id of [...oldC.back.keys(), ...newC.back.keys()]) ids.add(id);
  const oldT = [...oldC.back.keys()].sort(); const newT = [...newC.back.keys()].sort();
  const flags: Flags = {};
  if (JSON.stringify(oldT) !== JSON.stringify(newT)) flags.graph = true;
  if (movedIds.length) { flags.tree = true; for (const id of movedIds) ids.add(id) }
  // —— 三个特例（spec「手术不变量」）——
  const node = m.g.nodeOf.get(rel);
  const FM_KEYS: (keyof WikiDoc)[] = ['title', 'description', 'tags', 'status', 'updated', 'created', 'sources'];
  if (FM_KEYS.some((k) => JSON.stringify(oldDoc[k]) !== JSON.stringify(unit.doc[k]))) flags.stats = true;
  if (node?.dir) {
    flags.tree = true;
    const visit = (n: any) => { if (n.doc) ids.add(n.doc._id); (n.items ?? []).forEach(visit) };
    visit(node);
  }
  if (node && node.parent === m.g.root && oldDoc.title !== unit.doc.title) {
    flags.tree = true;
    flags.graph = true;                                       // 图节点带 crumb，区名变了全区图面也变
    for (const d of m.g.order) if (d.source.split('/')[1] === node.name) ids.add(d._id);
  }
  reindex(m, [...ids]);
  return { ids: [...ids], flags };
}

// 受影响名字写了哪些文档：改 map 之前收集（含本页），翻转后逐个重算
// 页在树里的节点路径（路径形式双链的目标）：文件夹页 = 文件夹路径，否则去 .md。与 attachNode 同口径
function nodeKeyOf(m: Model, rel: string): string {
  const segs = rel.split('/');
  const base = segs[segs.length - 1].replace(/\.md$/i, '');
  if (segs.length > 1) {
    const dir = segs.slice(0, -1).join('/');
    if (base === (m.folders.get(dir)?.index ?? segs[segs.length - 2])) return dir;
  }
  return rel.replace(/\.md$/i, '');
}

function linkersOf(m: Model, names: Set<string>): string[] {
  const ids = new Set<string>();
  for (const [rel, links] of m.g.linksOf) {
    for (const l of links) if (names.has(l.target) || names.has(l.target.trim())) { ids.add(rel); break }
  }
  return [...ids];
}

function attachNode(m: Model, rel: string, doc: any) {
  const parts = rel.split('/');
  parts.pop();                                              // 剩目录链
  let node = m.g.root;
  let dir = '';
  for (const p of parts) {
    dir = dir ? dir + '/' + p : p;
    if (!node.children.has(p)) node.children.set(p, { name: p, rel: dir, doc: null, parent: node, children: new Map(), dir: true });
    node = node.children.get(p);
  }
  const base = rel.split('/').pop()!.replace(/\.md$/i, '');
  const pageName = parts.length ? (m.folders.get(dir)?.index ?? parts[parts.length - 1]) : null;
  let leaf = node;
  if (base === pageName) node.doc = doc;                    // 文件夹页归位为文件夹自己
  else {
    leaf = { name: base, doc, parent: node, children: new Map(), dir: false };
    node.children.set(base + '.md', leaf);
  }
  m.g.nodeOf.set(rel, leaf);
}

function detachNode(m: Model, rel: string) {
  const node = m.g.nodeOf.get(rel);
  if (!node) return;
  m.g.nodeOf.delete(rel);
  let n = node;
  if (n.dir) n.doc = null;                                  // 文件夹 index 只清 doc
  else { n.parent.children.delete(n.name + '.md'); n = n.parent }
  while (n !== m.g.root && n.dir && !n.doc && n.children.size === 0) {
    const p = n.parent; p.children.delete(n.name); n = p;   // 剪空目录链
  }
}

function addName(m: Model, base: string, doc: any) {
  const e = m.g.map.get(base);
  if (e) { e.count += 1; e.docs.push(doc) }
  else m.g.map.set(base, { count: 1, doc, docs: [doc], aliases: [] });
}
function removeName(m: Model, base: string, doc: any) {
  const e = m.g.map.get(base);
  if (!e) return;
  const i = e.docs.indexOf(doc);
  if (i >= 0) { e.docs.splice(i, 1); e.count -= 1 }
  if (e.count <= 0) m.g.map.delete(base); else e.doc = e.docs[0];
}

export function doCreate(m: Model, rel: string): OpResult {
  // 同路径删了又建（引擎防抖窗 last-event-wins 只会送达 add）：页还在模型里，走 doChange 的
  // 换 doc/差分路径——直接 addName 会推进重复条目（假歧义、反链丢失）
  if (m.byId.has(rel)) return doChange(m, rel);
  const unit = m.store ? m.store.get(rel) : null;
  if (!unit) return { ids: [], flags: {} };
  const base = baseName(unit.doc);
  const names = new Set([base]);
  // 文件夹别名：.folder.json 指了 index 且文件名 ≠ 文件夹名时，refinalize→rebuildAliases 会把
  // [[文件夹名]] 的解析也翻到本页——linkersOf 必须把文件夹名一并收进受影响名字（改 map 前收集）
  const segs = rel.split('/');
  if (segs.length > 1) {
    const dirName = segs[segs.length - 2];
    const dirOf = segs.slice(0, -1).join('/');
    const pageName = m.folders.get(dirOf)?.index ?? dirName;   // 与 attachNode 同口径
    if (base === pageName && base !== dirName) names.add(dirName);
  }
  names.add(nodeKeyOf(m, rel));                             // 路径形式双链按节点路径指它
  const linkers = linkersOf(m, names);                      // 收集在改 map 之前
  const linkerOld = new Map(linkers.filter((l) => l !== rel)
    .map((l) => [l, contribute(m, l, m.g.linksOf.get(l) ?? [])]));
  attachNode(m, rel, unit.doc);
  addName(m, base, unit.doc);
  m.byId.set(rel, unit.doc);
  m.g.linksOf.set(rel, unit.links);
  m.embedOf.set(rel, unit.embeds);
  refinalize(m.g);
  const own = contribute(m, rel, unit.links);
  spliceDiff(m, rel, { back: new Map(), deadCount: new Map() }, own);
  for (const l of linkers) {
    if (l === rel) continue;
    spliceDiff(m, l, linkerOld.get(l)!, contribute(m, l, m.g.linksOf.get(l) ?? []));
  }
  finalizeDead(m);
  const ids = new Set<string>([rel, ...linkers, ...own.back.keys()]);
  for (const l of linkers) invalidateRender(m, l);
  reindex(m, [...ids]);
  return { ids: [...ids], flags: { tree: true, graph: true, stats: true } };
}

export function doUnlink(m: Model, rel: string): OpResult {
  const doc = m.byId.get(rel);
  if (!doc) return { ids: [], flags: {} };
  const base = baseName(doc);
  const names = new Set([base]);
  const node = m.g.nodeOf.get(rel);
  if (node?.dir && baseName(doc) !== node.name) names.add(node.name);   // 文件夹别名（见 doCreate 同款注释）
  names.add(nodeKeyOf(m, rel));                             // 路径形式双链按节点路径指它
  const linkers = linkersOf(m, names).filter((l) => l !== rel);
  const old = contribute(m, rel, m.g.linksOf.get(rel) ?? []);
  const linkerOld = new Map(linkers.map((l) => [l, contribute(m, l, m.g.linksOf.get(l) ?? [])]));
  detachNode(m, rel);
  removeName(m, base, doc);
  m.byId.delete(rel);
  m.g.linksOf.delete(rel);
  m.embedOf.delete(rel);
  refinalize(m.g);
  spliceDiff(m, rel, old, { back: new Map(), deadCount: new Map() });
  for (const l of linkers) spliceDiff(m, l, linkerOld.get(l)!, contribute(m, l, m.g.linksOf.get(l) ?? []));
  finalizeDead(m);
  const ids = new Set<string>([rel, ...linkers, ...old.back.keys()]);
  invalidateRender(m, rel);
  for (const l of linkers) invalidateRender(m, l);
  reindex(m, [...ids]);
  return { ids: [...ids], flags: { tree: true, graph: true, stats: true } };
}

export interface DocOp { op: 'create' | 'change' | 'unlink'; rel: string }

// 批内先 unlink 再 create 再 change：改名（unlink+add）的名字翻转才与重建语义一致
export function applyDocOps(m: Model, ops: DocOp[]): OpResult {
  const rank = { unlink: 0, create: 1, change: 2 };
  const ids = new Set<string>();
  const flags: Flags = {};
  for (const o of [...ops].sort((a, b) => rank[a.op] - rank[b.op])) {
    const r = o.op === 'unlink' ? doUnlink(m, o.rel) : o.op === 'create' ? doCreate(m, o.rel) : doChange(m, o.rel);
    for (const id of r.ids) ids.add(id);
    for (const k of Object.keys(r.flags) as (keyof Flags)[]) if (r.flags[k]) flags[k] = true;
  }
  return { ids: [...ids], flags };
}

// asset 变更：模型数据不动，只作废嵌入了它的页的 html（渲染时会把 mtime 版本号写进 iframe src）
export function applyAssets(m: Model, assets: string[]): OpResult {
  if (!assets.length) return { ids: [], flags: {} };
  const hit: string[] = [];
  for (const [id, embeds] of m.embedOf) {
    if (embeds.some((e) => assets.includes(e))) { hit.push(id); invalidateRender(m, id) }
  }
  return { ids: hit, flags: {} };
}

// raw/ 变更：rawNames 重算 + 死链 missing↔unpublished 翻转；ids=写这些名的页面（它们的渲染变了）
export function applyRaws(m: Model, rels: string[]): OpResult {
  if (!rels.length) return { ids: [], flags: {} };
  const names = new Set(rels.map((r) => r.split('/').pop()!.replace(/\.md$/i, '').normalize('NFC')));
  m.raws = rawNames(m.dir);
  for (const t of [...m.dead.keys()]) refreshDeadReason(m, t);
  syncDeadArray(m);
  const ids = linkersOf(m, names);
  for (const id of ids) invalidateRender(m, id);
  return { ids, flags: { documents: true } };
}

// anchors.conf 变更：重读；ids=基线命中的页。匹配规则逐条复刻 pagemeta.baselinesFor：
// 前缀只认 anatomy/ 开头的段，vaultPath（source 去 _posts/ 前缀）相等或落其子路径才算。
// ⚠ 与 pagemeta.baselinesFor 有意分歧（勿合并、勿静默对齐）：这里零 repos 的命中段也算页命中
// （ids 进载荷 → 重渲染，多失效便宜）；baselinesFor 只收 repos，零 repos 段产出空基线列表。
export function applyAnchors(m: Model): OpResult {
  m.anchors = readAnchors(m.dir);
  const ids: string[] = [];
  for (const d of m.g.order) {
    const vp = vaultPathOf(d);
    if ((m.anchors as any[]).some((s) => s.prefix.startsWith('anatomy/') && (vp === s.prefix || vp.startsWith(s.prefix + '/')))) ids.push(d._id);
  }
  return { ids, flags: { stats: true } };
}
