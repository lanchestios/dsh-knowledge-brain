// 知识库里站点之外的两份元数据：anchors.conf（研习基线）与 raw/ 下有哪些名字
// （死链「不在应用里」的判据）。只读文件名与配置行，不读 raw/ 与 .wiki/ 的正文。
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';   // 页的 frontmatter
import { parseAnchors, type AnchorSection } from './pagemeta';

export interface WikiDoc {
  _id: string; source: string; path: string
  title: string; description: string; tags: string[]; sources: string[]
  status: string; created: string; updated: string
  _content: string; raw: string; fmError: boolean; offline: boolean
}
export interface FolderConf { index: string | null; order: string[] }

function readAnchors(dir: string): AnchorSection[] {
  const f = path.join(dir, '.wiki', 'anchors.conf');
  return fs.existsSync(f) ? parseAnchors(fs.readFileSync(f, 'utf8')) : [];
}

// raw/ 下所有节点名：md 的文件名（去 .md）与目录名。
// raw/project 是外部克隆（CLI 的 SCOPE_EXCLUDE 同款围栏），整棵不扫：仓库代码名混进
// 死链判据没有意义，还会把几千个目录的同步扫描拖进每次重建。
function rawNames(dir: string): Set<string> {
  const names = new Set<string>();
  (function walk(d: string, top: boolean) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const name = e.name.normalize('NFC');
      if (e.isDirectory()) { if (top && name === 'project') continue; names.add(name); walk(path.join(d, e.name), false); }
      else if (name.endsWith('.md')) names.add(name.replace(/\.md$/, ''));
    }
  })(path.join(dir, 'raw'), true);
  return names;
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string; error: boolean } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw);
  if (!m) return { data: {}, body: raw, error: false };
  const body = raw.slice(m[0].length);
  try {
    const data = parseYaml(m[1]);
    return { data: data && typeof data === 'object' ? data as Record<string, unknown> : {}, body, error: false };
  } catch (e) {
    return { data: {}, body, error: true };
  }
}

const str = (v: unknown) => (v == null ? '' : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

// OneDrive 按需文件：占位不占块（size > 0 且 blocks === 0），读它会触发下载并可能卡住
function readDoc(dir: string, rel: string): WikiDoc {
  const abs = path.join(dir, rel);
  const st = fs.statSync(abs);
  const offline = st.size > 0 && st.blocks === 0;
  const raw = offline ? '' : fs.readFileSync(abs, 'utf8');
  const { data, body, error } = parseFrontmatter(raw);
  const base = rel.split('/').pop()!.replace(/\.md$/i, '');
  return {
    _id: rel, source: '_posts/' + rel, path: rel,
    title: str(data.title) || base, description: str(data.description),
    tags: arr(data.tags), sources: arr(data.source), status: str(data.status) || 'stable',
    created: str(data.created), updated: str(data.updated),
    _content: body, raw, fmError: error, offline,
  };
}

// 五区下全部 md；路径统一 NFC，与正文里的双链对得上
function loadDocs(dir: string, areas: string[]): WikiDoc[] {
  const out: WikiDoc[] = [];
  function walk(rel: string) {
    let entries;
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const child = (rel + '/' + e.name).normalize('NFC');
      if (e.isDirectory()) walk(child);
      else if (/\.md$/i.test(e.name)) {
        try { out.push(readDoc(dir, child)); } catch (err) { console.error('[vault] 读不了', child, err); }
      }
    }
  }
  for (const area of areas) walk(area);
  return out;
}

// 五区里每个文件夹的 .folder.json：{ index, children: { 名: { type, ext, order } } }，本层按 order 排。
// 字段全部必填由 wiki check 把关（开库前已校验）；这里读得宽：读不了或写错的层照默认规则，只在日志里提一句。
// .wiki/wiki.json 的 parts 同理。
const FOLDER_CONF = '.folder.json';
const WIKI_CONF = path.join('.wiki', 'wiki.json');

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const readJson = (f: string): Record<string, any> => {
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('顶层必须是对象');
  return data;
};
// { 名: { order } } → 按 order 排好的名字；没写 order 的殿后
const byOrder = (m: unknown): string[] =>
  Object.entries(m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, any>) : {})
    .map(([name, attrs]): [string, number] => [String(name).normalize('NFC'), num(attrs && attrs.order) ?? Infinity])
    .sort((a, b) => a[1] - b[1])
    .map(([n]) => n);

function loadFolders(dir: string, areas: string[]): Map<string, FolderConf> {
  const folders = new Map<string, FolderConf>();
  function walk(rel: string) {
    let entries;
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) walk((rel + '/' + e.name).normalize('NFC'));
      else if (e.name === FOLDER_CONF) {
        try {
          const data = readJson(path.join(dir, rel, e.name));
          const index = typeof data.index === 'string' && data.index ? data.index.normalize('NFC') : null;
          folders.set(rel, { index, order: byOrder(data.children) });
        } catch (err) {
          console.warn('[vault] ' + rel + '/' + FOLDER_CONF + ' 解析失败，按默认规则：' + (err as Error).message);
        }
      }
    }
  }
  for (const area of areas) walk(area);
  return folders;
}

// .wiki/wiki.json 的 parts，按 order 排；读不到时用 fallback
function loadParts(dir: string, fallback: string[]): string[] {
  try {
    const parts = byOrder(readJson(path.join(dir, WIKI_CONF)).parts);
    if (parts.length) return parts;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[vault] ' + WIKI_CONF + ' 解析失败，五区按默认顺序：' + (err as Error).message);
  }
  return fallback;
}

export { readDoc, readAnchors, rawNames, loadDocs, loadFolders, loadParts, parseFrontmatter };
