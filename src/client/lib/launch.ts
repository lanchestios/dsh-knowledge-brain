import type { Book, Document, HomeData } from '../../core/api'

// 空库引导：判定「库还是空的」+ 开场白。引导知识在技能层（wiki 技能的「上手」场景，
// vault-tools/skills/wiki/onboarding.md）。空库首页不自动开右栏；启动台的入口卡是场景按钮
// （sessions.openScene）：点了新开一场右栏会话，这一步的话直接发出去。

/** 开场白：一句自然话（不是命令），靠常驻 wiki 技能接住，带新人走完第一个闭环（学一篇 / 读一本书 / 记一场会议） */
export const START_SAY = '今天要往库里收什么？一篇文章、一本书、一场会议，或者一个想写的主题。'

/** 第一步的三件事：页上可点（Launchpad、会话欢迎页 hero 快捷 chips 共用一份）。
 *  say 是点选后搭好的话，以冒号收尾：启动台点了直接发（助手接着问链接 / 书名 / 主题）；
 *  hero chips 在已开的空白会话里只填不发，等人补上 */
export const FIRST_STEPS = [
  { name: '学一篇文章', hint: '贴链接，抓取归档再沉淀', say: '/wiki 我想放一篇文章进来：你抓取归档到素材库，归档好了再问我要不要当场沉淀成一页知识。链接：' },
  { name: '读一本书', hint: 'epub / azw3 / pdf，拆好章节', say: '/wiki 我想放一本书：建进度页、拆好章节，我稍后把 epub / azw3 / pdf 文件放进书目录。书名：' },
  { name: '记一场会议', hint: '听录/纪要在手，落成观察页', say: '/wiki 我想沉淀一次会议：手里有听录或纪要，帮我按观察文档的流程整理成经历区的一页，时间、结论、待办都要留。素材在：' },
] as const

/** 「眼看着从空变不空」：只有空库在人眼前长出第一页这一瞬为真——落成交接动画的闸门。
 *  一上来就有内容（进别人的库）、清库变空，都不演 */
export function becameNonEmpty(prev: HomeData | null | undefined, next: HomeData | null | undefined): boolean {
  return homeEmpty(prev) && !!next && !homeEmpty(next)
}

/** 沉淀看板空库 = 四区一页都没有；home 还没加载完不算（否则加载一瞬闪启动台） */
export function homeEmpty(home: HomeData | null | undefined): boolean {
  return !!home && home.stats.total === 0
}

/** 探索区空 = 书与文档双空；任一没加载完不算 */
export function exploreEmpty(books: Book[] | null | undefined, documents: Document[] | null | undefined): boolean {
  return !!books && !!documents && books.length === 0 && documents.length === 0
}

