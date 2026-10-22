// test/slug-parity.test.js —— 客户端（lezer 标题文本 + GithubSlugger）vs 服务端（hast + rehype-slug）
// 标题锚点 id 必须同序全等：分歧条目即锚点漂移点，修实现、不改语料放过。
// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { mathExt, wikilinkExt } from '../src/editor/kernel/mdext.ts';
import { buildDeco } from '../src/editor/kernel/deco.ts';
import { buildModel } from '../src/core/model.ts';
import { renderPage } from '../src/core/render.ts';

// 语料特意含「首个 h1 与后续 h2 同名」：rehype-slug 在剥首个 h1 之前跑，h1 先消费掉 slug、
// 同名 h2 拿 -1 后缀——客户端必须同计数（对隐藏 h1 照常 slug），否则同名锚点漂移
const H2 = ['你好 世界', 'Hello World', '主标题', '重复', '重复', '带  空白', '符号!@#', '中文·间隔', 'C++ 与 C'];
const doc = '# 主标题\n\n' + H2.map((h) => `## ${h}\n\n正文\n`).join('');

test('标题锚点 id：客户端装饰 vs 服务端 rehype-slug 语料一致（h2 层）', async () => {
  // 本仓 lang-markdown@6.5.2 没有 gfmLanguage 导出（拿到 undefined 会静默退到 CommonMark）——
  // 用导出的 markdownLanguage（GFM+），与 editor-deco-inline 测试同配置
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [mathExt, wikilinkExt] })] });
  const d = buildDeco(state, { mode: 'read', dark: false, batch: null, io: {}, degrade: false });
  const clientIds = [];
  // RangeSet.iter() 不收回调（返回 RangeCursor），与 editor-deco-inline 测试同协议
  for (let i = d.iter(); i.value; i.next()) {
    const v = i.value;
    if (!v.spec.attributes?.id) continue;
    if (state.doc.lineAt(i.from).text.startsWith('## ')) clientIds.push(v.spec.attributes.id);   // 只收 h2：首个 h1 阅读态隐藏但 id 仍挂
  }
  const dir = mkdtempSync(join(tmpdir(), 'wk-slug-'));
  try {
    mkdirSync(join(dir, '认知'), { recursive: true });
    writeFileSync(join(dir, '认知', '锚.md'), doc, 'utf8');
    const m = buildModel(dir);
    const { html } = await renderPage(m.byId.get('认知/锚.md'), m);
    const serverIds = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((x) => x[1]);
    assert.deepEqual(clientIds, serverIds);
  } finally { rmSync(dir, { recursive: true, force: true }) }
});
