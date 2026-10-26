import type { ComponentType } from 'react'
import type { WikiSettingsProps } from './WikiSettingsCard'
import { WikiSettingsModel, vaultDirField, type SettingsScope } from './model'
import { larkAppsField } from './larkField'
import { mcpServersField } from './mcpField'

// 通过宿主配置服务读写，设置仍注册到 DSH 的「设置 → 插件」。
// 草稿和基础组件由插件维护，不导入宿主表单类或控件。
export function mountWikiSettings(c: any, Card: ComponentType<WikiSettingsProps>) {
  const model = new WikiSettingsModel([vaultDirField, larkAppsField('larkApps'), mcpServersField('mcpServers')])
  c.inject(['configForms'], (cc: any) => {
    cc.effect(() => model.connect(cc.configForms.get('dsh-knowledge-brain') as SettingsScope), 'wiki: settings transport')
    cc.effect(() => cc.configForms.whileServed(['dsh-knowledge-brain'], () => cc.slots.inject('plugins.item', () => cc.slots.register({
      name: 'plugins.item', id: 'dsh-knowledge-brain', order: 50, label: () => '格物致知',
      inject: () => ({ wikiForm: model, edit: model.edit, save: model.save, discard: model.discard }),
    }, Card))), 'wiki: settings entry')
  })
  c.effect(() => () => model.dispose(), 'wiki: settings dispose')
  return model
}
