import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildModel } from '../src/core/model.ts';
import { treeJson } from '../src/core/vault/sitedata.ts';
import { flattenFolders } from '../src/client/settings/larkField.ts';

// 绑定下拉吃的是 tree() 的真实形状：目录节点的 path 是索引页的页 id（无索引页则为
// null），不是文件夹路径——按 path 拼绑定会让 search 前缀永远落空。下拉值必须来自目录
// 节点的库内相对路径 rel；且第一层目录的 displayName 会被索引页标题替换（knowledge
// 区显示「所知」），按 name 拼也必然错。这里用真 buildModel + 真 treeJson 喂。

const tmpVault = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-folders-'));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  for (const a of ['thought', 'anatomy', 'knowledge', 'work']) fs.mkdirSync(path.join(dir, a), { recursive: true });
  fs.mkdirSync(path.join(dir, '.wiki'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.wiki', 'wiki.json'), '{ "version": 1, "parts": { "thought": { "order": 1 }, "anatomy": { "order": 2 }, "knowledge": { "order": 3 }, "work": { "order": 4 } } }');
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), `---\ntitle: ${path.basename(rel, '.md')}\n---\n${body}`) };
  put('knowledge/knowledge.md', '总览');           // 区索引页：displayName 会变成「所知」这类标题
  put('knowledge/ML/grad.md', '梯度下降。');        // ML 文件夹没有索引页：tree 里 path 为 null
  put('knowledge/X/other.md', '别的。');
  return dir;
};

test('flattenFolders：给的是目录的库内相对路径，不是索引页 id、不含 displayName 陷阱', () => {
  const m = buildModel(tmpVault());
  const t = treeJson(m.g, (d) => d._id);
  const folders = flattenFolders(t.children);
  assert.ok(folders.includes('knowledge'), `应含区目录本身：${JSON.stringify(folders)}`);
  assert.ok(folders.includes('knowledge/ML'), `无索引页的文件夹也要能选：${JSON.stringify(folders)}`);
  assert.ok(folders.includes('knowledge/X'));
  assert.ok(!folders.some((f) => f.endsWith('.md')), '不能混进页 id');
  assert.ok(!folders.some((f) => /总览|knowledge\.md/.test(f)), '不能是索引页路径');
})
