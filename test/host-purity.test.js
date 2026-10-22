import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');

test('client/editor 不 import host（host 面隔离）', () => {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(join(SRC, 'client'));
  walk(join(SRC, 'editor'));
  assert.ok(files.length >= 50, `扫到足量文件（${files.length}），别空跑`);
  for (const p of files) {
    for (const imp of readFileSync(p, 'utf8').match(/from\s+['"][^'"]+['"]/g) ?? []) {
      assert.ok(!/\/host(\/|['"])/.test(imp), `${p} 违规 import：${imp}`);
    }
  }
});

test('src 根只许 index.ts、excalidraw-standalone.ts 与目录', () => {
  assert.deepEqual(
    readdirSync(SRC).filter((f) => f.endsWith('.ts')).sort(),
    ['excalidraw-standalone.ts', 'index.ts'],
  );
});
