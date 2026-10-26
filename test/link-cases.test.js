import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildModel } from '../src/core/model.ts';
import { resolveName, deadInfo, nodePath } from '../src/core/vault/graph.ts';

// 与 vault-tools/tests/test_links.py 共用一份用例：两边解析必须一致
const CASES = JSON.parse(fs.readFileSync(new URL('../vault-tools/tests/link_cases.json', import.meta.url), 'utf8'));

test('共享用例：路径 / 裸名 / 别名 / 歧义 / 沉淀区外 / 不存在', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-cases-'));
  try {
    fs.mkdirSync(path.join(dir, '.wiki'));
    for (const spec of CASES.pages) {
      const i = spec.indexOf('=');
      const rel = i === -1 ? spec : spec.slice(0, i);
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, i === -1 ? `---\ntitle: ${path.basename(rel, '.md')}\n---\n` : spec.slice(i + 1));
    }
    const m = buildModel(dir);
    const pathOf = (d) => nodePath(m.g.nodeOf.get(d._id));
    for (const [target, state, value] of CASES.cases) {
      const d = resolveName(m.g, target);
      if (state === 'ok') { assert.equal(d && pathOf(d), value, target); continue }
      assert.equal(d, null, target);
      const info = deadInfo(m.g, m.raws, target);
      const want = { ambiguous: 'ambiguous', outside: 'unpublished', missing: 'missing' }[state];
      assert.equal(info.reason, want, target);
      if (state === 'ambiguous') assert.deepEqual(info.candidates.map(pathOf).sort(), value, target);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
});
