import { useState, useEffect, useRef, useCallback } from 'react'

interface ClickEvent {
  x: number
  y: number
  selector: string
  description?: string
  taskId: string
  personaName: string
  variant: 'A' | 'B'
  subAgentType: string
  success: boolean
  timestamp: number
}

const TASKS = ['create-account', 'find-pricing', 'learn-about-company']
const TASK_LABELS: Record<string, string> = {
  'create-account': 'Create Account',
  'find-pricing': 'Find Pricing',
  'learn-about-company': 'Explore Company',
}
const PERSONAS = ['Alex', 'Morgan', 'Jamie', 'Jordan', 'Dana']
const RADIUS = 40
const LABEL_THRESHOLD = 0.35  // min relative density to show a label
const MAX_LABELS = 10

// ── Canvas drawing ────────────────────────────────────────────────────────────

function drawHeatmap(canvas: HTMLCanvasElement, clicks: ClickEvent[]) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  if (clicks.length === 0) return

  // 1. Build density buffer
  const density = new Float32Array(w * h)
  for (const click of clicks) {
    const cx = click.x * w
    const cy = click.y * h
    const x0 = Math.max(0, Math.floor(cx - RADIUS))
    const x1 = Math.min(w - 1, Math.ceil(cx + RADIUS))
    const y0 = Math.max(0, Math.floor(cy - RADIUS))
    const y1 = Math.min(h - 1, Math.ceil(cy + RADIUS))
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
        if (d < RADIUS) density[py * w + px] += (1 - d / RADIUS) ** 2
      }
    }
  }

  let maxD = 0
  for (let i = 0; i < density.length; i++) if (density[i] > maxD) maxD = density[i]
  if (maxD === 0) return

  // 2. Color-map density → pixels
  const img = ctx.createImageData(w, h)
  const d = img.data
  for (let i = 0; i < density.length; i++) {
    const t = density[i] / maxD
    if (t < 0.02) continue
    let r = 0, g = 0, b = 0, a = 0
    if (t < 0.33) {
      const s = t / 0.33
      r = 0; g = 0; b = 200; a = Math.round(s * 160)
    } else if (t < 0.66) {
      const s = (t - 0.33) / 0.33
      r = Math.round(s * 255); g = Math.round(s * 200); b = Math.round((1 - s) * 200); a = 185
    } else {
      const s = (t - 0.66) / 0.34
      r = 255; g = Math.round((1 - s) * 200); b = 0; a = Math.round(185 + s * 55)
    }
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a
  }
  ctx.putImageData(img, 0, 0)

  // 3. Labels — group clicks by selector+description, rank by local density
  const groups = new Map<string, { cx: number; cy: number; label: string; localD: number; count: number }>()
  for (const click of clicks) {
    const label = click.description ?? click.selector
    const key = `${click.selector}::${Math.round(click.x * 20)}:${Math.round(click.y * 20)}`
    if (!groups.has(key)) {
      const px = Math.round(click.x * w)
      const py = Math.round(click.y * h)
      const localD = density[py * w + px] ?? 0
      groups.set(key, { cx: click.x * w, cy: click.y * h, label, localD, count: 0 })
    }
    groups.get(key)!.count++
  }

  const candidates = [...groups.values()]
    .filter(g => g.localD / maxD >= LABEL_THRESHOLD)
    .sort((a, b) => b.localD - a.localD)
    .slice(0, MAX_LABELS)

  for (const { cx, cy, label } of candidates) {
    const text = label.length > 22 ? label.slice(0, 19) + '…' : label
    ctx.font = '10px system-ui, sans-serif'
    const tw = ctx.measureText(text).width
    const pad = 3
    const bx = Math.min(cx + 6, w - tw - pad * 2 - 2)
    const by = cy - 10 < pad ? cy + 6 : cy - 18

    ctx.fillStyle = 'rgba(255,255,255,0.82)'
    ctx.fillRect(bx - pad, by - pad, tw + pad * 2, 14 + pad)

    ctx.fillStyle = '#111'
    ctx.fillText(text, bx, by + 10)
  }
}

// ── Panel component ───────────────────────────────────────────────────────────

