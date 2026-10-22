import type { GraphData, GraphNode } from '../../core/api'
import { palette } from './palette'

type P = GraphNode & { x: number; y: number }

// 本页与一跳邻居（引用边，出入都算），环形布局。返回清理函数。
export function drawLocal(cv: HTMLCanvasElement, g: GraphData, id: string, onOpen: (id: string) => void, onMeta: (s: string) => void) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const me = byId.get(id)
  if (!me) { onMeta(''); return () => {} }
  const out = new Set<string>()
  const inn = new Set<string>()
  for (const e of g.edges) {
    if (e.type !== 'ref') continue
    if (e.s === id) out.add(e.t)
    if (e.t === id) inn.add(e.s)
  }
  const ring: P[] = [...new Set([...out, ...inn])].map((k) => byId.get(k)).filter(Boolean).map((n) => ({ ...n!, x: 0, y: 0 }))
  onMeta(ring.length ? `出 ${out.size} · 入 ${inn.size}` : '还没有和别的页互相引用')

  const c = cv.getContext('2d')!
  let W = 0
  const H = 200
  let hover: P | null = null
  let col = palette(cv)

  function layout() {
    W = cv.clientWidth || 260
    const dpr = window.devicePixelRatio || 1
    cv.width = W * dpr
    cv.height = H * dpr
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    const ry = H / 2 - 26
    const rx = Math.min(W / 2 - 40, ry * 1.6)
    ring.forEach((n, i) => {
      const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2
      n.x = W / 2 + Math.cos(a) * rx
      n.y = H / 2 + Math.sin(a) * ry
    })
  }
  function paint() {
    const cx = W / 2
    const cy = H / 2
    c.clearRect(0, 0, W, H)
    c.lineWidth = 1
    ring.forEach((n) => {
      c.globalAlpha = n === hover ? 1 : 0.4
      c.strokeStyle = n === hover ? col.hl : col.edge
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(n.x, n.y); c.stroke()
    })
    c.globalAlpha = 1
    c.font = '11px -apple-system, sans-serif'
    c.textAlign = 'center'
    ring.forEach((n) => {
      c.fillStyle = col.area(n.area)
      c.beginPath(); c.arc(n.x, n.y, n === hover ? 6 : 4.5, 0, Math.PI * 2); c.fill()
      c.fillStyle = col.text
      c.fillText(n.name.length > 12 ? n.name.slice(0, 11) + '…' : n.name, n.x, n.y + (n.y > cy ? 15 : -9))
    })
    c.fillStyle = col.area(me!.area)
    c.beginPath(); c.arc(cx, cy, 8, 0, Math.PI * 2); c.fill()
    c.fillStyle = col.text
    c.font = '600 12px -apple-system, sans-serif'
    c.fillText(me!.name, cx, cy + 22)
  }
  const pick = (ev: MouseEvent) => {
    const r = cv.getBoundingClientRect()
    const x = ev.clientX - r.left
    const y = ev.clientY - r.top
    let best: P | null = null
    let bd = 144
    ring.forEach((n) => { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = n } })
    return best as P | null
  }
  const move = (ev: MouseEvent) => {
    const h = pick(ev)
    if (h === hover) return
    hover = h
    cv.style.cursor = h ? 'pointer' : ''
    cv.title = h ? (h.crumb ? h.crumb + ' › ' : '') + h.name : ''
    paint()
  }
  const leave = () => { hover = null; paint() }
  const click = (ev: MouseEvent) => { const h = pick(ev); if (h) onOpen(h.id) }
  const theme = () => { col = palette(cv); paint() }
  const ro = new ResizeObserver(() => { layout(); paint() })

  cv.addEventListener('mousemove', move)
  cv.addEventListener('mouseleave', leave)
  cv.addEventListener('click', click)
  window.addEventListener('themechange', theme)
  ro.observe(cv)
  layout()
  paint()
  return () => {
    cv.removeEventListener('mousemove', move)
    cv.removeEventListener('mouseleave', leave)
    cv.removeEventListener('click', click)
    window.removeEventListener('themechange', theme)
    ro.disconnect()
  }
}
