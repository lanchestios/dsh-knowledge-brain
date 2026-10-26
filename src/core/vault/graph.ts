// 全站的链接图：双链解析规则、层级树与导览序、反链，都只在这里定义一份。
// 渲染、目录树、图谱、反链全部读它——反链和页里真实可点的链接因此
// 永远一致，不会一边能跳、一边说没人引用。
//
// buildGraphFrom 是纯函数（只吃文档数组），可以单测；读库与缓存在 main/model.ts。
//
// 导览序：一层子页的先后，取父层 index 正文里 [[双链]] 首次点名的位置
// （vault 约定「子页有序不加号」）。有「读的顺序 / 阅读顺序 / 导览」专节时以专节为准；
// 都没点名的排在后面，按 created、再按名称兜底。根层（四个区）的顺序由
// areas 给出（应用里来自 .wiki/wiki.json）。文件夹里有 .folder.json 的 children.order 时
// 它最先：列出的按 order 序，没列的再按上面的规则殿后。
//
// 文件夹页：X/ 的页是 .folder.json 的 index 所指文件，缺省为同名的 X/X.md
// （folders：文件夹库内路径 → { index, order: 子节点名数组 }）。

import type { WikiDoc, FolderConf } from './vault';

export interface GraphNode {
  name: string
  rel?: string
  doc: WikiDoc | null
  parent: GraphNode | null
  children: Map<string, GraphNode>
  dir: boolean
  items?: GraphNode[]
  count?: number
}

const WIKILINK_RE = /\[\[([^\[\]|#]+)(#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]/g;
const DEFAULT_AREAS = ['经历', '认知', '学习', '知识', '系统'];

// 逐行走 markdown 的散文部分：跳过 ```/~~~ 围栏，行内按反引号切开，
// 偶数段是散文、奇数段是行内代码。fn(parts, line) 可改写偶数段，返回
// true 表示这行改过。
function walkProse(md: string, fn: (parts: string[], line: string, i: number) => boolean | void): string {
  const lines = md.split('\n');
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || line.indexOf('[[') === -1) continue;
    const parts = line.split('`');
    if (fn(parts, line, i)) lines[i] = parts.join('`');
  }
  return lines.join('\n');
}

function linksIn(parts: string[]): Array<{ target: string; anchor: string; label: string }> {
  const out = [];
  for (let j = 0; j < parts.length; j += 2) {
    const seg = parts[j];
    if (seg.indexOf('[[') === -1) continue;
    for (const m of seg.matchAll(WIKILINK_RE)) {
      const t = m[1].trim();
      if (t) out.push({ target: t, anchor: m[2] || '', label: (m[3] || t).trim() });
    }
  }
  return out;
}

// [[目标#锚|标签]] → [标签](wikilink:目标#锚)，由 render.ts 解析；无标签显示目标最后一段（路径形式只显页名）。
// 嵌入件与图片同写法（![](asset/….html)），不经这里改写
function rewriteWikilinks(md: string): string {
  return walkProse(md, (parts) => {
    let changed = false;
    for (let j = 0; j < parts.length; j += 2) {
      const seg = parts[j];
      if (seg.indexOf('[[') === -1) continue;
      parts[j] = seg.replace(WIKILINK_RE, (m: string, target: string, anchor?: string, label?: string) => {
        const t = target.trim();
        if (!t) return m;
        return '[' + (label || lastSeg(t)).trim() + '](wikilink:' + encodeURI(t) + encodeURI(anchor || '') + ')';
      });
      if (parts[j] !== seg) changed = true;
    }
    return changed;
  });
}

// 每文档链接清单（带行文本与行号）：建图（oracle）与增量手术共用的单页输入定义。
// 行文本直接喂 snippetOf，不必再切一遍正文。
export interface DocLink { target: string; anchor: string; label: string; line: string; lineNo: number }
export function linksWithLines(md: string): DocLink[] {
  const out: DocLink[] = [];
  walkProse(md, (parts: string[], line: string, lineNo: number) => {
    for (const l of linksIn(parts)) out.push({ ...l, line, lineNo });
    return false;
  });
  return out;
}

function baseName(doc: { source: string }): string {
  return doc.source.split('/').pop()!.replace(/\.md$/i, '');
}

function buildNameMap(docs: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const doc of docs) {
    if (!doc.source || !doc.path) continue;
    const base = baseName(doc);
    const e = map.get(base);
    if (e) {
      e.count += 1;
      e.docs.push(doc);
    } else {
      map.set(base, { count: 1, doc, docs: [doc], aliases: [] });
    }
  }
  return map;
}

// 双链展示名：路径形式只取最后一段
const lastSeg = (t: string): string => t.slice(t.lastIndexOf('/') + 1);

// 节点路径：从区根起，文件夹页 = 文件夹路径，叶子页 = 去 .md（与 vault-tools/lib/core/links.py 的 node_path 同口径）
function nodePath(node: any): string {
  const segs: string[] = [];
  for (let n = node; n && n.parent; n = n.parent) segs.unshift(n.name);
  return segs.join('/');
}

// 按节点路径在树里走：中间段只认文件夹，末段先文件夹后叶子（同名文件夹无页时退到叶子）
function nodeAt(g: any, p: string): any {
  const segs = p.split('/');
  let n = g.root;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const last = i === segs.length - 1;
    const dirNode = n.children.get(s);
    if (!last) { if (!dirNode?.dir) return null; n = dirNode; continue }
    if (dirNode?.dir && dirNode.doc) return dirNode;
    if (s.endsWith('.md')) return null;                      // 路径形式不带 .md（与 links.py 同口径）
    return n.children.get(s + '.md') ?? (dirNode?.dir ? dirNode : null);
  }
  return null;
}

