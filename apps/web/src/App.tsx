import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

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

function pct(v: number) { return `${Math.round(v * 100)}%` }

function pKey(personaName: string) { return personaName.split(' ')[0] }

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 0.75 ? 'text-green-400' : score >= 0.4 ? 'text-yellow-400' : 'text-red-400'
  return <span className={`font-mono font-bold ${cls}`}>{pct(score)}</span>
}

function MetricCard({
  label, aValue, bValue, format, higherIsBetter = true,
}: {
  label: string; aValue: number; bValue: number
  format: (v: number) => string; higherIsBetter?: boolean
}) {
  const aWins = higherIsBetter ? aValue >= bValue : aValue <= bValue
  return (
    <div className="bg-gray-900 rounded-xl p-5">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">{label}</div>
      <div className="flex gap-3">
        <div className={`flex-1 rounded-lg p-3 ${aWins ? 'bg-indigo-950 ring-1 ring-indigo-500' : 'bg-gray-800'}`}>
          <div className="text-xs text-gray-400 mb-1">Variant A</div>
          <div className={`text-2xl font-bold ${aWins ? 'text-indigo-300' : 'text-gray-400'}`}>{format(aValue)}</div>
        </div>
        <div className={`flex-1 rounded-lg p-3 ${!aWins ? 'bg-orange-950 ring-1 ring-orange-500' : 'bg-gray-800'}`}>
          <div className="text-xs text-gray-400 mb-1">Variant B</div>
          <div className={`text-2xl font-bold ${!aWins ? 'text-orange-300' : 'text-gray-400'}`}>{format(bValue)}</div>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
      <div className="text-6xl">🧪</div>
      <h2 className="text-2xl font-bold text-white">No results yet</h2>
      <p className="text-gray-400 max-w-sm">Run a simulation to see A/B comparison results here.</p>
      <div className="mt-2 bg-gray-900 rounded-lg px-5 py-3 font-mono text-sm text-indigo-400">npm run sim</div>
      <p className="text-gray-600 text-xs mt-1">Dashboard auto-refreshes every 3 seconds</p>
    </div>
  )
}

// Recompute overall weighted scores from edited weights without hitting the server
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

