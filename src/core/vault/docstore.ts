// 解析仓：文件字节 → {doc, links, embeds} 的唯一读盘点，mtime+size 校验缓存。
// 解析产物只读：doc/links/embeds 视为冻结，与 byId 共享同一对象引用（零额外内存），任何视图不得就地改。
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { linksWithLines, type DocLink } from './graph';
import { readDoc, type WikiDoc } from './vault';

export interface ParsedUnit { doc: WikiDoc; links: DocLink[]; embeds: string[] }
interface Entry { mtimeMs: number; size: number; parsed: ParsedUnit }

// 正文里出现过的 asset/、raw/ 引用（图片、链接、嵌入件同归）：允许过失效——多失效一页
// 只是重渲染（惰性、便宜），漏失效才是 bug。精确解析在 render。
const REF_RE = /\]\(([^)\s]+)[^)]*\)|src=["']([^"']+)["']/g;
export function embedsOfDoc(docId: string, md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(REF_RE)) {
    const href = ((m[1] || m[2] || '')).split('#')[0].split('?')[0];
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    let p = href;
    try { p = decodeURI(p) } catch { /* 保持原样 */ }
    const rooted = p.startsWith('asset/') || p.startsWith('raw/');
    const rel = path.posix.normalize(rooted ? p : path.posix.join(path.posix.dirname(docId), p));
    out.add(rel.normalize('NFC'));   // 出侧 NFC：对齐 asset 事件路径的 NFC 归一，NFD 拼写的 href 也能命中
  }
  return [...out];
}

export class DocStore {
  private cache = new Map<string, Entry>();
  constructor(private dir: string) {}

  get(rel: string): ParsedUnit | null {
    const key = rel.normalize('NFC');
    try {
      const st = statSync(path.join(this.dir, key));
      const hit = this.cache.get(key);
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.parsed;
      const doc = readDoc(this.dir, key);
      const content = doc.offline ? '' : doc._content || '';
      const parsed: ParsedUnit = { doc, links: doc.offline ? [] : linksWithLines(content), embeds: doc.offline ? [] : embedsOfDoc(key, content) };
      this.cache.set(key, { mtimeMs: st.mtimeMs, size: st.size, parsed });
      return parsed;
    } catch { return null }   // 读不了按没有处理：引擎侧决定走 unlink 还是跳过
  }

  invalidate(rel: string) { this.cache.delete(rel.normalize('NFC')); }

  // 全量重建用：与 loadDocs 同序走一遍（readdirSync 深度优先），stat 命中的走缓存；
  // 顺带清掉已消失的缓存项
  bulk(areas: string[]): WikiDoc[] {
    const out: WikiDoc[] = [];
    const live = new Set<string>();
    const walk = (rel: string) => {
      let entries;
      try { entries = readdirSync(path.join(this.dir, rel), { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const child = (rel + '/' + e.name).normalize('NFC');
        if (e.isDirectory()) walk(child);
        else if (/\.md$/i.test(e.name)) {
          const u = this.get(child);
          if (u) { out.push(u.doc); live.add(child); }
        }
      }
    };
    for (const a of areas) walk(a);
    for (const k of this.cache.keys()) if (!live.has(k)) this.cache.delete(k);
    return out;
  }
}