// 解析不到的原因：裸名重名给出候选；否则 missing（沉淀区外由 deadInfo 再判）
function whyUnresolved(g: any, target: string): { reason: string; candidates: any[] } {
  const t = target.trim();
  if (t.includes('/')) return { reason: 'missing', candidates: [] };
  const e = g.map.get(t);
  return e && e.count > 1 ? { reason: 'ambiguous', candidates: [...e.docs] } : { reason: 'missing', candidates: [] };
}

// 死链条目的原因：歧义 / 沉淀区外（unpublished）/ 不存在。model 建图与 ops 增量共用这一处
function deadInfo(g: any, raws: Set<string>, target: string): { reason: string; candidates: any[] } {
  const why = whyUnresolved(g, target);
  if (why.reason !== 'missing') return why;
  const t = target.trim();
  const outside = t.includes('/') ? !g.areas.includes(t.split('/')[0]) : raws.has(t);
  return { reason: outside ? 'unpublished' : 'missing', candidates: [] };
}

// 路径形式按树精确命中；裸名只在全站唯一时命中，重名即歧义，不按来源页位置猜。
// 反链、阅读页链接、编辑器染色、导览序全走这里——一条链在哪看都指同一页（规则同 vault-tools/lib/core/links.py）
function resolveName(g: any, target: string): any {
  const t = target.trim();
  if (t.includes('/')) return nodeAt(g, t)?.doc ?? null;
  const e = g.map.get(t);
  return e && e.count === 1 ? e.doc : null;
}