function WeightsEditor({
  model,
  onApplied,
}: {
  model: PopulationModel
  onApplied: () => void
}) {
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
        body: JSON.stringify({
          personaGroupWeights: groupWeights,
          personaSubAgentWeights: subAgentWeights,
        }),
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
    <div className="mt-5 border border-gray-700 rounded-xl p-5">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-5">Edit Population Weights</div>

      {/* Live preview */}
      <div className="flex items-center gap-8 bg-gray-800 rounded-lg px-5 py-4 mb-6">
        <div>
          <div className="text-xs text-gray-500 mb-1">Preview A</div>
          <div className={`text-2xl font-bold font-mono ${preview.A >= preview.B ? 'text-indigo-300' : 'text-gray-500'}`}>
            {pct(preview.A)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Preview B</div>
          <div className={`text-2xl font-bold font-mono ${preview.B > preview.A ? 'text-orange-300' : 'text-gray-500'}`}>
            {pct(preview.B)}
          </div>
        </div>
        <div className="text-xs text-gray-600 leading-relaxed">
          Scores update as you edit.<br />
          Click Apply to persist and regenerate the summary.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8">
        {/* Group weights */}
        <div>
          <div className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wide">Persona Group Weights</div>
          <div className="space-y-2">
            {Object.entries(groupWeights).map(([pk, val]) => (
              <div key={pk} className="flex items-center gap-3">
                <span className="text-gray-400 text-sm w-16">{pk}</span>
                <input
                  type="number"
                  min={0} max={1} step={0.01}
                  value={val}
                  onChange={e => setGroupWeights(prev => ({ ...prev, [pk]: parseFloat(e.target.value) || 0 }))}
                  className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm font-mono text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            ))}
          </div>
          <div className={`mt-3 text-xs font-mono ${Math.abs(groupSum - 1.0) < 0.001 ? 'text-green-500' : 'text-red-400'}`}>
            sum = {groupSum.toFixed(3)}{Math.abs(groupSum - 1.0) < 0.001 ? ' ✓' : ' — must equal 1.0'}
          </div>
        </div>

        {/* Sub-agent weights */}
        <div>
          <div className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wide">Sub-Agent Weights per Persona</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-600 text-left">
                <th className="pb-2 font-medium">Persona</th>
                {SA_TYPES.map(t => (
                  <th key={t} className="pb-2 font-mono text-center">{t}</th>
                ))}
                <th className="pb-2 text-right font-medium">Sum</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(subAgentWeights).map(([pk, weights]) => (
                <tr key={pk}>
                  <td className="py-1.5 text-gray-400 pr-2">{pk}</td>
                  {SA_TYPES.map(t => (
                    <td key={t} className="py-1.5 px-1 text-center">
                      <input
                        type="number"
                        min={0} max={1} step={0.01}
                        value={weights[t] ?? 0}
                        onChange={e => setSubAgentWeights(prev => ({
                          ...prev,
                          [pk]: { ...prev[pk], [t]: parseFloat(e.target.value) || 0 },
                        }))}
                        className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 font-mono text-gray-200 text-center focus:outline-none focus:border-indigo-500"
                      />
                    </td>
                  ))}
                  <td className={`py-1.5 text-right font-mono ${Math.abs(subAgentSums[pk] - 1.0) < 0.001 ? 'text-green-500' : 'text-red-400'}`}>
                    {subAgentSums[pk]?.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && <div className="mt-4 text-xs text-red-400">{error}</div>}
      {saved && <div className="mt-4 text-xs text-green-500">Weights saved — summary regenerated.</div>}

      <div className="flex gap-3 mt-5">
        <button
          onClick={handleApply}
          disabled={!isValid || saving}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            isValid && !saving
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          {saving ? 'Applying...' : 'Apply Weights'}
        </button>
        <button
          onClick={handleReset}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-400"
        >
          Reset
        </button>
      </div>
    </div>
  )
}

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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500 animate-pulse">Connecting to API...</div>
      </div>
    )
  }

  if (apiError && !summary) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <div className="text-2xl font-bold text-white">API server not reachable</div>
        <p className="text-gray-400 text-sm">Make sure the API server is running on port 3001.</p>
        <div className="mt-2 bg-gray-900 rounded-lg px-5 py-3 font-mono text-sm text-indigo-400">pnpm run dev</div>
      </div>
    )
  }

  const hasResults = summary && summary.runCount > 0 && summary.variants.A && summary.variants.B

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">AI UX Simulator</h1>
            <p className="text-gray-500 mt-1 text-sm">
              A/B Testing with AI Personas
              {summary && ` — ${summary.runCount} run${summary.runCount !== 1 ? 's' : ''}`}
            </p>
          </div>
          {lastPoll && <div className="text-xs text-gray-600">Updated {lastPoll.toLocaleTimeString()}</div>}
        </div>

        {!hasResults ? <EmptyState /> : <Dashboard summary={summary!} onRefresh={fetchSummary} />}
      </div>
    </div>
  )
}

function WinnerBanner({ winner, A, B }: { winner: Summary['winner']; A: VariantStats; B: VariantStats }) {
  if (!winner) return null
  return (
    <div className={`rounded-xl p-5 mb-6 border ${
      winner === 'A' ? 'bg-indigo-950/60 border-indigo-600'
      : winner === 'B' ? 'bg-orange-950/60 border-orange-600'
      : 'bg-gray-800 border-gray-700'
    }`}>
      <div className="text-lg font-bold">
        {winner === 'tie' ? '🤝 Tie — both variants performed similarly' : `🏆 Variant ${winner} wins`}
      </div>
      {winner !== 'tie' && (
        <div className="text-gray-300 text-sm mt-1">
          {winner === 'A'
            ? `${Math.round((A.successRate - B.successRate) * 100)}pp higher success rate · ${(B.avgStepCount - A.avgStepCount).toFixed(1)} fewer steps on average`
            : `${Math.round((B.successRate - A.successRate) * 100)}pp higher success rate · ${(A.avgStepCount - B.avgStepCount).toFixed(1)} fewer steps on average`}
        </div>
      )}
    </div>
  )
}

