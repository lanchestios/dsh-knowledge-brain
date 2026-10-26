// 最小的假文档：只带 lib/ 读到的字段，形状照 Hexo：
// source = _posts/<知识库路径>，path = permalink `:title/` 生成的站内路径。
function doc(vaultPath, body, extra) {
  return Object.assign({
    _id: vaultPath,
    source: '_posts/' + vaultPath,
    path: vaultPath.replace(/\.md$/, '/'),
    title: vaultPath.split('/').pop().replace(/\.md$/, ''),
    description: '',
    _content: body || '',
    raw: '---\ntitle: x\n---\n' + (body || ''),
    created: '2026-09-10',
  }, extra || {});
}

// 一个小知识库：四个区、一条有导览专节的线、一个同名歧义、一个库外目标
function sample() {
  const posts = [
    doc('thought/thought.md', '', { title: '认知' }),
    doc('anatomy/anatomy.md', '', { title: '学习' }),
    doc('knowledge/knowledge.md', '', { title: '所知' }),
    doc('work/work.md', '', { title: '所为' }),
    doc('knowledge/ML/ML.md',
      '| [[C]] | 总览表先提到 C |\n\n## 读的顺序\n\n先读 [[A]]、[[B]]，再读 [[C]]。\n\n## 边界\n\n见 [[A]]。\n'),
    doc('knowledge/ML/A.md', '被最小化的 [[B]] 长什么样。'),
    doc('knowledge/ML/B.md', '回到 [[A]]。\n```\n[[围栏里不算]]\n```\n行内 `[[也不算]]`'),
    doc('knowledge/ML/C/C.md', ''),
    doc('knowledge/ML/D.md', '', { created: '2026-09-01' }),
    doc('knowledge/X/X.md', '[[C]] 与 [[项目]]，还有 [[书]] 和 [[书]]。'),
    doc('knowledge/X/Acme 客服系统.md', '见 [[A]]。'),
    doc('work/p1/p1.md', ''),
    doc('work/p1/项目/项目.md', ''),
    doc('work/p2/p2.md', ''),
    doc('work/p2/项目/项目.md', ''),
  ];
  return { posts, pages: [], areas: ['thought', 'anatomy', 'knowledge', 'work'] };
}

export { doc, sample };
