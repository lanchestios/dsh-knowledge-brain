// test/editor-purity.test.js
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'src', 'editor');

test('src/editor 包纯度：不 import 宿主/平台/node 内建（spec §1 内聚判据）', () => {
  assert.ok(statSync(ROOT).isDirectory(), 'src/editor 存在');
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(ROOT);
  assert.ok(files.length >= 12, `扫到足量文件（${files.length}），别空跑`);
  for (const p of files) {
    for (const imp of readFileSync(p, 'utf8').match(/from\s+['"][^'"]+['"]/g) ?? []) {
      assert.ok(
        !/(\/client|\/core\/|\/core['"]|@deepseek-ai|node:)/.test(imp),
        `${relative(ROOT, p)} 违规 import：${imp}`,
      );
    }
  }
});