function TaskView({ A, B, personaResults }: { A: VariantStats; B: VariantStats; personaResults: PersonaResult[] }) {
  const chartData = [{ name: 'Success Rate', A: Math.round(A.successRate * 100), B: Math.round(B.successRate * 100) }]

  return (
    <>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <MetricCard label="Avg Score" aValue={Math.round(A.successRate * 100)} bValue={Math.round(B.successRate * 100)} format={v => `${v}%`} higherIsBetter />
        <MetricCard label="Avg Completion Time" aValue={A.avgCompletionTimeMs} bValue={B.avgCompletionTimeMs} format={v => `${(v / 1000).toFixed(1)}s`} higherIsBetter={false} />
        <MetricCard label="Avg Steps to Complete" aValue={A.avgStepCount} bValue={B.avgStepCount} format={v => v.toFixed(1)} higherIsBetter={false} />
      </div>

      <div className="grid grid-cols-2 gap-5 mb-6">
        <div className="bg-gray-900 rounded-xl p-5">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Success Rate</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} barCategoryGap="40%">
              <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
              <Legend />
              <Bar dataKey="A" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="B" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 rounded-xl p-5">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Top Friction Points — Variant B</div>
          {B.topFrictionPoints.length === 0 ? (
            <p className="text-gray-600 text-sm">No friction points recorded</p>
          ) : (
            <ul className="space-y-3">
              {B.topFrictionPoints.map((fp, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="text-orange-500 font-mono text-xs mt-0.5">{i + 1}</span>
                  <span className="text-gray-300 leading-snug">{fp}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl p-5">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Results by Persona (avg across sub-agents)</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="text-gray-500 font-medium pb-3">Persona</th>
              <th className="text-indigo-400 font-medium pb-3">Variant A</th>
              <th className="text-orange-400 font-medium pb-3">Variant B</th>
              <th className="text-gray-500 font-medium pb-3">Drift (A_10)</th>
            </tr>
          </thead>
          <tbody>
            {personaResults.map((pr, i) => (
              <tr key={i} className="border-t border-gray-800">
                <td className="py-3 text-gray-200 font-medium whitespace-nowrap pr-4">{pr.personaName}</td>
                <td className="py-3">
                  {pr.variantA ? (
                    <div>
                      <ScoreBadge score={pr.variantA.successScore} />
                      <span className="text-gray-600 ml-1 text-xs">{pr.variantA.steps.toFixed(1)} steps</span>
                    </div>
                  ) : <span className="text-gray-700">—</span>}
                </td>
                <td className="py-3">
                  {pr.variantB ? (
                    <div>
                      <ScoreBadge score={pr.variantB.successScore} />
                      <span className="text-gray-600 ml-1 text-xs">{pr.variantB.steps.toFixed(1)} steps</span>
                    </div>
                  ) : <span className="text-gray-700">—</span>}
                </td>
                <td className="py-3 text-xs text-gray-500 font-mono max-w-[180px]">
                  {pr.variantA?.taskDrift || pr.variantB?.taskDrift || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 pt-4 border-t border-gray-800 flex gap-6 text-xs text-gray-600">
          <span>Variant A: {A.runs} run{A.runs !== 1 ? 's' : ''}</span>
          <span>Variant B: {B.runs} run{B.runs !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </>
  )
}

function PopulationModelPanel({ model, onRefresh }: { model: PopulationModel; onRefresh: () => void }) {
  const [editOpen, setEditOpen] = useState(false)

  const chartData = [
    { name: 'Weighted Score', A: Math.round(model.overallScore.A * 100), B: Math.round(model.overallScore.B * 100) },
  ]

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Population Model — Weighted A/B Scores
        </div>
        <button
          onClick={() => setEditOpen(o => !o)}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
            editOpen
              ? 'bg-indigo-700 text-indigo-100'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
          }`}
        >
          {editOpen ? 'Close Editor' : 'Edit Weights'}
        </button>
      </div>

      {/* Overall scores */}
      <div className={`rounded-xl p-5 mb-6 border ${
        model.winner === 'A' ? 'bg-indigo-950/40 border-indigo-700'
        : model.winner === 'B' ? 'bg-orange-950/40 border-orange-700'
        : 'bg-gray-800 border-gray-700'
      }`}>
        <div className="text-sm font-semibold text-gray-300 mb-3">
          {model.winner === 'tie'
            ? 'Population model — tie'
            : `Population model — Variant ${model.winner} leads`}
        </div>
        <div className="flex gap-6 items-end">
          <div>
            <div className="text-xs text-gray-500 mb-1">Variant A (weighted)</div>
            <div className="text-3xl font-bold text-indigo-300">{pct(model.overallScore.A)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Variant B (weighted)</div>
            <div className="text-3xl font-bold text-orange-300">{pct(model.overallScore.B)}</div>
          </div>
          <div className="ml-auto">
            <ResponsiveContainer width={200} height={80}>
              <BarChart data={chartData} barCategoryGap="30%">
                <XAxis dataKey="name" hide />
                <YAxis domain={[0, 100]} hide />
                <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                <Legend />
                <Bar dataKey="A" fill="#6366f1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="B" fill="#f97316" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Per-persona summary cards */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {model.personaScores.map((ps, i) => (
          <div key={i} className="bg-gray-900 rounded-xl p-4">
            <div className="text-xs text-gray-400 font-medium mb-1 truncate">{ps.personaName.split(' (')[0]}</div>
            <div className="text-xs text-gray-600 mb-2">group: {Math.round(ps.groupWeight * 100)}%</div>
            <div className="text-xs font-mono space-y-1">
              <div><span className="text-gray-600">A: </span><ScoreBadge score={ps.weightedPersonaScore.A} /></div>
              <div><span className="text-gray-600">B: </span><ScoreBadge score={ps.weightedPersonaScore.B} /></div>
            </div>
          </div>
        ))}
      </div>

      {/* Sub-agent breakdown table */}
      <div className="bg-gray-900 rounded-xl p-5">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Sub-Agent Breakdown</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-600">
              <th className="pb-3 font-medium pr-4">Persona</th>
              <th className="pb-3 font-medium pr-3">Group Wt</th>
              <th className="pb-3 font-medium pr-4">Sub-Agent</th>
              <th className="pb-3 font-medium pr-3">SA Wt</th>
              <th className="pb-3 font-medium text-indigo-400 pr-3">A Score</th>
              <th className="pb-3 font-medium text-orange-400 pr-3">B Score</th>
              <th className="pb-3 font-medium">Task Drift (A)</th>
            </tr>
          </thead>
          <tbody>
            {model.personaScores.flatMap((ps, pi) =>
              ps.subAgents.map((sa, si) => (
                <tr key={`${pi}-${si}`} className="border-t border-gray-800">
                  {si === 0 && (
                    <td className="py-2 text-gray-300 font-medium pr-4 align-top" rowSpan={ps.subAgents.length}>
                      {ps.personaName.split(' (')[0]}
                    </td>
                  )}
                  {si === 0 && (
                    <td className="py-2 text-gray-500 font-mono pr-3 align-top" rowSpan={ps.subAgents.length}>
                      {Math.round(ps.groupWeight * 100)}%
                    </td>
                  )}
                  <td className="py-2 pr-4">
                    <span className="font-mono text-gray-300">{sa.subAgentType}</span>
                    <span className="text-gray-600 ml-1">— {SA_LABELS[sa.subAgentType]}</span>
                  </td>
                  <td className="py-2 font-mono text-gray-500 pr-3">{Math.round(sa.weight * 100)}%</td>
                  <td className="py-2 pr-3">
                    {sa.variantA ? <ScoreBadge score={sa.variantA.successScore} /> : <span className="text-gray-700">—</span>}
                  </td>
                  <td className="py-2 pr-3">
                    {sa.variantB ? <ScoreBadge score={sa.variantB.successScore} /> : <span className="text-gray-700">—</span>}
                  </td>
                  <td className="py-2 text-gray-600 font-mono max-w-[200px] truncate">
                    {sa.variantA?.taskDrift || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Inline weight editor */}
      {editOpen && (
        <WeightsEditor
          model={model}
          onApplied={() => {
            onRefresh()
            setEditOpen(false)
          }}
        />
      )}
    </div>
  )
}

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
      {taskIds.length > 1 && (
        <div className="flex gap-2 mb-6">
          {taskIds.map(id => (
            <button
              key={id}
              onClick={() => setActiveTask(id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTask === id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
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
