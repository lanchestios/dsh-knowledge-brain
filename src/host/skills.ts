import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { vaultTools } from './pkg'
import type { Hub } from '../core/hub'

// 包内 vault-tools/skills 以子插件挂成一个独立的 skill provider（名 wiki），直接挂包内源：
// 库里只有本地状态（.wiki/wiki.json 等），技能文件不落库、也不依赖任何软链存在
export function mountSkills(ctx: Context, hub: Hub) {
  ctx.inject(['skills'] as any, (c: Context) => {
    let fiber: any = null
    let mounted = ''
    const sync = async () => {
      const dir = hub.engine.model ? vaultTools('skills') : ''
      const want = dir && existsSync(dir) ? dir : ''
      if (want === mounted) return
      mounted = want
      if (fiber) { const f = fiber; fiber = null; await f.dispose() }
      if (want) fiber = c.plugin(SkillFilesystem as any, { providerName: 'wiki', includeDefaultRoots: false, customSkillDirs: [want] })
    }
    // 串行：上一次卸载没完就开始下一次，会挂出两份同名 provider
    let chain = Promise.resolve()
    const queue = () => { chain = chain.then(sync).catch((e) => console.error('[dsh-knowledge-brain] skill 同步失败', e)) }
    queue()
    c.effect(() => hub.onChanged((ev) => { if (ev.kind === 'tools' || ev.kind === 'structural') queue() }), 'dsh-knowledge-brain.skills')
    c.effect(() => () => { Promise.resolve(fiber?.dispose()).catch(() => {}) }, 'dsh-knowledge-brain.skills.dispose')
  })
}
