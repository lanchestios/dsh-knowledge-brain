// Lark问答的机器人归一（纯函数）。配置面是机器人列表（larkApps）：合法的排成
// AppEntry[]，非法的带着原因剔除——通道挂载、设置卡状态、启动日志共用这一份视图。
// Binding 是内部形状：mount 把每个机器人化成一条「兜底绑定」（chatId 恒空）喂给现成的
// service/route 层，那两层不用知道机器人列表的存在。
import { folderText, normFolder } from '../core/folder'

export interface Binding { name: string; folder: string; chatId: string; model: string }

const MODEL = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/ // 'provider/model'

/** 一个机器人 = 一个Lark应用 = 一个文件夹。配置面只有三样：appId、appSecret、folder（model 可空） */
export interface AppEntry { appId: string; appSecret: string; folder: string; model: string }

/** appId → 工具名后缀（ASCII、稳定、唯一；cli_aa00 → cli-aa00）。name 是实现细节，配置面不出现 */
export function nameOf(appId: string): string {
  const s = appId.replace(/[^A-Za-z0-9-]+/g, '-')
  return /^[A-Za-z0-9]/.test(s) ? s : 'app' + s
}

// 机器人列表归一（与 normalizeBindings 同一套「非法剔除并带原因」的口径）。appSecret 的校验
// 只查非空——对错连上Lark才知道，连接失败会打日志并在状态里露出来
export function normalizeApps(raw: unknown): { ok: AppEntry[]; problems: string[] } {
  const ok: AppEntry[] = []
  const problems: string[] = []
  if (raw === undefined || raw === null) return { ok, problems }
  if (!Array.isArray(raw)) return { ok, problems: ['larkApps 不是数组'] }
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) { problems.push(`${String(item)}：不是对象`); continue }
    const appId = String((item as any).appId ?? '').trim()
    if (!appId) { problems.push(`${String((item as any).appId ?? '某行')}：缺 appId`); continue }
    const appSecret = String((item as any).appSecret ?? '').trim()
    const rawFolder = folderText((item as any).folder)
    if (!appSecret) { problems.push(`${appId}：缺 appSecret`); continue }
    if (!rawFolder.trim()) { problems.push(`${appId}：缺 folder`); continue }
    const folder = normFolder(rawFolder)
    if (folder === null) { problems.push(`${appId}：folder 不能含空段、. 或 .. 段`); continue }
    const model = String((item as any).model ?? '')
    if (model && !MODEL.test(model)) { problems.push(`${appId}：model 要写成 provider/model`); continue }
    if (ok.some((a) => a.appId === appId)) { problems.push(`${appId}：同一 app_id 只能配一个机器人`); continue }
    ok.push({ appId, appSecret, folder, model })
  }
  return { ok, problems }
}
