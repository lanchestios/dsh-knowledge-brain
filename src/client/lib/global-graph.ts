import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force'
import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom'
import { select, pointer } from 'd3-selection'
import 'd3-transition'
import type { GraphData, GraphNode } from '../../core/api'
import { palette } from './palette'

// d3 会往节点上写 index（数组下标），覆盖 graph.json 的布尔 index，克隆时挪到 isIndex
type N = Omit<GraphNode, 'index'> & SimulationNodeDatum & { isIndex: boolean }
type E = SimulationLinkDatum<N> & { source: N; target: N; type: 'ref' | 'tree' }

/** 上一次的节点坐标与镜头：改库后重建时沿用，布局与缩放不跳 */
export interface Snapshot { pos: Map<string, { x: number; y: number }>; t: ZoomTransform }

// 布局用全部边（层级边让同一棵子树聚在一起），绘制只画引用边
export function runGraph(cv: HTMLCanvasElement, wrap: HTMLElement, tip: HTMLElement, data: GraphData, onOpen: (id: string) => void, prev?: Snapshot) {
  let W = 0
  let H = 0
  const dpr = window.devicePixelRatio || 1
  const c = cv.getContext('2d')!
  function size() {
    W = wrap.clientWidth
    H = wrap.clientHeight
    cv.width = W * dpr
    cv.height = H * dpr
    cv.style.width = W + 'px'
    cv.style.height = H + 'px'
  }
  size()

  const nodes: N[] = data.nodes.map(({ index, ...n }) => ({ ...n, isIndex: index, ...prev?.pos.get(n.id) }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges: E[] = data.edges
    .filter((e) => byId.has(e.s) && byId.has(e.t))
    .map((e) => ({ source: byId.get(e.s)!, target: byId.get(e.t)!, type: e.type }))
  const radius = (n: N) => 3 + Math.sqrt(n.indeg) * 1.8
  const state: { hover: N | null; focus: N | null; t: ZoomTransform } = { hover: null, focus: null, t: prev?.t ?? zoomIdentity }
  let col = palette(cv)

  const neighbors = (n: N) => {
    const s = new Set([n])
    for (const e of edges) {
      if (e.type !== 'ref') continue
      if (e.source === n) s.add(e.target)
      if (e.target === n) s.add(e.source)
    }
    return s
  }

  function paint() {
    const t = state.t
    const hl = state.hover || state.focus
    const near = hl ? neighbors(hl) : null
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, W, H)
    c.save()
    c.translate(t.x, t.y)
    c.scale(t.k, t.k)
    for (const e of edges) {
      if (e.type !== 'ref') continue
      const on = !!hl && (e.source === hl || e.target === hl)
      c.globalAlpha = hl && !on ? 0.08 : on ? 0.9 : 0.3
      c.strokeStyle = on ? col.hl : col.edge
      c.lineWidth = (on ? 1.6 : 0.8) / t.k
      c.beginPath()
      c.moveTo(e.source.x!, e.source.y!)
      c.lineTo(e.target.x!, e.target.y!)
      c.stroke()
    }
    c.textAlign = 'center'
    c.font = 11 / t.k + 'px -apple-system, sans-serif'
    for (const n of nodes) {
      c.globalAlpha = near && !near.has(n) ? 0.18 : 1
      c.fillStyle = col.area(n.area)
      const r = radius(n)
      c.beginPath()
      if (n.isIndex) c.rect(n.x! - r, n.y! - r, r * 2, r * 2)
      else c.arc(n.x!, n.y!, r, 0, Math.PI * 2)
      c.fill()
      if (r * t.k >= 7 || (near && near.has(n))) {
        c.fillStyle = col.text
        c.fillText(n.name, n.x!, n.y! - r - 3 / t.k)
      }
    }
    c.restore()
    c.globalAlpha = 1
  }

  const sim = forceSimulation<N>(nodes)
    .force('link', forceLink<N, E>(edges).distance((e) => (e.type === 'tree' ? 30 : 60)).strength((e) => (e.type === 'tree' ? 0.6 : 0.15)))
    .force('charge', forceManyBody().strength(-45))
    .force('center', forceCenter(W / 2, H / 2))
    .force('collide', forceCollide<N>((n) => radius(n) + 2))
    .on('tick', paint)
  if (prev) sim.alpha(0.3)

  const zoom = d3zoom<HTMLCanvasElement, unknown>().scaleExtent([0.2, 6]).on('zoom', (ev) => { state.t = ev.transform; paint() })
  const sel = select(cv)
  sel.call(zoom)
  if (prev) sel.call(zoom.transform, prev.t)

  const at = (ev: MouseEvent) => {
    const [x, y] = state.t.invert(pointer(ev, cv))
    return sim.find(x, y, 14 / state.t.k) ?? null
  }
  const move = (ev: MouseEvent) => {
    const n = at(ev)
    if (n !== state.hover) { state.hover = n; cv.style.cursor = n ? 'pointer' : 'grab'; paint() }
    if (!n) { tip.hidden = true; return }
    tip.hidden = false
    tip.textContent = `${n.name}${n.crumb ? ' · ' + n.crumb : ''} · 入 ${n.indeg} / 出 ${n.outdeg}`
    const [px, py] = pointer(ev, wrap)
    tip.style.left = Math.min(px + 12, W - 260) + 'px'
    tip.style.top = py + 12 + 'px'
  }
  const leave = () => { state.hover = null; tip.hidden = true; paint() }
  // d3-zoom v7 会吞掉拖动松手后紧随的 click，拖完不会误触发
  const click = (ev: MouseEvent) => { const n = at(ev); if (n) onOpen(n.id) }
  const theme = () => { col = palette(cv); paint() }
  cv.addEventListener('mousemove', move)
  cv.addEventListener('mouseleave', leave)
  cv.addEventListener('click', click)
  window.addEventListener('themechange', theme)
  // 收放侧栏、拖分隔条、改窗口大小时画布跟着变，镜头不动
  const ro = new ResizeObserver(() => { size(); paint() })
  ro.observe(wrap)

  // 首次降温后把全图缩进画布；已有定位目标（从局部图进来）或沿用旧镜头时不抢
  if (!prev) sim.on('tick.fit', () => {
    if (sim.alpha() >= 0.1) return
    sim.on('tick.fit', null)
    if (state.focus) return
    const xs = nodes.map((n) => n.x!)
    const ys = nodes.map((n) => n.y!)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const k = Math.max(0.2, Math.min(1.5, 0.9 * Math.min(W / (x1 - x0 || 1), H / (y1 - y0 || 1))))
    sel.transition().duration(400).call(zoom.transform, zoomIdentity.translate(W / 2 - ((x0 + x1) / 2) * k, H / 2 - ((y0 + y1) / 2) * k).scale(k))
  })

  function fly(id: string) {
    const n = byId.get(id)
    if (!n) return
    const go = () => {
      state.focus = n
      const k = 2
      sel.transition().duration(500).call(zoom.transform, zoomIdentity.translate(W / 2 - n.x! * k, H / 2 - n.y! * k).scale(k))
    }
    // 布局还没稳时坐标会跑，等降温到 0.1 以下再飞
    if (sim.alpha() < 0.1) go()
    else sim.on('tick.fly', () => { if (sim.alpha() < 0.1) { sim.on('tick.fly', null); go() } })
  }

  return {
    fly,
    snapshot: (): Snapshot => ({ pos: new Map(nodes.map((n) => [n.id, { x: n.x!, y: n.y! }])), t: state.t }),
    destroy() {
      ro.disconnect()
      sim.stop()
      sel.on('.zoom', null)
      cv.removeEventListener('mousemove', move)
      cv.removeEventListener('mouseleave', leave)
      cv.removeEventListener('click', click)
      window.removeEventListener('themechange', theme)
    },
  }
}
