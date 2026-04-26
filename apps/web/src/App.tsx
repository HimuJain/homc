import { useState, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type SubAgentType = 'A_00' | 'A_10' | 'A_11' | 'A_12'
const SA_TYPES: SubAgentType[] = ['A_00', 'A_10', 'A_11', 'A_12']

interface VariantStats {
  runs: number
  successRate: number
  avgCompletionTimeMs: number
  avgStepCount: number
  avgClickCount: number
  topFrictionPoints: string[]
}

interface PersonaResult {
  personaName: string
  variantA: { success: boolean; successScore: number; steps: number; timeMs: number; taskDrift: string } | null
  variantB: { success: boolean; successScore: number; steps: number; timeMs: number; taskDrift: string } | null
}

interface TaskStats {
  taskId: string
  taskGoal: string
  A: VariantStats
  B: VariantStats
  personaResults: PersonaResult[]
  winner: 'A' | 'B' | 'tie' | null
}

interface SubAgentResult {
  subAgentType: SubAgentType
  weight: number
  variantA: { successScore: number; steps: number; timeMs: number; taskDrift: string } | null
  variantB: { successScore: number; steps: number; timeMs: number; taskDrift: string } | null
  weightedScore: { A: number; B: number }
}

interface PersonaWeightedScore {
  personaName: string
  groupWeight: number
  subAgents: SubAgentResult[]
  weightedPersonaScore: { A: number; B: number }
}

interface PopulationModel {
  personaScores: PersonaWeightedScore[]
  overallScore: { A: number; B: number }
  winner: 'A' | 'B' | 'tie' | null
}

interface Summary {
  runCount: number
  lastUpdated: number
  variants: { A: VariantStats; B: VariantStats }
  personaResults: PersonaResult[]
  winner: 'A' | 'B' | 'tie' | null
  tasks: Record<string, TaskStats>
  populationModel?: PopulationModel
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_LABELS: Record<string, string> = {
  'create-account': 'Create Account',
  'find-pricing': 'Find Pricing',
  'learn-about-company': 'Explore Company',
}

const SA_LABELS: Record<SubAgentType, string> = {
  A_00: 'Focused',
  A_10: 'Distracted (returns)',
  A_11: 'Blended goals',
  A_12: 'Fully distracted',
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function pct(v: number) { return `${Math.round(v * 100)}%` }
function pKey(personaName: string) { return personaName.split(' ')[0] }

// ─── Geometric Decorators ─────────────────────────────────────────────────────

function DotGrid({ rows = 3, cols = 5, gap = 10, r = 1.5 }: { rows?: number; cols?: number; gap?: number; r?: number }) {
  const w = (cols - 1) * gap + r * 4
  const h = (rows - 1) * gap + r * 4
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, col) => (
          <circle
            key={`${row}-${col}`}
            cx={col * gap + r * 2}
            cy={row * gap + r * 2}
            r={r}
            fill="currentColor"
          />
        ))
      )}
    </svg>
  )
}

function ArcDecor({ size = 56, degrees = 270 }: { size?: number; degrees?: number }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2
  const startRad = -Math.PI / 2
  const endRad = startRad + (degrees * Math.PI) / 180
  const x1 = cx + r * Math.cos(startRad)
  const y1 = cy + r * Math.sin(startRad)
  const x2 = cx + r * Math.cos(endRad)
  const y2 = cy + r * Math.sin(endRad)
  const largeArc = degrees > 180 ? 1 : 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <path
        d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  )
}

function TickMark({ winner }: { winner: boolean }) {
  if (!winner) return null
  return (
    <span className="inline-block w-1.5 h-1.5 rounded-full bg-ink align-middle ml-1" aria-hidden="true" />
  )
}

// ─── Score Badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 0.75 ? 'text-ink font-bold' :
    score >= 0.4  ? 'text-ink-2 font-medium' :
                    'text-ink-3 font-normal'
  return <span className={`font-mono text-sm ${cls}`}>{pct(score)}</span>
}