function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 反链的上下文句：取链接所在那一行，剥掉 markdown 记号，命中处用 \u0001…\u0002
// 夹住，过长时以命中为中心截一个窗口，最后转义并把夹住的部分换成 <mark>。
function snippetOf(line: string, g: any, targetDoc: any): string {
  let s = line
    .replace(/^\s*(?:[-*+]\s+|\d+\.\s+|>\s*|#{1,6}\s+)+/, '')
    .replace(WIKILINK_RE, (m: string, t: string, a?: string, label?: string) => {
      const text = (label || lastSeg(t.trim())).trim();
      return resolveName(g, t) === targetDoc ? '\u0001' + text + '\u0002' : text;
    })
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s*\|\s*/g, ' ｜ ')
    .replace(/^[\s｜]+|[\s｜]+$/g, '');
  const hit = s.indexOf('\u0001');
  const LIMIT = 90;
  if (s.length > LIMIT && hit !== -1) {
    const start = Math.max(0, hit - 30);
    const end = Math.min(s.length, start + LIMIT);
    s = (start > 0 ? '…' : '') + s.slice(start, end) + (end < s.length ? '…' : '');
    // 截断可能切掉收尾标记
    if (s.indexOf('\u0001') !== -1 && s.indexOf('\u0002') === -1) s += '\u0002';
  }
  return esc(s).replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>');
}

// index 里专门写导览的那一节（标题含「读的顺序 / 阅读顺序 / 导览」）的行号集合。
// 有这一节时它说了算：很多 index 开头先放一张分工总览表，那张表的行序是版面，
// 不是阅读序。
const GUIDE_HEADING = /^#{2,4}\s+.*(读的顺序|阅读顺序|导览)/;
function guideLines(md: string): Set<number> {
  const lines = md.split('\n');
  const set = new Set<number>();
  let fence = false;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const h = line.match(/^(#{1,6})\s/);
    if (h) {
      if (GUIDE_HEADING.test(line)) { level = h[1].length; continue; }
      if (level && h[1].length <= level) level = 0;
    }
    if (level) set.add(i);
  }
  return set;
}

const sortKey = (n: GraphNode): number => (n.doc ? Date.parse(String(n.doc.created || (n.doc as any).date || '')) || 0 : Infinity);

function displayName(node: GraphNode): string {
  if (!node.parent) return '首页';
  if (!node.parent.parent && node.doc && node.doc.title) return node.doc.title;
  return node.name;
}

function crumbOf(node: GraphNode): string {
  const names = [];
  for (let p = node.parent; p && p.parent; p = p.parent) names.unshift(displayName(p));
  return names.join(' › ');
}

const areaOf = (doc: any): string => doc.source.split('/')[1];
const vaultPathOf = (doc: any): string => doc.source.replace(/^_posts\//, '');

// 导览序的来源：根层看 areas；文件夹看自己的 index 正文（原 buildGraphFrom 闭包提升为
// 模块函数，areas/folders/map/root 改从入参 g 读——refinalize 与增量手术共用一份定义）
function mentionOrder(node: GraphNode, g: any): Map<GraphNode, number> & { named?: Set<GraphNode> } {
  const pos = new Map<GraphNode, number>() as Map<GraphNode, number> & { named?: Set<GraphNode> };
  if (node === g.root) {
    for (const child of node.children.values()) {
      const i = g.areas.indexOf(child.name);
      if (i !== -1) pos.set(child, i);
    }
    return pos;
  }
  const conf = g.folders.get(node.rel!)?.order;
  const listed = new Set<GraphNode>();
  if (conf) {
    const byName = new Map([...node.children.values()].map((c) => [c.name, c]));
    conf.forEach((name: string, k: number) => {
      const child = byName.get(name);
      if (child && !pos.has(child)) { pos.set(child, -1e12 + k); listed.add(child); }
    });
    pos.named = listed;
  }
  if (!node.doc) return pos;
  const byDoc = new Map<any, GraphNode>();
  for (const child of node.children.values()) if (child.doc) byDoc.set(child.doc._id, child);
  const md = node.doc._content || '';
  const guide = guideLines(md);
  const first = new Map<GraphNode, number>();
  const later = new Map<GraphNode, number>();
  let i = 0;
  walkProse(md, (parts, line, lineNo) => {
    const bucket = guide.has(lineNo) ? first : later;
    for (const l of linksIn(parts)) {
      const d = resolveName(g, l.target);
      const child = d && byDoc.get(d._id);
      if (child && !bucket.has(child)) bucket.set(child, i);
      i++;
    }
    return false;
  });
  for (const [child, k] of first) if (!pos.has(child)) pos.set(child, k);
  for (const [child, k] of later) if (!pos.has(child)) pos.set(child, 1e9 + k);
  pos.named = new Set([...listed, ...(guide.size ? first.keys() : pos.keys())]);
  return pos;
}

// 别名重建：改指的文件夹页（如 概览.md）让 [[文件夹名]] 也解析到它。先摘上一轮加过的
// （条目上的 aliases 标记），再按当前树重加——create/unlink 摘挂节点后调 refinalize 即自动对齐
function rebuildAliases(g: any) {
  for (const [name, e] of g.map) {
    if (!e.aliases?.length) continue;
    for (const d of e.aliases) { const i = e.docs.indexOf(d); if (i >= 0) { e.docs.splice(i, 1); e.count -= 1 } }
    e.aliases = [];
    if (e.count <= 0) g.map.delete(name); else e.doc = e.docs[0];
  }
  for (const node of g.nodeOf.values()) {
    if (!node.dir || !node.doc || baseName(node.doc) === node.name) continue;
    const e = g.map.get(node.name);
    if (!e) g.map.set(node.name, { count: 1, doc: node.doc, docs: [node.doc], aliases: [node.doc] });
    else if (!e.docs.includes(node.doc)) { e.count += 1; e.docs.push(node.doc); (e.aliases ??= []).push(node.doc) }
  }
}

// 公共收尾（buildGraphFrom 与每次手术共用，单一定义）：别名 → 各层 items 排序与 count →
// 全站导览序 order/indexOf → fallback 定序 → 名字映射 docs 按导览序定序。
// O(N) 纯内存，万页约毫秒级——换「补丁后这些不变量必然成立」的安全。
export function refinalize(g: any): void {
  rebuildAliases(g);
  const fallback: any[] = [];
  (function finalize(node: any) {
    const items = [...node.children.values()];
    items.forEach(finalize);
    const pos: any = mentionOrder(node, g);
    items.sort((a, b) => {
      const pa = pos.has(a) ? pos.get(a) : Infinity;
      const pb = pos.has(b) ? pos.get(b) : Infinity;
      if (pa !== pb) return pa - pb;
      return sortKey(a) - sortKey(b) || a.name.localeCompare(b.name, 'zh');
    });
    node.items = items;
    node.count = items.reduce((s, n) => s + (n.dir ? (n.doc ? 1 : 0) + n.count : 1), 0);
    if (node !== g.root && node.dir && pos.named) {
      const miss = items.filter((c) => !pos.named.has(c));
      if (miss.length) fallback.push({ node, children: miss });
    }
  })(g.root);
  const order: any[] = [];
  (function visit(n: any) { if (n.doc) order.push(n.doc); n.items.forEach(visit) })(g.root);
  g.order = order;
  g.indexOf = new Map(order.map((d, i) => [d._id, i]));
  const at = (f: any) => (f.node.doc ? g.indexOf.get(f.node.doc._id) : Infinity);
  fallback.sort((a, b) => at(a) - at(b));
  g.fallback = fallback;
  for (const e of g.map.values()) {
    e.docs.sort((a: any, b: any) => g.indexOf.get(a._id) - g.indexOf.get(b._id));
    e.doc = e.docs[0];
  }
}

function buildGraphFrom({ posts, pages = [], areas = DEFAULT_AREAS, folders = new Map() }: { posts: any[]; pages?: any[]; areas?: string[]; folders?: Map<string, FolderConf> }): any {
  const map = buildNameMap(pages.concat(posts));

  // 层级树：_posts/<区>/<目录…>/<页>.md；文件夹页归位为文件夹自己
  const root: GraphNode = { name: '', doc: null, parent: null, children: new Map(), dir: true };
  const nodeOf = new Map<any, GraphNode>();
  for (const doc of posts) {
    if (!doc.source || !doc.path) continue;
    const parts = doc.source.split('/');
    if (parts[0] !== '_posts' || parts.length < 2) continue;
    parts.shift();
    const base = parts.pop()!.replace(/\.md$/i, '');
    let node = root;
    let rel = '';
    for (const p of parts) {
      rel = rel ? rel + '/' + p : p;
      if (!node.children.has(p)) node.children.set(p, { name: p, rel, doc: null, parent: node, children: new Map(), dir: true });
      node = node.children.get(p)!;
    }
    const pageName = parts.length ? (folders.get(rel)?.index ?? parts[parts.length - 1]) : null;
    if (base === pageName) {
      node.doc = doc;
    } else {
      const leaf = { name: base, doc, parent: node, children: new Map(), dir: false };
      node.children.set(base + '.md', leaf);
      node = leaf;
    }
    nodeOf.set(doc._id, node);
  }

  // 公共收尾先行（树排序/导览序/order/fallback/别名都在 refinalize 一处定义）
  const g: any = { root, nodeOf, backlinks: new Map(), map, order: [], indexOf: new Map(), areas, folders, dead: [], fallback: [], linksOf: new Map() };
  refinalize(g);

  // 反链：谁的正文 [[双链]] 解析到了我。父层 index 必然链向每个子页，那层关系
  // 已由上下文条给出，这里不重复列；同一来源页只取第一处的上下文句。
  // 逐页消费 linksWithLines 的清单（建图 oracle 与增量手术同一份单页输入）
  g.linksOf = new Map(posts.map((d) => [d._id, linksWithLines(d._content || '')]));
  const deadBy = new Map<string, any>();
  for (const src of posts) {
    const seen = new Set();
    for (const l of g.linksOf.get(src._id) ?? []) {
      const d = resolveName(g, l.target);
      if (!d) {
        let e = deadBy.get(l.target);
        if (!e) {
          e = Object.assign({ target: l.target, count: 0, from: new Map() }, whyUnresolved(g, l.target));
          deadBy.set(l.target, e);
        }
        e.count += 1;
        e.from.set(src, (e.from.get(src) || 0) + 1);
        continue;
      }
      if (d === src || seen.has(d._id)) continue;
      seen.add(d._id);
      const node = nodeOf.get(d._id);
      if (node && node.parent && node.parent.doc === src) continue;
      if (!g.backlinks.has(d._id)) g.backlinks.set(d._id, []);
      g.backlinks.get(d._id)!.push({ doc: src, snippet: snippetOf(l.line, g, d) });
    }
  }
  const dead = [...deadBy.values()]
    .map((e) => ({
      target: e.target,
      reason: e.reason,
      candidates: e.candidates,
      count: e.count,
      from: [...e.from].map(([doc, count]) => ({ doc, count })),
    }))
    .map((e) => ({ ...e,
      from: e.from.sort((a: any, b: any) => g.indexOf.get(a.doc._id) - g.indexOf.get(b.doc._id)),
      candidates: e.candidates.sort((a: any, b: any) => g.indexOf.get(a._id) - g.indexOf.get(b._id)),
    }))
    .sort((a, b) => b.count - a.count || a.target.localeCompare(b.target, 'zh'));
  for (const list of g.backlinks.values()) {
    // 同名来源（跨区同名页互为反链来源）必须全序：走盘序不可复现，补丁侧永远对不齐；
    // _id 是稳定全序（rel 不变序不变），spliceDiff 用同一比较器，未触碰的列表也恒成立
    list.sort((a: any, b: any) => baseName(a.doc).localeCompare(baseName(b.doc), 'zh') || a.doc._id.localeCompare(b.doc._id));
  }
  g.dead = dead;

  return g;
}

function posOf(g: any, doc: any): { i: number; n: number; parentName: string } | null {
  const node = g.nodeOf.get(doc._id);
  if (!node || !node.parent) return null;
  const p = node.parent;
  return { i: p.items!.indexOf(node) + 1, n: p.items!.length, parentName: displayName(p) };
}

function prevNext(g: any, doc: any): { prev: any; next: any } {
  const i = g.indexOf.get(doc._id);
  if (i === undefined) return { prev: null, next: null };
  return {
    prev: i > 0 ? g.order[i - 1] : null,
    next: i < g.order.length - 1 ? g.order[i + 1] : null,
  };
}

export {
  WIKILINK_RE, DEFAULT_AREAS, walkProse, rewriteWikilinks, buildNameMap, resolveName,
  mentionOrder,
  whyUnresolved, snippetOf, baseName, sortKey, guideLines, nodePath, nodeAt, deadInfo, lastSeg,
  buildGraphFrom, displayName, crumbOf, posOf, prevNext, areaOf, vaultPathOf, esc,
};
