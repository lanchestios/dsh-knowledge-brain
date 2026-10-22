import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    // 组件挂载测试（lark-settings-render）把宿主 primitives 换成本仓最小替身：
    // 它的一串传递依赖（simple-icons / clsx / dsh-util-*）装不进本仓，且与本测无关
    alias: { '@deepseek-ai/dsh-client-ui-primitives': new URL('./test/stubs/dsh-primitives.js', import.meta.url).pathname },
  },
})
