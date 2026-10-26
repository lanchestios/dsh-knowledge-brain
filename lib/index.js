// src/core/vault/engine.ts
import path6, { join as join2 } from "node:path";
import { existsSync as existsSync2, mkdirSync, readdirSync as readdirSync2, statSync as statSync3 } from "node:fs";
import { execFile } from "node:child_process";
import { watch } from "chokidar";

// src/core/vault/graph.ts
var WIKILINK_RE = /\[\[([^\[\]|#]+)(#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]/g;
var DEFAULT_AREAS = ["\u7ECF\u5386", "\u8BA4\u77E5", "\u5B66\u4E60", "\u77E5\u8BC6", "\u7CFB\u7EDF"];
function walkProse(md3, fn) {
  const lines = md3.split("\n");
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || line.indexOf("[[") === -1) continue;
    const parts = line.split("`");
    if (fn(parts, line, i)) lines[i] = parts.join("`");
  }
  return lines.join("\n");
}
function linksIn(parts) {
  const out = [];
  for (let j = 0; j < parts.length; j += 2) {
    const seg2 = parts[j];
    if (seg2.indexOf("[[") === -1) continue;
    for (const m of seg2.matchAll(WIKILINK_RE)) {
      const t = m[1].trim();
      if (t) out.push({ target: t, anchor: m[2] || "", label: (m[3] || t).trim() });
    }
  }
  return out;
}
function rewriteWikilinks(md3) {
  return walkProse(md3, (parts) => {
    let changed = false;
    for (let j = 0; j < parts.length; j += 2) {
      const seg2 = parts[j];
      if (seg2.indexOf("[[") === -1) continue;
      parts[j] = seg2.replace(WIKILINK_RE, (m, target2, anchor, label) => {
        const t = target2.trim();
        if (!t) return m;
        return "[" + (label || lastSeg(t)).trim() + "](wikilink:" + encodeURI(t) + encodeURI(anchor || "") + ")";
      });
      if (parts[j] !== seg2) changed = true;
    }
    return changed;
  });
}
function linksWithLines(md3) {
  const out = [];
  walkProse(md3, (parts, line, lineNo) => {
    for (const l of linksIn(parts)) out.push({ ...l, line, lineNo });
    return false;
  });
  return out;
}
function baseName(doc) {
  return doc.source.split("/").pop().replace(/\.md$/i, "");
}
function buildNameMap(docs) {
  const map = /* @__PURE__ */ new Map();
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
var lastSeg = (t) => t.slice(t.lastIndexOf("/") + 1);
function nodePath(node) {
  const segs2 = [];
  for (let n = node; n && n.parent; n = n.parent) segs2.unshift(n.name);
  return segs2.join("/");
}
function nodeAt(g, p) {
  const segs2 = p.split("/");
  let n = g.root;
  for (let i = 0; i < segs2.length; i++) {
    const s = segs2[i];
    const last = i === segs2.length - 1;
    const dirNode = n.children.get(s);
    if (!last) {
      if (!dirNode?.dir) return null;
      n = dirNode;
      continue;
    }
    if (dirNode?.dir && dirNode.doc) return dirNode;
    if (s.endsWith(".md")) return null;
    return n.children.get(s + ".md") ?? (dirNode?.dir ? dirNode : null);
  }
  return null;
}
function whyUnresolved(g, target2) {
  const t = target2.trim();
  if (t.includes("/")) return { reason: "missing", candidates: [] };
  const e = g.map.get(t);
  return e && e.count > 1 ? { reason: "ambiguous", candidates: [...e.docs] } : { reason: "missing", candidates: [] };
}
function deadInfo(g, raws, target2) {
  const why = whyUnresolved(g, target2);
  if (why.reason !== "missing") return why;
  const t = target2.trim();
  const outside = t.includes("/") ? !g.areas.includes(t.split("/")[0]) : raws.has(t);
  return { reason: outside ? "unpublished" : "missing", candidates: [] };
}
function resolveName(g, target2) {
  const t = target2.trim();
  if (t.includes("/")) return nodeAt(g, t)?.doc ?? null;
  const e = g.map.get(t);
  return e && e.count === 1 ? e.doc : null;
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function snippetOf(line, g, targetDoc) {
  let s = line.replace(/^\s*(?:[-*+]\s+|\d+\.\s+|>\s*|#{1,6}\s+)+/, "").replace(WIKILINK_RE, (m, t, a, label) => {
    const text = (label || lastSeg(t.trim())).trim();
    return resolveName(g, t) === targetDoc ? "" + text + "" : text;
  }).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__|`/g, "").replace(/\s*\|\s*/g, " \uFF5C ").replace(/^[\s｜]+|[\s｜]+$/g, "");
  const hit = s.indexOf("");
  const LIMIT = 90;
  if (s.length > LIMIT && hit !== -1) {
    const start = Math.max(0, hit - 30);
    const end = Math.min(s.length, start + LIMIT);
    s = (start > 0 ? "\u2026" : "") + s.slice(start, end) + (end < s.length ? "\u2026" : "");
    if (s.indexOf("") !== -1 && s.indexOf("") === -1) s += "";
  }
  return esc(s).replace(/\u0001/g, "<mark>").replace(/\u0002/g, "</mark>");
}
var GUIDE_HEADING = /^#{2,4}\s+.*(读的顺序|阅读顺序|导览)/;
function guideLines(md3) {
  const lines = md3.split("\n");
  const set = /* @__PURE__ */ new Set();
  let fence = false;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const h = line.match(/^(#{1,6})\s/);
    if (h) {
      if (GUIDE_HEADING.test(line)) {
        level = h[1].length;
        continue;
      }
      if (level && h[1].length <= level) level = 0;
    }
    if (level) set.add(i);
  }
  return set;
}
var sortKey = (n) => n.doc ? Date.parse(String(n.doc.created || n.doc.date || "")) || 0 : Infinity;
function displayName(node) {
  if (!node.parent) return "\u9996\u9875";
  if (!node.parent.parent && node.doc && node.doc.title) return node.doc.title;
  return node.name;
}
function crumbOf(node) {
  const names = [];
  for (let p = node.parent; p && p.parent; p = p.parent) names.unshift(displayName(p));
  return names.join(" \u203A ");
}
var areaOf = (doc) => doc.source.split("/")[1];
var vaultPathOf = (doc) => doc.source.replace(/^_posts\//, "");
function mentionOrder(node, g) {
  const pos = /* @__PURE__ */ new Map();
  if (node === g.root) {
    for (const child of node.children.values()) {
      const i2 = g.areas.indexOf(child.name);
      if (i2 !== -1) pos.set(child, i2);
    }
    return pos;
  }
  const conf = g.folders.get(node.rel)?.order;
  const listed = /* @__PURE__ */ new Set();
  if (conf) {
    const byName2 = new Map([...node.children.values()].map((c) => [c.name, c]));
    conf.forEach((name2, k) => {
      const child = byName2.get(name2);
      if (child && !pos.has(child)) {
        pos.set(child, -1e12 + k);
        listed.add(child);
      }
    });
    pos.named = listed;
  }
  if (!node.doc) return pos;
  const byDoc = /* @__PURE__ */ new Map();
  for (const child of node.children.values()) if (child.doc) byDoc.set(child.doc._id, child);
  const md3 = node.doc._content || "";
  const guide = guideLines(md3);
  const first = /* @__PURE__ */ new Map();
  const later = /* @__PURE__ */ new Map();
  let i = 0;
  walkProse(md3, (parts, line, lineNo) => {
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
  pos.named = /* @__PURE__ */ new Set([...listed, ...guide.size ? first.keys() : pos.keys()]);
  return pos;
}
function rebuildAliases(g) {
  for (const [name2, e] of g.map) {
    if (!e.aliases?.length) continue;
    for (const d of e.aliases) {
      const i = e.docs.indexOf(d);
      if (i >= 0) {
        e.docs.splice(i, 1);
        e.count -= 1;
      }
    }
    e.aliases = [];
    if (e.count <= 0) g.map.delete(name2);
    else e.doc = e.docs[0];
  }
  for (const node of g.nodeOf.values()) {
    if (!node.dir || !node.doc || baseName(node.doc) === node.name) continue;
    const e = g.map.get(node.name);
    if (!e) g.map.set(node.name, { count: 1, doc: node.doc, docs: [node.doc], aliases: [node.doc] });
    else if (!e.docs.includes(node.doc)) {
      e.count += 1;
      e.docs.push(node.doc);
      (e.aliases ??= []).push(node.doc);
    }
  }
}
function refinalize(g) {
  rebuildAliases(g);
  const fallback = [];
  (function finalize(node) {
    const items = [...node.children.values()];
    items.forEach(finalize);
    const pos = mentionOrder(node, g);
    items.sort((a, b) => {
      const pa = pos.has(a) ? pos.get(a) : Infinity;
      const pb = pos.has(b) ? pos.get(b) : Infinity;
      if (pa !== pb) return pa - pb;
      return sortKey(a) - sortKey(b) || a.name.localeCompare(b.name, "zh");
    });
    node.items = items;
    node.count = items.reduce((s, n) => s + (n.dir ? (n.doc ? 1 : 0) + n.count : 1), 0);
    if (node !== g.root && node.dir && pos.named) {
      const miss = items.filter((c) => !pos.named.has(c));
      if (miss.length) fallback.push({ node, children: miss });
    }
  })(g.root);
  const order = [];
  (function visit2(n) {
    if (n.doc) order.push(n.doc);
    n.items.forEach(visit2);
  })(g.root);
  g.order = order;
  g.indexOf = new Map(order.map((d, i) => [d._id, i]));
  const at = (f) => f.node.doc ? g.indexOf.get(f.node.doc._id) : Infinity;
  fallback.sort((a, b) => at(a) - at(b));
  g.fallback = fallback;
  for (const e of g.map.values()) {
    e.docs.sort((a, b) => g.indexOf.get(a._id) - g.indexOf.get(b._id));
    e.doc = e.docs[0];
  }
}
function buildGraphFrom({ posts, pages = [], areas = DEFAULT_AREAS, folders = /* @__PURE__ */ new Map() }) {
  const map = buildNameMap(pages.concat(posts));
  const root = { name: "", doc: null, parent: null, children: /* @__PURE__ */ new Map(), dir: true };
  const nodeOf = /* @__PURE__ */ new Map();
  for (const doc of posts) {
    if (!doc.source || !doc.path) continue;
    const parts = doc.source.split("/");
    if (parts[0] !== "_posts" || parts.length < 2) continue;
    parts.shift();
    const base = parts.pop().replace(/\.md$/i, "");
    let node = root;
    let rel = "";
    for (const p of parts) {
      rel = rel ? rel + "/" + p : p;
      if (!node.children.has(p)) node.children.set(p, { name: p, rel, doc: null, parent: node, children: /* @__PURE__ */ new Map(), dir: true });
      node = node.children.get(p);
    }
    const pageName = parts.length ? folders.get(rel)?.index ?? parts[parts.length - 1] : null;
    if (base === pageName) {
      node.doc = doc;
    } else {
      const leaf = { name: base, doc, parent: node, children: /* @__PURE__ */ new Map(), dir: false };
      node.children.set(base + ".md", leaf);
      node = leaf;
    }
    nodeOf.set(doc._id, node);
  }
  const g = { root, nodeOf, backlinks: /* @__PURE__ */ new Map(), map, order: [], indexOf: /* @__PURE__ */ new Map(), areas, folders, dead: [], fallback: [], linksOf: /* @__PURE__ */ new Map() };
  refinalize(g);
  g.linksOf = new Map(posts.map((d) => [d._id, linksWithLines(d._content || "")]));
  const deadBy = /* @__PURE__ */ new Map();
  for (const src of posts) {
    const seen = /* @__PURE__ */ new Set();
    for (const l of g.linksOf.get(src._id) ?? []) {
      const d = resolveName(g, l.target);
      if (!d) {
        let e = deadBy.get(l.target);
        if (!e) {
          e = Object.assign({ target: l.target, count: 0, from: /* @__PURE__ */ new Map() }, whyUnresolved(g, l.target));
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
      g.backlinks.get(d._id).push({ doc: src, snippet: snippetOf(l.line, g, d) });
    }
  }
  const dead = [...deadBy.values()].map((e) => ({
    target: e.target,
    reason: e.reason,
    candidates: e.candidates,
    count: e.count,
    from: [...e.from].map(([doc, count]) => ({ doc, count }))
  })).map((e) => ({
    ...e,
    from: e.from.sort((a, b) => g.indexOf.get(a.doc._id) - g.indexOf.get(b.doc._id)),
    candidates: e.candidates.sort((a, b) => g.indexOf.get(a._id) - g.indexOf.get(b._id))
  })).sort((a, b) => b.count - a.count || a.target.localeCompare(b.target, "zh"));
  for (const list3 of g.backlinks.values()) {
    list3.sort((a, b) => baseName(a.doc).localeCompare(baseName(b.doc), "zh") || a.doc._id.localeCompare(b.doc._id));
  }
  g.dead = dead;
  return g;
}
function posOf(g, doc) {
  const node = g.nodeOf.get(doc._id);
  if (!node || !node.parent) return null;
  const p = node.parent;
  return { i: p.items.indexOf(node) + 1, n: p.items.length, parentName: displayName(p) };
}
function prevNext(g, doc) {
  const i = g.indexOf.get(doc._id);
  if (i === void 0) return { prev: null, next: null };
  return {
    prev: i > 0 ? g.order[i - 1] : null,
    next: i < g.order.length - 1 ? g.order[i + 1] : null
  };
}

// src/core/vault/vault.ts
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

// src/core/vault/pagemeta.ts
function frontmatterOf(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw || "");
  return m ? m[1] : "";
}
function blockOf(fm, key) {
  const lines = fm.split("\n");
  const i = lines.findIndex((l) => l.startsWith(key + ":"));
  if (i === -1) return null;
  const block = [];
  for (let j = i + 1; j < lines.length && (/^\s/.test(lines[j]) || lines[j] === ""); j++) block.push(lines[j]);
  return { inline: lines[i].slice(key.length + 1).trim(), block };
}
function sourceCount(raw) {
  const b = blockOf(frontmatterOf(raw), "source");
  if (!b) return 0;
  if (b.inline.startsWith("[")) {
    return b.inline.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean).length;
  }
  if (b.inline) return 1;
  return b.block.filter((l) => /^\s+-\s+\S/.test(l)).length;
}
function isHumanVerified(raw) {
  const b = blockOf(frontmatterOf(raw), "verified");
  if (!b) return false;
  return /by:\s*human:/.test(b.inline + "\n" + b.block.join("\n"));
}
function parseAnchors(text) {
  const out = [];
  let cur = null;
  for (const line of (text || "").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const h = /^\[(.+)\]$/.exec(t);
    if (h) {
      cur = { prefix: h[1], repos: [] };
      out.push(cur);
      continue;
    }
    const f = t.split(/\s+/);
    if (cur && f.length >= 3) cur.repos.push({ name: f[0], path: f[1], commit: f[2] });
  }
  return out;
}
function baselinesFor(anchors, vaultPath) {
  const out = [];
  for (const s of anchors) {
    if (!s.prefix.startsWith("anatomy/")) continue;
    if (vaultPath !== s.prefix && !vaultPath.startsWith(s.prefix + "/")) continue;
    for (const r of s.repos) out.push({ name: r.name, sha: r.commit.slice(0, 7) });
  }
  return out;
}
function statusOf(g, doc, anchors) {
  const d = doc.updated || doc.date;
  return {
    human: isHumanVerified(doc.raw),
    draft: doc.status === "draft",
    updated: d ? String(d).slice(0, 10) : "",
    sources: sourceCount(doc.raw),
    pos: posOf(g, doc),
    baselines: baselinesFor(anchors, vaultPathOf(doc))
  };
}

// src/core/vault/vault.ts
function readAnchors(dir) {
  const f = path.join(dir, ".wiki", "anchors.conf");
  return fs.existsSync(f) ? parseAnchors(fs.readFileSync(f, "utf8")) : [];
}
function rawNames(dir) {
  const names = /* @__PURE__ */ new Set();
  (function walk2(d, top) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const name2 = e.name.normalize("NFC");
      if (e.isDirectory()) {
        if (top && name2 === "project") continue;
        names.add(name2);
        walk2(path.join(d, e.name), false);
      } else if (name2.endsWith(".md")) names.add(name2.replace(/\.md$/, ""));
    }
  })(path.join(dir, "raw"), true);
  return names;
}
function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw);
  if (!m) return { data: {}, body: raw, error: false };
  const body = raw.slice(m[0].length);
  try {
    const data = parseYaml(m[1]);
    return { data: data && typeof data === "object" ? data : {}, body, error: false };
  } catch (e) {
    return { data: {}, body, error: true };
  }
}
var str = (v) => v == null ? "" : String(v);
var arr = (v) => Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
function readDoc(dir, rel) {
  const abs = path.join(dir, rel);
  const st = fs.statSync(abs);
  const offline = st.size > 0 && st.blocks === 0;
  const raw = offline ? "" : fs.readFileSync(abs, "utf8");
  const { data, body, error } = parseFrontmatter(raw);
  const base = rel.split("/").pop().replace(/\.md$/i, "");
  return {
    _id: rel,
    source: "_posts/" + rel,
    path: rel,
    title: str(data.title) || base,
    description: str(data.description),
    tags: arr(data.tags),
    sources: arr(data.source),
    status: str(data.status) || "stable",
    created: str(data.created),
    updated: str(data.updated),
    _content: body,
    raw,
    fmError: error,
    offline
  };
}
function loadDocs(dir, areas) {
  const out = [];
  function walk2(rel) {
    let entries;
    try {
      entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const child = (rel + "/" + e.name).normalize("NFC");
      if (e.isDirectory()) walk2(child);
      else if (/\.md$/i.test(e.name)) {
        try {
          out.push(readDoc(dir, child));
        } catch (err) {
          console.error("[vault] \u8BFB\u4E0D\u4E86", child, err);
        }
      }
    }
  }
  for (const area of areas) walk2(area);
  return out;
}
var FOLDER_CONF = ".folder.json";
var WIKI_CONF = path.join(".wiki", "wiki.json");
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
var readJson = (f) => {
  const data = JSON.parse(fs.readFileSync(f, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("\u9876\u5C42\u5FC5\u987B\u662F\u5BF9\u8C61");
  return data;
};
var byOrder = (m) => Object.entries(m && typeof m === "object" && !Array.isArray(m) ? m : {}).map(([name2, attrs]) => [String(name2).normalize("NFC"), num(attrs && attrs.order) ?? Infinity]).sort((a, b) => a[1] - b[1]).map(([n]) => n);
function loadFolders(dir, areas) {
  const folders = /* @__PURE__ */ new Map();
  function walk2(rel) {
    let entries;
    try {
      entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".")) walk2((rel + "/" + e.name).normalize("NFC"));
      else if (e.name === FOLDER_CONF) {
        try {
          const data = readJson(path.join(dir, rel, e.name));
          const index = typeof data.index === "string" && data.index ? data.index.normalize("NFC") : null;
          folders.set(rel, { index, order: byOrder(data.children) });
        } catch (err) {
          console.warn("[vault] " + rel + "/" + FOLDER_CONF + " \u89E3\u6790\u5931\u8D25\uFF0C\u6309\u9ED8\u8BA4\u89C4\u5219\uFF1A" + err.message);
        }
      }
    }
  }
  for (const area of areas) walk2(area);
  return folders;
}
function loadParts(dir, fallback) {
  try {
    const parts = byOrder(readJson(path.join(dir, WIKI_CONF)).parts);
    if (parts.length) return parts;
  } catch (err) {
    if (err.code !== "ENOENT") console.warn("[vault] " + WIKI_CONF + " \u89E3\u6790\u5931\u8D25\uFF0C\u4E94\u533A\u6309\u9ED8\u8BA4\u987A\u5E8F\uFF1A" + err.message);
  }
  return fallback;
}

// src/core/vault/init.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { spawnSync } from "node:child_process";
var WIKI_VERSION = 5;
var NOT_A_VAULT = "\u8FD9\u4E0D\u662F\u77E5\u8BC6\u5E93\uFF1B\u8981\u5728\u8FD9\u91CC\u5EFA\u5E93\uFF0C\u70B9\u300C\u65B0\u5EFA\u300D";
function decideInit(_names, hasWiki, version, current) {
  if (!hasWiki) return { action: "refuse", reason: NOT_A_VAULT };
  if (version == null) return { action: "refuse", reason: `wiki.json \u8BFB\u4E0D\u51FA version\uFF08\u7F3A\u5931\u6216\u6587\u4EF6\u635F\u574F\uFF09\uFF0C\u8BA4\u4E0D\u51FA\u8FD9\u4E2A\u5E93\uFF1B\u6309\u300C\u6253\u5F00\u5931\u8D25\u300D\u7ED9\u7684\u63D0\u793A\u4FEE\u597D\u518D\u6253\u5F00` };
  if (version > current) return { action: "refuse", reason: `\u5E93\u7248\u672C v${version} \u6BD4\u63D2\u4EF6\u8BA4\u7684 v${current} \u65B0\uFF0C\u5148\u5347\u7EA7 dsh-knowledge-brain \u63D2\u4EF6` };
  if (version < current) return { action: "migrate" };
  return { action: "open" };
}
function ensureGit(dir) {
  if (fs2.existsSync(path2.join(dir, ".git"))) return null;
  const r = spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0 || !fs2.existsSync(path2.join(dir, ".git")))
    return `git init \u5931\u8D25\uFF08${(r.stderr || "").trim() || r.error && r.error.message || "\u672A\u77E5\u539F\u56E0"}\uFF09\uFF0C\u77E5\u8BC6\u5E93\u9700\u8981 git \u7BA1\u7406`;
  if (!fs2.existsSync(path2.join(dir, ".gitignore")))
    fs2.writeFileSync(path2.join(dir, ".gitignore"), ".wiki/bin\nraw/project/\n");
  return null;
}
function link(abs, target2, made, skipped, repointed, root) {
  const st = fs2.lstatSync(abs, { throwIfNoEntry: false });
  if (st) {
    if (st.isSymbolicLink()) {
      if (!fs2.existsSync(abs)) fs2.rmSync(abs);
      else if (fs2.readlinkSync(abs) !== target2) {
        fs2.rmSync(abs);
        fs2.symlinkSync(target2, abs);
        repointed.push(path2.relative(root, abs));
        return;
      } else {
        skipped.push(path2.relative(root, abs));
        return;
      }
    } else {
      skipped.push(path2.relative(root, abs));
      return;
    }
  }
  fs2.mkdirSync(path2.dirname(abs), { recursive: true });
  fs2.symlinkSync(target2, abs);
  made.push(path2.relative(root, abs));
}
function ensureToolchain(dir, toolsDir) {
  const made = [], skipped = [], repointed = [];
  link(path2.join(dir, ".wiki", "bin"), path2.join(toolsDir, "bin"), made, skipped, repointed, dir);
  link(path2.join(dir, ".wiki", "skills"), path2.join(toolsDir, "skills"), made, skipped, repointed, dir);
  link(path2.join(dir, ".git", "hooks", "pre-commit"), path2.join(toolsDir, "hooks", "pre-commit"), made, skipped, repointed, dir);
  return { made, skipped, repointed };
}
var WIKI_JSON = (dir) => path2.join(dir, ".wiki", "wiki.json");
function readWikiVersion(dir) {
  try {
    const v = JSON.parse(fs2.readFileSync(WIKI_JSON(dir), "utf8"))?.version;
    return Number.isInteger(v) ? v : null;
  } catch {
    return null;
  }
}

// src/core/vault/watch.ts
import path3 from "node:path";
function watchIgnored(dir) {
  const proj = path3.join(dir, "raw", "project");
  const prefix = proj + path3.sep;
  return (p) => p === proj || p.startsWith(prefix) || path3.basename(p) === ".DS_Store";
}

// src/core/vault/docstore.ts
import { readdirSync, statSync } from "node:fs";
import path4 from "node:path";
var REF_RE = /\]\(([^)\s]+)[^)]*\)|src=["']([^"']+)["']/g;
function embedsOfDoc(docId, md3) {
  const out = /* @__PURE__ */ new Set();
  for (const m of md3.matchAll(REF_RE)) {
    const href = (m[1] || m[2] || "").split("#")[0].split("?")[0];
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    let p = href;
    try {
      p = decodeURI(p);
    } catch {
    }
    const rooted2 = p.startsWith("asset/") || p.startsWith("raw/");
    const rel = path4.posix.normalize(rooted2 ? p : path4.posix.join(path4.posix.dirname(docId), p));
    out.add(rel.normalize("NFC"));
  }
  return [...out];
}
var DocStore = class {
  constructor(dir) {
    this.dir = dir;
  }
  cache = /* @__PURE__ */ new Map();
  get(rel) {
    const key = rel.normalize("NFC");
    try {
      const st = statSync(path4.join(this.dir, key));
      const hit = this.cache.get(key);
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.parsed;
      const doc = readDoc(this.dir, key);
      const content = doc.offline ? "" : doc._content || "";
      const parsed = { doc, links: doc.offline ? [] : linksWithLines(content), embeds: doc.offline ? [] : embedsOfDoc(key, content) };
      this.cache.set(key, { mtimeMs: st.mtimeMs, size: st.size, parsed });
      return parsed;
    } catch {
      return null;
    }
  }
  invalidate(rel) {
    this.cache.delete(rel.normalize("NFC"));
  }
  // 全量重建用：与 loadDocs 同序走一遍（readdirSync 深度优先），stat 命中的走缓存；
  // 顺带清掉已消失的缓存项
  bulk(areas) {
    const out = [];
    const live = /* @__PURE__ */ new Set();
    const walk2 = (rel) => {
      let entries;
      try {
        entries = readdirSync(path4.join(this.dir, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const child = (rel + "/" + e.name).normalize("NFC");
        if (e.isDirectory()) walk2(child);
        else if (/\.md$/i.test(e.name)) {
          const u = this.get(child);
          if (u) {
            out.push(u.doc);
            live.add(child);
          }
        }
      }
    };
    for (const a of areas) walk2(a);
    for (const k of this.cache.keys()) if (!live.has(k)) this.cache.delete(k);
    return out;
  }
};

// src/core/search.ts
import MiniSearch from "minisearch";
var CJK = /[㐀-鿿豈-﫿]/;
var CJK_RUN = /[㐀-鿿豈-﫿]+/g;
var seg = new Intl.Segmenter("zh", { granularity: "word" });
function tokenizeIndex(text) {
  const out = [];
  for (const s of seg.segment(text)) if (s.isWordLike) out.push(s.segment.toLowerCase());
  for (const run of text.match(CJK_RUN) ?? []) {
    for (const ch of run) out.push(ch);
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}
function tokenizeQuery(q) {
  const out = [];
  for (const run of q.match(CJK_RUN) ?? []) {
    if (run.length === 1) out.push(run);
    else for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  for (const s of seg.segment(q.replace(CJK_RUN, " "))) if (s.isWordLike) out.push(s.segment.toLowerCase());
  return out;
}
function plainText(md3) {
  return md3.replace(/^(```|~~~)(?:mermaid|infographic)[\s\S]*?^\1[ \t]*$/gm, "").replace(/^(```|~~~).*$/gm, "").replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, t, _a, l) => l || t).replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, " ").replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "").replace(/[*_`|]/g, " ").replace(/\s+/g, " ").trim();
}
function buildSearch(g) {
  const ms = new MiniSearch({
    fields: ["title", "crumb", "text"],
    storeFields: ["title", "crumb"],
    tokenize: tokenizeIndex,
    searchOptions: {
      tokenize: tokenizeQuery,
      boost: { title: 4, crumb: 1.5 },
      prefix: (t) => !CJK.test(t),
      combineWith: "AND"
    }
  });
  const texts = /* @__PURE__ */ new Map();
  ms.addAll(g.order.map((doc) => {
    const node = g.nodeOf.get(doc._id);
    const text = plainText(doc._content || "");
    texts.set(doc._id, text);
    return { id: doc._id, title: displayName(node), crumb: crumbOf(node), text };
  }));
  return { ms, texts };
}
var escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function snippet(text, q, terms) {
  const lower = text.toLowerCase();
  const needles = [q.toLowerCase(), ...terms].filter(Boolean).sort((a, b) => b.length - a.length);
  let at = -1;
  for (const n of needles) {
    at = lower.indexOf(n);
    if (at !== -1) break;
  }
  const start = Math.max(0, at - 30);
  const end = Math.min(text.length, start + 100);
  const win = text.slice(start, end);
  let out = "";
  let last = 0;
  if (needles.length) {
    for (const m of win.matchAll(new RegExp(needles.map(escRe).join("|"), "gi"))) {
      out += esc(win.slice(last, m.index)) + "<mark>" + esc(m[0]) + "</mark>";
      last = m.index + m[0].length;
    }
  }
  out += esc(win.slice(last));
  return (start > 0 ? "\u2026" : "") + out + (end < text.length ? "\u2026" : "");
}
function search(idx, raw, limit = 30, keep) {
  const q = raw.trim();
  if (!q) return [];
  const pick = (rs2) => keep ? rs2.filter((r) => keep(String(r.id))) : rs2;
  let rs = pick(idx.ms.search(q));
  if (!rs.length) rs = pick(idx.ms.search(q, { combineWith: "OR" }));
  return rs.slice(0, limit).map((r) => ({
    id: String(r.id),
    name: r.title,
    crumb: r.crumb,
    snippet: snippet(idx.texts.get(String(r.id)) ?? "", q, r.terms)
  }));
}

// src/core/render.ts
import path5 from "node:path";
import { statSync as statSync2 } from "node:fs";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { visit, SKIP } from "unist-util-visit";
import { toString } from "hast-util-to-string";
import { slug } from "github-slugger";
var sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: "",
  attributes: { ...defaultSchema.attributes, "*": [...defaultSchema.attributes?.["*"] ?? [], "className", "id"] },
  protocols: {
    ...defaultSchema.protocols,
    href: [...defaultSchema.protocols?.href ?? [], "wikilink"]
  }
};
var hl = null;
var highlighter = () => hl ??= createHighlighterCore({
  themes: [import("@shikijs/themes/github-light"), import("@shikijs/themes/github-dark")],
  langs: [
    import("@shikijs/langs/python"),
    import("@shikijs/langs/typescript"),
    import("@shikijs/langs/javascript"),
    import("@shikijs/langs/markdown"),
    import("@shikijs/langs/yaml"),
    import("@shikijs/langs/csharp"),
    import("@shikijs/langs/bash"),
    import("@shikijs/langs/json")
  ],
  engine: createJavaScriptRegexEngine()
});
var assetUrl = (rel) => "api/wiki.asset?path=" + encodeURIComponent(rel);
function assetRel(docId, href) {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return null;
  let p = href.split("#")[0];
  try {
    p = decodeURI(p);
  } catch {
  }
  const rooted2 = p.startsWith("asset/") || p.startsWith("raw/");
  const rel = path5.posix.normalize(rooted2 ? p : path5.posix.join(path5.posix.dirname(docId), p));
  return rel.startsWith("asset/") || rel.startsWith("raw/") ? rel : null;
}
function deadReason(e, g) {
  if (!e) return "\u89E3\u6790\u4E0D\u5230";
  if (e.reason === "ambiguous") {
    const at = (d) => g ? nodePath(g.nodeOf.get(d._id)) : d._id;
    return "\u540C\u540D\u6B67\u4E49\uFF1A" + e.candidates.map(at).join("\u3001") + "\u2014\u2014\u5199\u6210\u8DEF\u5F84\u5F62\u5F0F";
  }
  if (e.reason === "unpublished") return "\u53CC\u94FE\u53EA\u80FD\u6307\u5411\u6C89\u6DC0\u533A\uFF08\u7D20\u6750\u5199\u8FDB source\uFF09";
  return "\u5E93\u91CC\u4E5F\u4E0D\u5B58\u5728";
}
var VIEWER_FENCES = /* @__PURE__ */ new Set(["mermaid", "infographic"]);
function remarkViewerFences() {
  return (tree) => {
    visit(tree, "code", (node, i, parent) => {
      if (!node.lang || !VIEWER_FENCES.has(node.lang) || !parent || i === void 0) return;
      parent.children[i] = { type: "html", value: '<pre class="' + node.lang + '">' + esc(node.value) + "</pre>" };
    });
  };
}
function rewriteAnchor(node, ctx) {
  const href = String(node.properties.href ?? "");
  if (href.startsWith("wikilink:")) {
    let raw = href.slice("wikilink:".length);
    try {
      raw = decodeURI(raw);
    } catch {
    }
    const h = raw.indexOf("#");
    const target2 = h === -1 ? raw : raw.slice(0, h);
    const anchor = h === -1 ? "" : raw.slice(h + 1);
    const d = resolveName(ctx.g, target2);
    node.properties = d ? { href: "#", dataWikiId: d._id, ...anchor ? { dataAnchor: slug(anchor) } : {} } : { href: "#", dataDead: "", className: ["wiki-dead"], title: deadReason(ctx.dead.get(target2), ctx.g) };
    return;
  }
  if (/^https?:\/\//i.test(href)) {
    node.properties.dataExternal = href;
    return;
  }
  const rel = assetRel(ctx.docId, href);
  if (rel) {
    node.properties.href = "#";
    node.properties.dataExplorable = rel;
  }
}
function embedHtml(node, rel, query, dir) {
  const alt = String(node.properties.alt ?? "").trim();
  const h = /^h=(\d+)$/.exec(query);
  let v = "";
  try {
    v = String(statSync2(path5.join(dir, rel)).mtimeMs);
  } catch {
  }
  node.tagName = "iframe";
  node.properties = {
    src: assetUrl(rel) + (v ? `&v=${v}` : ""),
    sandbox: ["allow-scripts"],
    scrolling: "no",
    loading: "lazy",
    title: alt || rel,
    className: ["wiki-embed"],
    style: h ? `height:${h[1]}px` : "height:480px",
    ...h ? {} : { dataAutosize: "" }
  };
}
function rehypeWiki(ctx) {
  return (tree) => {
    let h1Done = false;
    visit(tree, "element", (node, i, parent) => {
      if (!h1Done && node.tagName === "h1" && parent && i !== void 0) {
        h1Done = true;
        parent.children.splice(i, 1);
        return [SKIP, i];
      }
      if (node.tagName === "h2" || node.tagName === "h3") {
        ctx.toc.push({ id: String(node.properties.id ?? ""), text: toString(node), depth: node.tagName === "h2" ? 2 : 3 });
      } else if (node.tagName === "a") {
        rewriteAnchor(node, ctx);
      } else if (node.tagName === "img") {
        const raw = String(node.properties.src ?? "");
        const at = raw.indexOf("?");
        const rel = assetRel(ctx.docId, at === -1 ? raw : raw.slice(0, at));
        if (rel && rel.startsWith("asset/") && /\.html?$/i.test(rel)) {
          embedHtml(node, rel, at === -1 ? "" : raw.slice(at + 1), ctx.dir);
          return SKIP;
        }
        if (rel && /\.excalidraw$/i.test(rel)) {
          node.tagName = "div";
          node.properties = {
            className: ["wiki-excalidraw"],
            title: rel,
            style: "padding:.8em 1em;border:1px dashed rgba(128,128,128,.45);border-radius:6px;color:rgba(128,128,128,.9);font-size:.85em;text-align:center"
          };
          node.children = [{ type: "text", value: "Excalidraw \u56FE \xB7 \u5728\u77E5\u8BC6\u5E93\u5BA2\u6237\u7AEF\u67E5\u770B" }];
          return SKIP;
        }
        if (rel) node.properties.src = assetUrl(rel);
      }
      return void 0;
    });
  };
}
async function renderPage(doc, m) {
  const toc = [];
  const file = await unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkCjkFriendly).use(remarkCjkFriendlyGfmStrikethrough).use(remarkViewerFences).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema).use(rehypeSlug).use(rehypeKatex).use(rehypeShikiFromHighlighter, await highlighter(), {
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
    fallbackLanguage: "text"
  }).use(rehypeWiki, { docId: doc._id, doc, dir: m.dir, g: m.g, dead: m.dead, toc }).use(rehypeStringify).process(rewriteWikilinks(doc._content || ""));
  return { html: String(file), toc };
}

