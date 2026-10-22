import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAgents, presetFor, presetId, parseSkillList } from '../src/host/agents.ts';
import { vaultTools } from '../src/host/pkg.ts';

// 0.2.1 起子 agent 的人设与工具走 Agent Preset：tool-subagent 再收 persona / toolFilter 会在加载时抛迁移错误。
// 这里校验包内四个 agent 定义翻成 preset 后，每个只拿到 frontmatter tools 声明的那几样工具插件。

const agents = readAgents((m) => { throw new Error(m) });
const byName = Object.fromEntries(agents.map((a) => [a.name, a]));
const plugins = (name) => presetFor(byName[name]).plugins;
const names = (name) => plugins(name).filter((r) => !r.disabled).map((r) => r.name).sort();
const fs = (name) => plugins(name).find((r) => r.id === 'tool-fs')?.config;

test('读写两路五个 agent 都读得出来，工具名与 preset id 稳定', () => {
  assert.deepEqual(agents.map((a) => a.toolName), ['wiki_read', 'wiki_write_draft', 'wiki_write_explore', 'wiki_write_humanize', 'wiki_write_review']);
  assert.equal(presetId(byName['wiki-write-review']), 'dsh-knowledge-brain.wiki-write-review');
});

test('humanize 只有 read + edit，没有 search / bash / web', () => {
  assert.deepEqual(names('wiki-write-humanize'), ['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-fs']);
  assert.deepEqual(fs('wiki-write-humanize'), { read: true, readImage: false, write: false, edit: true });
});

test('review 多 grep / glob，仍不能 write、不能 bash', () => {
  assert.deepEqual(names('wiki-write-review'), ['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-fs', '@deepseek-ai/dsh-tool-fs-search']);
  assert.equal(fs('wiki-write-review').write, false);
});

test('explore 拿到 web 两件但没有 edit；bash 按平台二选一', () => {
  const rows = plugins('wiki-write-explore');
  assert.deepEqual(rows.find((r) => r.id === 'tool-web').config, { search: true, fetch: true });
  assert.equal(fs('wiki-write-explore').edit, false);
  const shells = rows.filter((r) => r.id === 'tool-bash' || r.id === 'tool-pwsh');
  assert.equal(shells.length, 2);
  assert.equal(shells.filter((r) => !r.disabled).length, 1);
});

test('write 不联网', () => {
  assert.ok(!plugins('wiki-write-draft').some((r) => r.id === 'tool-web'));
});

test('人设里点名同名技能的绝对路径，且路径真实存在', () => {
  for (const a of agents) {
    const m = a.persona.match(/预载技能 \S+ 的全文在 (\S+SKILL\.md)/);
    assert.ok(m, `${a.name} 人设没点名技能路径`);
    assert.ok(existsSync(m[1]), `${a.name} 的技能路径不存在：${m[1]}`);
  }
});

test('人设里没有 {{ }}：dsh-persona 渲染时会把它当提示词变量严格解析', () => {
  for (const a of agents) assert.ok(!a.persona.includes('{{'), a.name);
});

// skills: 字段——agent 只写工具边界，规则由 skills 列出的技能预载（Claude Code 同名字段）
const mk = (files) => { const d = mkdtempSync(join(tmpdir(), 'agents-')); for (const [f, t] of Object.entries(files)) writeFileSync(join(d, f), t); return d };
const fmx = (skills) => `---\nname: x\ndescription: d\ntools: Read\n${skills}\n---\n正文`;

test('parseSkillList：逗号串与数组同解，去空白、空项、重复', () => {
  assert.deepEqual(parseSkillList('wiki-read, wiki,, wiki'), ['wiki-read', 'wiki']);
  assert.deepEqual(parseSkillList(['wiki-read', ' wiki ']), ['wiki-read', 'wiki']);
  assert.deepEqual(parseSkillList(undefined), []);
});

test('skills: 逐个写进 persona，路径真实存在', () => {
  const [a] = readAgents((m) => { throw new Error(m) }, mk({ 'x.md': fmx('skills: [wiki, wiki]') }));
  assert.deepEqual(a.skills, ['wiki']);
  const paths = [...a.persona.matchAll(/预载技能 (\S+) 的全文在 (\S+SKILL\.md)/g)];
  assert.deepEqual(paths.map((m) => m[1]), ['wiki']);
  for (const m of paths) assert.ok(existsSync(m[2]), m[2]);
});

test('skills: 块列表写法也认', () => {
  const [a] = readAgents((m) => { throw new Error(m) }, mk({ 'x.md': fmx('skills:\n  - wiki') }));
  assert.deepEqual(a.skills, ['wiki']);
});

test('skills: 列了不存在的技能：warn 并跳过，其余照挂', () => {
  const warns = [];
  const [a] = readAgents((m) => warns.push(m), mk({ 'x.md': fmx('skills: nope, wiki') }));
  assert.deepEqual(a.skills, ['wiki']);
  assert.equal(warns.length, 1); assert.match(warns[0], /nope/);
});

test('wiki-read：只有 read + grep/glob，不能写、不能 bash、不联网；只预载 wiki-read（区判据自带，不背 wiki 库务）', () => {
  assert.deepEqual(names('wiki-read'), ['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-fs', '@deepseek-ai/dsh-tool-fs-search']);
  assert.deepEqual(fs('wiki-read'), { read: true, readImage: false, write: false, edit: false });
  assert.deepEqual(byName['wiki-read'].skills, ['wiki-read']);
  assert.equal(byName['wiki-read'].toolName, 'wiki_read');
});

test('wiki-read 技能点名五区门面的「怎么读」、写明 Lark 不派 agent、上下文包有「没找到」、不用 wiki_raw', () => {
  const s = readFileSync(vaultTools('skills', 'wiki-read', 'SKILL.md'), 'utf8');
  for (const z of ['经历', '认知', '学习', '知识', '系统']) assert.ok(s.includes(`${z}/${z}.md`), z);
  assert.match(s, /## 怎么读/);
  assert.match(s, /### 没找到/);
  assert.match(s, /Lark[^\n]*不派/);
  assert.match(s, /不用 `wiki_raw`/);
});
