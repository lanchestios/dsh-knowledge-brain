import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// macOS 桌面、左栏收起：左栏整列收没、主区顶到窗口 x=0，DSH 把红绿灯和
// shell.leading 两个悬浮按钮盖在主区左上角，同时发布 --dsh-frame-leading-clearance
// （AppFrame.module.css）让「顶到左上角的主面板」自己让位。顶栏必须消费它，
// 否则面包屑压在悬浮按钮底下（写法对齐宿主 Modal.module.css 的
// max(下限, var(…, 0px))）。其余平台/展开态变量未定义，落回 12px 原样。
test('顶栏左内边距消费宿主的悬浮 chrome 让位变量', () => {
  const css = readFileSync(path.resolve('src/client/components/TopBar.module.css'), 'utf8');
  const bar = css.match(/\.bar\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(bar, /padding-left:\s*max\(12px,\s*var\(--dsh-frame-leading-clearance,\s*0px\)\)/);
});

// 多 tab 接管「回到来处」：顶栏后退/前进、⌘⌥[] 快捷键、readerCommands 的 back/forward 槽一并退场
test('后退前进退场：按钮、快捷键、命令槽都撤', () => {
  const bar = readFileSync(path.resolve('src/client/components/TopBar.tsx'), 'utf8');
  assert.ok(!bar.includes('aria-label="后退"'));
  assert.ok(!bar.includes('aria-label="前进"'));
  const sc = readFileSync(path.resolve('src/client/shortcuts.ts'), 'utf8');
  assert.ok(!sc.includes('dsh-knowledge-brain.back'));
  assert.ok(!sc.includes('dsh-knowledge-brain.forward'));
  const cmd = readFileSync(path.resolve('src/client/reader/commands.ts'), 'utf8');
  assert.ok(!cmd.includes('back?'));
  assert.ok(!cmd.includes('forward?'));
});



// 图谱视图改为正文位开关（2026-10-20 用户裁定）：顶栏按钮不再跳独立的 graph 路由，
// 点开把当前页正文位换成该页局部图谱、再点收回；正文 hidden 保活（关掉回到原滚动位置）。
// 全局图仍从局部图谱「在全局图里看 →」进（graph 路由照旧）
test('图谱视图开关：按钮带 aria-pressed 不再跳 graph 路由；正文保活换层', () => {
  const bar = readFileSync(path.resolve('src/client/components/TopBar.tsx'), 'utf8');
  assert.match(bar, /aria-pressed=\{gOn\}/, '按钮是开关（pressed 态）');
  assert.ok(!bar.includes("go({ kind: 'graph' })"), '顶栏不再有跳 graph 路由的形态');
  assert.match(bar, /\{!explore && \(/, '所有沉淀区路由统一给开关（首页 / 知识页同交互）');
  const rp = readFileSync(path.resolve('src/client/reader/ReaderPage.tsx'), 'utf8');
  assert.match(rp, /hidden=\{graphOn\}/, '开着图谱时正文 hidden 藏（保活不卸载）');
  assert.match(rp, /LocalGraphPane/, '正文位渲染局部图谱');
  const lg = readFileSync(path.resolve('src/client/components/LocalGraphPane.tsx'), 'utf8');
  assert.ok(!lg.includes('PagePicker'), '局部图谱不带选页器');
  assert.match(lg, /runGraph/, '局部图谱用全局图同一交互引擎（缩放平移），不是静态小图');
  assert.match(lg, /r\.fly\(id\)/, '打开即飞到当前页');
  const panel = readFileSync(path.resolve('src/client/reader/panel.ts'), 'utf8');
  assert.match(panel, /graph: box\(false\)/, '面板带图谱开关盒，起手关');
});


// 首页（无当前页）的图谱开关：内容位换全局图（GraphView embedded——不带返回钮，返回由顶栏开关承担）
test('图谱开关统一：非页路由换全局图，embedded 不带返回钮', () => {
  const rp = readFileSync(path.resolve('src/client/reader/ReaderPage.tsx'), 'utf8');
  assert.match(rp, /<GraphView embedded \/>/, '非页路由内容位渲染全局图（嵌入态）');
  const gv = readFileSync(path.resolve('src/client/components/GraphView.tsx'), 'utf8');
  assert.match(gv, /!embedded &&/, '嵌入态藏返回钮');
  assert.match(gv, /className=\{s\.bar\} hidden=\{embedded\}/, '嵌入态藏「定位到页」那一行');
});


// 选页器（定位到页）全撤（2026-10-20 用户裁定）：开关视图与独立全局图页都不带——
// 开关跟着当前页走，独立页有目录树可达，图内定位靠飞入的 focus
test('全局图页不再带选页器', () => {
  const gv = readFileSync(path.resolve('src/client/components/GraphView.tsx'), 'utf8');
  assert.ok(!gv.includes('PagePicker'), 'GraphView 不再用 PagePicker');
});