function VariantPanel({ variant, clicks }: { variant: 'A' | 'B'; clicks: ClickEvent[] }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const accentClass = variant === 'A' ? 'text-a' : 'text-b'
  const src = `/screenshots/variant-${variant.toLowerCase()}-full.png`

  const syncAndDraw = useCallback(() => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas || img.naturalWidth === 0) return
    // Match canvas pixel dimensions to the image's rendered dimensions
    canvas.width = img.clientWidth
    canvas.height = img.clientHeight
    drawHeatmap(canvas, clicks)
  }, [clicks])

  // Redraw whenever clicks change or image loads
  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    if (img.complete && img.naturalWidth > 0) {
      syncAndDraw()
    } else {
      img.addEventListener('load', syncAndDraw, { once: true })
      return () => img.removeEventListener('load', syncAndDraw)
    }
  }, [syncAndDraw])

  // Keep canvas in sync if the panel resizes (e.g. window resize)
  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    const ro = new ResizeObserver(syncAndDraw)
    ro.observe(img)
    return () => ro.disconnect()
  }, [syncAndDraw])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-xs font-semibold uppercase tracking-label ${accentClass}`}>
          Variant {variant}
        </span>
        <span className="text-xs text-ink-4 font-mono">{clicks.length} clicks</span>
      </div>
      <div style={{ position: 'relative' }}>
        <img
          ref={imgRef}
          src={src}
          alt={`Variant ${variant} full-page screenshot`}
          style={{ display: 'block', width: '100%', height: 'auto' }}
          onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3' }}
        />
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        />
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function HeatmapPanel() {
  const [task, setTask] = useState('all')
  const [persona, setPersona] = useState('all')
  const [successFilter, setSuccessFilter] = useState<'all' | 'success' | 'fail'>('all')
  const [clicksA, setClicksA] = useState<ClickEvent[]>([])
  const [clicksB, setClicksB] = useState<ClickEvent[]>([])

  const fetchClicks = useCallback(async () => {
    const params = new URLSearchParams()
    if (task !== 'all') params.set('task', task)
    if (persona !== 'all') params.set('persona', persona)

    const [rawA, rawB] = await Promise.all([
      fetch(`/api/heatmap?variant=A&${params}`).then(r => r.json()).catch(() => []),
      fetch(`/api/heatmap?variant=B&${params}`).then(r => r.json()).catch(() => []),
    ])

    const applySuccess = (events: ClickEvent[]) => {
      if (successFilter === 'all') return events
      return events.filter(e => successFilter === 'success' ? e.success : !e.success)
    }

    setClicksA(applySuccess(rawA))
    setClicksB(applySuccess(rawB))
  }, [task, persona, successFilter])

  useEffect(() => { fetchClicks() }, [fetchClicks])

  const selectCls = 'border border-rule bg-paper text-ink text-xs px-2 py-1 font-mono focus:outline-none'

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-6 mb-8 flex-wrap">
        <label className="flex items-center gap-2 text-xs text-ink-2 uppercase tracking-label font-semibold">
          Task
          <select value={task} onChange={e => setTask(e.target.value)} className={selectCls}>
            <option value="all">All tasks</option>
            {TASKS.map(t => <option key={t} value={t}>{TASK_LABELS[t]}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-ink-2 uppercase tracking-label font-semibold">
          Persona
          <select value={persona} onChange={e => setPersona(e.target.value)} className={selectCls}>
            <option value="all">All personas</option>
            {PERSONAS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-ink-2 uppercase tracking-label font-semibold">
          Sessions
          <select value={successFilter} onChange={e => setSuccessFilter(e.target.value as 'all' | 'success' | 'fail')} className={selectCls}>
            <option value="all">All sessions</option>
            <option value="success">Successful only</option>
            <option value="fail">Failed only</option>
          </select>
        </label>

        <span className="text-xs text-ink-4 font-mono ml-auto">
          {clicksA.length + clicksB.length} click events
        </span>
      </div>

      {/* Side-by-side panels */}
      <div className="grid grid-cols-2 gap-8">
        <VariantPanel variant="A" clicks={clicksA} />
        <VariantPanel variant="B" clicks={clicksB} />
      </div>

      {/* Legend */}
      <div className="mt-6 flex items-center gap-3">
        <span className="text-[10px] text-ink-4 uppercase tracking-label font-semibold">Density</span>
        <div
          className="h-3 w-48 flex-shrink-0"
          style={{ background: 'linear-gradient(to right, rgba(0,0,200,0.3), rgba(128,140,200,0.73), rgba(255,200,0,0.9), rgba(255,0,0,1))' }}
        />
        <div className="flex justify-between w-48 text-[10px] text-ink-4 font-mono">
          <span>low</span>
          <span>high</span>
        </div>
      </div>
    </div>
  )
}
