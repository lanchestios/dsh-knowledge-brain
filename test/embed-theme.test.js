// test/embed-theme.test.js
// @vitest-environment jsdom
// 嵌入件明暗：服务端按 ?theme= 在首帧就把 data-dsh-theme 写进 <html>、注入统一 color-scheme；
// 客户端在 iframe 进 DOM 前给 src 补上当前明暗
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { injectEmbedScripts } from '../src/host/routes.ts';
import { embedTheme, themeEmbeds } from '../src/editor/kernel/embed-theme.ts';
import { readFileSync } from 'node:fs';

const PAGE = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<style>body{background:transparent}</style>\n</head>\n<body><p>x</p></body>\n</html>';

test('带 theme：<html> 首帧就立 data-dsh-theme', () => {
  assert.match(injectEmbedScripts(PAGE, 'dark'), /<html lang="zh-CN" data-dsh-theme="dark">/);
  assert.match(injectEmbedScripts(PAGE, 'light'), /<html lang="zh-CN" data-dsh-theme="light">/);
});

test('统一 color-scheme 样式注入在 <head> 最前，作者样式排在它后面', () => {
  const out = injectEmbedScripts(PAGE, 'dark');
  const style = out.indexOf('html[data-dsh-theme="dark"]{color-scheme:dark');
  assert.ok(style > 0, out);
  assert.ok(style < out.indexOf('<meta charset'), '注入样式在作者内容之前');
  assert.match(out, /html\[data-dsh-theme="light"\]\{color-scheme:light/);
  assert.match(out, /prefers-color-scheme:\s*dark\)\{html:not\(\[data-dsh-theme\]\)\{color-scheme:dark/, '没带 theme 的直开页按系统兜底');
});

test('没带 theme 或值非法：不立属性，样式照注', () => {
  for (const t of [undefined, '', 'evil"><script>']) {
    const out = injectEmbedScripts(PAGE, t);
    assert.match(out, /<html lang="zh-CN">/);
    assert.ok(!out.includes('evil'), '非法值不进页面');
    assert.ok(out.includes('color-scheme:dark'));
  }
});

test('页里已写 data-dsh-theme 时以宿主为准、不重复', () => {
  const out = injectEmbedScripts(PAGE.replace('<html lang="zh-CN">', '<html data-dsh-theme="light" lang="zh-CN">'), 'dark');
  assert.equal((out.match(/data-dsh-theme="/g) ?? []).length - (out.match(/html\[data-dsh-theme="/g) ?? []).length, 1);
  assert.match(out, /<html lang="zh-CN" data-dsh-theme="dark">/);
});

test('没有 <head>/<html> 的残页也能注入', () => {
  const out = injectEmbedScripts('<p>x</p>', 'dark');
  assert.ok(out.includes('color-scheme:dark'));
  assert.ok(out.includes('dshWikiEmbedHeight'));
});

test('监听脚本只立属性，不再写行内 colorScheme、不再发 ThemeAsk', () => {
  const out = injectEmbedScripts(PAGE, 'dark');
  assert.ok(out.includes('dshWikiTheme'));
  assert.ok(!out.includes('colorScheme'));
  assert.ok(!out.includes('dshWikiEmbedThemeAsk'));
});

test('embedTheme 读宿主 body[data-ds-dark-theme]', () => {
  document.body.removeAttribute('data-ds-dark-theme');
  assert.equal(embedTheme(), 'light');
  document.body.setAttribute('data-ds-dark-theme', '');
  assert.equal(embedTheme(), 'dark');
  document.body.removeAttribute('data-ds-dark-theme');
});

test('themeEmbeds 给 wiki-embed iframe 的 src 补 theme，已有的替换，别的 iframe 不动', () => {
  const box = document.createElement('div');
  box.innerHTML = '<iframe class="wiki-embed" src="api/wiki.asset?path=asset%2Fa.html&amp;v=1"></iframe>'
    + '<iframe class="wiki-embed" src="api/wiki.asset?path=asset%2Fb.html&amp;theme=light"></iframe>'
    + '<iframe src="https://example.com/x"></iframe>';
  themeEmbeds(box, 'dark');
  const [a, b, c] = box.querySelectorAll('iframe');
  assert.equal(a.getAttribute('src'), 'api/wiki.asset?path=asset%2Fa.html&v=1&theme=dark');
  assert.equal(b.getAttribute('src'), 'api/wiki.asset?path=asset%2Fb.html&theme=dark');
  assert.equal(c.getAttribute('src'), 'https://example.com/x');
});

test('正文 iframe 不垫底色：背景透明，嵌入件底色透到宿主', () => {
  const css = readFileSync('src/editor/article.module.css', 'utf8');
  const rule = css.match(/:where\(iframe\)\s*\{([^}]*)\}/);
  assert.ok(rule, '找得到正文 iframe 规则');
  const bg = rule[1].match(/background(?:-color)?\s*:\s*([^;]+)/);
  assert.ok(!bg || /^(transparent|none)$/i.test(bg[1].trim()), '背景应透明，实为 ' + (bg && bg[1]));
});
