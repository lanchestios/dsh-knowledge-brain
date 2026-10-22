// 页的元数据：状态行与仓库页要的几项事实，全部从原文现算。
//
// 为什么读 doc.raw 而不读 doc.source：Hexo 用文件路径覆盖了 frontmatter 的 source 字段
// （doc.source 是 _posts/…md），来源文档条数只能从原文的 frontmatter 里数。verified 也按原文判，
// 与 wiki page unverified 同口径：有一条 by 以 human: 开头即人工确认。

import * as wg from './graph';

export interface AnchorSection {
  prefix: string;
  repos: Array<{ name: string; path: string; commit: string }>;
}

function frontmatterOf(raw: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw || '');
  return m ? m[1] : '';
}

// 顶层键的值：同一行冒号后的部分 + 紧随其后的缩进行
function blockOf(fm: string, key: string): { inline: string; block: string[] } | null {
  const lines = fm.split('\n');
  const i = lines.findIndex((l) => l.startsWith(key + ':'));
  if (i === -1) return null;
  const block = [];
  for (let j = i + 1; j < lines.length && (/^\s/.test(lines[j]) || lines[j] === ''); j++) block.push(lines[j]);
  return { inline: lines[i].slice(key.length + 1).trim(), block };
}

function sourceCount(raw: string): number {
  const b = blockOf(frontmatterOf(raw), 'source');
  if (!b) return 0;
  if (b.inline.startsWith('[')) {
    return b.inline.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean).length;
  }
  if (b.inline) return 1;
  return b.block.filter((l) => /^\s+-\s+\S/.test(l)).length;
}

function isHumanVerified(raw: string): boolean {
  const b = blockOf(frontmatterOf(raw), 'verified');
  if (!b) return false;
  return /by:\s*human:/.test(b.inline + '\n' + b.block.join('\n'));
}

function bodyChars(md: string): number {
  return (md || '').replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/\s+/g, '').length;
}

// .wiki/anchors.conf：[前缀] 段头，段内一行一个仓：名字 路径 commit
function parseAnchors(text: string): AnchorSection[] {
  const out: AnchorSection[] = [];
  let cur: AnchorSection | null = null;
  for (const line of (text || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
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

// 研习页的基线：只看 anatomy/ 段；段前缀按路径边界匹配（anatomy/Pi 不匹配 anatomy/Pix）。
// ⚠ 与 ops.applyAnchors 有意分歧（勿合并、勿静默对齐）：那边零 repos 的命中段也算页命中（进
// ids 走重渲染）；这里只收 repos，零 repos 段产出空基线列表。
function baselinesFor(anchors: AnchorSection[], vaultPath: string): Array<{ name: string; sha: string }> {
  const out = [];
  for (const s of anchors) {
    if (!s.prefix.startsWith('anatomy/')) continue;
    if (vaultPath !== s.prefix && !vaultPath.startsWith(s.prefix + '/')) continue;
    for (const r of s.repos) out.push({ name: r.name, sha: r.commit.slice(0, 7) });
  }
  return out;
}

function statusOf(g: any, doc: any, anchors: AnchorSection[]): {
  human: boolean;
  draft: boolean;
  updated: string;
  sources: number;
  pos: { i: number; n: number; parentName: string } | null;
  baselines: Array<{ name: string; sha: string }>;
} {
  const d = doc.updated || doc.date;
  return {
    human: isHumanVerified(doc.raw),
    draft: doc.status === 'draft',
    updated: d ? String(d).slice(0, 10) : '',
    sources: sourceCount(doc.raw),
    pos: wg.posOf(g, doc),
    baselines: baselinesFor(anchors, wg.vaultPathOf(doc)),
  };
}

export { frontmatterOf, sourceCount, isHumanVerified, bodyChars, parseAnchors, baselinesFor, statusOf };