// ─── Horizontal Bar ───────────────────────────────────────────────────────────

function HBar({ label, value, color, max = 100 }: { label: string; value: number; color: 'a' | 'b'; max?: number }) {
  const fill = color === 'a' ? '#1A5F8A' : '#6BA3BE'
  const textColor = color === 'a' ? 'text-a' : 'text-b'
  const pctWidth = Math.min((value / max) * 100, 100)
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[10px] font-semibold uppercase tracking-label ${textColor}`}>
          Variant {label}
        </span>
        <span className={`font-mono text-sm font-bold ${textColor}`}>{value}%</span>
      </div>
      <div className="h-4 bg-rule w-full">
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${pctWidth}%`, backgroundColor: fill }}
        />
      </div>
    </div>
  )
}

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({
  label, aValue, bValue, format, higherIsBetter = true,
}: {
  label: string; aValue: number; bValue: number
  format: (v: number) => string; higherIsBetter?: boolean
}) {
  const aWins = higherIsBetter ? aValue >= bValue : aValue <= bValue
  return (
    <div className="border border-rule p-6">
      <div className="label mb-5">{label}</div>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-label text-a">A</span>
            <TickMark winner={aWins} />
          </div>
          <span className={`font-mono text-2xl font-bold ${aWins ? 'text-ink' : 'text-ink-3'}`}>
            {format(aValue)}
          </span>
        </div>
        <div className="border-t border-rule" />
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-label text-b">B</span>
            <TickMark winner={!aWins} />
          </div>
          <span className={`font-mono text-2xl font-bold ${!aWins ? 'text-ink' : 'text-ink-3'}`}>
            {format(bValue)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-10 py-20 border-t-2 border-ink">
      <div className="flex items-start gap-8">
        <div className="text-ink-4">
          <ArcDecor size={80} degrees={240} />
        </div>
        <div>
          <h2 className="text-5xl font-black tracking-tight leading-none mb-3">No results yet</h2>
          <p className="text-ink-2 text-sm leading-relaxed max-w-xs">
            Run a simulation to populate this dashboard with A/B comparison results.
          </p>
        </div>
      </div>
      <div>
        <div className="label mb-3">Start a simulation</div>
        <code className="inline-block border border-ink px-5 py-3 text-sm font-mono bg-ink text-paper">
          pnpm run sim
        </code>
        <p className="text-ink-3 text-xs mt-3">Dashboard refreshes automatically every 3 seconds</p>
      </div>
    </div>
  )
}

// ─── computePreview (unchanged logic) ────────────────────────────────────────

function computePreview(
  personaScores: PersonaWeightedScore[],
  groupWeights: Record<string, number>,
  subAgentWeights: Record<string, Record<SubAgentType, number>>,
): { A: number; B: number } {
  let overallA = 0
  let overallB = 0
  for (const ps of personaScores) {
    const pk = pKey(ps.personaName)
    const gw = groupWeights[pk] ?? ps.groupWeight
    const saW = subAgentWeights[pk] ?? {}
    let pA = 0; let pB = 0
    for (const sa of ps.subAgents) {
      const w = saW[sa.subAgentType] ?? sa.weight
      pA += w * (sa.variantA?.successScore ?? 0)
      pB += w * (sa.variantB?.successScore ?? 0)
    }
    overallA += gw * pA
    overallB += gw * pB
  }
  return { A: overallA, B: overallB }
}

// ─── Weights Editor ───────────────────────────────────────────────────────────

function WeightsEditor({ model, onApplied }: { model: PopulationModel; onApplied: () => void }) {
  const initGroupWeights = () => {
    const gw: Record<string, number> = {}
    for (const ps of model.personaScores) gw[pKey(ps.personaName)] = ps.groupWeight
    return gw
  }
  const initSubAgentWeights = () => {
    const saw: Record<string, Record<SubAgentType, number>> = {}
    for (const ps of model.personaScores) {
      const pk = pKey(ps.personaName)
      saw[pk] = {} as Record<SubAgentType, number>
      for (const sa of ps.subAgents) saw[pk][sa.subAgentType] = sa.weight
    }
    return saw
  }

  const [groupWeights, setGroupWeights] = useState(initGroupWeights)
  const [subAgentWeights, setSubAgentWeights] = useState(initSubAgentWeights)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const groupSum = Object.values(groupWeights).reduce((a, b) => a + b, 0)
  const subAgentSums: Record<string, number> = {}
  for (const [pk, w] of Object.entries(subAgentWeights)) {
    subAgentSums[pk] = Object.values(w).reduce((a, b) => a + b, 0)
  }
  const isValid =
    Math.abs(groupSum - 1.0) < 0.001 &&
    Object.values(subAgentSums).every(s => Math.abs(s - 1.0) < 0.001)

  const preview = computePreview(model.personaScores, groupWeights, subAgentWeights)

  const handleApply = async () => {
    if (!isValid) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaGroupWeights: groupWeights, personaSubAgentWeights: subAgentWeights }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSaved(true)
      onApplied()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setGroupWeights(initGroupWeights())
    setSubAgentWeights(initSubAgentWeights())
    setError(null)
    setSaved(false)
  }

  return (
    <div className="mt-8 border-t-2 border-ink pt-8">
      <div className="label mb-8">Adjust Population Weights</div>

      {/* Live preview */}
      <div className="border border-rule p-6 mb-8 flex items-end gap-12">
        <div>
          <div className="label mb-2">Preview — Variant A</div>
          <div className={`font-mono text-4xl font-black ${preview.A >= preview.B ? 'text-a' : 'text-ink-3'}`}>
            {pct(preview.A)}
          </div>
        </div>
        <div>
          <div className="label mb-2">Preview — Variant B</div>
          <div className={`font-mono text-4xl font-black ${preview.B > preview.A ? 'text-b' : 'text-ink-3'}`}>
            {pct(preview.B)}
          </div>
        </div>
        <p className="text-xs text-ink-3 leading-relaxed ml-auto max-w-[180px] text-right">
          Scores update as you edit.<br />
          Apply to persist and regenerate.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-12">
        {/* Group weights */}
        <div>
          <div className="label mb-5">Persona Group Weights</div>
          <div className="space-y-4">
            {Object.entries(groupWeights).map(([pk, val]) => (
              <div key={pk} className="flex items-center justify-between">
                <span className="text-sm text-ink-2">{pk}</span>
                <input
                  type="number"
                  min={0} max={1} step={0.01}
                  value={val}
                  onChange={e => setGroupWeights(prev => ({ ...prev, [pk]: parseFloat(e.target.value) || 0 }))}
                  className="w-20 bg-transparent border-b border-rule pb-1 text-sm font-mono text-ink text-right focus:outline-none focus:border-ink"
                />
              </div>
            ))}
          </div>
          <div className={`mt-4 text-xs font-mono pt-3 border-t ${Math.abs(groupSum - 1.0) < 0.001 ? 'text-ink border-ink' : 'text-red-600 border-red-300'}`}>
            sum = {groupSum.toFixed(3)}{Math.abs(groupSum - 1.0) < 0.001 ? ' — valid' : ' — must equal 1.000'}
          </div>
        </div>

        {/* Sub-agent weights */}
        <div>
          <div className="label mb-5">Sub-Agent Weights per Persona</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ink-3 text-left border-b border-rule">
                <th className="pb-2 font-medium pr-4">Persona</th>
                {SA_TYPES.map(t => (
                  <th key={t} className="pb-2 font-mono text-center px-1">{t}</th>
                ))}
                <th className="pb-2 font-medium text-right">Sum</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(subAgentWeights).map(([pk, weights]) => (
                <tr key={pk} className="border-b border-rule">
                  <td className="py-2.5 text-ink-2 pr-4">{pk}</td>
                  {SA_TYPES.map(t => (
                    <td key={t} className="py-2.5 px-1 text-center">
                      <input
                        type="number"
                        min={0} max={1} step={0.01}
                        value={weights[t] ?? 0}
                        onChange={e => setSubAgentWeights(prev => ({
                          ...prev,
                          [pk]: { ...prev[pk], [t]: parseFloat(e.target.value) || 0 },
                        }))}
                        className="w-12 bg-transparent border-b border-rule pb-0.5 font-mono text-ink text-center focus:outline-none focus:border-ink"
                      />
                    </td>
                  ))}
                  <td className={`py-2.5 text-right font-mono ${Math.abs(subAgentSums[pk] - 1.0) < 0.001 ? 'text-ink' : 'text-red-600'}`}>
                    {subAgentSums[pk]?.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && <p className="mt-5 text-xs text-red-600">{error}</p>}
      {saved && <p className="mt-5 text-xs text-ink-2">Weights saved — summary regenerated.</p>}

      <div className="flex gap-3 mt-8">
        <button
          onClick={handleApply}
          disabled={!isValid || saving}
          className="px-8 py-2.5 text-xs font-semibold tracking-label uppercase bg-ink text-paper transition-opacity disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-75"
        >
          {saving ? 'Applying…' : 'Apply Weights'}
        </button>
        <button
          onClick={handleReset}
          className="px-8 py-2.5 text-xs font-semibold tracking-label uppercase border border-ink text-ink hover:bg-ink hover:text-paper transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  )
}

// ─── Winner Banner ────────────────────────────────────────────────────────────

function WinnerBanner({ winner, A, B }: { winner: Summary['winner']; A: VariantStats; B: VariantStats }) {
  if (!winner) return null
  const borderColor = winner === 'A' ? 'border-a' : winner === 'B' ? 'border-b' : 'border-ink-4'
  return (
    <div className={`border-l-[3px] pl-7 py-3 mb-12 ${borderColor}`}>
      <div className="text-4xl font-black tracking-tight leading-tight">
        {winner === 'tie' ? 'Both Variants Tied' : `Variant ${winner} Wins`}
      </div>
      {winner !== 'tie' && (
        <p className="text-sm text-ink-2 mt-2 leading-relaxed">
          {winner === 'A'
            ? `+${Math.round((A.successRate - B.successRate) * 100)}pp success rate  ·  ${(B.avgStepCount - A.avgStepCount).toFixed(1)} fewer steps on average`
            : `+${Math.round((B.successRate - A.successRate) * 100)}pp success rate  ·  ${(A.avgStepCount - B.avgStepCount).toFixed(1)} fewer steps on average`}
        </p>
      )}
    </div>
  )
}

// ─── Task View ────────────────────────────────────────────────────────────────

function TaskView({ A, B, personaResults }: { A: VariantStats; B: VariantStats; personaResults: PersonaResult[] }) {
  return (
    <div className="space-y-8">
      {/* Metric cards */}
      <div className="grid grid-cols-3">
        <MetricCard
          label="Avg Score"
          aValue={Math.round(A.successRate * 100)}
          bValue={Math.round(B.successRate * 100)}
          format={v => `${v}%`}
          higherIsBetter
        />
        <MetricCard
          label="Avg Completion Time"
          aValue={A.avgCompletionTimeMs}
          bValue={B.avgCompletionTimeMs}
          format={v => `${(v / 1000).toFixed(1)}s`}
          higherIsBetter={false}
        />
        <MetricCard
          label="Avg Steps"
          aValue={A.avgStepCount}
          bValue={B.avgStepCount}
          format={v => v.toFixed(1)}
          higherIsBetter={false}
        />
      </div>

      {/* Success rate bars + friction */}
      <div className="grid grid-cols-2 gap-0">
        <div className="border border-rule p-6 border-r-0">
          <div className="label mb-6">Success Rate</div>
          <div className="space-y-5">
            <HBar label="A" value={Math.round(A.successRate * 100)} color="a" />
            <HBar label="B" value={Math.round(B.successRate * 100)} color="b" />
          </div>
        </div>

        <div className="border border-rule p-6">
          <div className="label mb-6">Top Friction Points — Variant B</div>
          {B.topFrictionPoints.length === 0 ? (
            <p className="text-ink-3 text-sm">No friction points recorded</p>
          ) : (
            <ol className="space-y-4">
              {B.topFrictionPoints.map((fp, i) => (
                <li key={i} className="flex gap-4">
                  <span className="font-mono text-[10px] text-ink-3 w-4 pt-0.5 shrink-0">{i + 1}</span>
                  <span className="text-sm text-ink-2 leading-snug">{fp}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Persona results table */}
      <div className="border border-rule">
        <div className="px-6 pt-6 pb-4 border-b border-rule">
          <div className="label">Results by Persona (avg across sub-agents)</div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule">
              <th className="text-left px-6 py-3 label">Persona</th>
              <th className="text-left px-6 py-3 label text-a">Variant A</th>
              <th className="text-left px-6 py-3 label text-b">Variant B</th>
              <th className="text-left px-6 py-3 label">Task Drift (A_10)</th>
            </tr>
          </thead>
          <tbody>
            {personaResults.map((pr, i) => (
              <tr key={i} className="border-t border-rule hover:bg-ink/[0.02] transition-colors">
                <td className="px-6 py-4 font-medium whitespace-nowrap">{pr.personaName}</td>
                <td className="px-6 py-4">
                  {pr.variantA
                    ? <div className="flex items-baseline gap-2">
                        <ScoreBadge score={pr.variantA.successScore} />
                        <span className="text-ink-3 text-xs">{pr.variantA.steps.toFixed(1)} steps</span>
                      </div>
                    : <span className="text-ink-4">—</span>}
                </td>
                <td className="px-6 py-4">
                  {pr.variantB
                    ? <div className="flex items-baseline gap-2">
                        <ScoreBadge score={pr.variantB.successScore} />
                        <span className="text-ink-3 text-xs">{pr.variantB.steps.toFixed(1)} steps</span>
                      </div>
                    : <span className="text-ink-4">—</span>}
                </td>
                <td className="px-6 py-4 text-xs font-mono text-ink-3 max-w-[200px] truncate">
                  {pr.variantA?.taskDrift || pr.variantB?.taskDrift || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-6 py-3 border-t border-rule flex gap-6">
          <span className="text-[10px] text-ink-3">Variant A: {A.runs} run{A.runs !== 1 ? 's' : ''}</span>
          <span className="text-[10px] text-ink-3">Variant B: {B.runs} run{B.runs !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Population Model Panel ───────────────────────────────────────────────────

function PopulationModelPanel({ model, onRefresh }: { model: PopulationModel; onRefresh: () => void }) {
  const [editOpen, setEditOpen] = useState(false)

  return (
    <div className="mt-16 border-t-2 border-ink pt-10">
      {/* Section header */}
      <div className="flex items-start justify-between mb-10">
        <div className="flex items-start gap-6">
          <div className="text-ink-4 mt-1">
            <ArcDecor size={48} degrees={210} />
          </div>
          <div>
            <div className="label mb-1">Population Model</div>
            <h2 className="text-2xl font-black tracking-tight">Weighted A/B Scores</h2>
          </div>
        </div>
        <button
          onClick={() => setEditOpen(o => !o)}
          className={`mt-1 px-6 py-2 text-xs font-semibold tracking-label uppercase transition-colors ${
            editOpen
              ? 'bg-ink text-paper'
              : 'border border-ink text-ink hover:bg-ink hover:text-paper'
          }`}
        >
          {editOpen ? 'Close Editor' : 'Edit Weights'}
        </button>
      </div>

      {/* Overall weighted scores */}
      <div className="grid grid-cols-2 mb-8">
        <div className={`border border-rule p-8 border-r-0 ${model.winner === 'A' ? 'bg-a-pale' : ''}`}>
          <div className="label mb-3 text-a">Variant A — Weighted Score</div>
          <div className="font-mono text-6xl font-black text-ink leading-none">{pct(model.overallScore.A)}</div>
        </div>
        <div className={`border border-rule p-8 ${model.winner === 'B' ? 'bg-b-pale' : ''}`}>
          <div className="label mb-3 text-b">Variant B — Weighted Score</div>
          <div className="font-mono text-6xl font-black text-ink-3 leading-none">{pct(model.overallScore.B)}</div>
        </div>
      </div>

      {/* Persona cards */}
      <div className="grid grid-cols-5 mb-8">
        {model.personaScores.map((ps, i) => (
          <div key={i} className={`border border-rule p-4 ${i > 0 ? 'border-l-0' : ''}`}>
            <div className="text-xs font-semibold mb-0.5 truncate">{ps.personaName.split(' (')[0]}</div>
            <div className="text-[10px] text-ink-3 mb-4">group {Math.round(ps.groupWeight * 100)}%</div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-[10px] text-a uppercase tracking-label">A</span>
                <ScoreBadge score={ps.weightedPersonaScore.A} />
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-b uppercase tracking-label">B</span>
                <ScoreBadge score={ps.weightedPersonaScore.B} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Sub-agent breakdown */}
      <div className="border border-rule">
        <div className="px-6 pt-5 pb-4 border-b border-rule">
          <div className="label">Sub-Agent Breakdown</div>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-rule">
              <th className="text-left px-6 py-3 label">Persona</th>
              <th className="text-left px-4 py-3 label">Grp Wt</th>
              <th className="text-left px-4 py-3 label">Sub-Agent</th>
              <th className="text-left px-4 py-3 label">SA Wt</th>
              <th className="text-left px-4 py-3 label text-a">A Score</th>
              <th className="text-left px-4 py-3 label text-b">B Score</th>
              <th className="text-left px-4 py-3 label">Task Drift (A)</th>
            </tr>
          </thead>
          <tbody>
            {model.personaScores.flatMap((ps, pi) =>
              ps.subAgents.map((sa, si) => (
                <tr key={`${pi}-${si}`} className="border-t border-rule hover:bg-ink/[0.02] transition-colors">
                  {si === 0 && (
                    <td className="px-6 py-3 font-medium text-ink align-top" rowSpan={ps.subAgents.length}>
                      {ps.personaName.split(' (')[0]}
                    </td>
                  )}
                  {si === 0 && (
                    <td className="px-4 py-3 font-mono text-ink-3 align-top" rowSpan={ps.subAgents.length}>
                      {Math.round(ps.groupWeight * 100)}%
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className="font-mono text-ink">{sa.subAgentType}</span>
                    <span className="text-ink-3 ml-2">— {SA_LABELS[sa.subAgentType]}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-ink-3">{Math.round(sa.weight * 100)}%</td>
                  <td className="px-4 py-3">
                    {sa.variantA ? <ScoreBadge score={sa.variantA.successScore} /> : <span className="text-ink-4">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {sa.variantB ? <ScoreBadge score={sa.variantB.successScore} /> : <span className="text-ink-4">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-ink-3 max-w-[200px] truncate">
                    {sa.variantA?.taskDrift || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editOpen && (
        <WeightsEditor
          model={model}
          onApplied={() => { onRefresh(); setEditOpen(false) }}
        />
      )}
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ summary, onRefresh }: { summary: Summary; onRefresh: () => void }) {
  const taskIds = Object.keys(summary.tasks ?? {})
  const [activeTask, setActiveTask] = useState<string>(taskIds[0] ?? '')

  const taskData = summary.tasks?.[activeTask]
  const A = taskData?.A ?? summary.variants.A
  const B = taskData?.B ?? summary.variants.B
  const personaResults = taskData?.personaResults ?? summary.personaResults
  const winner = taskData?.winner ?? summary.winner

  return (
    <>
      {/* Task tabs */}
      {taskIds.length > 1 && (
        <div className="flex border-b-2 border-ink mb-12">
          {taskIds.map(id => (
            <button
              key={id}
              onClick={() => setActiveTask(id)}
              className={`px-6 py-3 text-xs font-semibold tracking-label uppercase transition-colors ${
                activeTask === id
                  ? 'bg-ink text-paper'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              {TASK_LABELS[id] ?? id}
            </button>
          ))}
        </div>
      )}

      <WinnerBanner winner={winner} A={A} B={B} />
      <TaskView A={A} B={B} personaResults={personaResults} />

      {summary.populationModel && (
        <PopulationModelPanel model={summary.populationModel} onRefresh={onRefresh} />
      )}
    </>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(false)
  const [lastPoll, setLastPoll] = useState<Date | null>(null)

  const fetchSummary = useCallback(() => {
    fetch('/api/summary')
      .then(r => r.json())
      .then(data => { setSummary(data); setLoading(false); setApiError(false); setLastPoll(new Date()) })
      .catch(() => { setLoading(false); setApiError(true) })
  }, [])

  useEffect(() => {
    fetchSummary()
    const id = setInterval(fetchSummary, 3000)
    return () => clearInterval(id)
  }, [fetchSummary])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-ink-4 animate-pulse" />
          <span className="text-sm text-ink-3">Connecting to API…</span>
        </div>
      </div>
    )
  }

  if (apiError && !summary) {
    return (
      <div className="min-h-screen flex flex-col items-start justify-center bg-paper px-16">
        <div className="border-l-[3px] border-ink pl-8 py-4">
          <h1 className="text-4xl font-black mb-2">API Not Reachable</h1>
          <p className="text-sm text-ink-2 mb-6">Make sure the API server is running on port 3001.</p>
          <code className="inline-block border border-ink bg-ink text-paper px-5 py-3 text-sm font-mono">
            pnpm run dev
          </code>
        </div>
      </div>
    )
  }

  const hasResults = summary && summary.runCount > 0 && summary.variants.A && summary.variants.B

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-6xl mx-auto px-10 py-12">

        {/* Header */}
        <header className="border-t-2 border-ink pt-7 mb-14">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-6xl font-black tracking-tight leading-none mb-4">
                Hierarchical Orchestration <br />of Modelled Clients
              </h1>
              <p className="text-sm text-ink-2">
                {summary
                  ? `${summary.runCount} simulation run${summary.runCount !== 1 ? 's' : ''} across 5 personas, 3 tasks, 2 variants`
                  : 'Simulate user flows · Compare variants · Surface friction'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-4 mt-1">
              <div className="text-ink-4">
                <DotGrid rows={3} cols={5} gap={10} r={1.5} />
              </div>
              <div className="flex items-center gap-6 text-[10px] text-ink-3 font-mono">
                {lastPoll && <span>Updated {lastPoll.toLocaleTimeString()}</span>}
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5" style={{ backgroundColor: '#1A5F8A' }} />
                    Variant A
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5" style={{ backgroundColor: '#6BA3BE' }} />
                    Variant B
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main content */}
        {!hasResults ? <EmptyState /> : <Dashboard summary={summary!} onRefresh={fetchSummary} />}

        {/* Footer */}
        <footer className="border-t border-rule mt-16 pt-6 flex items-center justify-between">
          <span className="text-[10px] text-ink-4 tracking-label uppercase">HOMC — Hackathon A/B Simulator</span>
          <div className="text-ink-4">
            <DotGrid rows={1} cols={5} gap={8} r={1} />
          </div>
        </footer>

      </div>
    </div>
  )
}
