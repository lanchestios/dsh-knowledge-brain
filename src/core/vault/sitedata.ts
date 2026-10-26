// 浏览器端要的两份数据：tree.json（侧栏目录树、搜索结果路径、继续读的校验）与
// graph.json（全局图与局部图）。只从链接图派生，不另读文件。
// href(doc) 由调用方给（应用里是 d => d._id），便于单测。

import * as wg from './graph';

function treeJson(g: any, href: (d: any) => string | null) {
  function conv(node: any) {
    return {
      name: wg.displayName(node),
      path: node.doc ? href(node.doc) : null,
      // 节点的库内路径：目录是目录路径（path 是索引页 id，当不了文件夹路径；displayName 首层还会被
      // 索引页标题替换），文件是 .md 路径（= 页 id）。绑定下拉、目录拖动这类「要指认节点」的消费者用 rel
      rel: node.dir ? (node.rel ?? null) : (node.doc ? href(node.doc) : null),
      desc: (node.doc && node.doc.description) || '',
      dir: !!node.dir,
      count: node.dir ? node.count : 0,
      children: node.items.map(conv),
    };
  }
  return { children: g.root.items.map(conv) };
}

function graphJson(g: any, href: (d: any) => string | null) {
  const idOf = new Map();
  const nodes = g.order.map((doc: any) => {
    const node = g.nodeOf.get(doc._id);
    const id = href(doc);
    idOf.set(doc._id, id);
    return { id, name: wg.displayName(node), crumb: wg.crumbOf(node), area: wg.areaOf(doc), index: !!node.dir, indeg: 0, outdeg: 0 };
  });
  const byId = new Map<any, any>(nodes.map((n: any) => [n.id, n]));
  const edges = [];
  for (const [tid, list] of g.backlinks) {
    const t = idOf.get(tid);
    if (!t) continue;
    for (const b of list) {
      const s = idOf.get(b.doc._id);
      if (!s) continue;
      edges.push({ s, t, type: 'ref' });
      byId.get(s).outdeg += 1;
      byId.get(t).indeg += 1;
    }
  }
  for (const doc of g.order) {
    const p = g.nodeOf.get(doc._id).parent;
    if (p && p.parent && p.doc) edges.push({ s: idOf.get(p.doc._id), t: idOf.get(doc._id), type: 'tree' });
  }
  return { nodes, edges };
}

export { treeJson, graphJson };