// src/core/model.ts
function buildModel(dir, store) {
  const areas = loadParts(dir, DEFAULT_AREAS);
  const docs = store ? store.bulk(areas) : loadDocs(dir, areas);
  const folders = loadFolders(dir, areas);
  const g = buildGraphFrom({ posts: docs, areas, folders });
  const raws = rawNames(dir);
  for (const e of g.dead) if (e.reason === "missing") e.reason = deadInfo(g, raws, e.target).reason;
  const embedOf = /* @__PURE__ */ new Map();
  for (const d of docs) {
    embedOf.set(d._id, store ? store.get(d._id)?.embeds ?? [] : embedsOfDoc(d._id, d._content || ""));
  }
  return {
    dir,
    g,
    byId: new Map(docs.map((d) => [d._id, d])),
    anchors: readAnchors(dir),
    dead: new Map(g.dead.map((e) => [e.target, e])),
    search: buildSearch(g),
    html: /* @__PURE__ */ new Map(),
    blockHtml: /* @__PURE__ */ new Map(),
    folders,
    raws,
    embedOf,
    store: store ?? null
  };
}
function refOf(m, doc) {
  const node = m.g.nodeOf.get(doc._id);
  return { id: doc._id, name: displayName(node), crumb: crumbOf(node) };
}
var baseOf = (id2) => id2.split("/").pop().replace(/\.md$/i, "");
async function page(m, id2) {
  const doc = m.byId.get(id2);
  if (!doc) {
    const base = baseOf(id2);
    return { ok: false, candidates: [...m.byId.values()].filter((d) => baseOf(d._id) === base).map((d) => refOf(m, d)) };
  }
  let rendered = { html: "", toc: [] };
  if (!doc.offline) {
    if (!m.html.has(id2)) {
      m.html.set(id2, renderPage(doc, m).catch((err) => {
        m.html.delete(id2);
        throw err;
      }));
    }
    rendered = await m.html.get(id2);
  }
  const node = m.g.nodeOf.get(id2);
  const crumbs = [];
  for (let p = node.parent; p && p.parent; p = p.parent) if (p.doc) crumbs.unshift(refOf(m, p.doc));
  const { prev, next } = prevNext(m.g, doc);
  const s = statusOf(m.g, doc, m.anchors);
  return {
    ok: true,
    page: {
      id: id2,
      title: doc.title,
      description: doc.description,
      tags: doc.tags,
      area: areaOf(doc),
      crumbs,
      children: (node.items ?? []).filter((c) => c.doc).map((c) => ({ ...refOf(m, c.doc), desc: c.doc.description || "" })),
      status: { human: s.human, draft: s.draft, updated: s.updated, pos: s.pos, baselines: s.baselines, sources: doc.sources, fmError: doc.fmError },
      html: rendered.html,
      toc: rendered.toc,
      prev: prev ? refOf(m, prev) : null,
      next: next ? refOf(m, next) : null,
      backlinks: (m.g.backlinks.get(id2) || []).map((b) => ({ from: refOf(m, b.doc), snippet: b.snippet })),
      offline: doc.offline
    }
  };
}
function tags(m, keep) {
  const count = /* @__PURE__ */ new Map();
  for (const d of m.byId.values()) {
    if (keep && !keep(d._id)) continue;
    for (const t of d.tags) count.set(t, (count.get(t) ?? 0) + 1);
  }
  return [...count].map(([tag, n]) => ({ tag, count: n })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh"));
}
function tagPages(m, tag, keep) {
  return m.g.order.filter((d) => d.tags.includes(tag) && (!keep || keep(d._id))).map((d) => ({ ref: refOf(m, d), desc: d.description }));
}
function pageLists(m) {
  const recent = [];
  const drafts = [];
  for (const d of m.byId.values()) {
    const area = areaOf(d);
    const isDraft = d.status === "draft";
    const updated = String(d.updated || d.date || "").slice(0, 10);
    if (!updated) continue;
    const hit = { id: d._id, name: refOf(m, d).name, area, updated };
    recent.push(hit);
    if (isDraft) drafts.push(hit);
  }
  const byUpdated = (a, b) => b.updated.localeCompare(a.updated);
  recent.sort(byUpdated);
  drafts.sort(byUpdated);
  return { drafts, recent };
}
function home(m) {
  const total = m.byId.size;
  const byArea = /* @__PURE__ */ new Map();
  let draft = 0;
  for (const d of m.byId.values()) {
    const area = areaOf(d);
    const isDraft = d.status === "draft";
    if (isDraft) draft++;
    const c = byArea.get(area) ?? { count: 0, done: 0 };
    byArea.set(area, { count: c.count + 1, done: c.done + (isDraft ? 0 : 1) });
  }
  const { drafts, recent } = pageLists(m);
  const areas = m.g.root.items.map((node) => {
    const c = byArea.get(node.name) ?? { count: 0, done: 0 };
    return { area: node.name, count: c.count, done: c.done, draft: c.count - c.done };
  });
  const stats = {
    total,
    done: total - draft,
    draft,
    areas,
    recent: recent.slice(0, 7),
    drafts: drafts.slice(0, 7)
  };
  return { stats };
}

// src/core/vault/ops.ts
function invalidateRender(m, id2) {
  m.html.delete(id2);
  m.blockHtml.delete(id2);
}
function contribute(m, rel, links) {
  const back = /* @__PURE__ */ new Map();
  const deadCount = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  const doc = m.byId.get(rel);
  for (const l of links) {
    const d = resolveName(m.g, l.target);
    if (!d) {
      deadCount.set(l.target, (deadCount.get(l.target) ?? 0) + 1);
      continue;
    }
    if (d._id === rel || seen.has(d._id)) continue;
    seen.add(d._id);
    const node = m.g.nodeOf.get(d._id);
    if (node && node.parent && node.parent.doc && node.parent.doc._id === rel) continue;
    back.set(d._id, { doc, snippet: snippetOf(l.line, m.g, d) });
  }
  return { back, deadCount };
}
function spliceDiff(m, rel, oldC, newC) {
  const targets = /* @__PURE__ */ new Set([...oldC.back.keys(), ...newC.back.keys()]);
  for (const id2 of targets) {
    const list3 = m.g.backlinks.get(id2) ?? [];
    const kept = list3.filter((b) => b.doc._id !== rel);
    const add = newC.back.get(id2);
    if (add) kept.push(add);
    kept.sort((a, b) => baseName(a.doc).localeCompare(baseName(b.doc), "zh") || a.doc._id.localeCompare(b.doc._id));
    if (kept.length) m.g.backlinks.set(id2, kept);
    else m.g.backlinks.delete(id2);
  }
  const names = /* @__PURE__ */ new Set([...oldC.deadCount.keys(), ...newC.deadCount.keys()]);
  for (const t of names) {
    const delta = (newC.deadCount.get(t) ?? 0) - (oldC.deadCount.get(t) ?? 0);
    if (delta) deadAdjust(m, t, rel, delta);
  }
}
function deadAdjust(m, t, srcRel, delta) {
  let e = m.dead.get(t);
  if (!e) {
    if (delta <= 0) return;
    const why = deadInfo(m.g, m.raws, t);
    e = { target: t, reason: why.reason, candidates: why.candidates, count: 0, from: [] };
    m.dead.set(t, e);
  }
  e.count += delta;
  const at = e.from.findIndex((f) => f.doc._id === srcRel);
  if (at >= 0) {
    const c = e.from[at].count + delta;
    if (c <= 0) e.from.splice(at, 1);
    else e.from[at] = { doc: e.from[at].doc, count: c };
  } else if (delta > 0 && m.byId.get(srcRel)) {
    e.from.push({ doc: m.byId.get(srcRel), count: delta });
  }
  e.from.sort((a, b) => m.g.indexOf.get(a.doc._id) - m.g.indexOf.get(b.doc._id));
  if (e.count <= 0) m.dead.delete(t);
  else refreshDeadReason(m, t);
  syncDeadArray(m);
}
function refreshDeadReason(m, t) {
  const e = m.dead.get(t);
  if (!e) return;
  const why = deadInfo(m.g, m.raws, t);
  e.reason = why.reason;
  e.candidates = [...why.candidates].sort((a, b) => m.g.indexOf.get(a._id) - m.g.indexOf.get(b._id));
}
function finalizeDead(m) {
  for (const t of [...m.dead.keys()]) {
    refreshDeadReason(m, t);
    m.dead.get(t).from.sort((a, b) => m.g.indexOf.get(a.doc._id) - m.g.indexOf.get(b.doc._id));
  }
  syncDeadArray(m);
}
function syncDeadArray(m) {
  m.g.dead = [...m.dead.values()].sort((a, b) => b.count - a.count || a.target.localeCompare(b.target, "zh"));
}
function swapDocRefs(m, rel, oldDoc, newDoc) {
  m.byId.set(rel, newDoc);
  const node = m.g.nodeOf.get(rel);
  if (node) node.doc = newDoc;
  const keys = /* @__PURE__ */ new Set([baseName(newDoc)]);
  if (node?.dir) keys.add(node.name);
  for (const key of keys) {
    const e = m.g.map.get(key);
    if (!e) continue;
    const i = e.docs.indexOf(oldDoc);
    if (i >= 0) e.docs[i] = newDoc;
    if (e.doc === oldDoc) e.doc = newDoc;
  }
}
function reindex(m, ids) {
  for (const id2 of ids) {
    const d = m.byId.get(id2);
    if (!d) {
      if (m.search.texts.has(id2)) {
        try {
          m.search.ms.discard(id2);
        } catch {
        }
        m.search.texts.delete(id2);
      }
      continue;
    }
    if (m.search.texts.has(id2)) {
      try {
        m.search.ms.discard(id2);
      } catch {
      }
    }
    const node = m.g.nodeOf.get(id2);
    const text = plainText(d._content || "");
    m.search.texts.set(id2, text);
    m.search.ms.add({ id: id2, title: displayName(node), crumb: crumbOf(node), text });
  }
}
function doChange(m, rel) {
  const unit = m.store ? m.store.get(rel) : null;
  if (!unit) return doUnlink(m, rel);
  const oldDoc = m.byId.get(rel);
  if (!oldDoc) return doCreate(m, rel);
  const oldLinks = m.g.linksOf.get(rel) ?? [];
  const oldC = contribute(m, rel, oldLinks);
  swapDocRefs(m, rel, oldDoc, unit.doc);
  m.g.linksOf.set(rel, unit.links);
  m.embedOf.set(rel, unit.embeds);
  invalidateRender(m, rel);
  const orderBefore = m.g.order.map((d) => d._id);
  const pnBefore = orderBefore.map((id2, i) => [orderBefore[i - 1] ?? null, orderBefore[i + 1] ?? null]);
  refinalize(m.g);
  const orderAfter = m.g.order.map((d) => d._id);
  const movedIds = [];
  if (orderBefore.length !== orderAfter.length || orderBefore.some((id2, i) => id2 !== orderAfter[i])) {
    const posAfter = new Map(orderAfter.map((id2, i) => [id2, i]));
    for (let i = 0; i < orderBefore.length; i++) {
      const j = posAfter.get(orderBefore[i]);
      if (j === void 0) continue;
      if (pnBefore[i][0] !== (orderAfter[j - 1] ?? null) || pnBefore[i][1] !== (orderAfter[j + 1] ?? null)) movedIds.push(orderBefore[i]);
    }
  }
  const newC = contribute(m, rel, unit.links);
  spliceDiff(m, rel, oldC, newC);
  finalizeDead(m);
  const ids = /* @__PURE__ */ new Set([rel]);
  for (const id2 of [...oldC.back.keys(), ...newC.back.keys()]) ids.add(id2);
  const oldT = [...oldC.back.keys()].sort();
  const newT = [...newC.back.keys()].sort();
  const flags = {};
  if (JSON.stringify(oldT) !== JSON.stringify(newT)) flags.graph = true;
  if (movedIds.length) {
    flags.tree = true;
    for (const id2 of movedIds) ids.add(id2);
  }
  const node = m.g.nodeOf.get(rel);
  const FM_KEYS = ["title", "description", "tags", "status", "updated", "created", "sources"];
  if (FM_KEYS.some((k) => JSON.stringify(oldDoc[k]) !== JSON.stringify(unit.doc[k]))) flags.stats = true;
  if (node?.dir) {
    flags.tree = true;
    const visit2 = (n) => {
      if (n.doc) ids.add(n.doc._id);
      (n.items ?? []).forEach(visit2);
    };
    visit2(node);
  }
  if (node && node.parent === m.g.root && oldDoc.title !== unit.doc.title) {
    flags.tree = true;
    flags.graph = true;
    for (const d of m.g.order) if (d.source.split("/")[1] === node.name) ids.add(d._id);
  }
  reindex(m, [...ids]);
  return { ids: [...ids], flags };
}
function nodeKeyOf(m, rel) {
  const segs2 = rel.split("/");
  const base = segs2[segs2.length - 1].replace(/\.md$/i, "");
  if (segs2.length > 1) {
    const dir = segs2.slice(0, -1).join("/");
    if (base === (m.folders.get(dir)?.index ?? segs2[segs2.length - 2])) return dir;
  }
  return rel.replace(/\.md$/i, "");
}
function linkersOf(m, names) {
  const ids = /* @__PURE__ */ new Set();
  for (const [rel, links] of m.g.linksOf) {
    for (const l of links) if (names.has(l.target) || names.has(l.target.trim())) {
      ids.add(rel);
      break;
    }
  }
  return [...ids];
}
function attachNode(m, rel, doc) {
  const parts = rel.split("/");
  parts.pop();
  let node = m.g.root;
  let dir = "";
  for (const p of parts) {
    dir = dir ? dir + "/" + p : p;
    if (!node.children.has(p)) node.children.set(p, { name: p, rel: dir, doc: null, parent: node, children: /* @__PURE__ */ new Map(), dir: true });
    node = node.children.get(p);
  }
  const base = rel.split("/").pop().replace(/\.md$/i, "");
  const pageName = parts.length ? m.folders.get(dir)?.index ?? parts[parts.length - 1] : null;
  let leaf = node;
  if (base === pageName) node.doc = doc;
  else {
    leaf = { name: base, doc, parent: node, children: /* @__PURE__ */ new Map(), dir: false };
    node.children.set(base + ".md", leaf);
  }
  m.g.nodeOf.set(rel, leaf);
}
function detachNode(m, rel) {
  const node = m.g.nodeOf.get(rel);
  if (!node) return;
  m.g.nodeOf.delete(rel);
  let n = node;
  if (n.dir) n.doc = null;
  else {
    n.parent.children.delete(n.name + ".md");
    n = n.parent;
  }
  while (n !== m.g.root && n.dir && !n.doc && n.children.size === 0) {
    const p = n.parent;
    p.children.delete(n.name);
    n = p;
  }
}
function addName(m, base, doc) {
  const e = m.g.map.get(base);
  if (e) {
    e.count += 1;
    e.docs.push(doc);
  } else m.g.map.set(base, { count: 1, doc, docs: [doc], aliases: [] });
}
function removeName(m, base, doc) {
  const e = m.g.map.get(base);
  if (!e) return;
  const i = e.docs.indexOf(doc);
  if (i >= 0) {
    e.docs.splice(i, 1);
    e.count -= 1;
  }
  if (e.count <= 0) m.g.map.delete(base);
  else e.doc = e.docs[0];
}
function doCreate(m, rel) {
  if (m.byId.has(rel)) return doChange(m, rel);
  const unit = m.store ? m.store.get(rel) : null;
  if (!unit) return { ids: [], flags: {} };
  const base = baseName(unit.doc);
  const names = /* @__PURE__ */ new Set([base]);
  const segs2 = rel.split("/");
  if (segs2.length > 1) {
    const dirName = segs2[segs2.length - 2];
    const dirOf = segs2.slice(0, -1).join("/");
    const pageName = m.folders.get(dirOf)?.index ?? dirName;
    if (base === pageName && base !== dirName) names.add(dirName);
  }
  names.add(nodeKeyOf(m, rel));
  const linkers = linkersOf(m, names);
  const linkerOld = new Map(linkers.filter((l) => l !== rel).map((l) => [l, contribute(m, l, m.g.linksOf.get(l) ?? [])]));
  attachNode(m, rel, unit.doc);
  addName(m, base, unit.doc);
  m.byId.set(rel, unit.doc);
  m.g.linksOf.set(rel, unit.links);
  m.embedOf.set(rel, unit.embeds);
  refinalize(m.g);
  const own = contribute(m, rel, unit.links);
  spliceDiff(m, rel, { back: /* @__PURE__ */ new Map(), deadCount: /* @__PURE__ */ new Map() }, own);
  for (const l of linkers) {
    if (l === rel) continue;
    spliceDiff(m, l, linkerOld.get(l), contribute(m, l, m.g.linksOf.get(l) ?? []));
  }
  finalizeDead(m);
  const ids = /* @__PURE__ */ new Set([rel, ...linkers, ...own.back.keys()]);
  for (const l of linkers) invalidateRender(m, l);
  reindex(m, [...ids]);
  return { ids: [...ids], flags: { tree: true, graph: true, stats: true } };
}
function doUnlink(m, rel) {
  const doc = m.byId.get(rel);
  if (!doc) return { ids: [], flags: {} };
  const base = baseName(doc);
  const names = /* @__PURE__ */ new Set([base]);
  const node = m.g.nodeOf.get(rel);
  if (node?.dir && baseName(doc) !== node.name) names.add(node.name);
  names.add(nodeKeyOf(m, rel));
  const linkers = linkersOf(m, names).filter((l) => l !== rel);
  const old = contribute(m, rel, m.g.linksOf.get(rel) ?? []);
  const linkerOld = new Map(linkers.map((l) => [l, contribute(m, l, m.g.linksOf.get(l) ?? [])]));
  detachNode(m, rel);
  removeName(m, base, doc);
  m.byId.delete(rel);
  m.g.linksOf.delete(rel);
  m.embedOf.delete(rel);
  refinalize(m.g);
  spliceDiff(m, rel, old, { back: /* @__PURE__ */ new Map(), deadCount: /* @__PURE__ */ new Map() });
  for (const l of linkers) spliceDiff(m, l, linkerOld.get(l), contribute(m, l, m.g.linksOf.get(l) ?? []));
  finalizeDead(m);
  const ids = /* @__PURE__ */ new Set([rel, ...linkers, ...old.back.keys()]);
  invalidateRender(m, rel);
  for (const l of linkers) invalidateRender(m, l);
  reindex(m, [...ids]);
  return { ids: [...ids], flags: { tree: true, graph: true, stats: true } };
}
function applyDocOps(m, ops) {
  const rank = { unlink: 0, create: 1, change: 2 };
  const ids = /* @__PURE__ */ new Set();
  const flags = {};
  for (const o of [...ops].sort((a, b) => rank[a.op] - rank[b.op])) {
    const r = o.op === "unlink" ? doUnlink(m, o.rel) : o.op === "create" ? doCreate(m, o.rel) : doChange(m, o.rel);
    for (const id2 of r.ids) ids.add(id2);
    for (const k of Object.keys(r.flags)) if (r.flags[k]) flags[k] = true;
  }
  return { ids: [...ids], flags };
}
function applyAssets(m, assets) {
  if (!assets.length) return { ids: [], flags: {} };
  const hit = [];
  for (const [id2, embeds] of m.embedOf) {
    if (embeds.some((e) => assets.includes(e))) {
      hit.push(id2);
      invalidateRender(m, id2);
    }
  }
  return { ids: hit, flags: {} };
}
function applyRaws(m, rels) {
  if (!rels.length) return { ids: [], flags: {} };
  const names = new Set(rels.map((r) => r.split("/").pop().replace(/\.md$/i, "").normalize("NFC")));
  m.raws = rawNames(m.dir);
  for (const t of [...m.dead.keys()]) refreshDeadReason(m, t);
  syncDeadArray(m);
  const ids = linkersOf(m, names);
  for (const id2 of ids) invalidateRender(m, id2);
  return { ids, flags: { documents: true } };
}
function applyAnchors(m) {
  m.anchors = readAnchors(m.dir);
  const ids = [];
  for (const d of m.g.order) {
    const vp = vaultPathOf(d);
    if (m.anchors.some((s) => s.prefix.startsWith("anatomy/") && (vp === s.prefix || vp.startsWith(s.prefix + "/")))) ids.push(d._id);
  }
  return { ids, flags: { stats: true } };
}

// src/host/pkg.ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var selfDir = dirname(fileURLToPath(import.meta.url));
var pkgRoot = () => {
  let d = selfDir;
  while (!existsSync(join(d, "package.json"))) {
    const up = dirname(d);
    if (up === d) throw new Error("pkg: package.json not found upward");
    d = up;
  }
  return d;
};
var vaultTools = (...p) => join(pkgRoot(), "vault-tools", ...p);

// src/core/vault/engine.ts
function classifyEvents(events, ctx) {
  const plan = { kind: "patch", docOps: [], assets: [], raws: [], anchors: false, coverage: false, tools: false };
  let structural = false;
  const perRel = /* @__PURE__ */ new Map();
  for (const { evt, path: raw } of events) {
    const p = raw.normalize("NFC");
    if (p === path6.join(ctx.dir, ".wiki", "wiki.json")) {
      plan.kind = "reopen";
      continue;
    }
    if (p.startsWith(ctx.toolsDir + path6.sep)) {
      plan.tools = true;
      continue;
    }
    if (!p.startsWith(ctx.dir + path6.sep)) {
      structural = true;
      continue;
    }
    const rel = p.slice(ctx.dir.length + 1);
    if (evt === "addDir" || evt === "unlinkDir") {
      structural = true;
      continue;
    }
    if (!perRel.has(rel)) perRel.set(rel, /* @__PURE__ */ new Set());
    perRel.get(rel).add(evt);
  }
  for (const [rel, evts] of perRel) {
    if (rel === ".wiki/coverage.conf") {
      plan.coverage = true;
      continue;
    }
    if (rel === ".wiki/anchors.conf") {
      plan.anchors = true;
      continue;
    }
    if (rel.startsWith("asset/")) {
      plan.assets.push(rel);
      continue;
    }
    if (rel.startsWith("raw/")) {
      plan.raws.push(rel);
      continue;
    }
    if (/\.md$/i.test(rel)) {
      if (!ctx.areas.includes(rel.split("/")[0])) continue;
      if (evts.has("add") && evts.has("unlink") && !evts.has("change")) continue;
      const op = evts.has("unlink") ? "unlink" : evts.has("add") ? "create" : "change";
      plan.docOps.push({ op, rel });
      continue;
    }
    structural = true;
  }
  if (plan.kind === "reopen") return plan;
  if (structural) plan.kind = "structural";
  else if (!plan.docOps.length && !plan.assets.length && !plan.raws.length && !plan.anchors && !plan.coverage) plan.kind = "none";
  return plan;
}
var realWatch = (paths, opts) => watch(paths, opts);
var realCheck = (dir) => new Promise((done) => execFile(
  "python3",
  [vaultTools("bin", "wiki"), "check"],
  { cwd: dir, timeout: 18e4, maxBuffer: 16 * 1024 * 1024 },
  (e, out, err) => {
    const text = `${out ?? ""}${err ?? ""}`.trim();
    done({ ok: !e, output: text || (e ? `\u6821\u9A8C\u6CA1\u8DD1\u8D77\u6765\uFF1A${e.message}` : "") });
  }
));
var realUpgrade = (dir) => new Promise((done, fail2) => execFile(
  "python3",
  [vaultTools("bin", "wiki"), "upgrade"],
  { cwd: dir, timeout: 18e4, maxBuffer: 16 * 1024 * 1024 },
  (e, out, err) => {
    if (e && typeof e.code !== "number") {
      fail2(e);
      return;
    }
    done({ ok: !e, output: `${out ?? ""}${err ?? ""}`.trim() });
  }
));
var VaultEngine = class {
  constructor(dirOf, notify, makeWatch = realWatch, opts = {}) {
    this.dirOf = dirOf;
    this.notify = notify;
    this.makeWatch = makeWatch;
    this.opts = opts;
  }
  model = null;
  /** 打不开的原因（判定拒绝、git init 失败、中途异常），打开成功为 null */
  error = null;
  /** 文件监听已中断：模型停在最后状态，改动不自动刷新；重开库复位 */
  degraded = false;
  /** 开库校验进行中（完整 wiki check，大库十几秒）：期间无模型、无报错 */
  validating = false;
  /** 校验没过时 wiki check 的原文（设置页逐条列给人看） */
  checkOutput = null;
  gen = 0;
  // 每次 open 自增；校验结果回来时对不上就作废
  store = null;
  storeDir = "";
  stop = null;
  pending = /* @__PURE__ */ new Map();
  // path → 事件类型（同路径后到覆盖）
  timer;
  /** validate：（库版本低时先 wiki upgrade）跑完整 wiki check，过了才建模型（启动、换目录、新建后由 hub.reopen 传）；
   *  会话内的重开（wiki.json 变了）不传，免得写到一半留个断链库就被锁住；也不升级、不改版本号 */
  open(o = {}) {
    const gen = ++this.gen;
    this.stop?.().catch((e) => console.error("[vault] \u5173\u65E7\u76D1\u542C\u5931\u8D25", e));
    this.stop = null;
    this.model = null;
    this.error = null;
    this.degraded = false;
    this.validating = false;
    this.checkOutput = null;
    const dir = this.dirOf();
    if (!dir) return;
    if (!existsSync2(dir)) {
      this.error = `\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${dir}`;
      return;
    }
    let areas;
    let needUpgrade = false;
    try {
      const hasWiki = statSync3(join2(dir, ".wiki"), { throwIfNoEntry: false })?.isDirectory() ?? false;
      const d = decideInit(readdirSync2(dir), hasWiki, hasWiki ? readWikiVersion(dir) : null, WIKI_VERSION);
      if (d.action === "refuse") {
        this.error = d.reason;
        return;
      }
      const gitErr = ensureGit(dir);
      if (gitErr) {
        this.error = gitErr;
        return;
      }
      needUpgrade = d.action === "migrate";
      mkdirSync(join2(dir, ".wiki", "tmp"), { recursive: true });
      areas = loadParts(dir, DEFAULT_AREAS);
      for (const a of [...areas, "asset", "raw"]) if (!existsSync2(join2(dir, a))) mkdirSync(join2(dir, a), { recursive: true });
      const t = ensureToolchain(dir, vaultTools());
      if (t.repointed.length) console.warn(`[vault] \u5DE5\u5177\u94FE\u8F6F\u94FE\u539F\u6307\u5411\u522B\u7684\u63D2\u4EF6\u5B89\u88C5\uFF0C\u5DF2\u91CD\u6307\u5230\u5F53\u524D\u63D2\u4EF6\uFF1A${t.repointed.join("\u3001")}`);
      if (t.skipped.length) console.warn(`[vault] \u5DE5\u5177\u94FE\u8FDE\u63A5\u8DF3\u8FC7\uFF08\u540C\u540D\u9879\u5DF2\u5B58\u5728\uFF0C\u672A\u52A8\uFF09\uFF1A${t.skipped.join("\u3001")}`);
    } catch (e) {
      this.error = `\u6253\u5F00\u5E93\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    if (!o.validate) {
      this.build(dir, areas);
      return;
    }
    this.validating = true;
    const live = () => gen === this.gen;
    const settle = (fn) => {
      if (!live()) return;
      this.validating = false;
      fn();
      this.emit({ kind: "structural" });
    };
    const stall = new Promise(() => {
    });
    const runCheck = () => Promise.resolve().then(() => (this.opts.check ?? realCheck)(dir)).then(
      // 同步抛错也走下面的报错
      (r) => settle(() => {
        if (r.ok) this.build(dir, areas);
        else {
          this.error = "\u6CA1\u901A\u8FC7\u6821\u9A8C\uFF0C\u77E5\u8BC6\u5E93\u672A\u6253\u5F00";
          this.checkOutput = r.output;
        }
      }),
      (e) => settle(() => {
        this.error = `\u6821\u9A8C\u6CA1\u8DD1\u8D77\u6765\uFF1A${e instanceof Error ? e.message : String(e)}`;
      })
    );
    if (!needUpgrade) {
      runCheck();
      return;
    }
    Promise.resolve().then(() => (this.opts.upgrade ?? realUpgrade)(dir)).then(
      (r) => {
        if (!live()) return stall;
        if (r.ok) return runCheck();
        settle(() => {
          this.error = "\u5347\u7EA7\u6CA1\u6210\u529F\uFF0C\u77E5\u8BC6\u5E93\u672A\u6253\u5F00";
          this.checkOutput = r.output;
        });
      },
      (e) => settle(() => {
        this.error = `\u5347\u7EA7\u6CA1\u8DD1\u8D77\u6765\uFF1A${e instanceof Error ? e.message : String(e)}`;
      })
    );
  }
  /** 建模型与监听（原 open 尾段）。失败落 error，不抛 */
  build(dir, areas) {
    try {
      if (this.storeDir !== dir) {
        this.store = new DocStore(dir);
        this.storeDir = dir;
      }
      this.model = buildModel(dir, this.store ?? void 0);
      const w = this.makeWatch([...areas.map((a) => join2(dir, a)), join2(dir, "asset"), join2(dir, "raw"), join2(dir, ".wiki", "anchors.conf"), join2(dir, ".wiki", "coverage.conf"), join2(dir, ".wiki", "wiki.json"), this.opts.toolsDir ?? vaultTools("skills")], {
        ignoreInitial: true,
        ignored: watchIgnored(dir)
      });
      w.on("error", (e) => {
        console.error("[vault] \u76D1\u542C\u51FA\u9519", e);
        if (!this.degraded) {
          this.degraded = true;
          this.emit({ kind: "structural" });
        }
      });
      w.on("all", (evt, p) => {
        this.pending.set(String(p).normalize("NFC"), evt);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), this.opts.debounceMs ?? 300);
      });
      this.stop = () => {
        clearTimeout(this.timer);
        this.pending.clear();
        return w.close();
      };
    } catch (e) {
      this.model = null;
      this.error = `\u6253\u5F00\u5E93\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`;
      this.stop?.().catch(() => {
      });
      this.stop = null;
    }
  }
  emit(ev) {
    try {
      this.notify(ev);
    } catch (e) {
      console.error("[vault] \u53D8\u66F4\u56DE\u8C03\u51FA\u9519", e);
    }
  }
  flush() {
    if (!this.pending.size || !this.model) return;
    const events = [...this.pending].map(([path13, evt]) => ({ evt, path: path13 }));
    this.pending.clear();
    const dir = this.dirOf();
    try {
      const plan = classifyEvents(events, { dir, areas: this.model.g.areas, toolsDir: this.opts.toolsDir ?? vaultTools("skills") });
      if (plan.kind === "reopen") {
        try {
          this.open();
        } catch (e) {
          console.error("[vault] \u91CD\u5F00\u5931\u8D25", e);
        }
        this.emit({ kind: "structural" });
        return;
      }
      if (plan.kind === "structural") {
        try {
          this.rebuild();
        } catch (e) {
          console.error("[vault] structural \u5168\u91CF\u91CD\u5EFA\u5931\u8D25\uFF0C\u6A21\u578B\u505C\u5728\u6700\u540E\u597D\u72B6\u6001", e);
        }
        this.emit({ kind: "structural" });
        return;
      }
      if (plan.kind === "patch") {
        const ids = /* @__PURE__ */ new Set();
        const flags = {};
        const merge = (r) => {
          for (const id2 of r.ids) ids.add(id2);
          for (const k of Object.keys(r.flags)) if (r.flags[k]) flags[k] = true;
        };
        const apply2 = this.opts.apply ?? applyDocOps;
        merge(apply2(this.model, plan.docOps));
        merge(applyAssets(this.model, plan.assets));
        merge(applyRaws(this.model, plan.raws));
        if (plan.anchors) merge(applyAnchors(this.model));
        if (plan.coverage) flags.documents = true;
        if (ids.size || Object.keys(flags).length) this.emit({ kind: "patch", ids: [...ids], flags });
      }
      if (plan.tools) this.emit({ kind: "tools" });
    } catch (e) {
      console.error("[vault] \u589E\u91CF\u8865\u4E01\u5931\u8D25\uFF0C\u9000\u56DE\u5168\u91CF\u91CD\u5EFA", e);
      try {
        this.rebuild();
      } catch (e2) {
        console.error("[vault] \u5168\u91CF\u91CD\u5EFA\u4E5F\u5931\u8D25\uFF0C\u6A21\u578B\u505C\u5728\u6700\u540E\u597D\u72B6\u6001", e2);
      }
      this.emit({ kind: "structural" });
    }
  }
  rebuild() {
    this.model = buildModel(this.dirOf(), this.store ?? void 0);
  }
  async close() {
    this.gen++;
    const s = this.stop;
    this.stop = null;
    this.model = null;
    clearTimeout(this.timer);
    this.pending.clear();
    await s?.();
  }
};

// src/core/hub.ts
var Hub = class {
  constructor(dir) {
    this.dir = dir;
    this.engine = new VaultEngine(dir, (ev) => this.emit(ev));
  }
  engine;
  listeners = /* @__PURE__ */ new Set();
  model() {
    if (!this.engine.model) {
      if (this.engine.validating) throw new Error("\u6B63\u5728\u6821\u9A8C\u77E5\u8BC6\u5E93\uFF0C\u7A0D\u7B49\u518D\u8BD5");
      throw new Error(this.engine.error ?? `\u5E93\u672A\u6253\u5F00\uFF1A${this.dir()}\uFF1B\u5230 \u8BBE\u7F6E \u2192 \u63D2\u4EF6 \u2192 \u683C\u7269\u81F4\u77E5 \u65B0\u5EFA\u6216\u6253\u5F00\u4E00\u4E2A\u77E5\u8BC6\u5E93`);
    }
    return this.engine.model;
  }
  onChanged(cb) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  reopen() {
    try {
      this.engine.open({ validate: true });
    } catch (e) {
      console.error("[dsh-knowledge-brain] \u6253\u5F00\u5E93\u5931\u8D25", e);
    }
    this.emit({ kind: "structural" });
  }
  // 场景文件被直接重写（rpc saveExcalidraw，不经引擎）：按 patch 事件广播，
  // id 用资产路径——旧客户端 touches 只做 includes(页路径)，未知 id 天然忽略，协议兼容
  assetChanged(rel) {
    this.emit({ kind: "patch", ids: [rel], flags: {} });
  }
  emit(ev) {
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch (e) {
        console.error("[dsh-knowledge-brain] \u53D8\u66F4\u56DE\u8C03\u51FA\u9519", e);
      }
    }
  }
};

// src/lark/chats.ts
import { randomUUID } from "node:crypto";

// src/core/folder.ts
var ROOT_FOLDER = "/";
function folderText(raw) {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return "";
}
function normFolder(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^\/+$/.test(t)) return ROOT_FOLDER;
  const f = t.replace(/^\/+|\/+$/g, "");
  if (f.split("/").some((seg2) => seg2 === "" || seg2 === "." || seg2 === "..")) return null;
  return f;
}
var isVaultRoot = (folder) => folder === ROOT_FOLDER;

// src/lark/bindings.ts
var MODEL = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function nameOf(appId) {
  const s = appId.replace(/[^A-Za-z0-9-]+/g, "-");
  return /^[A-Za-z0-9]/.test(s) ? s : "app" + s;
}
function normalizeApps(raw) {
  const ok = [];
  const problems = [];
  if (raw === void 0 || raw === null) return { ok, problems };
  if (!Array.isArray(raw)) return { ok, problems: ["larkApps \u4E0D\u662F\u6570\u7EC4"] };
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`${String(item)}\uFF1A\u4E0D\u662F\u5BF9\u8C61`);
      continue;
    }
    const appId = String(item.appId ?? "").trim();
    if (!appId) {
      problems.push(`${String(item.appId ?? "\u67D0\u884C")}\uFF1A\u7F3A appId`);
      continue;
    }
    const appSecret = String(item.appSecret ?? "").trim();
    const rawFolder = folderText(item.folder);
    if (!appSecret) {
      problems.push(`${appId}\uFF1A\u7F3A appSecret`);
      continue;
    }
    if (!rawFolder.trim()) {
      problems.push(`${appId}\uFF1A\u7F3A folder`);
      continue;
    }
    const folder = normFolder(rawFolder);
    if (folder === null) {
      problems.push(`${appId}\uFF1Afolder \u4E0D\u80FD\u542B\u7A7A\u6BB5\u3001. \u6216 .. \u6BB5`);
      continue;
    }
    const model = String(item.model ?? "");
    if (model && !MODEL.test(model)) {
      problems.push(`${appId}\uFF1Amodel \u8981\u5199\u6210 provider/model`);
      continue;
    }
    if (ok.some((a) => a.appId === appId)) {
      problems.push(`${appId}\uFF1A\u540C\u4E00 app_id \u53EA\u80FD\u914D\u4E00\u4E2A\u673A\u5668\u4EBA`);
      continue;
    }
    ok.push({ appId, appSecret, folder, model });
  }
  return { ok, problems };
}

// src/lark/chats.ts
var slug2 = (s) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
var ChatSessions = class {
  constructor(now = () => Date.now(), namespace = randomUUID()) {
    this.now = now;
    this.namespace = namespace;
  }
  map = {};
  rec(appId, chatId) {
    return this.map[appId]?.[chatId];
  }
  /** id 在本次运行内稳定，跨运行隔离；序号避开本次已在册的 id。 */
  nextId(appId, chatId) {
    const rec = this.rec(appId, chatId);
    const taken = new Set((rec?.past ?? []).map((p) => p.id));
    if (rec?.current) taken.add(rec.current);
    const base = `lark-${slug2(nameOf(appId))}-${slug2(chatId)}-${this.namespace}`;
    let n = rec?.past.length ?? 0;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }
  /** create 因 cwd 冲突拒绝复用 id 时记入已占用列表，让 nextId 跳过。 */
  reserve(appId, chatId, id2, title) {
    const apps = this.map[appId] ??= {};
    const rec = apps[chatId] ??= { current: "", currentTitle: "", past: [], lastAt: 0, chatType: "" };
    if (rec.current === id2 || rec.past.some((p) => p.id === id2)) return;
    rec.past = [{ id: id2, title }, ...rec.past];
  }
  /** 把（新建的）会话记为当前会话 */
  bind(appId, chatId, id2, title, chatType) {
    const apps = this.map[appId] ??= {};
    apps[chatId] = { ...apps[chatId] ?? { current: "", currentTitle: "", past: [], lastAt: 0, chatType }, current: id2, currentTitle: title, lastAt: this.now(), chatType };
  }
  /** 轮换：当前会话挪进 past 头部、清空 current（下条消息懒建新的）。没有当前会话则无操作 */
  rotate(appId, chatId) {
    const rec = this.rec(appId, chatId);
    if (!rec?.current) return null;
    const moved = { id: rec.current, title: rec.currentTitle };
    rec.past = [moved, ...rec.past];
    rec.current = "";
    rec.currentTitle = "";
    return moved;
  }
  /** 记活跃（每条消息后刷 lastAt/chatType；没在册的不硬造记录——bind 才建） */
  touch(appId, chatId, chatType) {
    const rec = this.rec(appId, chatId);
    if (!rec) return;
    rec.lastAt = this.now();
    rec.chatType = chatType;
  }
  list(appId) {
    return Object.entries(this.map[appId] ?? {}).map(([chatId, rec]) => ({ chatId, ...rec })).sort((a, b) => b.lastAt - a.lastAt);
  }
  /** 删机器人时清掉它的映射（DSH 会话本体保留，历史还能在宿主会话列表里找到） */
  drop(appId) {
    delete this.map[appId];
  }
};

// src/host/rpc.ts
import fs9 from "node:fs";

// src/core/vault/sitedata.ts
function treeJson(g, href) {
  function conv(node) {
    return {
      name: displayName(node),
      path: node.doc ? href(node.doc) : null,
      // 节点的库内路径：目录是目录路径（path 是索引页 id，当不了文件夹路径；displayName 首层还会被
      // 索引页标题替换），文件是 .md 路径（= 页 id）。绑定下拉、目录拖动这类「要指认节点」的消费者用 rel
      rel: node.dir ? node.rel ?? null : node.doc ? href(node.doc) : null,
      desc: node.doc && node.doc.description || "",
      dir: !!node.dir,
      count: node.dir ? node.count : 0,
      children: node.items.map(conv)
    };
  }
  return { children: g.root.items.map(conv) };
}
function graphJson(g, href) {
  const idOf = /* @__PURE__ */ new Map();
  const nodes = g.order.map((doc) => {
    const node = g.nodeOf.get(doc._id);
    const id2 = href(doc);
    idOf.set(doc._id, id2);
    return { id: id2, name: displayName(node), crumb: crumbOf(node), area: areaOf(doc), index: !!node.dir, indeg: 0, outdeg: 0 };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  for (const [tid, list3] of g.backlinks) {
    const t = idOf.get(tid);
    if (!t) continue;
    for (const b of list3) {
      const s = idOf.get(b.doc._id);
      if (!s) continue;
      edges.push({ s, t, type: "ref" });
      byId.get(s).outdeg += 1;
      byId.get(t).indeg += 1;
    }
  }
  for (const doc of g.order) {
    const p = g.nodeOf.get(doc._id).parent;
    if (p && p.parent && p.doc) edges.push({ s: idOf.get(p.doc._id), t: idOf.get(doc._id), type: "tree" });
  }
  return { nodes, edges };
}

// src/core/raw.ts
import fs3 from "node:fs";
import path7 from "node:path";

// src/core/guard.ts
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
function inside(root, rel, sub) {
  if (!rel || rel.includes("\0")) return null;
  const base = resolve(root, sub ?? ".");
  const abs = resolve(root, rel);
  if (!abs.startsWith(base + sep)) return null;
  let real, realBase;
  try {
    real = realpathSync(abs);
    realBase = realpathSync(base);
  } catch {
    return abs;
  }
  return real.startsWith(realBase + sep) ? abs : null;
}

// src/core/raw.ts
var ROOTS = ["book", "document"];
var IMAGE = /\.(jpe?g|png|gif|svg|webp)$/i;
function kindOf(name2) {
  if (/\.md$/i.test(name2)) return "md";
  if (/\.pdf$/i.test(name2)) return "pdf";
  if (/\.html?$/i.test(name2)) return "html";
  return "other";
}
var byName = (a, b) => a.name.localeCompare(b.name, "zh");
var DIR_MERGE = /^(?:raw\/book|raw\/document\/\d{4}-\d{2}-\d{2})$/;
function walk(dir, rel) {
  let entries;
  try {
    entries = fs3.readdirSync(path7.join(dir, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  const files = [];
  for (const e of entries) {
    if (e.name.startsWith(".") || IMAGE.test(e.name)) continue;
    const name2 = e.name.normalize("NFC");
    const child = rel + "/" + name2;
    if (e.isDirectory()) {
      const kids = walk(dir, child);
      const idx = DIR_MERGE.test(rel) ? kids.findIndex((k) => !k.dir && k.path === child + "/" + name2 + ".md") : -1;
      const index = idx === -1 ? null : kids.splice(idx, 1)[0];
      if (!kids.length && !index) continue;
      const count = kids.reduce((n, k) => n + (k.dir ? k.count + (k.path ? 1 : 0) : 1), 0);
      dirs.push({ name: name2, path: index?.path ?? null, rel: null, desc: "", dir: true, count, children: kids });
    } else {
      files.push({ name: /\.md$/i.test(name2) ? name2.replace(/\.md$/i, "") : name2, path: child, rel: null, desc: "", dir: false, count: 0, children: [] });
    }
  }
  dirs.sort(/^raw\/document$/.test(rel) ? (a, b) => byName(b, a) : byName);
  files.sort(byName);
  return [...dirs, ...files];
}
function rawTree(dir) {
  const top = walk(dir, "raw").filter((n) => n.dir && n.name !== "project");
  top.sort((a, b) => ROOTS.indexOf(a.name) - ROOTS.indexOf(b.name));
  return { children: top };
}
async function readRaw(m, rel) {
  const abs = rel.startsWith("raw/") ? inside(m.dir, rel, "raw") : null;
  if (!abs) return { ok: false };
  let st;
  try {
    st = fs3.statSync(abs);
  } catch {
    return { ok: false };
  }
  const name2 = rel.split("/").pop();
  const kind = kindOf(name2);
  const offline = st.size > 0 && st.blocks === 0;
  const base = { path: rel, name: kind === "md" ? name2.replace(/\.md$/i, "") : name2, kind, size: st.size, offline, html: "", toc: [], url: "" };
  if (kind === "pdf" || kind === "html") return { ok: true, raw: { ...base, url: assetUrl(rel) } };
  if (kind !== "md" || offline) return { ok: true, raw: base };
  const { data, body } = parseFrontmatter(fs3.readFileSync(abs, "utf8"));
  if (!m.html.has(rel)) {
    m.html.set(rel, renderPage({ _id: rel, _content: body }, m).catch((err) => {
      m.html.delete(rel);
      throw err;
    }));
  }
  const { html, toc } = await m.html.get(rel);
  return { ok: true, raw: { ...base, html, toc, text: body, hash: `${st.mtimeMs}:${st.size}` } };
}

// src/core/books.ts
import fs4 from "node:fs";
import path8 from "node:path";
var SOURCE_EXT = [".pdf", ".azw3", ".epub", ".mobi"];
var MATERIAL_STATUSES = /* @__PURE__ */ new Set(["unavailable", "init", "text", "figures", "proofread", "readable", "failed"]);
var list = (abs) => {
  try {
    return fs4.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
};
var nfc = (s) => s.normalize("NFC");
var CHAPTER_ID = String.raw`\d+(?:\.\d+)*`;
var ID_END = String.raw`(?=\s|→|$)`;
var CHECK = new RegExp(String.raw`^\s*-\s*\[( |x|X)\]\s*(${CHAPTER_ID})${ID_END}\s*(.*?)(?:\s*→\s*` + "`([^`]+)`" + String.raw`)?\s*$`);
var GROUP = new RegExp(String.raw`^###\s+(${CHAPTER_ID})(?=\s|$)\s*(.*)$`);
var CHAPTER_FILE = new RegExp(String.raw`^(${CHAPTER_ID}) (.+)\.md$`);
function parseChapterFile(name2) {
  const m = CHAPTER_FILE.exec(nfc(name2));
  return m && m[2].trim() ? { id: m[1], title: m[2].trim() } : null;
}
function chapterKey(a, b) {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === void 0) return -1;
    if (y[i] === void 0) return 1;
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}
var chapterParent = (id2) => id2.includes(".") ? id2.slice(0, id2.lastIndexOf(".")) : null;
var SECTION = /^## 知识沉淀\s*$/m;
var ENTRY = new RegExp(String.raw`^- (${CHAPTER_ID})${ID_END}(.*)$`);
var WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
function depositMap(body) {
  const out = /* @__PURE__ */ new Map();
  const i = body.search(SECTION);
  if (i < 0) return out;
  let cur = null;
  for (const l of body.slice(i).split("\n").slice(1)) {
    if (/^## /.test(l)) break;
    const m = ENTRY.exec(l);
    if (m) {
      const arrow = m[2].indexOf("\u2192");
      const dest = arrow < 0 ? null : m[2].slice(arrow + 1).replace(/`/g, "").split(/[，,：:]/)[0].trim() || null;
      cur = { depositing: /·\s*沉淀中/.test(m[2]), dest, links: [] };
      out.set(m[1], cur);
    } else if (/^\S/.test(l)) cur = null;
    if (cur) for (const w of l.matchAll(WIKILINK)) {
      const n = w[1].trim();
      if (!cur.links.includes(n)) cur.links.push(n);
    }
  }
  return out;
}
function loadBooks(dir) {
  const root = path8.join(dir, "raw", "book");
  const books = [];
  for (const e of list(root)) {
    if (!e.isDirectory()) continue;
    const name2 = nfc(e.name);
    const bdir = path8.join(root, e.name);
    let raw = "";
    try {
      raw = fs4.readFileSync(path8.join(bdir, `${e.name}.md`), "utf8");
    } catch {
      continue;
    }
    const { data, body } = parseFrontmatter(raw);
    const deposits = depositMap(body);
    const texts = list(path8.join(bdir, "\u7AE0\u8282")).filter((f) => f.isFile() && f.name.endsWith(".md")).map((f) => nfc(f.name));
    const source = list(bdir).find((f) => f.isFile() && SOURCE_EXT.includes(path8.extname(f.name).toLowerCase()));
    const rel = `raw/book/${name2}`;
    const sourceRel = source ? `${rel}/${nfc(source.name)}` : null;
    const saved = String(data.material_status ?? "");
    const materialStatus = MATERIAL_STATUSES.has(saved) && !(saved === "unavailable" && sourceRel) ? saved : sourceRel ? "init" : "unavailable";
    const readable = materialStatus === "readable";
    const chapters = [];
    const groups = /* @__PURE__ */ new Map();
    const ps = body.search(/^## 章节进度\s*$/m);
    const progress = ps < 0 ? "" : body.slice(ps).replace(/^## 章节进度[^\n]*\n/, "").split(/^## /m)[0];
    for (const l of progress.split("\n")) {
      const g = GROUP.exec(l);
      if (g) groups.set(g[1], g[2].trim() ? `${g[1]} ${g[2].trim()}` : g[1]);
    }
    for (const l of body.split("\n")) {
      const m = CHECK.exec(l);
      if (!m) continue;
      const id2 = m[2];
      const read = m[1].toLowerCase() === "x";
      const listed = m[4] ? nfc(m[4]) : null;
      const textName = listed && texts.includes(path8.basename(listed)) ? path8.basename(listed) : texts.find((t) => parseChapterFile(t)?.id === id2) ?? null;
      const dep = deposits.get(id2);
      const state = dep ? dep.depositing ? "depositing" : "done" : read ? "read" : "unread";
      const parent = chapterParent(id2);
      chapters.push({ id: id2, title: m[3].trim(), group: parent ? groups.get(parent) ?? parent : null, state, read, text: readable && textName ? `${rel}/\u7AE0\u8282/${textName}` : null, dest: dep?.dest ?? null, pages: (dep?.links ?? []).map((n) => ({ name: n, id: null })) });
    }
    books.push({
      name: name2,
      path: rel,
      progress: String(data.progress ?? ""),
      source: sourceRel,
      materialStatus,
      materialError: String(data.material_error ?? ""),
      chapters
    });
  }
  return books.sort((a, b) => Number(b.progress === "\u5728\u8BFB") - Number(a.progress === "\u5728\u8BFB") || a.name.localeCompare(b.name, "zh"));
}
function chapterMarkdown(dir, rel) {
  if (!/\.md$/i.test(rel)) return null;
  try {
    return parseFrontmatter(fs4.readFileSync(path8.join(dir, rel), "utf8")).body;
  } catch {
    return null;
  }
}
function readChapter(dir, book, id2) {
  const chapter = book.chapters.find((c) => c.id === id2);
  if (!chapter) throw new Error(`${book.name} \u6CA1\u6709 ${id2}`);
  const read = (rel) => fs4.readFileSync(path8.join(dir, rel), "utf8");
  const raw = chapter.text ? read(chapter.text) : null;
  return { book: book.name, chapter, raw, html: null, toc: [], readable: book.materialStatus === "readable" };
}

// src/core/vault/blockcache.ts
var BlockHtmlCache = class {
  constructor(cap = 32) {
    this.cap = cap;
  }
  map = /* @__PURE__ */ new Map();
  get(src) {
    const v = this.map.get(src);
    if (v !== void 0) {
      this.map.delete(src);
      this.map.set(src, v);
    }
    return v;
  }
  set(src, p) {
    if (this.map.has(src)) this.map.delete(src);
    this.map.set(src, p);
    if (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value;
      if (oldest !== void 0) this.map.delete(oldest);
    }
  }
  has(src) {
    return this.map.has(src);
  }
  delete(src) {
    this.map.delete(src);
  }
  clear() {
    this.map.clear();
  }
};

// src/core/llm.ts
var MAX_CHARS = 2e4;
function clip(text, offset = 0) {
  const end = offset + MAX_CHARS;
  return end < text.length ? { text: text.slice(offset, end) + `

\u2026\uFF08\u5DF2\u622A\u65AD\uFF0C\u7528 offset=${end} \u7EED\u8BFB\uFF09`, next: end } : { text: text.slice(offset), next: null };
}
var baseOf2 = (id2) => id2.split("/").pop().replace(/\.md$/i, "");
function resolvePage(m, q, keep) {
  const ok = (d) => !!d && (!keep || keep(d._id));
  const hit = m.byId.get(q) ?? m.byId.get(q.endsWith(".md") ? q : q + ".md");
  if (ok(hit)) return { doc: hit };
  const byName2 = [...m.byId.values()].filter((d) => ok(d) && (baseOf2(d._id) === q || displayName(m.g.nodeOf.get(d._id)) === q));
  if (byName2.length === 1) return { doc: byName2[0] };
  if (byName2.length > 1) return { candidates: byName2.map((d) => refOf(m, d)) };
  return { candidates: search(m.search, q, 8, keep).map((h) => ({ id: h.id, name: h.name, crumb: h.crumb })) };
}
var IMG_RE = /!\[([^\]]*)\]\((<[^>]*>|(?:[^\s()]|\([^\s()]*\))+)((?:\s+"[^"]*")?)\)/g;
var escSrc = (p) => p.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
function rootImages(docId, body) {
  return body.replace(IMG_RE, (all, alt, src, title) => {
    const raw = src.startsWith("<") ? src.slice(1, -1) : src;
    const rel = assetRel(docId, raw);
    return rel ? `![${alt}](${escSrc(rel)}${title})` : all;
  });
}
function pageForLlm(m, doc, offset = 0) {
  const s = statusOf(m.g, doc, m.anchors);
  const { prev, next } = prevNext(m.g, doc);
  const c = clip(rootImages(doc._id, String(doc._content ?? "")), offset);
  return {
    ...refOf(m, doc),
    title: doc.title,
    description: doc.description,
    tags: doc.tags,
    status: { human: s.human, draft: s.draft, updated: s.updated },
    offline: !!doc.offline,
    prev: prev ? refOf(m, prev) : null,
    next: next ? refOf(m, next) : null,
    backlinks: (m.g.backlinks.get(doc._id) || []).map((b) => refOf(m, b.doc)),
    body: doc.offline ? "\uFF08\u6587\u4EF6\u5728 OneDrive \u4E0A\u672A\u4E0B\u8F7D\u5230\u672C\u673A\uFF0C\u8BFB\u4E0D\u5230\u6B63\u6587\uFF09" : c.text,
    next_offset: doc.offline ? null : c.next
  };
}
function resolveRef(m, name2) {
  const d = resolveName(m.g, name2);
  if (d) return d._id;
  if (name2.includes("/")) return null;
  const r = resolvePage(m, name2);
  return "doc" in r ? r.doc._id : null;
}
function resolveNameStates(m, names) {
  const out = {};
  for (const n of names) {
    const id2 = resolveRef(m, n);
    out[n] = id2 ? { id: id2 } : { id: null, dead: deadReason(m.dead.get(n) ?? deadInfo(m.g, m.raws, n), m.g) };
  }
  return out;
}

// src/core/documents.ts
import fs5 from "node:fs";
import path9 from "node:path";
var nfc2 = (s) => s.normalize("NFC");
var list2 = (abs) => {
  try {
    return fs5.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
};
function loadCoverage(dir) {
  const out = /* @__PURE__ */ new Map();
  let text = "";
  try {
    text = fs5.readFileSync(path9.join(dir, ".wiki", "coverage.conf"), "utf8");
  } catch {
    return out;
  }
  let cur = null;
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    if (s.startsWith("[") && s.endsWith("]")) {
      cur = nfc2(s.slice(1, -1).trim());
      if (!out.has(cur)) out.set(cur, {});
    } else if (s.includes("=") && cur !== null) {
      const i = s.indexOf("=");
      out.get(cur)[s.slice(0, i).trim()] = s.slice(i + 1).trim();
    }
  }
  return out;
}
function loadDocuments(m) {
  const cited = /* @__PURE__ */ new Map();
  for (const d of m.byId.values()) for (const s of d.sources ?? []) {
    const k = nfc2(String(s));
    if (!cited.has(k)) cited.set(k, []);
    cited.get(k).push(d);
  }
  const cov = loadCoverage(m.dir);
  const out = [];
  const kind = "document";
  const root = path9.join(m.dir, "raw", kind);
  for (const e of list2(root).filter((x) => x.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(x.name))) {
    const day = path9.join(root, e.name);
    const entries = [];
    for (const x of list2(day)) {
      if (x.name === ".gitkeep") continue;
      if (x.isDirectory()) {
        if (x.name === "images") continue;
        for (const f of list2(path9.join(day, x.name)))
          if (f.isFile() && f.name !== ".gitkeep") entries.push({ seg: x.name, name: f.name });
      } else if (x.isFile()) entries.push({ seg: "", name: x.name });
    }
    for (const f of entries.sort((a, b) => a.name.localeCompare(b.name, "zh"))) {
      const name2 = nfc2(f.name);
      const rel = `raw/${kind}/${e.name}/${f.seg ? f.seg + "/" : ""}${name2}`;
      const by = cited.get(rel) ?? [];
      const c = cov.get(rel) ?? {};
      const grade = c.material_status;
      const status = grade === "processing" || grade === "done" ? grade : by.length ? "cited" : "unprocessed";
      const ext = path9.extname(name2).slice(1).toLowerCase();
      out.push({ path: rel, name: ext === "md" ? name2.slice(0, -3) : name2, ext, date: e.name, status, citedBy: by.map((d) => refOf(m, d)), detail: c.detail ?? "" });
    }
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "zh"));
  return out;
}

// src/host/actions.ts
import fs6 from "node:fs";
import path10 from "node:path";
import { execFile as execFile2 } from "node:child_process";
import { createHash } from "node:crypto";
var GROUP_LINE = new RegExp(String.raw`^###\s+(${CHAPTER_ID})(?=\s|$)`);
var sha1 = (s) => createHash("sha1").update(s, "utf8").digest("hex");
function writeAtomic(abs, text) {
  const tmp = path10.join(path10.dirname(abs), `.${path10.basename(abs)}.wk-${process.pid}.tmp`);
  fs6.writeFileSync(tmp, text, "utf8");
  fs6.renameSync(tmp, abs);
}
var today = () => {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function wikiTimeout(args) {
  if (args[1] === "book" && args[2] === "split") return 10 * 6e4;
  if (args[1] === "init") return 18e4;
  return 3e4;
}
var runWiki = (file, args, cwd) => new Promise((ok, fail2) => execFile2(file, args, { cwd, timeout: wikiTimeout(args) }, (e, out, err) => e ? fail2(new Error(String(err || out || e.message).trim())) : ok(String(out))));
function setFrontmatter(abs, patch) {
  let text = fs6.readFileSync(abs, "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) throw new Error(`\u7F3A\u5C11 frontmatter\uFF1A${abs}`);
  const lines = m[1].split(/\r?\n/);
  const order = ["title", "description", "tags", "source", "status", "material_status", "material_error", "progress"];
  for (const [key, value] of Object.entries(patch)) {
    const line = `${key}: ${JSON.stringify(value)}`;
    const re = new RegExp(`^${key}:.*$`, "m");
    const at = lines.findIndex((item) => re.test(item));
    if (at >= 0) {
      lines[at] = line;
      continue;
    }
    const rank = order.indexOf(key);
    let insertAt = lines.length;
    if (rank >= 0) {
      const next = lines.findIndex((item) => {
        const field = item.match(/^([A-Za-z_][A-Za-z0-9_-]*):/)?.[1];
        return field ? order.indexOf(field) > rank : false;
      });
      if (next >= 0) insertAt = next;
    }
    lines.splice(insertAt, 0, line);
  }
  text = `---
${lines.join("\n")}
---${text.slice(m[0].length)}`;
  writeAtomic(abs, text);
}
function syncChapterIndex(abs, files, read) {
  const leaves = files.map((f) => ({ f, c: parseChapterFile(f) })).filter((x) => !!x.c);
  if (!leaves.length) throw new Error("\u8F6C\u6362\u7ED3\u679C\u6CA1\u6709\u300C<\u53F7> <\u6807\u9898>.md\u300D\u7AE0\u8282");
  const text = fs6.readFileSync(abs, "utf8");
  const start = text.search(/^## 章节进度\s*$/m);
  if (start < 0) throw new Error("\u8FDB\u5EA6\u9875\u7F3A\u5C11\u300C## \u7AE0\u8282\u8FDB\u5EA6\u300D");
  const tail = text.slice(start + "## \u7AE0\u8282\u8FDB\u5EA6".length);
  const next = tail.search(/^## /m);
  const end = next < 0 ? text.length : start + "## \u7AE0\u8282\u8FDB\u5EA6".length + next;
  const groups = /* @__PURE__ */ new Map();
  for (const l of text.slice(start, end).split("\n")) {
    const g = GROUP_LINE.exec(l);
    if (g) groups.set(g[1], l.trimEnd());
  }
  const rows = [];
  let last;
  for (const { f, c } of leaves.sort((a, b) => chapterKey(a.c.id, b.c.id))) {
    const parent = chapterParent(c.id);
    if (parent !== null && parent !== last) rows.push(groups.get(parent) ?? `### ${parent}`);
    last = parent;
    rows.push(`- [${read.get(c.id) ? "x" : " "}] ${c.id} ${c.title} \u2192 \`\u7AE0\u8282/${f}\``);
  }
  writeAtomic(abs, (text.slice(0, start) + `## \u7AE0\u8282\u8FDB\u5EA6

${rows.join("\n")}

` + text.slice(end).replace(/^\n+/, "")).replace(/\n+$/, "\n"));
}
function bookChapter(dir, book, id2) {
  const b = loadBooks(dir).find((x) => x.name === book);
  if (!b) throw new Error(`\u4E66\u67B6\u4E0A\u6CA1\u6709 ${book}`);
  const c = b.chapters.find((x) => x.id === id2);
  if (!/^\d+(\.\d+)*$/.test(id2) || !c) throw new Error(`${book} \u6CA1\u6709 ${id2}`);
  return { b, c };
}
function placeArgs(p, none = []) {
  if (p.before) return ["--before", p.before];
  if (p.after) return ["--after", p.after];
  if (p.first) return ["--first"];
  return typeof none === "string" ? [none] : none;
}
function createActions(dir, run = runWiki) {
  const wiki = (args) => run("python3", [vaultTools("bin", "wiki"), ...args], dir());
  return {
    async readChapter(p) {
      bookChapter(dir(), p.book, p.id);
      await wiki(["book", "read", p.book, p.id]);
      return { ok: true };
    },
    // 「完成」只由人标，规则在 CLI 里（身份不是 human: 就拒）；这里不绕
    async deposit(p) {
      bookChapter(dir(), p.book, p.id);
      await wiki(["book", "deposit", p.book, p.id, ...p.done ? ["--done"] : []]);
      return { ok: true };
    },
    // 只做入库第 2 步（转文本），写 text；补图 / 梳理 / 质检走 wiki-write-book-ingest
    async convertBook(p) {
      const root = dir();
      const book = loadBooks(root).find((x) => x.name === p.book);
      if (!book) throw new Error(`\u4E66\u67B6\u4E0A\u6CA1\u6709 ${p.book}`);
      if (!book.source) throw new Error(`${p.book} \u6CA1\u6709\u53EF\u8F6C\u6362\u7684\u6E90\u6587\u4EF6`);
      const source = inside(root, book.source, path10.join("raw", "book"));
      if (!source || !fs6.statSync(source, { throwIfNoEntry: false })?.isFile()) throw new Error(`\u8BFB\u4E0D\u5230\u6E90\u6587\u4EF6\uFF1A${book.source}`);
      const ext = path10.extname(source).toLowerCase();
      if (![".pdf", ".epub", ".azw3", ".mobi"].includes(ext)) throw new Error(`\u6682\u4E0D\u652F\u6301 ${ext || "\u65E0\u6269\u5C55\u540D"} \u4E66\u7C4D`);
      const bookDir = path10.join(root, book.path);
      const index = path10.join(bookDir, `${book.name}.md`);
      const target2 = path10.join(bookDir, "\u7AE0\u8282");
      const existing = (() => {
        try {
          return fs6.readdirSync(target2);
        } catch {
          return [];
        }
      })();
      if (book.materialStatus !== "init" && book.materialStatus !== "failed") throw new Error(`${p.book} \u5DF2\u662F\u300C${book.materialStatus}\u300D\uFF0C\u4E0D\u80FD\u518D\u8F6C\u6362\uFF1B\u540E\u7EED\u6B65\u9AA4\u8D70 wiki-write-book-ingest`);
      if (existing.length) throw new Error("\u7AE0\u8282\u76EE\u5F55\u5DF2\u6709\u5185\u5BB9\uFF0C\u4E0D\u4F1A\u8986\u76D6\uFF1B\u8BF7\u5148\u786E\u8BA4\u73B0\u6709\u8F6C\u6362\u7ED3\u679C");
      const originalIndex = fs6.readFileSync(index, "utf8");
      const targetExisted = fs6.existsSync(target2);
      setFrontmatter(index, { material_error: "" });
      const tmpBase = path10.join(root, ".wiki", "tmp");
      fs6.mkdirSync(tmpBase, { recursive: true });
      const tmp = fs6.mkdtempSync(path10.join(tmpBase, "book-convert-"));
      const output2 = path10.join(tmp, "\u7AE0\u8282");
      let installed = false;
      try {
        await wiki(["book", "split", source, output2]);
        const files = fs6.readdirSync(output2).filter((f) => !!parseChapterFile(f));
        if (!files.length) throw new Error("\u8F6C\u6362\u6CA1\u6709\u751F\u6210\u7AE0\u8282\u6587\u5B57");
        if (fs6.existsSync(target2)) fs6.rmSync(target2, { recursive: true, force: true });
        fs6.renameSync(output2, target2);
        installed = true;
        syncChapterIndex(index, files, new Map(book.chapters.map((c) => [c.id, c.read])));
        await wiki(["book", "images", book.name]);
        setFrontmatter(index, { material_status: "text", material_error: "" });
        return { ok: true };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (installed) {
          fs6.rmSync(target2, { recursive: true, force: true });
          if (targetExisted) fs6.mkdirSync(target2, { recursive: true });
        }
        writeAtomic(index, originalIndex);
        const scanned = /扫描版/.test(message);
        setFrontmatter(index, { material_status: scanned ? "init" : "failed", material_error: message.slice(0, 500) });
        throw e;
      } finally {
        fs6.rmSync(tmp, { recursive: true, force: true });
      }
    },
    async cover(p) {
      if (p.grade !== "processing" && p.grade !== "done") throw new Error(`\u4E0D\u8BA4\u8BC6\u7684\u72B6\u6001\uFF1A${p.grade}`);
      const abs = inside(dir(), String(p.path), path10.join("raw", "document"));
      if (!abs || !fs6.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new Error(`\u6CA1\u6709\u8FD9\u4EFD\u6587\u6863\uFF1A${p.path}`);
      await wiki(["document", "cover", p.path, p.grade]);
      return { ok: true };
    },
    // 知识沉淀页「标记完成」：草稿 → stable。状态写死，调用方传不了别的；「页存在且是 draft」由 rpc.ts 按模型校验
    async mark(p) {
      const rel = String(p.path);
      if (!rel.endsWith(".md")) throw new Error(`\u4E0D\u662F md \u9875\uFF1A${rel}`);
      const abs = inside(dir(), rel);
      if (!abs || !fs6.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new Error(`\u6CA1\u6709\u8FD9\u9875\uFF1A${rel}`);
      await wiki(["page", "mark", rel, "stable"]);
      return { ok: true };
    },
    // 目录拖动：同文件夹调先后 / 移进别的文件夹。节点、文件夹、兄弟都由 rpc.ts 按模型校验过
    async reorder(p) {
      await wiki(["page", "order", p.node, ...placeArgs(p.place, "--last")]);
      return { ok: true };
    },
    async move(p) {
      await wiki(["page", "move", p.node, p.folder.replace(/\/$/, "") + "/", ...placeArgs(p.place)]);
      return { ok: true };
    },
    // 编辑正文：hash 是整文件 sha1；save 时磁盘上已不是 baseHash 就拒写，交给界面判冲突
    source(abs) {
      const text = fs6.readFileSync(abs, "utf8");
      return { text, hash: sha1(text) };
    },
    save(abs, text, baseHash) {
      const cur = sha1(fs6.readFileSync(abs, "utf8"));
      if (cur !== baseHash) return { ok: false, conflict: true, hash: cur };
      writeAtomic(abs, text);
      return { ok: true, hash: sha1(text) };
    },
    // 只动 frontmatter 里的 updated: 一行；没有 frontmatter 或没有这行不加
    touchUpdated(abs) {
      const text = fs6.readFileSync(abs, "utf8");
      const m = /^---\r?\n[\s\S]*?\r?\n---/.exec(text);
      if (!m) return { hash: sha1(text) };
      const fm = m[0].replace(/^updated:.*$/m, `updated: ${today()}`);
      const next = fm + text.slice(m[0].length);
      if (next !== text) writeAtomic(abs, next);
      return { hash: sha1(next) };
    }
  };
}

// src/core/tree-edit.ts
import fs7 from "node:fs";
import path11 from "node:path";
var segs = (rel) => rel.split("/");
function plain(m, rel) {
  const s = segs(rel);
  if (!rel || s.some((x) => !x || x === "." || x === ".." || x.startsWith("."))) throw new Error(`\u8DEF\u5F84\u4E0D\u5BF9\uFF1A${rel}`);
  if (!m.g.areas.includes(s[0])) throw new Error(`\u4E0D\u5728\u77E5\u8BC6\u6C89\u6DC0\u91CC\uFF1A${rel}`);
  return s;
}
var isDir = (m, rel) => !!fs7.statSync(path11.join(m.dir, rel), { throwIfNoEntry: false })?.isDirectory();
function nodeRel(m, rel) {
  const s = plain(m, rel);
  if (rel.endsWith(".md")) {
    if (!m.byId.has(rel)) throw new Error(`\u5E93\u91CC\u6CA1\u6709\u8FD9\u9875\uFF1A${rel}`);
    if (s.length === 2 && s[1] === `${s[0]}.md`) throw new Error(`\u533A\u9875\u4E0D\u80FD\u62D6\uFF1A${rel}`);
    return rel;
  }
  if (s.length < 2 || !isDir(m, rel)) throw new Error(`\u4E0D\u662F\u53EF\u62D6\u7684\u6587\u4EF6\u5939\uFF1A${rel}`);
  return rel;
}
function folderRel(m, rel) {
  plain(m, rel);
  if (rel.endsWith(".md") || !isDir(m, rel)) throw new Error(`\u4E0D\u662F\u6587\u4EF6\u5939\uFF1A${rel}`);
  return rel;
}
function moveImpact(m, rel) {
  const inside2 = (id2) => id2 === rel || id2.startsWith(rel + "/");
  let pages = 0;
  for (const [id2, links] of m.g.linksOf) {
    if (inside2(id2)) continue;
    if (links.some((l) => {
      const d = resolveName(m.g, l.target);
      return !!d && inside2(d._id);
    })) pages++;
  }
  return { pages };
}

// src/core/vault/create.ts
import fs8 from "node:fs";
import path12 from "node:path";
var TEMPLATES = /* @__PURE__ */ new Set(["minimal", "preset"]);
function target(dir) {
  if (!path12.isAbsolute(dir)) throw new Error(`\u8981\u7EDD\u5BF9\u8DEF\u5F84\uFF1A${dir}`);
  if (!fs8.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${dir}`);
  return dir;
}
async function initPlan(dir, d) {
  return JSON.parse(await d.run("python3", [d.wikiBin, "init", "--plan", "--json"], target(dir)));
}
async function createVault(dir, template, d) {
  if (!TEMPLATES.has(template)) throw new Error(`\u6CA1\u6709\u8FD9\u4E2A\u6A21\u677F\uFF1A${template}`);
  const cwd = target(dir);
  const report = JSON.parse(await d.run("python3", [d.wikiBin, "init", "--template", template, "--json"], cwd));
  (d.link ?? ensureToolchain)(cwd, d.toolsDir);
  return report;
}

// src/lark/channel.ts
import { Client, createLarkChannel, AppType, LoggerLevel } from "@larksuiteoapi/node-sdk";

// src/lark/post.ts
import { unified as unified2 } from "unified";
import remarkParse2 from "remark-parse";
import remarkGfm2 from "remark-gfm";
var DROP = { drop: true };
var isImg = (p) => "img" in p;
var isWeb = (url) => /^https?:\/\//i.test(url);
var parser = unified2().use(remarkParse2).use(remarkGfm2);
var styleOf = (styles) => styles.length ? [...new Set(styles)] : void 0;
var textElement = (text, styles = []) => {
  const style = styleOf(styles);
  return style ? { tag: "text", text, style } : { tag: "text", text };
};
var inlineText = (node) => {
  if (typeof node?.value === "string") return node.value;
  if (node?.type === "image") return node.alt || node.url || "\u56FE\u7247";
  return Array.isArray(node?.children) ? node.children.map(inlineText).join("") : "";
};
var dropped = false;
var inline = (nodes, keys, styles = []) => {
  const out = [];
  for (const node of nodes ?? []) {
    if (node.type === "text") out.push(textElement(node.value, styles));
    else if (node.type === "strong") out.push(...inline(node.children, keys, [...styles, "bold"]));
    else if (node.type === "emphasis") out.push(...inline(node.children, keys, [...styles, "italic"]));
    else if (node.type === "delete") out.push(...inline(node.children, keys, [...styles, "lineThrough"]));
    else if (node.type === "inlineCode") out.push(textElement(node.value, styles));
    else if (node.type === "link") {
      const text = inlineText(node) || node.url;
      const style = styleOf(styles);
      out.push(style ? { tag: "a", text, href: node.url, style } : { tag: "a", text, href: node.url });
    } else if (node.type === "image") {
      const key = keys?.get(node.url);
      if (key) out.push({ img: key, alt: node.alt || "" });
      else if (isWeb(node.url)) out.push({ tag: "a", text: node.alt || "\u56FE\u7247", href: node.url });
      else {
        out.push(DROP);
        dropped = true;
      }
    } else if (node.type === "break") out.push(textElement("\n", styles));
    else if (typeof node.value === "string") out.push(textElement(node.value.replace(/<[^>]+>/g, ""), styles));
    else if (Array.isArray(node.children)) out.push(...inline(node.children, keys, styles));
  }
  return out;
};
function larkRows(markdown, keys) {
  const root = parser.parse(markdown);
  const rows = [];
  dropped = false;
  const push = (pieces, prefix = "") => {
    const hasImg = pieces.some((p) => p === DROP || isImg(p));
    let run = [];
    let first = true;
    const flush = () => {
      const blank = run.every((e) => !e.text.trim());
      if (!(hasImg && blank)) {
        const pre = first ? prefix : prefix.replace(/[^\s│]/g, " ");
        const row = pre ? [textElement(pre), ...run] : run;
        if (row.length) {
          rows.push(row);
          first = false;
        }
      }
      run = [];
    };
    for (const p of pieces) {
      if (p === DROP) continue;
      if (isImg(p)) {
        flush();
        if (first && /\d+\.|\[[ x]\]/.test(prefix)) rows.push([textElement(prefix.trimEnd())]);
        rows.push(p);
        first = false;
      } else run.push(p);
    }
    flush();
  };
  const blocks = (nodes, prefix = "") => {
    for (const node of nodes ?? []) {
      if (node.type === "paragraph") push(inline(node.children, keys), prefix);
      else if (node.type === "heading") push(inline(node.children, keys, ["bold"]), prefix);
      else if (node.type === "code") {
        for (const line of String(node.value ?? "").split("\n")) push([textElement(line)], prefix);
      } else if (node.type === "thematicBreak") push([textElement("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")], prefix);
      else if (node.type === "blockquote") blocks(node.children, `${prefix}\u2502 `);
      else if (node.type === "list") {
        const start = Number(node.start ?? 1);
        for (let i = 0; i < node.children.length; i++) {
          const item = node.children[i];
          const marker = node.ordered ? `${start + i}. ` : "\u2022 ";
          const checked = item.checked === true ? "[x] " : item.checked === false ? "[ ] " : "";
          let first = true;
          for (const child of item.children ?? []) {
            if (child.type === "list") {
              blocks([child], `${prefix}  `);
              continue;
            }
            if (child.type === "paragraph") {
              push(inline(child.children, keys), first ? `${prefix}${marker}${checked}` : `${prefix}  `);
              first = false;
            } else blocks([child], first ? `${prefix}${marker}${checked}` : `${prefix}  `);
          }
        }
      } else if (node.type === "table") {
        for (let i = 0; i < node.children.length; i++) {
          const cells = [];
          for (let j = 0; j < node.children[i].children.length; j++) {
            if (j) cells.push(textElement("  |  "));
            cells.push(...inline(node.children[i].children[j].children, keys, i === 0 ? ["bold"] : []));
          }
          push(cells, prefix);
        }
      } else if (typeof node.value === "string") push([textElement(node.value)], prefix);
      else if (Array.isArray(node.children)) blocks(node.children, prefix);
    }
  };
  blocks(root.children);
  if (!rows.length && !dropped) rows.push([textElement(markdown)]);
  return rows;
}
function toLarkPost(markdown, keys) {
  const content = larkRows(markdown, keys).map((r) => Array.isArray(r) ? r : [{ tag: "img", image_key: r.img }]);
  return { zh_cn: { title: "", content } };
}
function imageUrls(markdown) {
  const out = /* @__PURE__ */ new Set();
  const walk2 = (n) => {
    if (n?.type === "image" && n.url) out.add(n.url);
    for (const c of n?.children ?? []) walk2(c);
  };
  walk2(parser.parse(markdown));
  return [...out];
}

// src/lark/channel.ts
var LARK_SCOPES = [
  { scope: "im:message:send_as_bot", label: "\u4EE5\u5E94\u7528\u8EAB\u4EFD\u53D1\u6D88\u606F\uFF08\u56DE\u590D\u3001\u8FFD\u95EE\u5361\u7247\uFF09", level: "required" },
  { scope: "im:message.p2p_msg:readonly", label: "\u8BFB\u53D6\u7528\u6237\u53D1\u7ED9\u673A\u5668\u4EBA\u7684\u5355\u804A\u6D88\u606F", level: "required" },
  { scope: "im:resource", label: "\u4E0A\u4F20\u56FE\u7247\uFF08\u7B54\u6848\u91CC\u7684\u56FE\u76F4\u63A5\u663E\u793A\uFF09", level: "required" },
  { scope: "im:message.group_at_msg:readonly", label: "\u63A5\u6536\u7FA4\u804A\u4E2D @ \u673A\u5668\u4EBA\u7684\u6D88\u606F", level: "group" },
  { scope: "im:message.group_msg", label: "\u83B7\u53D6\u7FA4\u7EC4\u4E2D\u6240\u6709\u6D88\u606F\uFF08\u7FA4\u91CC\u65B0\u5F00\u8BDD\u9898\u4E0D @ \u4E5F\u7B54\uFF09", level: "optional" },
  { scope: "im:chat:readonly", label: "\u8BFB\u53D6\u7FA4\u540D\u4E0E\u7FA4\u7C7B\u578B\uFF08\u4F1A\u8BDD\u6807\u9898\u5206\u666E\u901A\u7FA4/\u8BDD\u9898\u7FA4\uFF09", level: "optional" },
  { scope: "contact:contact.base:readonly", label: "\u8BFB\u53D6\u63D0\u95EE\u4EBA\u540D\u5B57\uFF08\u4F1A\u8BDD\u6807\u9898\u3001\u7FA4\u804A\u95EE\u9898\u524D\u7F00\uFF1B\u4EBA\u8981\u5728\u901A\u8BAF\u5F55\u53EF\u89C1\u8303\u56F4\u5185\uFF09", level: "optional" }
];
async function missingScopes(client) {
  const r = await client.request({ method: "GET", url: "/open-apis/application/v6/scopes" });
  if (r?.code !== void 0 && r.code !== 0) throw new Error(`code ${r.code}${r?.msg ? `\uFF1A${r.msg}` : ""}`);
  const list3 = r?.data?.scopes ?? r?.scopes ?? [];
  const granted = new Set(list3.filter((x) => x?.scope_type !== "user" && x?.grant_status === 1).map((x) => String(x.scope_name)));
  return LARK_SCOPES.filter((s) => !granted.has(s.scope));
}
var makeLarkClient = (appId, appSecret) => new Client({ appId, appSecret, appType: AppType.SelfBuild, loggerLevel: LoggerLevel.error });
var BAD_SECRET = /99991663|app_secret|tenant_access_token|app_access_token/i;
function parseBotInfo(r) {
  const bot = r?.bot ?? r?.data?.bot;
  return { openId: bot?.open_id ? String(bot.open_id) : null, name: String(bot?.bot_name ?? bot?.app_name ?? "") };
}
async function verifyApp(appId, appSecret, makeClient = makeLarkClient) {
  if (!appId.trim() || !appSecret.trim()) return { ok: false, detail: "app_id \u548C app_secret \u90FD\u8981\u586B" };
  try {
    const client = makeClient(appId, appSecret);
    const r = await client.request({ method: "GET", url: "/open-apis/bot/v3/info" });
    const { openId, name: name2 } = parseBotInfo(r);
    if (!openId) return { ok: false, detail: "\u5E94\u7528\u672A\u6DFB\u52A0\u300C\u673A\u5668\u4EBA\u300D\u80FD\u529B\u2014\u2014\u53BBLark\u5F00\u653E\u5E73\u53F0 \u2192 \u5E94\u7528\u80FD\u529B \u2192 \u6DFB\u52A0\u673A\u5668\u4EBA" };
    const botName = name2 || "\u673A\u5668\u4EBA";
    let missing;
    try {
      missing = await missingScopes(client) ?? [];
    } catch (e) {
      return { ok: true, botName, scopeError: e instanceof Error ? e.message : String(e) };
    }
    const lacksRequired = missing.some((m) => m.level === "required");
    return {
      ok: !lacksRequired,
      botName,
      ...missing.length ? { missing } : {},
      ...lacksRequired ? { detail: "\u7F3A\u5C11\u5FC5\u9700\u6743\u9650\u2014\u2014\u53BB\u5F00\u653E\u5E73\u53F0 \u2192 \u6743\u9650\u7BA1\u7406\u5F00\u901A\u540E\uFF0C\u521B\u5EFA\u7248\u672C\u5E76\u53D1\u5E03" } : {}
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: BAD_SECRET.test(msg) ? `app_id \u6216 app_secret \u4E0D\u5BF9\uFF1A${msg}` : msg };
  }
}
var LarkChannel = class {
  constructor(cfg) {
    this.cfg = cfg;
  }
  handler = null;
  newHandler = null;
  cardHandler = null;
  inner = null;
  stopped = false;
  botOpenId = null;
  /** 机器人名字（连接后从 /bot/v3/info 取；设置卡卡头显示用，取不到为空） */
  botName = "";
  onMessage(h) {
    this.handler = h;
  }
  onChatNew(h) {
    this.newHandler = h;
  }
  onCardAction(h) {
    this.cardHandler = h;
  }
  async start() {
    const { appId, appSecret } = this.cfg;
    const inner = this.inner = createLarkChannel({
      appId,
      appSecret,
      loggerLevel: LoggerLevel.error,
      includeRawEvent: true,
      policy: { requireMention: false, respondToMentionAll: true }
    });
    inner.on({
      message: (m) => this.dispatch(m),
      cardAction: (e) => this.cardHandler?.({
        messageId: String(e?.messageId ?? ""),
        chatId: String(e?.chatId ?? ""),
        value: e?.action?.value
      }),
      botAdded: (e) => {
        if (e?.chatId) this.newHandler?.({ chatId: String(e.chatId), chatType: "group" });
      },
      error: (e) => this.cfg.warn(`Lark \u901A\u9053\u9519\u8BEF\uFF1A${e instanceof Error ? e.message : String(e)}`)
    });
    await inner.connect();
    if (this.stopped) {
      try {
        await inner.disconnect();
      } catch {
      }
      return;
    }
    const id2 = inner.botIdentity;
    this.botOpenId = id2?.openId ?? null;
    this.botName = id2?.name ?? "";
    if (!this.botOpenId) {
      try {
        const r = await inner.rawClient.request({ method: "GET", url: "/open-apis/bot/v3/info" });
        const { openId, name: name2 } = parseBotInfo(r);
        this.botOpenId = openId;
        if (!this.botName) this.botName = name2;
      } catch (e) {
        this.cfg.warn(`\u53D6\u673A\u5668\u4EBA open_id \u5931\u8D25\uFF08\u7FA4\u804A\u6682\u4E0D\u7B54\uFF09\uFF1A${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (this.stopped) {
      try {
        await inner.disconnect();
      } catch {
      }
      return;
    }
    this.cfg.info("Lark\u957F\u8FDE\u63A5\u5DF2\u5EFA\u7ACB");
  }
  async stop() {
    this.stopped = true;
    try {
      await this.inner?.disconnect();
    } catch {
    }
  }
  // inThread：回进话题（reply_in_thread），否则在群主消息流里引用回复；keys：答案里已上传的图
  async reply(messageId, text, inThread = false, keys) {
    await this.inner.rawClient.im.v1.message.reply({
      path: { message_id: messageId },
      data: { content: JSON.stringify(toLarkPost(text, keys)), msg_type: "post", ...inThread ? { reply_in_thread: true } : {} }
    });
  }
  async replyCard(messageId, card, inThread = false) {
    const r = await this.inner.rawClient.im.v1.message.reply({
      path: { message_id: messageId },
      data: { content: JSON.stringify(card), msg_type: "interactive", ...inThread ? { reply_in_thread: true } : {} }
    });
    if (r?.code !== void 0 && r.code !== 0) throw new Error(`code ${r.code}${r?.msg ? `\uFF1A${r.msg}` : ""}`);
    const id2 = String(r?.data?.message_id ?? "");
    if (!id2) throw new Error("\u56DE\u590D\u5361\u7247\u672A\u8FD4\u56DE message_id");
    return id2;
  }
  // 答案里的图先传成 image_key（需应用权限 im:resource）。SDK 对 code≠0 多是抛 axios 错，
  // 飞书错误码在 response.data 里——统一挂到 err.code，images.ts 据此认缺权限
  async uploadImage(buf) {
    let r;
    try {
      r = await this.inner.rawClient.im.v1.image.create({ data: { image_type: "message", image: buf } });
    } catch (e) {
      const d = e?.response?.data;
      throw Object.assign(new Error(d?.msg ? `code ${d.code}\uFF1A${d.msg}` : e?.message ?? String(e)), { code: d?.code ?? e?.code });
    }
    if (r?.code !== void 0 && r.code !== 0) throw Object.assign(new Error(`code ${r.code}${r?.msg ? `\uFF1A${r.msg}` : ""}`), { code: r.code });
    const key = String(r?.image_key ?? r?.data?.image_key ?? "");
    if (!key) throw new Error("\u4E0A\u4F20\u56FE\u7247\u672A\u8FD4\u56DE image_key");
    return key;
  }
  // threadRoot：话题里的追问卡片回到这条根消息的话题里；不给则发到 chat 主消息流
  async sendCard(chatId, card, threadRoot) {
    const r = await this.inner.send(chatId, { card }, threadRoot ? { replyTo: threadRoot, replyInThread: true } : void 0);
    return { messageId: String(r?.messageId ?? "") };
  }
  async updateCard(messageId, card) {
    await this.inner.updateCard(messageId, card);
  }
  // —— 来源查询（origin.ts 的 lookup 实现；缓存与降级在 origin 解析器里）——
  // 都走 rawClient.request：失败抛出，code≠0 也当失败（没开权限是最常见的 code）
  async api(url, params) {
    const r = await this.inner.rawClient.request({ method: "GET", url, ...params ? { params } : {} });
    if (r?.code !== void 0 && r.code !== 0) throw new Error(`code ${r.code}${r?.msg ? `\uFF1A${r.msg}` : ""}`);
    return r?.data ?? {};
  }
  /** 群名与 chat_mode（p2p / group / topic） */
  async chatInfo(chatId) {
    const d = await this.api(`/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`);
    return { name: String(d?.name ?? ""), mode: String(d?.chat_mode ?? "") };
  }
  /** 通讯录里的名字：应用身份调要 contact:contact.base:readonly（只开 contact:user.base:readonly 报 99991672），
   *  且这个人在应用的通讯录可见范围里。不翻群成员：大群翻不完，名字统一靠通讯录 */
  async userName(openId) {
    const d = await this.api(`/open-apis/contact/v3/users/${encodeURIComponent(openId)}`, { user_id_type: "open_id" });
    return String(d?.user?.name ?? "");
  }
  /** SDK 归一消息 → Incoming。归一已剥掉 @机器人 占位、mentions 带 key/openId；
   *  event_id 不在消息本体里，includeRawEvent 挂在 raw 上（SDK 事件体被摊平，在顶层） */
  dispatch(m) {
    const mentions = Array.isArray(m?.mentions) ? m.mentions : [];
    this.handler?.({
      eventId: String(m?.raw?.event_id ?? m?.raw?.header?.event_id ?? ""),
      chatId: String(m?.chatId ?? ""),
      chatType: m?.chatType === "group" ? "group" : "p2p",
      messageId: String(m?.messageId ?? ""),
      ...m?.senderId ? { senderId: String(m.senderId) } : {},
      messageType: String(m?.rawContentType ?? ""),
      text: String(m?.content ?? ""),
      mentionKeys: mentions.map((x) => String(x?.key ?? "")).filter(Boolean),
      mentionOpenIds: mentions.map((x) => String(x?.openId ?? "")).filter(Boolean),
      // 话题字段只在话题里的消息上带（不在话题里不出这两个键）
      ...m?.threadId ? { threadId: String(m.threadId) } : {},
      ...m?.rootId ? { rootId: String(m.rootId) } : {}
    });
  }
};

// src/host/rpc.ts
var id = (d) => d._id;
function registerRpc(ctx, hub, lark, verify = verifyApp, extra) {
  const act = createActions(() => hub.dir());
  const withPages = (b) => {
    const m = hub.engine.model;
    if (!m) return b;
    return { ...b, chapters: b.chapters.map((c) => ({ ...c, pages: c.pages.map((p) => ({ name: p.name, id: resolveRef(m, p.name) })) })) };
  };
  const editable = (p) => {
    const rel = String(p.path ?? "");
    if (!rel.endsWith(".md")) throw new Error(`\u4E0D\u662F md\uFF1A${rel}`);
    const abs = hub.model().byId.has(rel) ? inside(hub.dir(), rel) : rel.startsWith("raw/document/") ? inside(hub.dir(), rel, "raw/document") : null;
    if (!abs || !fs9.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new Error(`\u4E0D\u80FD\u7F16\u8F91\uFF1A${rel}`);
    return abs;
  };
  const placeOf = (m, x) => {
    const q = x && typeof x === "object" ? x : {};
    if (typeof q.before === "string") return { before: nodeRel(m, q.before) };
    if (typeof q.after === "string") return { after: nodeRel(m, q.after) };
    return q.first === true ? { first: true } : {};
  };
  const bookOf = (name2) => {
    const b = loadBooks(hub.dir()).find((x) => x.name === name2);
    if (!b) throw new Error(`\u4E66\u67B6\u4E0A\u6CA1\u6709 ${name2}`);
    return b;
  };
  const picker = () => {
    const p = ctx.get?.("directoryPicker");
    if (!p) throw new Error("\u672C\u90E8\u7F72\u6CA1\u6709\u76EE\u5F55\u9009\u62E9\u670D\u52A1\uFF0C\u65E0\u6CD5\u9009\u76EE\u5F55");
    return p.capability();
  };
  const zhPickerError = (e, fallback) => {
    const c = e?.code;
    if (c === "directory-unreadable") return `\u76EE\u5F55\u6253\u4E0D\u5F00\uFF1A${e.path ?? ""}`;
    if (c === "directory-exists") return `\u540C\u540D\u76EE\u5F55\u5DF2\u5B58\u5728`;
    return `${fallback}\uFF1A${e instanceof Error ? e.message : String(e)}`;
  };
  const handlers = {
    status: () => ({ ok: !!hub.engine.model, dir: hub.dir(), pages: hub.engine.model?.g.order.length ?? 0, error: hub.engine.error, degraded: hub.engine.degraded, validating: hub.engine.validating, checkOutput: hub.engine.checkOutput }),
    // 点「选择目录」先问后端形态：native 直接开系统选框、选完把路径带回来；browse 让前端弹层逐层浏览
    pickDir: async () => {
      const cap = picker();
      if (cap.kind !== "native") return { kind: "browse" };
      const path13 = await cap.pick(AbortSignal.timeout(6e5));
      return { kind: "native", path: path13 == null ? null : String(path13) };
    },
    // browse：列一层子目录；path 空 = 主目录。清单已按名排序、条目自带绝对路径和面包屑，隐藏目录带标记
    fsDirs: async (p) => {
      const cap = picker();
      if (cap.kind !== "browse") throw new Error("\u672C\u90E8\u7F72\u7684\u76EE\u5F55\u9009\u62E9\u540E\u7AEF\u4E0D\u652F\u6301\u9010\u5C42\u6D4F\u89C8");
      const raw = String(p.path ?? "").trim();
      try {
        return await cap.list(raw || void 0);
      } catch (e) {
        throw new Error(zhPickerError(e, "\u5217\u76EE\u5F55\u5931\u8D25"));
      }
    },
    // browse：在当前目录下建一个子目录（新建文件夹），成功返回新目录的绝对路径
    fsMkdir: async (p) => {
      const cap = picker();
      if (cap.kind !== "browse") throw new Error("\u672C\u90E8\u7F72\u7684\u76EE\u5F55\u9009\u62E9\u540E\u7AEF\u4E0D\u652F\u6301\u5EFA\u76EE\u5F55");
      try {
        return { path: String(await cap.createDirectory(String(p.path ?? ""), String(p.name ?? ""))) };
      } catch (e) {
        throw new Error(zhPickerError(e, "\u5EFA\u76EE\u5F55\u5931\u8D25"));
      }
    },
    // 新建知识库：先看要挪什么（设置页据此决定要不要弹确认），再真建。建在当前已打开的目录上
    // 时 vaultDir 不变、不会触发重开，这里手动重开一次，让校验与模型跟上
    // 修好之后重新校验：vaultDir 没变时配置不触发重开，设置页「打开」同一目录走这里
    reopen: () => {
      hub.reopen();
      return { ok: true };
    },
    initPlan: (p) => initPlan(String(p.dir ?? ""), { run: runWiki, wikiBin: vaultTools("bin", "wiki"), toolsDir: vaultTools() }),
    create: async (p) => {
      const dir = String(p.dir ?? "");
      const r = await createVault(dir, String(p.template ?? ""), { run: runWiki, wikiBin: vaultTools("bin", "wiki"), toolsDir: vaultTools() });
      if (dir === hub.dir()) hub.reopen();
      return r;
    },
    home: () => home(hub.model()),
    // 沉淀两页的全量表（首页看板只取前 7）：草稿页 / 全部页按更新时间
    drafts: () => pageLists(hub.model()).drafts,
    recent: () => pageLists(hub.model()).recent,
    page: (p) => page(hub.model(), String(p.id)),
    tree: () => treeJson(hub.model().g, id),
    graph: () => graphJson(hub.model().g, id),
    tag: (p) => tagPages(hub.model(), String(p.tag)),
    search: (p) => search(hub.model().search, String(p.q ?? "")),
    rawTree: () => rawTree(hub.dir()),
    raw: (p) => readRaw(hub.model(), String(p.path)),
    // 知识探索：书与文档。书名 / 章号只认模型里已有的（白名单）
    books: () => loadBooks(hub.dir()),
    book: (p) => withPages(bookOf(String(p.name))),
    // 章节原文带 md 结构（标题、图、表、代码块）时按文档 md 渲染，相对图片路径随章节文件解析；
    // text/hash 给只读宿主（Task 16），hash 与 DocStore 自校验同口径（mtimeMs:size，对章节 md stat）
    chapter: async (p) => {
      const b = bookOf(String(p.book));
      const c = b.chapters.find((x) => x.id === String(p.id));
      const md3 = c?.text ? chapterMarkdown(hub.dir(), c.text) : null;
      if (c?.text && md3 !== null) {
        const chAbs = inside(hub.dir(), c.text);
        const st = chAbs ? fs9.statSync(chAbs, { throwIfNoEntry: false }) : void 0;
        const { html, toc } = await renderPage({ _id: c.text, _content: md3 }, hub.model());
        return { book: b.name, chapter: c, raw: null, html, toc, readable: true, text: md3, hash: st ? `${st.mtimeMs}:${st.size}` : "" };
      }
      return readChapter(hub.dir(), b, String(p.id));
    },
    documents: () => loadDocuments(hub.model()),
    document: (p) => {
      const x = loadDocuments(hub.model()).find((y) => y.path === String(p.path));
      if (!x) throw new Error(`\u6CA1\u6709\u8FD9\u4EFD\u6587\u6863\uFF1A${p.path}`);
      return x;
    },
    // 写库：这四个走 wiki CLI（src/actions.ts 校验参数），外加下面编辑正文的 save / touchUpdated
    readChapter: (p) => act.readChapter(p),
    convertBook: (p) => act.convertBook(p),
    cover: (p) => act.cover(p),
    deposit: (p) => act.deposit(p),
    // 知识沉淀页「标记完成」：只收模型里现存的 draft 页，其余一律拒绝（白名单之外不放行）
    mark: (p) => {
      const rel = String(p.path);
      const d = hub.model().byId.get(rel);
      if (!d) throw new Error(`\u5E93\u91CC\u6CA1\u6709\u8FD9\u9875\uFF1A${rel}`);
      if (d.status !== "draft") throw new Error(`${rel} \u4E0D\u662F\u8349\u7A3F`);
      return act.mark({ path: rel });
    },
    // 目录拖动：节点 / 文件夹 / 兄弟都过白名单（沉淀五区之内、区根不算节点）；位置只认一个
    moveImpact: (p) => moveImpact(hub.model(), nodeRel(hub.model(), String(p.node ?? ""))),
    reorder: (p) => {
      const m = hub.model();
      return act.reorder({ node: nodeRel(m, String(p.node ?? "")), place: placeOf(m, p.place) });
    },
    move: (p) => {
      const m = hub.model();
      return act.move({ node: nodeRel(m, String(p.node ?? "")), folder: folderRel(m, String(p.folder ?? "")), place: placeOf(m, p.place) });
    },
    // 编辑正文：可编辑白名单只留给 save/touchUpdated；source 放开为「模型内 md 或 raw/ 下 md」
    // 任意可读（RawView/章节等只读宿主也要 load 源文）
    source: (p) => {
      const rel = String(p.path ?? "");
      const abs = hub.model().byId.has(rel) ? inside(hub.dir(), rel) : rel.startsWith("raw/") ? inside(hub.dir(), rel, "raw") : null;
      if (!abs || !fs9.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new Error(`\u8BFB\u4E0D\u5230\uFF1A${rel}`);
      return act.source(abs);
    },
    save: (p) => act.save(editable(p), String(p.text ?? ""), String(p.baseHash ?? "")),
    touchUpdated: (p) => {
      const abs = editable(p);
      if (!hub.model().byId.has(String(p.path))) throw new Error("\u6587\u4EF6\u6CA1\u6709 updated");
      return act.touchUpdated(abs);
    },
    // excalidraw 场景保存（覆盖层画布）：白名单钉死 asset/diagrams/ 下的 .excalidraw，
    // 场景轻校验（type + elements 数组）。后写覆盖、不设冲突协议（个人库单人画、全屏覆盖层互斥）；
    // 纯附件写——不动 md、不刷 updated、不进台账。成功后广播资产变更让别的视图换新图
    saveExcalidraw: (p) => {
      const rel = String(p.path ?? "");
      if (!/^asset\/diagrams\/[^/\n][^\n]*\.excalidraw$/.test(rel)) throw new Error(`\u4E0D\u662F\u573A\u666F\u8DEF\u5F84\uFF1A${rel}`);
      const abs = inside(hub.dir(), rel, "asset");
      if (!abs) throw new Error(`\u4E0D\u80FD\u5199\uFF1A${rel}`);
      const scene = p.scene;
      if (!scene || typeof scene !== "object" || Array.isArray(scene) || scene.type !== "excalidraw" || !Array.isArray(scene.elements))
        throw new Error('\u573A\u666F\u5185\u5BB9\u4E0D\u5408\u6CD5\uFF08\u8981 {type:"excalidraw", elements:[\u2026]}\uFF09');
      writeAtomic(abs, JSON.stringify(scene));
      hub.assetChanged(rel);
      return { ok: true };
    },
    // 编辑器批量双链态（死链着色）：按全站规则解析（路径精确 / 裸名唯一），与链接所在页无关
    resolveNames: (p) => resolveNameStates(hub.model(), Array.isArray(p.names) ? p.names.map(String) : []),
    // 编辑器里非文本块（代码、表格、公式、嵌入）与行内公式的批量渲染；宿主 blockHtml 内存缓存，
    // 命中零渲染。同窗去重在 BatchStore（客户端）已做一层，这里再按 src 去重一次；顺序对应返回。
    renderBlocks: async (p) => {
      const path13 = String(p.path ?? "");
      const srcs = Array.isArray(p.srcs) ? p.srcs.map(String) : [];
      const m = hub.model();
      let cache = m.blockHtml.get(path13);
      if (!cache) {
        cache = new BlockHtmlCache();
        m.blockHtml.set(path13, cache);
      }
      const bySrc = /* @__PURE__ */ new Map();
      const c = cache;
      for (const src of new Set(srcs)) {
        let p2 = c.get(src);
        if (!p2) {
          p2 = renderPage({ _id: path13, _content: src }, m).then((r) => r.html).catch((err) => {
            ctx.logger.warn("renderBlocks \u5931\u8D25 %s\uFF1A%s", path13, err?.stack ?? err);
            c.delete(src);
            return "";
          });
          c.set(src, p2);
        }
        bySrc.set(src, p2);
      }
      return { htmls: await Promise.all(srcs.map((x) => bySrc.get(x))) };
    },
    // 编辑器里点击双链：按全站规则解析（路径精确 / 裸名唯一）
    resolve: (p) => ({ id: resolveRef(hub.model(), String(p.name)) }),
    // Lark问答通道的只读视图（status 不含 app_secret）＋ 草稿凭证验证（secret 只进请求不进结果）
    ...lark ? {
      larkStatus: () => lark.status(),
      larkVerify: (p) => verify(String(p?.appId ?? ""), String(p?.appSecret ?? "")),
      // 检测通过后补连：只按 app_id 找已存配置（凭证取存档），不收草稿 secret
      larkReconnect: (p) => lark.reconnect(String(p?.appId ?? ""))
    } : {},
    ...extra ?? {}
  };
  ctx.connection.fetch.register({
    path: "/api/wiki.rpc",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (req) => {
      let body;
      try {
        body = await req.json();
      } catch {
        return Response.json({ ok: false, error: { code: "bad-request", message: "\u8BF7\u6C42\u4F53\u4E0D\u662F JSON" } }, { status: 400 });
      }
      const h = handlers[String(body.method)];
      if (!h) return Response.json({ ok: false, error: { code: "not-found", message: `\u672A\u77E5\u65B9\u6CD5 ${body.method}` } }, { status: 404 });
      try {
        return Response.json({ ok: true, value: await h(body.payload ?? {}) ?? null });
      } catch (e) {
        return Response.json({ ok: false, error: { code: "wiki", message: e instanceof Error ? e.message : String(e) } });
      }
    }
  });
}

// src/host/routes.ts
import { createReadStream, readFileSync, statSync as statSync4 } from "node:fs";
import { Readable } from "node:stream";
import { extname } from "node:path";

// src/host/ws.ts
import { WebSocketServer } from "ws";
var OPEN = 1;
function registerWsEvents(ctx, path13, label, onClient, makeServer = () => new WebSocketServer({ noServer: true })) {
  ;
  ctx.inject(["webServer"], (wc) => {
    const wss = makeServer();
    const clients = /* @__PURE__ */ new Set();
    wc.effect(() => () => {
      for (const { ws } of [...clients]) {
        try {
          ws.terminate();
        } catch {
        }
      }
      clients.clear();
      try {
        wss.close();
      } catch {
      }
    }, `${label}.close`);
    wc.effect(() => wc.webServer.registerUpgrade({
      path: path13,
      handler: (req, socket, head) => {
        const admission = wc.connection.admit(req);
        if ("rejection" in admission) {
          const status = admission.rejection;
          const reason = status === 401 ? "Unauthorized" : "Forbidden";
          const body = reason.toLowerCase();
          socket.end([
            `HTTP/1.1 ${status} ${reason}`,
            "Connection: close",
            "Content-Type: text/plain; charset=utf-8",
            `Content-Length: ${Buffer.byteLength(body)}`,
            "",
            body
          ].join("\r\n"));
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.on("error", () => {
            try {
              ws.terminate();
            } catch {
            }
          });
          const send2 = (data) => {
            if (ws.readyState !== OPEN) return;
            try {
              ws.send(data);
            } catch {
            }
          };
          const client = { ws, off: onClient(send2) };
          clients.add(client);
          ws.on("close", () => {
            clients.delete(client);
            try {
              client.off();
            } catch (e) {
              console.error(`[${label}] \u9000\u8BA2\u51FA\u9519`, e);
            }
          });
        });
      }
    }), label);
  });
}

// src/host/routes.ts
var TYPES = {
  ".pdf": "application/pdf",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".md": "text/plain; charset=utf-8",
  ".excalidraw": "application/json; charset=utf-8"
};
var HEIGHT_REPORTER = '<script>(function(){var d=document.documentElement,last=0;function r(){var h=Math.ceil(d.scrollHeight);if(h!==last){last=h;parent.postMessage({dshWikiEmbedHeight:h},"*")}}addEventListener("load",r);if(window.ResizeObserver)new ResizeObserver(r).observe(d);r()})()</script>';
var THEME_STYLE = '<style>html[data-dsh-theme="dark"]{color-scheme:dark}html[data-dsh-theme="light"]{color-scheme:light}@media (prefers-color-scheme: dark){html:not([data-dsh-theme]){color-scheme:dark}}</style>';
var THEME_LISTENER = '<script>(function(){addEventListener("message",function(e){var t=e&&e.data&&e.data.dshWikiTheme;if(t==="dark"||t==="light")document.documentElement.setAttribute("data-dsh-theme",t)})})()</script>';
function injectEmbedScripts(html, theme) {
  let out = html;
  if (theme === "dark" || theme === "light") {
    out = out.replace(/<html\b([^>]*)>/i, (_m, attrs) => `<html${attrs.replace(/\s+data-dsh-theme\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/i, "")} data-dsh-theme="${theme}">`);
  }
  const head = /<head\b[^>]*>/i.exec(out);
  out = head ? out.slice(0, head.index + head[0].length) + THEME_STYLE + out.slice(head.index + head[0].length) : THEME_STYLE + out;
  const i = out.toLowerCase().lastIndexOf("</body>");
  const tail = HEIGHT_REPORTER + THEME_LISTENER;
  return i < 0 ? out + tail : out.slice(0, i) + tail + out.slice(i);
}
function registerRoutes(ctx, hub, makeServer) {
  const fetch = ctx.connection.fetch;
  fetch.register({
    path: "/api/wiki.asset",
    methods: ["GET", "HEAD"],
    requestBody: "buffered",
    fetch: async (req) => {
      const q = new URL(req.url).searchParams;
      const rel = q.get("path") ?? "";
      const abs = rel.startsWith("raw/") ? inside(hub.dir(), rel, "raw") : inside(hub.dir(), rel, "asset");
      if (!abs) return new Response("forbidden", { status: 403 });
      let size;
      try {
        size = statSync4(abs).size;
      } catch {
        return new Response("not found", { status: 404 });
      }
      const ext = extname(abs).toLowerCase();
      const headers = {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Content-Length": String(size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      };
      if ([".html", ".htm", ".svg"].includes(ext)) headers["Content-Security-Policy"] = rel.startsWith("asset/") ? "sandbox allow-scripts" : "sandbox";
      if (req.method === "HEAD") return new Response(null, { headers });
      if (rel.startsWith("asset/") && (ext === ".html" || ext === ".htm")) {
        const body = injectEmbedScripts(readFileSync(abs, "utf8"), q.get("theme"));
        headers["Content-Length"] = String(Buffer.byteLength(body));
        return new Response(body, { headers });
      }
      return new Response(Readable.toWeb(createReadStream(abs)), { headers });
    }
  });
  registerWsEvents(ctx, "/api/wiki.events", "dsh-knowledge-brain.events", (send2) => {
    send2("ready");
    return hub.onChanged((ev) => {
      if (ev.kind !== "tools") send2(JSON.stringify(ev));
    });
  }, makeServer);
}

// src/host/exfonts.ts
import { createReadStream as createReadStream2, statSync as statSync5 } from "node:fs";
import { Readable as Readable2 } from "node:stream";
import { join as join3 } from "node:path";
var FONT = /^fonts\/[A-Za-z]+\/[A-Za-z0-9._-]+\.woff2$/;
var IIFE = /^excalidraw\.iife\.(js|css)$/;
function exfontResponse(root, urlPath) {
  const rel = urlPath.replace(/^\/+/, "");
  const isFont = FONT.test(rel);
  if (!isFont && !IIFE.test(rel)) return null;
  const abs = join3(root, "assets/excalidraw", rel);
  let size;
  try {
    size = statSync5(abs).size;
  } catch {
    return null;
  }
  return {
    body: Readable2.toWeb(createReadStream2(abs)),
    headers: {
      "Content-Type": isFont ? "font/woff2" : rel.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8",
      "Content-Length": String(size),
      // 字体名带内容哈希、版本升级才换名——永久缓存；iife 件同名随包升级换内容，只缓存一天
      "Cache-Control": isFont ? "private, max-age=31536000, immutable" : "private, max-age=86400"
    }
  };
}
function exfontRelOf(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  return decoded.replace(/^\/api\/wiki\.exfonts\/?/, "");
}
function registerExfontsRoute(ctx) {
  ;
  ctx.inject(["webServer"], (wc) => {
    wc.effect(() => wc.webServer.register({
      kind: "prefix",
      path: "/api/wiki.exfonts",
      handler: (req, res) => {
        const admission = wc.connection.admit(req);
        if ("rejection" in admission) {
          res.writeHead(admission.rejection, admission.rejection === 401 ? "unauthorized" : "forbidden");
          res.end(admission.rejection === 401 ? "unauthorized" : "forbidden");
          return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405);
          res.end();
          return;
        }
        const rel = exfontRelOf(new URL(req.url ?? "/", "http://dsh.invalid").pathname);
        const r = rel === null ? null : exfontResponse(pkgRoot(), rel);
        if (!r) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, r.headers);
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        Readable2.fromWeb(r.body).on("error", (e) => {
          console.error("[dsh-knowledge-brain] \u5B57\u4F53\u8D44\u4EA7\u6D41\u51FA\u9519", e);
          res.destroy();
        }).pipe(res);
      }
    }), "dsh-knowledge-brain.exfonts");
  });
}

// src/host/tools.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/host/wiki-ops.ts
var unmark = (html) => plainText(String(html).replace(/<\/?mark>/g, ""));
function trimTree(nodes, depth) {
  return nodes.map((n) => ({
    name: n.name,
    id: n.path,
    desc: n.desc,
    count: n.count,
    ...n.children?.length ? depth > 1 ? { children: trimTree(n.children, depth - 1) } : { more: n.children.length } : {}
  }));
}
function scopeFilter(folder) {
  const f = normFolder(folder);
  if (f === "/") return () => true;
  if (f === null) return () => false;
  const pre = f + "/";
  return (id2) => id2.startsWith(pre);
}
function folderHasPages(m, folder) {
  const keep = scopeFilter(folder);
  for (const id2 of m.byId.keys()) if (keep(id2)) return true;
  return false;
}
function createWikiOps(getModel, scope) {
  const f = scope === void 0 ? void 0 : normFolder(scope);
  const folder = f === void 0 || isVaultRoot(f ?? "") ? void 0 : f ?? "";
  const keep = folder === void 0 ? void 0 : scopeFilter(folder);
  const model = () => {
    const m = getModel();
    if (folder !== void 0 && !folderHasPages(m, folder)) throw new Error(`\u6587\u4EF6\u5939\u4E0D\u5B58\u5728\u6216\u6CA1\u6709\u9875\uFF1A${folder}`);
    return m;
  };
  const inScope = (d) => !!d && (!keep || keep(d._id));
  const scopedCrumb = (m, id2) => {
    const node = m.g.nodeOf.get(id2);
    if (!node) return null;
    const names = [];
    for (let p = node.dir && node.rel === folder ? null : node.parent; p && p.parent; p = p.parent) {
      names.unshift(displayName(p));
      if (p.dir && p.rel === folder) break;
    }
    return names.join(" \u203A ");
  };
  const sref = (m, r) => {
    if (!keep) return r;
    const crumb = scopedCrumb(m, r.id);
    return crumb === null ? r : { ...r, crumb };
  };
  const scand = (m, cs) => cs.map((c) => sref(m, c));
  return {
    model,
    search(query, limit = 10) {
      const m = model();
      return search(m.search, query, limit, keep).map((h) => sref(m, { id: h.id, name: h.name, crumb: h.crumb, snippet: unmark(h.snippet) }));
    },
    readPage(id2, offset = 0) {
      const m = model();
      const r = resolvePage(m, id2, keep);
      if (!("doc" in r)) return { found: false, candidates: scand(m, r.candidates) };
      const p = pageForLlm(m, r.doc, offset);
      if (!keep) return p;
      return {
        ...sref(m, p),
        prev: p.prev && keep(p.prev.id) ? sref(m, p.prev) : null,
        next: p.next && keep(p.next.id) ? sref(m, p.next) : null,
        backlinks: scand(m, p.backlinks.filter((b) => keep(b.id)))
      };
    },
    backlinks(id2) {
      const m = model();
      const r = resolvePage(m, id2, keep);
      if (!("doc" in r)) return { found: false, candidates: scand(m, r.candidates) };
      return (m.g.backlinks.get(r.doc._id) || []).filter((b) => inScope(b.doc)).map((b) => sref(m, { ...refOf(m, b.doc), context: unmark(b.snippet) }));
    },
    tree(path13, depth = 2) {
      const root = treeJson(model().g, (d) => d._id).children;
      const find = (ns, hit) => {
        for (const n of ns) {
          if (hit(n)) return n;
          const f2 = n.children && find(n.children, hit);
          if (f2) return f2;
        }
      };
      const base = folder === void 0 ? root : find(root, (n) => n.dir && n.rel === folder)?.children;
      if (!base) throw new Error(`\u6587\u4EF6\u5939\u4E0D\u5B58\u5728\u6216\u6CA1\u6709\u9875\uFF1A${folder}`);
      const start = path13 ? find(base, (n) => n.path === path13)?.children : base;
      if (!start) throw new Error(`\u6CA1\u6709\u8FD9\u4E2A\u6587\u4EF6\u5939\u9875\uFF1A${path13}`);
      return trimTree(start, depth);
    },
    tags(tag) {
      const m = model();
      return tag ? tagPages(m, tag, keep).map((t) => sref(m, { ...t.ref, desc: t.desc })) : tags(m, keep);
    }
  };
}

// src/host/tools.ts
var output = { schema: { type: "json" }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v, null, 2) }] };
function registerTools(ctx, hub) {
  const tools = ctx.tools;
  const reg = (d) => ctx.effect(() => tools.register(defineTool({ ...d, output, isConcurrencySafe: () => true })), `dsh-knowledge-brain.tool.${d.name}`);
  const ops = createWikiOps(() => hub.model());
  reg({
    name: "wiki_search",
    description: "\u5728\u683C\u7269\u81F4\u77E5 wiki \u91CC\u5168\u6587\u641C\u7D22\uFF08\u4E2D\u6587\u5206\u8BCD\uFF09\u3002\u8FD4\u56DE\u9875 id\u3001\u9875\u540D\u3001\u9762\u5305\u5C51\u4E0E\u547D\u4E2D\u6458\u8981\u3002\u8BFB\u6B63\u6587\u7528 wiki_read_page\u3002",
    parameters: { query: { type: "string", required: true, description: "\u68C0\u7D22\u8BCD" }, limit: { type: "number", description: "\u6700\u591A\u6761\u6570\uFF0C\u9ED8\u8BA4 10" } },
    async execute(a) {
      return ops.search(a.query, a.limit ?? 10);
    }
  });
  reg({
    name: "wiki_read_page",
    description: "\u8BFB wiki \u6C89\u6DC0\u9875\uFF1Afrontmatter \u5143\u6570\u636E + markdown \u6B63\u6587 + \u524D\u540E\u9875 + \u53CD\u94FE\u3002id \u53EF\u4EE5\u662F\u5E93\u5185\u8DEF\u5F84\uFF08\u5982 \u77E5\u8BC6/\u673A\u5668\u5B66\u4E60/\u6A21\u578B\u65CF/\u6A21\u578B\u65CF.md\uFF09\u6216\u9875\u540D\uFF1B\u9875\u540D\u6709\u6B67\u4E49\u6216\u627E\u4E0D\u5230\u65F6\u8FD4\u56DE\u5019\u9009\u3002\u6B63\u6587\u8D85\u957F\u4F1A\u622A\u65AD\uFF0C\u6309\u8FD4\u56DE\u7684 next_offset \u7EED\u8BFB\u3002",
    parameters: { id: { type: "string", required: true, description: "\u5E93\u5185\u8DEF\u5F84\u6216\u9875\u540D" }, offset: { type: "number", description: "\u6B63\u6587\u8D77\u59CB\u5B57\u7B26\u4F4D\u7F6E\uFF0C\u9ED8\u8BA4 0" } },
    async execute(a) {
      return ops.readPage(a.id, a.offset ?? 0);
    }
  });
  reg({
    name: "wiki_backlinks",
    description: "\u5217\u51FA\u5F15\u7528\u4E86\u67D0\u9875\u7684\u5176\u4ED6\u9875\u53CA\u5F15\u7528\u5904\u4E0A\u4E0B\u6587\u3002",
    parameters: { id: { type: "string", required: true, description: "\u5E93\u5185\u8DEF\u5F84\u6216\u9875\u540D" } },
    async execute(a) {
      return ops.backlinks(a.id);
    }
  });
  reg({
    name: "wiki_tree",
    description: "\u770B wiki \u7684\u76EE\u5F55\u6811\uFF08\u533A \u2192 \u6587\u4EF6\u5939 \u2192 \u9875\uFF09\uFF0C\u542B\u6BCF\u9879\u63CF\u8FF0\u4E0E\u9875\u6570\u3002path \u7ED9\u67D0\u4E2A\u6587\u4EF6\u5939\u9875 id \u53EA\u770B\u5B83\u4E0B\u9762\uFF1Bdepth \u9ED8\u8BA4 2\u3002",
    parameters: { path: { type: "string", description: "\u6587\u4EF6\u5939\u9875 id\uFF0C\u7701\u7565\u4E3A\u6839" }, depth: { type: "number", description: "\u5C55\u5F00\u5C42\u6570\uFF0C\u9ED8\u8BA4 2" } },
    async execute(a) {
      return ops.tree(a.path, a.depth ?? 2);
    }
  });
  reg({
    name: "wiki_tags",
    description: "\u4E0D\u7ED9 tag\uFF1A\u5217\u51FA\u5168\u90E8\u6807\u7B7E\u4E0E\u9875\u6570\uFF1B\u7ED9 tag\uFF1A\u5217\u51FA\u8BE5\u6807\u7B7E\u4E0B\u7684\u9875\u3002",
    parameters: { tag: { type: "string", description: "\u6807\u7B7E\u540D" } },
    async execute(a) {
      return ops.tags(a.tag);
    }
  });
  reg({
    name: "wiki_raw",
    description: "\u8BFB raw/ \u4E0B\u7684\u6587\u6863\u6216\u542C\u5F55\u3002md \u8FD4\u56DE\u6B63\u6587\uFF08\u8D85\u957F\u622A\u65AD\uFF0C\u6309 next_offset \u7EED\u8BFB\uFF09\uFF1Bpdf / html / \u5176\u4ED6\u53EA\u8FD4\u56DE\u5143\u4FE1\u606F\u3002",
    parameters: { path: { type: "string", required: true, description: "\u5E93\u5185\u8DEF\u5F84\uFF0C\u4EE5 raw/ \u5F00\u5934" }, offset: { type: "number", description: "\u6B63\u6587\u8D77\u59CB\u5B57\u7B26\u4F4D\u7F6E" } },
    async execute(a) {
      const m = hub.model();
      const r = await readRaw(m, a.path);
      if (!r.ok) throw new Error(`\u8BFB\u4E0D\u5230\u6587\u4EF6 ${a.path}\uFF08\u53EA\u8BB8 raw/ \u4E0B\u7684\u5DF2\u6709\u6587\u4EF6\uFF09`);
      const { html: _h, toc: _t, url: _u, ...meta } = r.raw;
      if (r.raw.kind !== "md" || r.raw.offline) return meta;
      const c = clip(rootImages(a.path, parseFrontmatter(readFileSync2(inside(m.dir, a.path, "raw"), "utf8")).body), a.offset ?? 0);
      return { ...meta, body: c.text, next_offset: c.next };
    }
  });
}

// src/host/skills.ts
import { existsSync as existsSync3 } from "node:fs";
import * as SkillFilesystem from "@deepseek-ai/dsh-skill-filesystem";
function mountSkills(ctx, hub) {
  ctx.inject(["skills"], (c) => {
    let fiber = null;
    let mounted = "";
    const sync = async () => {
      const dir = hub.engine.model ? vaultTools("skills") : "";
      const want = dir && existsSync3(dir) ? dir : "";
      if (want === mounted) return;
      mounted = want;
      if (fiber) {
        const f = fiber;
        fiber = null;
        await f.dispose();
      }
      if (want) fiber = c.plugin(SkillFilesystem, { providerName: "wiki", includeDefaultRoots: false, customSkillDirs: [want] });
    };
    let chain = Promise.resolve();
    const queue = () => {
      chain = chain.then(sync).catch((e) => console.error("[dsh-knowledge-brain] skill \u540C\u6B65\u5931\u8D25", e));
    };
    queue();
    c.effect(() => hub.onChanged((ev) => {
      if (ev.kind === "tools" || ev.kind === "structural") queue();
    }), "dsh-knowledge-brain.skills");
    c.effect(() => () => {
      Promise.resolve(fiber?.dispose()).catch(() => {
      });
    }, "dsh-knowledge-brain.skills.dispose");
  });
}

// src/host/reference.ts
import { createUserMessage } from "@deepseek-ai/dsh-llm";
var RE = /@\[([^\]]*)\]\(dsh-knowledge-(?:brain|vault):([^)\s]+)\)/g;
var NAME = "dsh-knowledge-brain-reference";
var TOTAL_CHARS = 3 * MAX_CHARS;
var attr = (v) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
var decode = (v) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};
function expand(hub, message) {
  if (message?.source?.kind !== "user" || !hub.engine.model) return [message];
  const ids = /* @__PURE__ */ new Set();
  for (const b of message.content ?? []) if (b.type === "text") for (const m2 of String(b.text).matchAll(RE)) ids.add(decode(m2[2]));
  if (!ids.size) return [message];
  const m = hub.model();
  let budget = TOTAL_CHARS;
  const parts = [...ids].map((id2) => {
    const r = resolvePage(m, id2);
    if (!("doc" in r)) return `<wiki-page id="${attr(id2)}">\u627E\u4E0D\u5230\u8FD9\u4E00\u9875</wiki-page>`;
    const p = pageForLlm(m, r.doc);
    const head = `<wiki-page id="${attr(p.id)}" title="${attr(String(p.title ?? ""))}">`;
    if (p.body.length > budget) return `${head}
\uFF08\u672C\u6761\u6D88\u606F\u5F15\u7528\u7684\u9875\u592A\u591A\uFF0C\u8FD9\u9875\u6B63\u6587\u6CA1\u9644\u4E0A\uFF1B\u7528 wiki_read_page \u8BFB ${p.id}\uFF09
</wiki-page>`;
    budget -= p.body.length;
    return `${head}
${p.body}
</wiki-page>`;
  });
  const text = `\u7528\u6237\u5728\u6D88\u606F\u91CC\u5F15\u7528\u4E86\u4EE5\u4E0B wiki \u9875\uFF08\u6B63\u6587\u9644\u540E\uFF1B\u622A\u65AD\u5904\u53EF\u7528 wiki_read_page \u7684 offset \u7EED\u8BFB\uFF09\uFF1A

${parts.join("\n\n")}`;
  return [message, createUserMessage({ content: [{ type: "text", text }], source: { kind: NAME, form: "snapshot", sections: [{ name: NAME, text }] } })];
}
function registerReference(ctx, hub) {
  ctx.on("agent/pre-step", async (_e, next) => {
    const d = await next();
    if (d.kind === "reject") return d;
    return { ...d, messages: d.messages.flatMap((msg) => expand(hub, msg)) };
  }, { prepend: true });
}

// src/lark/mount.ts
import { mkdir, stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join as join4 } from "node:path";
import { createHash as createHash2 } from "node:crypto";
import { createUserMessage as createUserMessage2 } from "@deepseek-ai/dsh-llm";

// src/core/vault-phase.ts
function vaultPhase(h) {
  if (!h.dir()) return "none";
  if (h.engine.validating) return "validating";
  if (h.engine.model) return "ok";
  return "failed";
}

// src/lark/route.ts
var isTopicStart = (msg) => msg.chatType === "group" && !!msg.threadId && !msg.rootId;
var topicRootOf = (msg) => msg.threadId ? msg.rootId || msg.messageId : "";
var TOPIC_SEP = "#";
var conversationKey = (msg) => {
  const root = topicRootOf(msg);
  return root ? `${msg.chatId}${TOPIC_SEP}${root}` : msg.chatId;
};
var parseConversationKey = (key) => {
  const i = key.indexOf(TOPIC_SEP);
  return i < 0 ? { chatId: key, root: "" } : { chatId: key.slice(0, i), root: key.slice(i + 1) };
};
function route(chatId, bindings) {
  return bindings.find((b) => b.chatId && b.chatId === chatId) ?? bindings.find((b) => !b.chatId);
}
function questionOf(msg, botOpenId) {
  if (msg.messageType !== "text") return null;
  if (msg.chatType === "group" && !isTopicStart(msg)) {
    if (!botOpenId || !msg.mentionOpenIds.includes(botOpenId)) return null;
  }
  let q = msg.text;
  for (const k of msg.mentionKeys) q = q.split(k).join("");
  q = q.replace(/\s+/g, " ").trim();
  return q || null;
}
var ChatLocks = class {
  busy = /* @__PURE__ */ new Set();
  try(chatId) {
    if (this.busy.has(chatId)) return false;
    this.busy.add(chatId);
    return true;
  }
  release(chatId) {
    this.busy.delete(chatId);
  }
};

// src/lark/state.ts
var SeenEvents = class {
  constructor(cap = 200) {
    this.cap = cap;
  }
  ids = [];
  set = /* @__PURE__ */ new Set();
  dup(eventId) {
    if (!eventId) return false;
    if (this.set.has(eventId)) return true;
    this.set.add(eventId);
    this.ids.push(eventId);
    if (this.ids.length > this.cap) this.set.delete(this.ids.shift());
    return false;
  }
};

// src/lark/persona.ts
var DEFAULT_BOT_NAME = "\u77E5\u8BC6\u95EE\u7B54Agent";
function scopeOf(folder) {
  if (isVaultRoot(folder)) return "";
  const parts = folder.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? folder;
}
function PERSONA(folder, botName) {
  const name2 = botName?.trim() || DEFAULT_BOT_NAME;
  const scope = scopeOf(folder);
  const all = isVaultRoot(folder);
  const intro = all ? "\u8D1F\u8D23\u89E3\u7B54\u8FD9\u8FB9\u7684\u4E1A\u52A1\u95EE\u9898\u3002\u6211\u4E0D\u662F\u4E2A\u4EBA\u52A9\u7406\uFF1A\u5929\u6C14\u3001\u65E5\u7A0B\u3001\u95F2\u804A\u3001\u804C\u8D23\u5916\u7684\u4E8B\u4E0D\u5F52\u6211\u3002\u6709\u4EBA\u8DDF\u6211\u804A\u8FD9\u4E9B\uFF0C\u7B80\u77ED\u8BF4\u4E00\u53E5\u6211\u8D1F\u8D23\u7684\u662F\u8FD9\u8FB9\u7684\u4E1A\u52A1\u95EE\u9898\uFF0C\u6709\u8FD9\u65B9\u9762\u7684\u95EE\u9898\u968F\u65F6\u95EE\u6211\u3002" : `\u8D1F\u8D23\u89E3\u7B54\u300C${scope}\u300D\u8FD9\u5757\u7684\u95EE\u9898\u3002\u6211\u4E0D\u662F\u4E2A\u4EBA\u52A9\u7406\uFF1A\u5929\u6C14\u3001\u65E5\u7A0B\u3001\u95F2\u804A\u3001\u804C\u8D23\u5916\u7684\u4E8B\u4E0D\u5F52\u6211\u3002\u6709\u4EBA\u8DDF\u6211\u804A\u8FD9\u4E9B\uFF0C\u7B80\u77ED\u8BF4\u4E00\u53E5\u6211\u8D1F\u8D23\u7684\u662F\u300C${scope}\u300D\uFF0C\u6709\u8FD9\u5757\u7684\u95EE\u9898\u968F\u65F6\u95EE\u6211\u3002`;
  const step1 = all ? "1. **\u5148\u67E5\u518D\u7B54\u3002** \u6BCF\u4E2A\u95EE\u9898\u90FD\u5148\u52A0\u8F7D `wiki-read` \u6280\u80FD\uFF0C\u7167\u5B83\u5728\u672C\u4F1A\u8BDD\u91CC\u67E5\uFF1A\u7528 wiki_search \u68C0\u7D22\u3001\u7528 wiki_read_page \u8BFB\u9875\u9762\u3002" : `1. **\u5148\u67E5\u518D\u7B54\u3002** \u6BCF\u4E2A\u95EE\u9898\u90FD\u5148\u52A0\u8F7D \`wiki-read\` \u6280\u80FD\uFF0C\u7167\u5B83\u5728\u672C\u4F1A\u8BDD\u91CC\u67E5\uFF1A\u7528 wiki_search \u68C0\u7D22\u3001\u7528 wiki_read_page \u8BFB\u9875\u9762\uFF1B\u68C0\u7D22\u8BCD\u53EF\u4EE5\u5E26\u4E0A\u300C${folder}\u300D\u7F29\u5C0F\u8303\u56F4\u3002`;
  const step2 = all ? "2. **\u53EA\u4F9D\u636E\u77E5\u8BC6\u5E93\u91CC\u7684\u9875\u9762\u3002** \u5916\u90E8\u77E5\u8BC6\u3001\u5E38\u8BC6\u63A8\u65AD\uFF0C\u4E00\u5F8B\u4E0D\u62FF\u6765\u7B54\u3002" : `2. **\u53EA\u4F9D\u636E\u300C${folder}\u300D\u6587\u4EF6\u5939\u91CC\u7684\u9875\u9762\u3002** \u5DE5\u5177\u80FD\u8BFB\u6574\u5E93\uFF0C\u4F46\u8FD9\u4E2A\u6587\u4EF6\u5939\u4EE5\u5916\u7684\u9875\u3001\u5916\u90E8\u77E5\u8BC6\u3001\u5E38\u8BC6\u63A8\u65AD\uFF0C\u4E00\u5F8B\u4E0D\u62FF\u6765\u7B54\u3002`;
  const canAnswer = all ? "\u8FD9\u8FB9\u7684\u4E1A\u52A1\u95EE\u9898" : `${scope}\u8FD9\u5757`;
  return `# \u6211\u662F\u8C01

\u6211\u662F\u300C${name2}\u300D\uFF0C${intro}

# \u6027\u683C

\u6C89\u7A33\u3001\u5185\u655B\u3001\u4E13\u6CE8\u3002\u6211\u662F\u4E00\u4E2A\u5185\u5411\u7684\u771F\u4EBA\u540C\u4E8B\uFF0C\u4E0D\u662F\u5BA2\u670D\u673A\u5668\u4EBA\uFF0C\u4E5F\u4E0D\u662F\u6C14\u6C1B\u7EC4\u3002

# \u600E\u4E48\u7B54

${step1}
${step2}
3. **\u80FD\u786E\u5B9A\u624D\u7B54\u3002** \u9875\u9762\u91CC\u767D\u7EB8\u9ED1\u5B57\u5199\u7740\uFF0C\u624D\u76F4\u63A5\u7ED9\u7B54\u6848\uFF1B\u5199\u5F97\u4E0D\u591F\u3001\u6211\u62FF\u4E0D\u51C6\uFF0C\u5C31\u6309\u4E0B\u9762\u300C\u7B54\u4E0D\u4E0A\u6765\u300D\u90A3\u6837\u8BF4\u3002
4. **\u6709\u56FE\u5C31\u5E26\u4E0A\u3002** \u9875\u9762\u91CC\u6709\u76F4\u63A5\u5E2E\u52A9\u56DE\u7B54\u7684\u56FE\uFF08\u622A\u56FE\u3001\u6D41\u7A0B\u56FE\u3001\u793A\u610F\u56FE\uFF09\uFF0C\u5728\u7B54\u6848\u76F8\u5E94\u4F4D\u7F6E\u7528 \`![\u7B80\u77ED\u8BF4\u660E](\u9875\u9762\u91CC\u7684\u539F\u8DEF\u5F84)\` \u5E26\u4E0A\uFF1A\u8DEF\u5F84\u4E00\u5B57\u4E0D\u6539\u7167\u6284\uFF0C\u4E0D\u7F16\u8DEF\u5F84\uFF0C\u6700\u591A 3 \u5F20\uFF1B\u8BF4\u660E\u6587\u5B57\u53EA\u63CF\u8FF0\u56FE\u7684\u5185\u5BB9\uFF0C\u4E0D\u63D0\u9875\u9762\u3001\u6587\u4EF6\u8FD9\u4E9B\u8BCD\u3002

# \u51C6\u786E\u6027\u5E95\u7EBF

- **\u5B81\u53EF\u4E0D\u8BF4\uFF0C\u4E5F\u4E0D\u80FD\u8BF4\u9519\u3002**
- \u7981\u7528\u6A21\u7CCA\u8BCD\uFF1A\u300C\u53EF\u80FD\u300D\u300C\u5927\u6982\u300D\u300C\u4E5F\u8BB8\u300D\u300C\u4F3C\u4E4E\u300D\u300C\u4E0D\u592A\u6E05\u695A\u300D\u3002\u8981\u4E48\u7ED9\u786E\u5B9A\u7684\u7B54\u6848\uFF0C\u8981\u4E48\u8BF4\u6211\u7B54\u4E0D\u4E0A\u6765\u3002
- **\u53EA\u642C\u9875\u9762\u91CC\u5199\u7684\uFF0C\u4E0D\u5F80\u5916\u52A0\u3002** \u9875\u9762\u8BF4\u300C\u6539 A \u4F1A\u89E6\u53D1\u300D\uFF0C\u4E0D\u7B49\u4E8E\u300C\u6539 B \u4E0D\u4F1A\u89E6\u53D1\u300D\uFF1B\u4E00\u4EFD\u300C\u8FD9\u4E9B\u60C5\u51B5\u4F1A XX\u300D\u7684\u6E05\u5355\uFF0C\u4E0D\u80FD\u53CD\u8FC7\u6765\u5F53\u6210\u300C\u6CA1\u5217\u7684\u90FD\u4E0D\u4F1A XX\u300D\u3002\u4E0D\u8865\u8FB9\u754C\u3001\u4E0D\u8865\u4F8B\u5916\u3001\u4E0D\u8865\u4E3E\u4F8B\u2014\u2014\u300C\u5982\u679C\u53EA\u662F\u2026\u2026\u5C31\u4E0D\u4F1A\u300D\u300C\u9664\u975E\u2026\u2026\u300D\u300C\u6BD4\u5982\u2026\u2026\u300D\u8FD9\u7C7B\u8BDD\uFF0C\u9875\u9762\u91CC\u6CA1\u6709\u5C31\u662F\u6211\u7F16\u7684\u3002\u6211\u81EA\u5DF1\u5F80\u5F80\u610F\u8BC6\u4E0D\u5230\u8FD9\u662F\u5728\u7F16\uFF0C\u6240\u4EE5\u6807\u51C6\u653E\u5728\u5B57\u9762\u4E0A\uFF1A**\u6211\u8BF4\u7684\u6BCF\u4E00\u53E5\uFF0C\u90FD\u8981\u80FD\u5728\u9875\u9762\u91CC\u6307\u51FA\u51FA\u5904\u3002**
- **\u4E0D\u7F16\u64CD\u4F5C\u5165\u53E3\u3002** \u300C\u5728\u540E\u53F0\u628A XX \u5207\u6210 YY\u300D\u300C\u70B9\u67D0\u67D0\u6309\u94AE\u300D\u300C\u5728\u8BBE\u7F6E\u91CC\u6539\u4E00\u4E0B\u300D\uFF0C\u53EA\u6709\u9875\u9762\u91CC\u5199\u4E86\u8FD9\u4E2A\u5165\u53E3\u624D\u80FD\u8BF4\u3002\u62FF\u4E0D\u51C6\u5C31\u8BF4\u5177\u4F53\u5728\u54EA\u513F\u64CD\u4F5C\u6211\u7B54\u4E0D\u4E0A\u6765\u3002

# \u7B54\u4E0D\u4E0A\u6765

\u4E3B\u8BED\u662F\u300C\u6211\u300D\uFF1A\u8BF4\u7684\u662F\u6211\u7684\u80FD\u529B\u8FB9\u754C\uFF0C\u4E0D\u662F\u300C\u8FD9\u4E0D\u5F52\u6211\u4EEC\u7BA1\u300D\u3002

- \u2705 \u300C\u6211\u76EE\u524D\u80FD\u89E3\u7B54\u7684\u662F${canAnswer}\uFF0C\u8FD9\u4E2A\u6211\u8FD8\u7B54\u4E0D\u4E0A\u6765\uFF0C\u5EFA\u8BAE\u95EE\u95EE\u8D1F\u8D23\u7684\u540C\u4E8B\uFF5E\u300D
- \u274C \u300C\u8FD9\u4E2A\u4E0D\u5F52\u6211\u4EEC\u7BA1\u300D\u300C\u77E5\u8BC6\u5E93\u91CC\u6CA1\u6709\u627E\u5230\u300D

**\u4E0D @ \u4EFB\u4F55\u4EBA\u3002** \u6211\u624B\u4E0A\u6CA1\u6709\u540C\u4E8B\u540D\u518C\uFF0C\u63D0\u5230\u7684\u4EBA\u540D\u90FD\u4E0D\u7B97\u6211\u8BA4\u8BC6\u7684\u4EBA\uFF1B\u4E0D\u5199 at \u6807\u7B7E\u3001\u4E0D\u7F16 open_id\u3002

# \u4FE1\u606F\u4E0D\u591F\u65F6

\u95EE\u9898\u63CF\u8FF0\u4E0D\u8DB3\u4EE5\u67E5\uFF08\u6BD4\u5982\u53EA\u8BF4\u300C\u6709\u4E2A\u5458\u5DE5\u300D\u300C\u90A3\u4E2A\u9875\u9762\u300D\u5374\u6CA1\u8BF4\u662F\u8C01\u3001\u662F\u54EA\u4E2A\uFF09\uFF1A**\u4E00\u6B21\u95EE\u9F50**\u7F3A\u7684\u51E0\u6837\uFF0C\u7528\u4E00\u4E24\u53E5\u8BDD\u95EE\u51FA\u6765\uFF0C\u4E0D\u6324\u7259\u818F\uFF1B**\u6700\u591A\u8FFD\u4E00\u8F6E**\uFF0C\u5BF9\u65B9\u8865\u5B8C\u8FD8\u4E0D\u591F\u6216\u6CA1\u56DE\uFF0C\u5C31\u6309\u624B\u4E0A\u7684\u4FE1\u606F\u7B54\u80FD\u786E\u5B9A\u7684\u90E8\u5206\u3002\u7EAF\u89C4\u5219\u54A8\u8BE2\uFF08\u300C\u80FD\u4E0D\u80FD\u529E\u300D\u300C\u5141\u4E0D\u5141\u8BB8\u300D\uFF09\u4E0D\u7528\u8FFD\u95EE\u3002

# \u8BF4\u8BDD

- \u50CF\u771F\u4EBA\u540C\u4E8B\u4E00\u6837\u8BF4\u8BDD\uFF1A\u8BED\u6C14\u81EA\u7136\u3001\u7B80\u6D01\u3001\u5B9E\u7528\uFF0C\u7B80\u4F53\u4E2D\u6587\u3001\u804A\u5929\u5F0F\u77ED\u6BB5\u843D\uFF1B\u5185\u5BB9\u5929\u7136\u662F\u6761\u76EE\u624D\u7528\u5217\u8868\u3002
- \u76F4\u63A5\u7ED9\u7B54\u6848\u3002**\u4E0D\u66B4\u9732\u4EFB\u4F55\u5185\u90E8\u673A\u5236**\uFF1A\u77E5\u8BC6\u5E93\u3001\u6587\u4EF6\u5939\u3001\u9875\u9762\u3001\u68C0\u7D22\u3001\u5DE5\u5177\u3001AI\u3001\u6A21\u578B\u8FD9\u4E9B\u8BCD\u90FD\u4E0D\u51FA\u73B0\uFF1B\u4E0D\u8BF4\u300C\u6839\u636E\u77E5\u8BC6\u5E93\u300D\u300C\u6211\u67E5\u4E86\u4E00\u4E0B\u300D\u300C\u4F5C\u4E3A\u667A\u80FD\u4F53\u300D\u3002
- \u5185\u90E8\u63A8\u6F14\u4E0D\u5199\u8FDB\u6D88\u606F\uFF1A\u67E5\u4E86\u4EC0\u4E48\u3001\u8BFB\u4E86\u54EA\u9875\u3001\u600E\u4E48\u5224\u65AD\u7684\uFF0C\u90FD\u662F\u6211\u81EA\u5DF1\u7684\u4E8B\uFF0C\u53D1\u51FA\u53BB\u7684\u53EA\u6709\u6700\u540E\u8981\u5BF9\u4EBA\u8BF4\u7684\u8BDD\u3002
- \u79F0\u547C\uFF1A\u4E0D\u76F4\u547C\u540C\u4E8B\u5168\u540D\u3002\u77E5\u9053\u540D\u5B57\u5C31\u53BB\u59D3\u53EB\u540D\uFF0C\u4E0D\u786E\u5B9A\u5C31\u53EB\u300C\u540C\u5B66\u300D\u6216\u300C\u540C\u4E8B\u300D\uFF1B\u4E0D\u52A0\u540D\u5B57\u5BF9\u65B9\u4E5F\u77E5\u9053\u5728\u8BF4\u8C01\u65F6\uFF0C\u5C31\u4E0D\u5E26\u540D\u5B57\u3002`;
}

// src/lark/origin.ts
var KIND_LABEL = { p2p: "\u5355\u804A", group: "\u7FA4", topic: "\u8BDD\u9898\u7FA4", thread: "\u7FA4\u8BDD\u9898" };
var TOPIC_MAX = 16;
var squash = (s) => s.replace(/\s+/g, " ").trim();
function sessionTitle(o, n) {
  const topic = squash(o.topic);
  const tail = topic ? topic.length > TOPIC_MAX ? `${topic.slice(0, TOPIC_MAX)}\u2026` : topic : o.asker;
  return `${[KIND_LABEL[o.kind], o.chatName, tail].filter(Boolean).join(" \xB7 ")} #${n}`;
}
function askerLabel(name2, openId) {
  return name2.trim() || `\u7528\u6237${openId.slice(-6)}`;
}
function framedQuestion(o, question) {
  return o.kind === "p2p" ? question : `${o.asker}\uFF1A${question}`;
}
var OK_TTL_MS = 6 * 60 * 6e4;
var FAIL_TTL_MS = 10 * 6e4;
function createOriginResolver(deps) {
  const now = deps.now ?? (() => Date.now());
  const cache = /* @__PURE__ */ new Map();
  const cached = async (key, fallback, load) => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < (hit.ok ? OK_TTL_MS : FAIL_TTL_MS)) return hit.ok ? hit.v : fallback;
    try {
      const v = await load();
      cache.set(key, { at: now(), ok: true, v });
      return v;
    } catch {
      cache.set(key, { at: now(), ok: false, v: null });
      return fallback;
    }
  };
  const nameOf2 = (m) => m.senderId ? cached(`u:${m.senderId}`, "", () => deps.userName(m.senderId)) : Promise.resolve("");
  const resolve2 = async (m) => {
    const topic = m.threadId ? squash(m.text) : "";
    if (m.chatType === "p2p") {
      return { kind: "p2p", chatName: "", asker: askerLabel(await nameOf2(m), m.senderId), topic: "" };
    }
    const [info, name2] = await Promise.all([
      cached(`c:${m.chatId}`, { name: "", mode: "" }, () => deps.chatInfo(m.chatId)),
      nameOf2(m)
    ]);
    const kind = info.mode === "topic" ? "topic" : m.threadId ? "thread" : "group";
    return { kind, chatName: info.name.trim(), asker: askerLabel(name2, m.senderId), topic };
  };
  return { resolve: resolve2 };
}

// src/lark/ask.ts
var ASK_TIMEOUT_MS = 15 * 6e4;
var MAX_ANSWER = 4e3;
var ASKER_NOTE = "\u7FA4\u804A\u91CC\u6BCF\u6761\u95EE\u9898\u5F00\u5934\u7684\u300C\u540D\u5B57\uFF1A\u300D\u662F\u63D0\u95EE\u4EBA\uFF0C\u4E0D\u662F\u95EE\u9898\u7684\u4E00\u90E8\u5206\uFF1B\u56DE\u7B54\u65F6\u4E0D\u5FC5\u590D\u8FF0\u3002";
function firstMessage(folder, question, botName) {
  return { context: `${PERSONA(folder, botName)}

${ASKER_NOTE}`, text: question };
}
function truncate(text, max = MAX_ANSWER) {
  return text.length <= max ? text : text.slice(0, max) + "\n\n\uFF08\u8D85\u957F\u5DF2\u622A\u65AD\uFF09";
}
function textOfStream(stream) {
  if (!Array.isArray(stream)) return "";
  let text = "";
  for (const r of stream) {
    if (r?.type === "text-chunks" && Array.isArray(r.texts)) text += r.texts.join("");
    else if (r?.type === "chunk" && r?.chunk?.type === "text-delta") text += String(r.chunk.text ?? "");
  }
  return text;
}
var TurnWaiter = class {
  constructor(sessionId, onEvent) {
    this.sessionId = sessionId;
    this.onEvent = onEvent;
  }
  armed = false;
  lastText = "";
  settled = false;
  resolveDone;
  done = new Promise((res) => {
    this.resolveDone = res;
  });
  // 超时看门狗：deadline＋held。held=true（AI 追问的卡片挂着等人点）期间不计超时；unhold
  // 重置 deadline 再起表。轮询粒度 1s——回合超时的精度不需要更细。
  held = false;
  deadline = 0;
  timer = null;
  fireTimeout;
  timedOut = new Promise((res) => {
    this.fireTimeout = () => res(null);
  });
  /** 起表：ms 内没收场 → timedOut 落定 */
  arm(ms) {
    this.deadline = Date.now() + ms;
    this.held = false;
    this.watch();
  }
  watch() {
    if (this.timer) clearTimeout(this.timer);
    const tick = () => {
      if (this.settled) return;
      if (this.held) {
        this.timer = setTimeout(tick, 1e3);
        return;
      }
      const left = this.deadline - Date.now();
      if (left <= 0) {
        this.fireTimeout();
        return;
      }
      this.timer = setTimeout(tick, Math.min(1e3, left + 5));
    };
    this.timer = setTimeout(tick, 0);
  }
  /** 挂起（等人点卡片）：不计超时 */
  hold() {
    this.held = true;
  }
  /** 解除挂起并把剩余时长重置为 ms（答案回去后回合还要跑完） */
  unhold(ms) {
    this.held = false;
    this.deadline = Date.now() + ms;
    this.watch();
  }
  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  /** 'session/event' 的 event：收 assistant 文本；blocked 代表这个会话已不能继续。 */
  event(ev) {
    if (this.settled) return;
    try {
      this.onEvent?.(ev);
    } catch {
    }
    if (ev?.type === "turn/end" && ev?.data?.reason?.kind === "blocked") {
      this.settled = true;
      this.resolveDone({ status: "blocked" });
      return;
    }
    if (ev?.type !== "assistant/message") return;
    const text = textOfStream(ev?.data?.stream).trim();
    if (text) this.lastText = text;
  }
  /** 'agent/status'：true=回合开始（armed），armed 后的 false=回合结束 */
  running(v) {
    if (this.settled) return;
    if (v) {
      this.armed = true;
      return;
    }
    if (!this.armed) return;
    this.settled = true;
    this.resolveDone(this.lastText ? { status: "ok", text: truncate(this.lastText) } : { status: "error", detail: "\u56DE\u5408\u7ED3\u675F\u4F46\u6CA1\u6709\u6587\u672C\u8F93\u51FA" });
  }
  /** 'agent/error' 或派发失败：提前收场 */
  fail(detail) {
    if (this.settled) return;
    this.settled = true;
    this.resolveDone({ status: "error", detail });
  }
};
var TurnHub = class {
  waiters = /* @__PURE__ */ new Map();
  onEvent(sessionId, ev) {
    for (const w of this.waiters.get(sessionId) ?? []) w.event(ev);
  }
  onStatus(agentId, running) {
    for (const w of this.waiters.get(agentId) ?? []) w.running(running);
  }
  onError(agentId, detail) {
    for (const w of this.waiters.get(agentId) ?? []) w.fail(detail);
  }
  /** 派发失败收不了场时，替等待中的回合给个错误结果 */
  fail(sessionId, detail) {
    this.onError(sessionId, detail);
  }
  /** 挂起该会话所有等待回合的超时（AI 追问转卡片等人期间） */
  hold(sessionId) {
    for (const w of this.waiters.get(sessionId) ?? []) w.hold();
  }
  /** 解除挂起并把剩余时长重置为 ms */
  unhold(sessionId, ms) {
    for (const w of this.waiters.get(sessionId) ?? []) w.unhold(ms);
  }
  async wait(sessionId, timeoutMs, onEvent) {
    const w = new TurnWaiter(sessionId, onEvent);
    let set = this.waiters.get(sessionId);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.waiters.set(sessionId, set);
    }
    set.add(w);
    w.arm(timeoutMs);
    try {
      const r = await Promise.race([
        w.done.then((v) => ({ kind: "done", v })),
        w.timedOut.then(() => ({ kind: "to" }))
      ]);
      return r.kind === "to" ? { status: "timeout" } : r.v;
    } finally {
      w.dispose();
      set.delete(w);
      if (!set.size) this.waiters.delete(sessionId);
    }
  }
};
var isArchivedError = (detail) => /归档|archived|\bblocked\b/i.test(detail);
async function runTurn(deps, o) {
  const timeoutMs = o.timeoutMs ?? ASK_TIMEOUT_MS;
  try {
    const { id: id2, first } = await deps.ensure();
    const answer = deps.hub.wait(id2, timeoutMs, o.onEvent);
    try {
      await deps.send(id2, first ? o.first : o.followup);
    } catch (e) {
      const detail = `\u6D3E\u53D1\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`;
      deps.hub.fail(id2, detail);
      await answer.catch(() => ({ status: "error", detail }));
      return isArchivedError(detail) ? { status: "blocked", detail } : { status: "error", detail };
    }
    const r = await answer;
    if (r.status === "timeout") await deps.cancel(id2).catch(() => {
    });
    return r;
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}
async function askSession(deps, o) {
  const question = framedQuestion(o.origin, o.question);
  return runTurn({
    ensure: () => deps.ensureSession(o.appId, o.chatId, o.chatType, o.origin),
    send: (id2, msg) => deps.send(id2, msg),
    hub: deps.hub,
    cancel: (id2) => deps.cancel(id2)
  }, { first: firstMessage(o.folder, question, o.botName), followup: { text: question }, timeoutMs: o.timeoutMs, onEvent: o.onEvent });
}

// src/lark/live.ts
var LIVE_DEFAULTS = { delayMs: 1e4, throttleMs: 2e3, heartbeatMs: 15e3 };
var MAX_LINES = 5;
var md = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
var plain2 = (text) => ({ tag: "plain_text", content: text });
var note = (text) => ({ tag: "note", elements: [plain2(text)] });
var div = (content) => ({ tag: "div", text: { tag: "lark_md", content } });
function formatElapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1e3));
  return s < 60 ? `${s} \u79D2` : `${Math.floor(s / 60)} \u5206 ${s % 60} \u79D2`;
}
var lastSegment = (p) => {
  const parts = p.split("/").filter(Boolean);
  return (parts[parts.length - 1] ?? p).replace(/\.md$/i, "");
};
function stepLine(name2, rawArgs) {
  if (name2 !== "wiki_search" && name2 !== "wiki_read_page") return null;
  let a = {};
  try {
    a = JSON.parse(rawArgs || "{}") ?? {};
  } catch {
    a = {};
  }
  if (name2 === "wiki_search") return `\u{1F50D} \u68C0\u7D22\uFF1A${String(a.query ?? "").trim() || "\uFF08\u7A7A\uFF09"}`;
  return `\u{1F4D6} \u9605\u8BFB\uFF1A${lastSegment(String(a.id ?? a.name ?? "")) || "\uFF08\u9875\uFF09"}`;
}
function buildThinkingCard(lines, elapsedMs) {
  const shown = lines.slice(-MAX_LINES);
  const els = [div(`**\u6B63\u5728\u67E5\u8D44\u6599** \xB7 \u5DF2\u7528\u65F6 ${formatElapsed(elapsedMs)}`)];
  els.push(div(shown.length ? shown.map(md).join("\n") : "\u7406\u89E3\u95EE\u9898\u4E2D\u2026"));
  return { config: { wide_screen_mode: true, update_multi: true }, header: { title: plain2("\u77E5\u8BC6\u95EE\u7B54 \xB7 \u601D\u8003\u4E2D"), template: "blue" }, elements: els };
}
var rowMd = (row) => row.map((e) => {
  const raw = e.text;
  if (e.tag === "a") return `[${md(raw)}](${e.href})`;
  if (!e.style?.length || !raw.trim()) return md(raw);
  let t = md(raw);
  if (e.style.includes("lineThrough")) t = `~~${t}~~`;
  if (e.style.includes("italic")) t = `*${t}*`;
  if (e.style.includes("bold")) t = `**${t}**`;
  return t;
}).join("");
var statsLine = (s) => {
  const parts = [`\u7528\u65F6 ${formatElapsed(s.elapsedMs)}`];
  if (s.searches) parts.push(`\u68C0\u7D22 ${s.searches} \u6B21`);
  if (s.reads) parts.push(`\u9605\u8BFB ${s.reads} \u9875`);
  return parts.join(" \xB7 ");
};
function buildAnswerCard(markdown, stats, keys) {
  const els = [];
  let buf = [];
  const flush = () => {
    for (let i = 0; i < buf.length; i += 40) els.push(div(buf.slice(i, i + 40).join("\n")));
    buf = [];
  };
  for (const row of larkRows(markdown, keys)) {
    if (Array.isArray(row)) {
      buf.push(rowMd(row));
      continue;
    }
    flush();
    els.push({ tag: "img", img_key: row.img, alt: plain2(row.alt || "\u56FE\u7247") });
  }
  flush();
  els.push(note(statsLine(stats)));
  return { config: { wide_screen_mode: true, update_multi: true }, elements: els };
}
function buildFailCard(text, stats) {
  return { config: { wide_screen_mode: true, update_multi: true }, elements: [div(md(text)), note(statsLine(stats))] };
}
var LiveReply = class {
  constructor(io, opts = {}) {
    this.io = io;
    this.opts = { ...LIVE_DEFAULTS, ...opts };
  }
  phase = "idle";
  lines = [];
  searches = /* @__PURE__ */ new Set();
  reads = /* @__PURE__ */ new Set();
  messageId = "";
  startedAt = 0;
  chain = Promise.resolve();
  delayTimer = null;
  refreshTimer = null;
  heartbeat = null;
  lastRefresh = 0;
  opts;
  /** 串行写卡：每次写入排在前一次之后，前一次失败不挡后一次 */
  enqueue(op) {
    const p = this.chain.then(op, op);
    this.chain = p.catch(() => {
    });
    return p;
  }
  /** 有卡就改，没卡就发（发出后记下 id，之后都改这一张） */
  async put(card) {
    if (this.messageId) await this.io.updateCard(this.messageId, card);
    else this.messageId = await this.io.sendCard(card);
  }
  stats() {
    return { elapsedMs: Date.now() - this.startedAt, searches: this.searches.size, reads: this.reads.size };
  }
  /** 回合开跑：起延迟表，到点还在想就发思考卡 */
  start() {
    this.startedAt = Date.now();
    this.phase = "thinking";
    this.delayTimer = setTimeout(() => {
      this.delayTimer = null;
      if (this.phase !== "thinking") return;
      this.refreshNow();
      this.heartbeat = setInterval(() => this.schedule(), this.opts.heartbeatMs);
    }, this.opts.delayMs);
  }
  visible() {
    return !!this.messageId || !this.delayTimer && this.phase === "thinking";
  }
  refreshNow() {
    if (this.phase !== "thinking") return;
    this.lastRefresh = Date.now();
    const card = buildThinkingCard(this.lines, Date.now() - this.startedAt);
    void this.enqueue(async () => {
      if (this.phase !== "thinking") return;
      await this.put(card);
    }).catch((e) => this.io.warn(`\u5237\u65B0\u601D\u8003\u5361\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`));
  }
  /** 节流刷新：距上次不足 throttleMs 就挂一次延后的，期间再来的合并 */
  schedule() {
    if (this.phase !== "thinking" || !this.visible() || this.refreshTimer) return;
    const wait = Math.max(0, this.opts.throttleMs - (Date.now() - this.lastRefresh));
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshNow();
    }, wait);
  }
  /** 宿主 session/event：只认 tool/call，记一行并（节流）刷卡 */
  step(ev) {
    if (this.phase === "done" || ev?.type !== "tool/call") return;
    const name2 = String(ev?.data?.name ?? "");
    const args = String(ev?.data?.arguments ?? "");
    const line = stepLine(name2, args);
    if (!line) return;
    if (name2 === "wiki_search") this.searches.add(line);
    if (name2 === "wiki_read_page") this.reads.add(line);
    this.lines.push(line);
    this.schedule();
  }
  /** AI 追问：把这张卡换成题卡（还没发卡就直接作为回复发出），得卡片消息 id 供按钮回调认领 */
  ask(questionCard) {
    this.phase = "asking";
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }
    return this.enqueue(async () => {
      await this.put(questionCard);
      return this.messageId;
    });
  }
  /** 题卡挂起期间改题卡（多选勾选态）：同样排进串行链，且只在仍在追问时落笔 */
  updateAsk(questionCard) {
    return this.enqueue(async () => {
      if (this.phase === "asking" && this.messageId) await this.io.updateCard(this.messageId, questionCard);
    });
  }
  /** 作答完毕：回到思考中并立刻刷回思考卡 */
  resume() {
    if (this.phase !== "asking") return;
    this.phase = "thinking";
    if (!this.heartbeat) this.heartbeat = setInterval(() => this.schedule(), this.opts.heartbeatMs);
    this.refreshNow();
  }
  stop() {
    this.phase = "done";
    if (this.delayTimer) clearTimeout(this.delayTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.delayTimer = this.refreshTimer = this.heartbeat = null;
  }
  async settle(card, fallbackText, keys) {
    this.stop();
    try {
      await this.enqueue(() => this.put(card));
    } catch (e) {
      this.io.warn(`\u7B54\u6848\u5361\u7247\u53D1\u9001\u5931\u8D25\uFF0C\u9000\u56DE\u5BCC\u6587\u672C\uFF1A${e instanceof Error ? e.message : String(e)}`);
      await this.io.replyText(fallbackText, keys);
    }
  }
  /** 收场：卡片换成答案（keys：答案里已上传的图） */
  finish(answer, keys) {
    return this.settle(buildAnswerCard(answer, this.stats(), keys), answer, keys);
  }
  /** 失败收场：卡片换成失败话术 */
  fail(text) {
    return this.settle(buildFailCard(text, this.stats()), text);
  }
};

// src/lark/service.ts
var BUSY_TEXT = "\u4E0A\u4E00\u6761\u8FD8\u5728\u60F3\uFF0C\u7A0D\u7B49\u4E00\u4E0B\u518D\u95EE";
var FAIL_TEXT = "\u8FD9\u6761\u6CA1\u7B54\u4E0A\u6765\uFF0C\u7A0D\u540E\u518D\u8BD5";
var BLOCKED_TEXT = "\u5F53\u524D\u95EE\u7B54\u4F1A\u8BDD\u5DF2\u5F52\u6863\uFF0C\u8BF7\u53D1\u9001\u300C\u65B0\u4F1A\u8BDD\u300D\u540E\u518D\u63D0\u95EE";
var NEW_SESSION_CMD = "\u65B0\u4F1A\u8BDD";
var NEW_SESSION_TEXT = "\u5DF2\u51C6\u5907\u597D\u65B0\u4F1A\u8BDD\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u63D0\u95EE\u4E86";
function createLarkService(deps) {
  const now = deps.now ?? (() => Date.now());
  const locks = new ChatLocks();
  const seen = new SeenEvents(200);
  const replySafe = async (messageId, text, inThread = false, keys) => {
    try {
      await deps.reply(messageId, text, inThread, keys);
    } catch (e) {
      if (keys?.size) {
        deps.warn(`\u56DE\u590D Lark \u5E26\u56FE\u5931\u8D25\uFF0C\u6539\u53D1\u7EAF\u6587\u5B57\uFF1A${e instanceof Error ? e.message : String(e)}`);
        return replySafe(messageId, text, inThread);
      }
      deps.warn(`\u56DE\u590D Lark \u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const lives = /* @__PURE__ */ new Map();
  const makeLive = (messageId, inThread) => {
    const { replyCard, updateCard } = deps;
    if (!replyCard || !updateCard) return null;
    return new LiveReply({
      sendCard: (card) => replyCard(messageId, card, inThread),
      updateCard: (id2, card) => updateCard(id2, card),
      replyText: (text, keys) => replySafe(messageId, text, inThread, keys),
      warn: deps.warn
    }, deps.liveOpts);
  };
  const fallbackOrigin = (msg, q) => ({
    kind: msg.chatType === "p2p" ? "p2p" : msg.threadId ? "thread" : "group",
    chatName: "",
    asker: askerLabel("", msg.senderId ?? ""),
    topic: msg.threadId ? q : ""
  });
  const originOf = async (msg, q) => {
    if (!deps.origin) return fallbackOrigin(msg, q);
    try {
      return await deps.origin(msg, q);
    } catch (e) {
      deps.warn(`Lark \u6D88\u606F\u6765\u6E90\u89E3\u6790\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`);
      return fallbackOrigin(msg, q);
    }
  };
  const keysOf = async (text) => {
    if (!deps.images) return void 0;
    try {
      return await deps.images.resolve(text);
    } catch (e) {
      deps.warn(`Lark \u7B54\u6848\u56FE\u7247\u5904\u7406\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`);
      return void 0;
    }
  };
  const handle = (msg) => {
    if (seen.dup(msg.eventId)) return;
    const binding = route(msg.chatId, deps.bindings());
    if (!binding) return;
    const q = questionOf(msg, deps.botOpenId());
    if (!q) return;
    const key = conversationKey(msg);
    const inThread = !!msg.threadId;
    if (deps.pendingText?.(key, q)) return;
    if (q === NEW_SESSION_CMD) {
      rotateChat(key);
      void replySafe(msg.messageId, NEW_SESSION_TEXT, inThread);
      return;
    }
    if (!locks.try(key)) {
      void replySafe(msg.messageId, BUSY_TEXT, inThread);
      return;
    }
    const live = makeLive(msg.messageId, inThread);
    if (live) lives.set(key, live);
    void (async () => {
      try {
        live?.start();
        const origin = await originOf(msg, q);
        const r = await askSession(deps.ask, {
          appId: deps.appId,
          chatId: key,
          chatType: msg.chatType,
          folder: binding.folder,
          question: q,
          origin,
          botName: deps.botName?.(),
          ...live ? { onEvent: (ev) => live.step(ev) } : {}
        });
        deps.sessions.touch(deps.appId, key, msg.chatType);
        if (r.status === "error") deps.warn(`Lark \u95EE\u7B54\u5931\u8D25\uFF08${key}\uFF09\uFF1A${r.detail}`);
        if (r.status === "blocked" && r.detail) deps.warn(`Lark \u95EE\u7B54\u4F1A\u8BDD\u5DF2\u5F52\u6863\uFF08${key}\uFF09\uFF1A${r.detail}`);
        if (r.status === "timeout") deps.warn(`Lark \u95EE\u7B54\u8D85\u8FC7\u515C\u5E95\u4E0A\u9650\u672A\u6536\u573A\uFF08${key}\uFF09\uFF0C\u5DF2\u53EB\u505C`);
        const text = r.status === "ok" ? r.text : r.status === "blocked" ? BLOCKED_TEXT : FAIL_TEXT;
        const keys = r.status === "ok" ? await keysOf(text) : void 0;
        if (!live) await replySafe(msg.messageId, text, inThread, keys);
        else if (r.status === "ok") await live.finish(text, keys);
        else await live.fail(text);
      } finally {
        if (live && lives.get(key) === live) lives.delete(key);
        locks.release(key);
      }
    })();
  };
  const rotateChat = (chatId) => {
    const moved = deps.sessions.rotate(deps.appId, chatId);
    if (moved) deps.info(`Lark \u65B0\u4F1A\u8BDD\uFF1A${chatId} \u7684\u65E7\u4F1A\u8BDD\u300C${moved.title}\u300D\u5DF2\u5F52\u6863\uFF0C\u4E0B\u6761\u6D88\u606F\u5F00\u65B0\u4F1A\u8BDD`);
  };
  const rotate = (chatId, _chatType) => {
    const binding = route(chatId, deps.bindings());
    if (!binding) return;
    rotateChat(chatId);
  };
  return {
    start: (hooks) => {
      hooks.onMessage(handle);
      hooks.onChatNew((e) => rotate(e.chatId, e.chatType));
    },
    handle,
    rotate,
    live: (key) => lives.get(key)
  };
}

// src/lark/images.ts
var IMAGE_DEFAULTS = { maxImages: 5, maxBytes: 10 * 1024 * 1024, timeoutMs: 15e3 };
var EXTS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
var NO_SCOPE = 99991672;
var relOf = (url) => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#")) return null;
  let p = url.split("#")[0];
  try {
    p = decodeURI(p);
  } catch {
  }
  return p.startsWith("raw/") || p.startsWith("asset/") ? p : null;
};
var extOf = (p) => (p.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
var errMsg = (e) => e instanceof Error ? e.message : String(e);
function createImageResolver(deps, opts = {}) {
  const o = { ...IMAGE_DEFAULTS, ...opts };
  const cache = /* @__PURE__ */ new Map();
  let disabled = false;
  const one = async (url, rel, out) => {
    const abs = deps.locate(rel);
    if (!abs) return;
    let st;
    try {
      st = await deps.stat(abs);
    } catch {
      return;
    }
    if (!st.size || st.size > o.maxBytes) return;
    const ck = `${abs}|${st.mtimeMs}|${st.size}`;
    const hit = cache.get(ck);
    if (hit) {
      out.set(url, hit);
      return;
    }
    if (disabled) return;
    try {
      const key = await deps.upload(await deps.read(abs));
      cache.set(ck, key);
      out.set(url, key);
    } catch (e) {
      if (Number(e?.code) === NO_SCOPE) {
        if (!disabled) deps.warn("\u98DE\u4E66\u5E94\u7528\u7F3A im:resource \u6743\u9650\uFF0C\u7B54\u6848\u91CC\u7684\u56FE\u7247\u4E0D\u4F1A\u53D1\u9001");
        disabled = true;
      } else deps.warn(`\u98DE\u4E66\u56FE\u7247\u4E0A\u4F20\u5931\u8D25\uFF08${rel}\uFF09\uFF1A${errMsg(e)}`);
    }
  };
  return {
    async resolve(markdown) {
      const out = /* @__PURE__ */ new Map();
      const picks = [];
      for (const url of imageUrls(markdown)) {
        const rel = relOf(url);
        if (rel && EXTS.has(extOf(rel))) picks.push([url, rel]);
        if (picks.length >= o.maxImages) break;
      }
      if (!picks.length) return out;
      let timer;
      const timeout = new Promise((r) => {
        timer = setTimeout(r, o.timeoutMs);
      });
      await Promise.race([Promise.all(picks.map(([u, r]) => one(u, r, out))), timeout]);
      clearTimeout(timer);
      return new Map(out);
    }
  };
}

// src/lark/cards.ts
var md2 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
var note2 = (text) => ({ tag: "note", elements: [{ tag: "plain_text", content: text }] });
var plain3 = (text) => ({ tag: "plain_text", content: text });
function questionElements(q, index, picked, customs) {
  const els = [{
    tag: "div",
    text: {
      tag: "lark_md",
      content: `**${index + 1}. ${md2(q.header ? `${q.header}\uFF1A` : "")}${md2(q.question)}${q.multiSelect ? "\uFF08\u53EF\u591A\u9009\uFF09" : ""}**`
    }
  }];
  const tips = [];
  if (q.detail) tips.push(q.detail);
  for (const o of q.options ?? []) if (o.description) tips.push(`${o.label}\uFF1A${o.description}`);
  if (customs[q.id] !== void 0) tips.push(`\u5DF2\u56DE\u590D\uFF1A${customs[q.id]}`);
  else if (!q.options?.length) tips.push("\u8BF7\u76F4\u63A5\u56DE\u590D\u6587\u5B57\u4F5C\u7B54");
  if (tips.length) els.push(note2(tips.join("\n")));
  const actions = [];
  const sel = picked[q.id] ?? [];
  for (const o of q.options ?? []) {
    const checked = sel.includes(o.label);
    actions.push({
      tag: "button",
      text: plain3(checked ? `\u2713 ${o.label}` : o.label),
      type: checked ? "primary" : "default",
      value: { q: q.id, o: o.label }
    });
  }
  if (q.multiSelect) actions.push({ tag: "button", text: plain3("\u63D0\u4EA4"), type: "primary", value: { q: q.id, s: "1" } });
  if (actions.length) els.push({ tag: "action", actions });
  return els;
}
function buildAskCard(questions, picked = {}, customs = {}) {
  return {
    config: { wide_screen_mode: true },
    header: { title: plain3("\u77E5\u8BC6\u95EE\u7B54 \xB7 \u9700\u8981\u4F60\u9009\u62E9"), template: "blue" },
    elements: [
      ...questions.flatMap((q, i) => questionElements(q, i, picked, customs)),
      note2("\u70B9\u6309\u94AE\u4F5C\u7B54\uFF1B\u4E5F\u53EF\u4EE5\u76F4\u63A5\u56DE\u590D\u6587\u5B57")
    ]
  };
}
function buildSettledCard(questions, settled, customs, banner) {
  const els = [{ tag: "div", text: { tag: "lark_md", content: `**${md2(banner)}**` } }];
  questions.forEach((q, i) => {
    els.push({ tag: "div", text: { tag: "lark_md", content: `**${i + 1}. ${md2(q.header ? `${q.header}\uFF1A` : "")}${md2(q.question)}**` } });
    const sel = settled[q.id];
    const text = sel === void 0 ? "\u672A\u4F5C\u7B54" : sel.length ? sel.map(md2).join("\u3001") : `\u6587\u5B57\u4F5C\u7B54\uFF1A${md2(customs[q.id] ?? "")}`;
    els.push(note2(text));
  });
  return { config: { wide_screen_mode: true }, header: { title: plain3("\u77E5\u8BC6\u95EE\u7B54 \xB7 \u5DF2\u6536\u5361"), template: "grey" }, elements: els };
}
function applyCardAction(questions, picked, value) {
  if (typeof value !== "object" || value === null) return null;
  const v = value;
  const q = questions.find((x) => x.id === String(v.q ?? ""));
  if (!q) return null;
  const next = { ...picked };
  if (v.s !== void 0) {
    return { picked: next, settled: { [q.id]: [...next[q.id] ?? []] } };
  }
  const label = String(v.o ?? "");
  if (!(q.options ?? []).some((o) => o.label === label)) return null;
  if (q.multiSelect) {
    const sel = [...next[q.id] ?? []];
    const at = sel.indexOf(label);
    if (at >= 0) sel.splice(at, 1);
    else sel.push(label);
    next[q.id] = sel;
    return { picked: next, settled: {} };
  }
  next[q.id] = [label];
  return { picked: next, settled: { [q.id]: [label] } };
}

// src/lark/mount.ts
function mountLark(ctx, hub, cfg, makeChannel = (c) => new LarkChannel(c)) {
  let inner = null;
  ctx.inject(["agents", "sessions", "sessionController", "workspaceRegistry", "permissionPresets"], (c) => {
    inner = mountInner(c, hub, cfg, makeChannel);
  });
  return {
    status: () => inner?.status() ?? {
      connected: false,
      serving: 0,
      phase: vaultPhase(hub),
      // 显式挑字段（appSecret 绝不进 RPC 响应，哪怕没连上也一样）
      apps: normalizeApps(cfg.apps()).ok.map((a) => ({ appId: a.appId, folder: a.folder, model: a.model, name: "", connected: false, botReady: false, folderExists: folderOf(hub, a.folder) }))
    },
    restart: () => inner?.restart(),
    reconnect: async (appId) => inner ? inner.reconnect(appId) : { saved: false, connected: false, detail: "\u95EE\u7B54\u901A\u9053\u672A\u6302\u8F7D\uFF08\u5BBF\u4E3B\u4F1A\u8BDD\u670D\u52A1\u672A\u5C31\u7EEA\uFF09" }
  };
}
var folderOf = (hub, folder) => {
  const m = hub.engine.model;
  return !!m && folderHasPages(m, folder);
};
var READ_ONLY_PRESET = "read-only";
function pinReadOnly(ctx, session) {
  const presets = ctx.permissionPresets;
  if (!presets || !session) throw new Error("\u5BBF\u4E3B\u7F3A\u5C11\u6743\u9650\u9884\u8BBE\u670D\u52A1\uFF0C\u95EE\u7B54\u4F1A\u8BDD\u65E0\u6CD5\u9650\u5B9A\u53EA\u8BFB\uFF0C\u62D2\u7EDD\u4F5C\u7B54");
  if (presets.current(session) !== READ_ONLY_PRESET) presets.set(session, READ_ONLY_PRESET);
}
var appBinding = (a) => ({ name: nameOf(a.appId), folder: a.folder, chatId: "", model: a.model });
function mountInner(ctx, hub, cfg, makeChannel) {
  const log = ctx.logger;
  const controller = () => ctx.sessionController;
  const turns = new TurnHub();
  let chans = [];
  let mountedApps = /* @__PURE__ */ new Set();
  let lastSig = "";
  const groupPath = cfg.groupDir ? cfg.groupDir() : join4(homedir(), ".dsh", "\u77E5\u8BC6\u95EE\u7B54");
  let wsId = null;
  let wsInFlight = null;
  const ensureWorkspace = () => {
    if (wsId) return Promise.resolve(wsId);
    return wsInFlight ??= (async () => {
      try {
        await mkdir(groupPath, { recursive: true });
        const ws = await ctx.workspaceRegistry.create(groupPath);
        if (!ws?.id) throw new Error("workspaceRegistry.create \u672A\u8FD4\u56DE id");
        wsId = String(ws.id);
        log.info(`Lark \u95EE\u7B54\u4F1A\u8BDD\u5DF2\u5F52\u7EC4\u300C${String(ws.title ?? "\u77E5\u8BC6\u95EE\u7B54")}\u300D\uFF08${String(ws.path ?? groupPath)}\uFF09`);
        return wsId;
      } catch (e) {
        log.warn(`\u95EE\u7B54\u4F1A\u8BDD\u7EC4\u672A\u5EFA\u7ACB\uFF0C\u4F1A\u8BDD\u9000\u56DE\u5E93\u76EE\u5F55\uFF1A${e instanceof Error ? e.message : String(e)}`);
        return null;
      } finally {
        wsInFlight = null;
      }
    })();
  };
  ctx.effect(() => ctx.on("session/event", (s, ev) => turns.onEvent(String(typeof s === "object" ? s?.id : s), ev)), "dsh-knowledge-brain.lark.events");
  ctx.effect(() => ctx.on("agent/status", ({ agent, status: status2 }) => turns.onStatus(String(agent?.id ?? ""), status2 === "running")), "dsh-knowledge-brain.lark.status");
  ctx.effect(() => ctx.on("agent/error", ({ agent, error }) => turns.onError(String(agent?.id ?? ""), String(error ?? "agent \u51FA\u9519"))), "dsh-knowledge-brain.lark.error");
  const status = () => {
    const { ok } = normalizeApps(cfg.apps());
    return {
      // 全部机器人都连上才算总体已连接；逐个状态在 apps 里看
      connected: ok.length > 0 && chans.length === ok.length,
      serving: ok.length,
      phase: vaultPhase(hub),
      apps: ok.map((a) => {
        const e = chans.find((x) => x.app.appId === a.appId);
        return { appId: a.appId, folder: a.folder, model: a.model, name: e?.ch.botName ?? "", connected: !!e, botReady: !!e?.ch.botOpenId, folderExists: folderOf(hub, a.folder) };
      })
    };
  };
  const ensureSession = (app) => async (appId, chatId, chatType, origin) => {
    const sessions = cfg.chats;
    const rec = sessions.list(appId).find((r) => r.chatId === chatId);
    if (rec?.current) return { id: rec.current, first: false };
    const workspaceId = await ensureWorkspace();
    const where = workspaceId ? { workspaceId } : { cwd: hub.dir() };
    for (let attempt = 0; attempt < 8; attempt++) {
      const past = sessions.list(appId).find((r) => r.chatId === chatId)?.past.length ?? 0;
      const id2 = sessions.nextId(appId, chatId);
      const title = sessionTitle(origin, past + 1);
      try {
        await controller().create({ sessionId: id2, ...where });
        try {
          await controller().rename({ sessionId: id2, title });
        } catch {
        }
        if (app.model) {
          const at = app.model.indexOf("/");
          try {
            await controller().selectModel({ sessionId: id2, provider: app.model.slice(0, at), model: app.model.slice(at + 1) });
          } catch {
          }
        }
        sessions.bind(appId, chatId, id2, title, chatType);
        return { id: id2, first: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/belongs to "|records no cwd/.test(msg)) throw e;
        sessions.reserve(appId, chatId, id2, title);
      }
    }
    throw new Error("\u95EE\u7B54\u4F1A\u8BDD\u521B\u5EFA\u53CD\u590D\u88AB\u62D2\uFF08cwd \u51B2\u7A81\uFF09\uFF0C\u5DF2\u91CD\u8BD5 8 \u6B21");
  };
  const CARD_ASK_TIMEOUT_MS = 10 * 6e4;
  const pendingByCard = /* @__PURE__ */ new Map();
  const pendingByChat = /* @__PURE__ */ new Map();
  const dropPending = (p) => {
    pendingByCard.delete(p.messageId);
    if (pendingByChat.get(p.chatId) === p) pendingByChat.delete(p.chatId);
    clearTimeout(p.timer);
    p.off();
  };
  const answerOf = (p) => ({
    // custom 只在有文字作答时带（undefined 键会让宿主侧的形状校验多一个字段）
    answers: p.questions.map((q) => {
      const a = { id: q.id, selected: p.settled[q.id] ?? [] };
      if (p.customs[q.id] !== void 0) a.custom = p.customs[q.id];
      return a;
    })
  });
  const allSettled = (p) => p.questions.every((q) => p.settled[q.id] !== void 0);
  const finishPending = (p, banner) => {
    dropPending(p);
    p.resolve(answerOf(p));
    if (p.live) {
      p.live.resume();
      return;
    }
    void p.ch.updateCard(p.messageId, buildSettledCard(p.questions, p.settled, p.customs, banner)).catch((e) => log.warn(`\u66F4\u65B0\u95EE\u7B54\u5361\u7247\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`));
  };
  const refreshPending = (p) => {
    const card = buildAskCard(p.questions, p.picked, p.customs);
    if (p.live) {
      void p.live.updateAsk(card).catch(() => {
      });
      return;
    }
    void p.ch.updateCard(p.messageId, card).catch(() => {
    });
  };
  const onCardAction = (a) => {
    const p = pendingByCard.get(a.messageId);
    if (!p) return;
    const r = applyCardAction(p.questions, p.picked, a.value);
    if (!r) return;
    p.picked = r.picked;
    Object.assign(p.settled, r.settled);
    if (allSettled(p)) finishPending(p, "\u5DF2\u4F5C\u7B54");
    else refreshPending(p);
  };
  const takePendingText = (chatId, text) => {
    const p = pendingByChat.get(chatId);
    if (!p) return false;
    const open = p.questions.filter((x) => p.settled[x.id] === void 0);
    const q = open.find((x) => !x.options?.length) ?? open[0];
    if (!q) return false;
    p.settled[q.id] = [];
    p.customs[q.id] = text;
    if (allSettled(p)) finishPending(p, "\u5DF2\u4F5C\u7B54");
    else refreshPending(p);
    return true;
  };
  const failPendings = (detail) => {
    for (const p of [...pendingByCard.values()]) {
      dropPending(p);
      p.reject(new Error(detail));
    }
  };
  const askViaCard = async (ch, chatId, sessionId, req, live) => {
    const questions = (Array.isArray(req?.questions) ? req.questions : []).map((q) => ({
      id: String(q?.id ?? ""),
      question: String(q?.question ?? ""),
      detail: q?.detail === void 0 ? void 0 : String(q.detail),
      header: q?.header === void 0 ? void 0 : String(q.header),
      multiSelect: !!q?.multiSelect,
      options: Array.isArray(q?.options) ? q.options.map((o) => ({ label: String(o?.label ?? ""), description: o?.description === void 0 ? void 0 : String(o.description) })) : void 0
    })).filter((q) => q.id && q.question);
    turns.hold(sessionId);
    let resolve2, reject;
    const answer = new Promise((res, rej) => {
      resolve2 = res;
      reject = rej;
    });
    let p = null;
    try {
      let messageId = "";
      let viaLive;
      if (live) {
        try {
          messageId = await live.ask(buildAskCard(questions, {}));
          viaLive = live;
        } catch (e) {
          log.warn(`\u56DE\u590D\u5361\u7247\u6362\u9898\u5361\u5931\u8D25\uFF0C\u53E6\u53D1\u9898\u5361\uFF1A${e instanceof Error ? e.message : String(e)}`);
          live.resume();
        }
      }
      if (!messageId) {
        const where = parseConversationKey(chatId);
        messageId = (await ch.sendCard(where.chatId, buildAskCard(questions, {}), where.root || void 0)).messageId;
      }
      p = { ch, chatId, sessionId, questions, picked: {}, settled: {}, customs: {}, messageId, ...viaLive ? { live: viaLive } : {}, resolve: resolve2, reject, timer: 0, off: () => {
      } };
      pendingByCard.set(p.messageId, p);
      pendingByChat.set(chatId, p);
      p.timer = setTimeout(() => {
        dropPending(p);
        if (!p.live) void p.ch.updateCard(p.messageId, buildSettledCard(questions, p.settled, p.customs, "\u8D85\u65F6\u672A\u4F5C\u7B54\uFF0C\u672C\u6761\u5DF2\u653E\u5F03")).catch(() => {
        });
        void cancel(sessionId);
        reject(new Error("\u95EE\u7B54\u5361\u7247\u8D85\u65F6\u672A\u4F5C\u7B54"));
      }, CARD_ASK_TIMEOUT_MS);
      if (req?.signal) {
        const onAbort = () => {
          if (!pendingByCard.has(p.messageId)) return;
          dropPending(p);
          if (!p.live) void p.ch.updateCard(p.messageId, buildSettledCard(questions, p.settled, p.customs, "\u56DE\u5408\u5DF2\u4E2D\u6B62")).catch(() => {
          });
          reject(new Error("\u95EE\u7B54\u5361\u7247\u968F\u56DE\u5408\u4E2D\u6B62"));
        };
        req.signal.addEventListener("abort", onAbort, { once: true });
        p.off = () => {
          try {
            req.signal.removeEventListener("abort", onAbort);
          } catch {
          }
        };
      }
      return await answer;
    } catch (e) {
      if (p) dropPending(p);
      throw e;
    } finally {
      if (p) dropPending(p);
      turns.unhold(sessionId, ASK_TIMEOUT_MS);
    }
  };
  ctx.effect(() => ctx.on("user-questions/request", async (req, next) => {
    const sessionId = String(req?.agent?.id ?? "");
    if (sessionId) {
      for (const { ch, app, svc } of chans) {
        const rec = cfg.chats.list(app.appId).find((r) => r.current === sessionId);
        if (rec) return await askViaCard(ch, rec.chatId, sessionId, req, svc.live(rec.chatId));
      }
    }
    return await next();
  }, "dsh-knowledge-brain.lark.ask"));
  const pendingPersona = /* @__PURE__ */ new Map();
  ctx.effect(() => ctx.on("agent/pre-step", async (e, next) => {
    const d = await next();
    const sid = String(e?.agent?.id ?? e?.agent?.session?.id ?? "");
    const persona = pendingPersona.get(sid);
    if (!persona || d?.kind !== "enter" || !Array.isArray(d.messages)) return d;
    const at = d.messages.findIndex((m) => m?.source?.kind === "user");
    if (at < 0) return d;
    pendingPersona.delete(sid);
    const context = createUserMessage2({ content: [{ type: "text", text: persona }], source: { kind: "lark" } });
    return { ...d, messages: [...d.messages.slice(0, at), context, ...d.messages.slice(at)] };
  }), "dsh-knowledge-brain.lark.persona");
  const send2 = async (sessionId, msg) => {
    const { agent } = await controller().resolveAgent(sessionId);
    pinReadOnly(ctx, agent.session);
    if (msg.context) pendingPersona.set(sessionId, msg.context);
    const question = createUserMessage2({ content: [{ type: "text", text: msg.text }], source: { kind: "user" } });
    const drive = async () => {
      agent.followup(question);
      await ctx.sessions.flush(agent.session);
    };
    const agents = ctx.agents;
    if (typeof agents?.withoutInitiator === "function") await agents.withoutInitiator(drive);
    else await drive();
  };
  const cancel = async (sessionId) => {
    try {
      await controller().cancel({ sessionId });
    } catch {
    }
  };
  const restart = () => {
    const { ok, problems } = normalizeApps(cfg.apps());
    for (const p of problems) log.warn(`Lark \u673A\u5668\u4EBA\u914D\u7F6E\u95EE\u9898\uFF1A${p}`);
    const sig = JSON.stringify(ok.map((a) => [a.appId, createHash2("sha256").update(a.appSecret).digest("hex"), a.folder, a.model]));
    if (sig === lastSig) return;
    lastSig = sig;
    failPendings("\u673A\u5668\u4EBA\u914D\u7F6E\u5DF2\u53D8\u66F4\uFF0C\u8FFD\u95EE\u5361\u7247\u4F5C\u5E9F");
    for (const { ch } of chans) {
      void ch.stop().catch(() => {
      });
    }
    chans = [];
    const keep = new Set(ok.map((a) => a.appId));
    for (const id2 of mountedApps) if (!keep.has(id2)) cfg.chats.drop(id2);
    mountedApps = keep;
    if (!ok.length) {
      log.info("Lark \u901A\u9053\u672A\u8FDE\u63A5\uFF1A\u6CA1\u6709\u914D\u7F6E\u673A\u5668\u4EBA");
      return;
    }
    for (const app of ok) void connect(app).catch(() => {
    });
  };
  const originOf = (ch) => {
    if (!ch.chatInfo || !ch.userName) return void 0;
    const r = createOriginResolver({ chatInfo: (id2) => ch.chatInfo(id2), userName: (id2) => ch.userName(id2) });
    return (m, question) => r.resolve({
      chatId: m.chatId,
      chatType: m.chatType,
      senderId: m.senderId ?? "",
      text: question,
      ...m.threadId ? { threadId: m.threadId } : {}
    });
  };
  const connect = (app) => {
    const pseudo = appBinding(app);
    const ch = makeChannel({ appId: app.appId, appSecret: app.appSecret, warn: (m) => log.warn(m), info: (m) => log.info(m) });
    ch.onCardAction(onCardAction);
    const svc = createLarkService({
      appId: app.appId,
      bindings: () => [pseudo],
      // 单兜底绑定：这个机器人答所有会话
      botOpenId: () => ch.botOpenId,
      botName: () => ch.botName ?? "",
      reply: (messageId, text, inThread, keys) => ch.reply(messageId, text, inThread, keys),
      // 通道能回卡片才走回复卡片（思考过程 → 答案原位替换）；否则照旧富文本
      ...ch.replyCard ? {
        replyCard: (messageId, card, inThread) => ch.replyCard(messageId, card, inThread),
        updateCard: (messageId, card) => ch.updateCard(messageId, card)
      } : {},
      ...cfg.liveOpts ? { liveOpts: cfg.liveOpts } : {},
      ask: {
        ensureSession: ensureSession(app),
        send: send2,
        hub: turns,
        cancel
      },
      sessions: cfg.chats,
      // 答案带图：一个机器人一个 resolver（image_key 只在本应用内有效；重连即新建，缺权限标记随之清掉）
      ...ch.uploadImage ? {
        images: createImageResolver({
          locate: (rel) => inside(hub.dir(), rel, rel.startsWith("raw/") ? "raw" : "asset"),
          stat: (abs) => stat(abs),
          read: (abs) => readFile(abs),
          upload: (buf) => ch.uploadImage(buf),
          warn: (m) => log.warn(m)
        })
      } : {},
      origin: originOf(ch),
      pendingText: takePendingText,
      warn: (m) => log.warn(m),
      info: (m) => log.info(m)
    });
    svc.start({
      onMessage: (h) => ch.onMessage(h),
      onChatNew: (h) => ch.onChatNew(h)
    });
    const entry = { app, ch, svc };
    chans.push(entry);
    return ch.start().catch((e) => {
      log.error(`Lark \u957F\u8FDE\u63A5\u5931\u8D25\uFF08${app.appId}\uFF09\uFF1A${e instanceof Error ? e.message : String(e)}`);
      const i = chans.indexOf(entry);
      if (i >= 0) chans.splice(i, 1);
      throw e;
    });
  };
  const inFlight = /* @__PURE__ */ new Map();
  const reconnect = (appId) => {
    const app = normalizeApps(cfg.apps()).ok.find((a) => a.appId === appId);
    if (!app) return Promise.resolve({ saved: false, connected: false });
    const pending = inFlight.get(appId);
    if (pending) return pending;
    if (chans.some((x) => x.app.appId === appId)) return Promise.resolve({ saved: true, connected: true, already: true });
    const p = connect(app).then(
      () => ({ saved: true, connected: true }),
      (e) => ({ saved: true, connected: false, detail: e instanceof Error ? e.message : String(e) })
    ).finally(() => inFlight.delete(appId));
    inFlight.set(appId, p);
    return p;
  };
  restart();
  ctx.effect(() => () => {
    failPendings("\u63D2\u4EF6\u505C\u7528\uFF0C\u8FFD\u95EE\u5361\u7247\u4F5C\u5E9F");
    for (const { ch } of chans) void ch.stop().catch(() => {
    });
  }, "dsh-knowledge-brain.lark");
  return { status, restart, reconnect };
}

// src/host/config.ts
import z from "@deepseek-ai/schemastery";
var Config = z.object({
  vaultDir: z.string().description("\u77E5\u8BC6\u5E93\u76EE\u5F55\uFF08\u7EDD\u5BF9\u8DEF\u5F84\uFF09\uFF0C\u5728 profile \u7684 cordis.patch.yml \u91CC\u7ED9 dsh-knowledge-brain \u914D config.vaultDir").volatile(),
  // 机器人列表：一个元素 = {appId, appSecret, folder, model?}（一个机器人答一个文件夹的所有
  // 会话）。schema 故意放行任何形状——手改 yml 打错结构不能炸插件加载（那会拖死整个知识库），
  // 校验全交给 normalizeApps：非法项剔除并带原因，其余照常；secret 只存配置，不打日志、不进 RPC 响应。
  // schema 外的键（旧版的 feishuAppId / feishuAppSecret / feishuApps 等）schemastery 原样忽略，存量 yml 里还写着也不会炸加载
  larkApps: z.any().default([]).description("Lark\u673A\u5668\u4EBA\u5217\u8868\uFF08app_id+app_secret+\u6587\u4EF6\u5939\uFF09").volatile(),
  // MCP 端点列表：一个元素 = {name, folder, token}（一个端点只开放一个文件夹，只读）。schema 放行任何形状，
  // 校验交给 mcp/entries.normalizeMcpEntries（非法剔除带原因）；token 只存配置，不打日志、不进 RPC 响应
  mcpServers: z.any().default([]).description("MCP \u7AEF\u70B9\u5217\u8868\uFF08endpoint+name+folder+token\uFF09").volatile()
});
function larkAppsOf(config) {
  const lark = config.larkApps?.get?.();
  return Array.isArray(lark) ? lark : [];
}

// src/mcp/entries.ts
var ENDPOINT_RE = /^[A-Za-z0-9_-]{1,32}$/;
var MAX_NAME = 32;
var MIN_TOKEN = 32;
function normalizeMcpEntries(raw) {
  const ok = [];
  const problems = [];
  if (raw === void 0 || raw === null) return { ok, problems };
  if (!Array.isArray(raw)) return { ok, problems: ["mcpServers \u4E0D\u662F\u6570\u7EC4"] };
  for (const [i, item] of raw.entries()) {
    const nth = `\u7B2C ${i + 1} \u9879`;
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`${nth}\uFF1A\u4E0D\u662F\u5BF9\u8C61`);
      continue;
    }
    const endpoint = String(item.endpoint ?? "").trim();
    if (!endpoint) {
      problems.push(`${nth}\uFF1A\u7F3A endpoint`);
      continue;
    }
    if (!ENDPOINT_RE.test(endpoint)) {
      problems.push(`${nth}\uFF1Aendpoint \u53EA\u80FD\u7528\u5B57\u6BCD\u3001\u6570\u5B57\u3001- \u548C _\uFF0C\u6700\u591A 32 \u4F4D`);
      continue;
    }
    const name2 = typeof item.name === "string" ? item.name.trim() : "";
    if (!name2) {
      problems.push(`${endpoint}\uFF1A\u7F3A name`);
      continue;
    }
    if ([...name2].length > MAX_NAME) {
      problems.push(`${endpoint}\uFF1Aname \u6700\u591A 32 \u4E2A\u5B57`);
      continue;
    }
    const rawFolder = folderText(item.folder);
    if (!rawFolder.trim()) {
      problems.push(`${endpoint}\uFF1A\u7F3A folder`);
      continue;
    }
    const folder = normFolder(rawFolder);
    if (folder === null) {
      problems.push(`${endpoint}\uFF1Afolder \u4E0D\u80FD\u542B\u7A7A\u6BB5\u3001. \u6216 .. \u6BB5`);
      continue;
    }
    const token = String(item.token ?? "").trim();
    if (token.length < MIN_TOKEN) {
      problems.push(`${endpoint}\uFF1Atoken \u592A\u77ED\uFF08\u81F3\u5C11 ${MIN_TOKEN} \u4F4D\uFF09`);
      continue;
    }
    if (ok.some((e) => e.endpoint === endpoint)) {
      problems.push(`${endpoint}\uFF1Aendpoint \u91CD\u540D`);
      continue;
    }
    ok.push({ endpoint, name: name2, folder, token });
  }
  return { ok, problems };
}

// src/mcp/http.ts
import { createHash as createHash3, timingSafeEqual } from "node:crypto";
import { Readable as Readable3, pipeline } from "node:stream";

// src/mcp/server.ts
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import * as z2 from "zod";

// src/mcp/image.ts
import { readFileSync as readFileSync3, statSync as statSync6 } from "node:fs";
var MAX_IMAGE_BYTES = 5 * 1024 * 1024;
var MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
var extOf2 = (p) => (p.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
var rooted = (p) => p.startsWith("asset/") || p.startsWith("raw/");
function allowedImages(m, folder) {
  const keep = scopeFilter(folder);
  const out = /* @__PURE__ */ new Set();
  for (const [id2, refs] of m.embedOf) {
    if (!keep(id2)) continue;
    for (const r of refs) if (rooted(r) && MIME[extOf2(r)]) out.add(r);
  }
  return out;
}
function readImage(m, folder, path13) {
  const rel = String(path13 ?? "").normalize("NFC");
  const no = () => new Error(`\u8BFB\u4E0D\u5230\u56FE\u7247\uFF1A${rel}\uFF08\u53EA\u8BB8\u8303\u56F4\u5185\u9875\u9762\u91CC\u5F15\u7528\u7684 png/jpg/jpeg/gif/webp/bmp\uFF0C\u22645MB\uFF09`);
  if (!allowedImages(m, folder).has(rel)) throw no();
  const abs = inside(m.dir, rel, rel.startsWith("raw/") ? "raw" : "asset");
  if (!abs) throw no();
  let size;
  try {
    const st = statSync6(abs);
    if (!st.isFile()) throw no();
    size = st.size;
  } catch {
    throw no();
  }
  if (!size || size > MAX_IMAGE_BYTES) throw no();
  let data;
  try {
    data = readFileSync3(abs).toString("base64");
  } catch {
    throw no();
  }
  return { data, mimeType: MIME[extOf2(rel)] };
}

// src/mcp/server.ts
var RO = { readOnlyHint: true };
var json = (v) => ({ content: [{ type: "text", text: JSON.stringify(v, null, 2) }] });
var fail = (e) => ({ isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] });
var safe = (fn) => async (a) => {
  try {
    return await fn(a);
  } catch (e) {
    return fail(e);
  }
};
function buildMcpServer(getModel, folder, title) {
  const ops = createWikiOps(getModel, folder);
  const s = new McpServer({ name: "dsh-knowledge-brain", version: "0.1.0", ...title ? { title } : {} });
  const where = isVaultRoot(folder) ? "\u77E5\u8BC6\u5E93" : `\u300C${folder}\u300D\u6587\u4EF6\u5939`;
  s.registerTool("wiki_search", {
    description: `\u5728${where}\u91CC\u5168\u6587\u641C\u7D22\uFF08\u4E2D\u6587\u5206\u8BCD\uFF09\u3002\u8FD4\u56DE\u9875 id\u3001\u9875\u540D\u3001\u9762\u5305\u5C51\u4E0E\u547D\u4E2D\u6458\u8981\u3002\u8BFB\u6B63\u6587\u7528 wiki_read_page\u3002`,
    inputSchema: z2.object({ query: z2.string().describe("\u68C0\u7D22\u8BCD"), limit: z2.number().optional().describe("\u6700\u591A\u6761\u6570\uFF0C\u9ED8\u8BA4 10") }),
    annotations: RO
  }, safe(({ query, limit }) => json(ops.search(query, limit ?? 10))));
  s.registerTool("wiki_read_page", {
    description: `\u8BFB${where}\u91CC\u7684\u9875\uFF1Afrontmatter \u5143\u6570\u636E + markdown \u6B63\u6587 + \u524D\u540E\u9875 + \u53CD\u94FE\u3002id \u53EF\u4EE5\u662F\u5E93\u5185\u8DEF\u5F84\u6216\u9875\u540D\uFF1B\u9875\u540D\u6709\u6B67\u4E49\u6216\u627E\u4E0D\u5230\u65F6\u8FD4\u56DE\u5019\u9009\u3002\u6B63\u6587\u8D85\u957F\u4F1A\u622A\u65AD\uFF0C\u6309\u8FD4\u56DE\u7684 next_offset \u7EED\u8BFB\u3002\u6B63\u6587\u91CC\u7684\u56FE\u7247\u7528 wiki_image \u770B\u3002`,
    inputSchema: z2.object({ id: z2.string().describe("\u5E93\u5185\u8DEF\u5F84\u6216\u9875\u540D"), offset: z2.number().optional().describe("\u6B63\u6587\u8D77\u59CB\u5B57\u7B26\u4F4D\u7F6E\uFF0C\u9ED8\u8BA4 0") }),
    annotations: RO
  }, safe(({ id: id2, offset }) => json(ops.readPage(id2, offset ?? 0))));
  s.registerTool("wiki_backlinks", {
    description: `\u5217\u51FA${where}\u91CC\u5F15\u7528\u4E86\u67D0\u9875\u7684\u5176\u4ED6\u9875\u53CA\u5F15\u7528\u5904\u4E0A\u4E0B\u6587\u3002`,
    inputSchema: z2.object({ id: z2.string().describe("\u5E93\u5185\u8DEF\u5F84\u6216\u9875\u540D") }),
    annotations: RO
  }, safe(({ id: id2 }) => json(ops.backlinks(id2))));
  s.registerTool("wiki_tree", {
    description: `\u770B${where}\u7684\u76EE\u5F55\u6811\uFF08\u6587\u4EF6\u5939 \u2192 \u9875\uFF09\uFF0C\u542B\u6BCF\u9879\u63CF\u8FF0\u4E0E\u9875\u6570\u3002path \u7ED9\u67D0\u4E2A\u6587\u4EF6\u5939\u9875 id \u53EA\u770B\u5B83\u4E0B\u9762\uFF1Bdepth \u9ED8\u8BA4 2\u3002`,
    inputSchema: z2.object({ path: z2.string().optional().describe(`\u6587\u4EF6\u5939\u9875 id\uFF0C\u7701\u7565\u4E3A${isVaultRoot(folder) ? "\u6574\u4E2A\u77E5\u8BC6\u5E93" : "\u672C\u6587\u4EF6\u5939"}`), depth: z2.number().optional().describe("\u5C55\u5F00\u5C42\u6570\uFF0C\u9ED8\u8BA4 2") }),
    annotations: RO
  }, safe(({ path: path13, depth }) => json(ops.tree(path13, depth ?? 2))));
  s.registerTool("wiki_tags", {
    description: `\u4E0D\u7ED9 tag\uFF1A\u5217\u51FA${where}\u91CC\u7684\u5168\u90E8\u6807\u7B7E\u4E0E\u9875\u6570\uFF1B\u7ED9 tag\uFF1A\u5217\u51FA\u8BE5\u6807\u7B7E\u4E0B\u7684\u9875\u3002`,
    inputSchema: z2.object({ tag: z2.string().optional().describe("\u6807\u7B7E\u540D") }),
    annotations: RO
  }, safe(({ tag }) => json(ops.tags(tag))));
  s.registerTool("wiki_image", {
    description: `\u770B${where}\u9875\u9762\u6B63\u6587\u91CC\u5F15\u7528\u7684\u56FE\u7247\u3002path \u7528\u6B63\u6587\u91CC ![](\u2026) \u7684\u5E93\u6839\u8DEF\u5F84\uFF08asset/\u2026 \u6216 raw/\u2026\uFF09\u3002\u53EA\u652F\u6301 png/jpg/jpeg/gif/webp/bmp\uFF0C\u5355\u5F20 \u22645MB\u3002`,
    inputSchema: z2.object({ path: z2.string().describe("\u56FE\u7247\u7684\u5E93\u6839\u8DEF\u5F84\uFF0C\u5982 asset/xx/a.png") }),
    annotations: RO
  }, safe(({ path: path13 }) => {
    const img = readImage(ops.model(), folder, path13);
    return { content: [{ type: "image", data: img.data, mimeType: img.mimeType }] };
  }));
  return s;
}
function createFolderHandler(getModel, folder, title) {
  return createMcpHandler(() => buildMcpServer(getModel, folder, title), {
    onerror: (e) => console.error("[dsh-knowledge-brain] MCP", e.message)
  });
}

// src/mcp/http.ts
var MCP_PREFIX = "/mcp";
var MAX_BODY = 1024 * 1024;
var HOP = /* @__PURE__ */ new Set(["host", "connection", "keep-alive", "transfer-encoding", "content-length", "upgrade", "authorization"]);
var digest = (s) => createHash3("sha256").update(s).digest();
var sameToken = (a, b) => timingSafeEqual(digest(a), digest(b));
function bearerOf(req) {
  const m = /^\s*bearer\s+(.+?)\s*$/i.exec(String(req.headers.authorization ?? ""));
  return m ? m[1] : null;
}
function endpointOf(rawUrl) {
  const path13 = new URL(rawUrl ?? "/", "http://x").pathname;
  const m = /^\/mcp\/([^/]+)$/.exec(path13);
  if (!m) return null;
  try {
    const n = decodeURIComponent(m[1]);
    return n === m[1] && !n.includes("/") ? n : null;
  } catch {
    return null;
  }
}
var send = (res, status, text) => {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
};
function readBody(req, max) {
  return new Promise((resolve2, reject) => {
    const chunks = [];
    let n = 0;
    let over = false;
    req.on("data", (c) => {
      if (over) return;
      n += c.length;
      if (n > max) {
        over = true;
        chunks.length = 0;
      } else chunks.push(c);
    });
    req.on("end", () => resolve2(over ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function createMcpRoute(deps) {
  const handlers = /* @__PURE__ */ new Map();
  const keyOf = (e) => `${e.endpoint}\0${e.folder}\0${e.name}`;
  const handlerOf = (e) => {
    const key = keyOf(e);
    let h = handlers.get(key);
    if (!h) {
      h = createFolderHandler(deps.getModel, e.folder, e.name);
      handlers.set(key, h);
    }
    const live = new Set(deps.entries().map(keyOf));
    for (const [k, old] of handlers) if (!live.has(k)) {
      handlers.delete(k);
      void old.close().catch(() => {
      });
    }
    return h;
  };
  async function handle(req, res) {
    try {
      if (req.headers.origin !== void 0) return send(res, 403, "forbidden");
      const endpoint = endpointOf(req.url);
      const token = bearerOf(req);
      const entry = endpoint ? deps.entries().find((e) => e.endpoint === endpoint) : void 0;
      if (!entry || token === null || !sameToken(token, entry.token)) return send(res, 401, "unauthorized");
      if (req.method !== "POST") return send(res, 405, "method not allowed");
      const body = await readBody(req, MAX_BODY);
      if (body === null) return send(res, 413, "payload too large");
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === void 0 || HOP.has(k)) continue;
        for (const x of Array.isArray(v) ? v : [v]) headers.append(k, x);
      }
      const web = await handlerOf(entry).fetch(new Request(`http://127.0.0.1${req.url}`, { method: "POST", headers, body: new Uint8Array(body) }));
      const out = {};
      web.headers.forEach((v, k) => {
        out[k] = v;
      });
      res.writeHead(web.status, out);
      if (!web.body) {
        res.end();
        return;
      }
      pipeline(Readable3.fromWeb(web.body), res, () => {
      });
    } catch (e) {
      console.error("[dsh-knowledge-brain] MCP \u8BF7\u6C42\u51FA\u9519", e instanceof Error ? e.message : String(e));
      send(res, 500, "internal error");
    }
  }
  return {
    handle,
    async close() {
      await Promise.allSettled([...handlers.values()].map((h) => h.close()));
      handlers.clear();
    }
  };
}

// src/mcp/mount.ts
function mountMcp(ctx, hub, cfg) {
  let lastProblems = "";
  const entries = () => {
    const { ok, problems } = normalizeMcpEntries(cfg.servers());
    const sig = problems.join("\uFF1B");
    if (sig && sig !== lastProblems) console.warn("[dsh-knowledge-brain] mcpServers \u6709\u6761\u76EE\u88AB\u5FFD\u7565\uFF1A" + sig);
    lastProblems = sig;
    return ok;
  };
  const route2 = createMcpRoute({ entries, getModel: () => hub.model() });
  let webServer = null;
  ctx.inject(["webServer"], (wc) => {
    webServer = wc.webServer;
    wc.effect(() => () => {
      webServer = null;
    }, "dsh-knowledge-brain.mcp.port");
    wc.effect(() => () => {
      void route2.close().catch(() => {
      });
    }, "dsh-knowledge-brain.mcp.close");
    wc.effect(() => wc.webServer.register({
      kind: "prefix",
      path: MCP_PREFIX,
      handler: (req, res) => route2.handle(req, res).catch(() => {
        try {
          res.destroy();
        } catch {
        }
      })
    }), "dsh-knowledge-brain.mcp");
  });
  return {
    status() {
      const m = hub.engine.model;
      const port = portOf(webServer);
      return {
        phase: vaultPhase(hub),
        endpointBase: port ? `http://127.0.0.1:${port}` : null,
        servers: entries().map((e) => ({ endpoint: e.endpoint, name: e.name, folder: e.folder, folderExists: !!m && folderHasPages(m, e.folder) }))
      };
    }
  };
}
function portOf(ws) {
  try {
    const p = ws?.port;
    return Number.isInteger(p) && p > 0 && p < 65536 ? p : null;
  } catch {
    return null;
  }
}

// src/index.ts
var name = "dsh-knowledge-brain";
var inject = ["connection", "tools"];
async function apply(ctx, config) {
  const hub = new Hub(() => config.vaultDir.get());
  hub.reopen();
  ctx.effect(() => () => {
    hub.engine.close().catch((e) => console.error("[dsh-knowledge-brain] \u5173\u5E93\u5931\u8D25", e));
  }, "dsh-knowledge-brain.vault");
  const lark = mountLark(ctx, hub, {
    apps: () => larkAppsOf(config),
    chats: new ChatSessions()
  });
  let last = config.vaultDir.get();
  ctx.on("loader/volatile-update", () => {
    if (config.vaultDir.get() !== last) {
      last = config.vaultDir.get();
      hub.reopen();
    }
    lark.restart();
  });
  const mcp = mountMcp(ctx, hub, { servers: () => config.mcpServers?.get?.() });
  registerRpc(ctx, hub, lark, void 0, { mcpStatus: () => mcp.status() });
  registerRoutes(ctx, hub);
  registerExfontsRoute(ctx);
  registerTools(ctx, hub);
  mountSkills(ctx, hub);
  registerReference(ctx, hub);
  ctx.logger.info("dsh-knowledge-brain\uFF1A\u5E93 %s\uFF0C%d \u9875\uFF0CLark \u673A\u5668\u4EBA %d \u4E2A\uFF0CMCP \u7AEF\u70B9 %d \u4E2A", hub.dir(), hub.engine.model?.g.order.length ?? 0, normalizeApps(larkAppsOf(config)).ok.length, mcp.status().servers.length);
}
export {
  Config,
  apply,
  inject,
  name
};
