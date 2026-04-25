import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts'

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
  variantA: { success: boolean; steps: number; timeMs: number } | null
  variantB: { success: boolean; steps: number; timeMs: number } | null
}

interface TaskStats {
  taskId: string
  taskGoal: string
  A: VariantStats
  B: VariantStats
  personaResults: PersonaResult[]
  winner: 'A' | 'B' | 'tie' | null
}

interface Summary {
  runCount: number
  lastUpdated: number
  variants: { A: VariantStats; B: VariantStats }
  personaResults: PersonaResult[]
  winner: 'A' | 'B' | 'tie' | null
  tasks: Record<string, TaskStats>
}

const TASK_LABELS: Record<string, string> = {
  'create-account': 'Create Account',
  'find-pricing': 'Find Pricing',
  'learn-about-company': 'Explore Company',
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
      <p className="text-gray-400 max-w-sm">
        Run a simulation to see A/B comparison results here.
      </p>
      <div className="mt-2 bg-gray-900 rounded-lg px-5 py-3 font-mono text-sm text-indigo-400">
        npm run sim
      </div>
      <p className="text-gray-600 text-xs mt-1">Dashboard auto-refreshes every 3 seconds</p>
    </div>
  )
}

export default function App() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(false)
  const [lastPoll, setLastPoll] = useState<Date | null>(null)

  useEffect(() => {
    const poll = () => {
      fetch('/api/summary')
        .then(r => r.json())
        .then(data => { setSummary(data); setLoading(false); setApiError(false); setLastPoll(new Date()) })
        .catch(() => { setLoading(false); setApiError(true) })
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [])

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
        <div className="mt-2 bg-gray-900 rounded-lg px-5 py-3 font-mono text-sm text-indigo-400">
          pnpm run dev
        </div>
      </div>
    )
  }

  const hasResults = summary && summary.runCount > 0 && summary.variants.A && summary.variants.B

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">AI UX Simulator</h1>
            <p className="text-gray-500 mt-1 text-sm">
              A/B Testing with AI Personas
              {summary && ` — ${summary.runCount} run${summary.runCount !== 1 ? 's' : ''}`}
            </p>
          </div>
          {lastPoll && (
            <div className="text-xs text-gray-600">
              Updated {lastPoll.toLocaleTimeString()}
            </div>
          )}
        </div>

        {!hasResults ? <EmptyState /> : <Dashboard summary={summary!} />}
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
        <MetricCard label="Success Rate" aValue={Math.round(A.successRate * 100)} bValue={Math.round(B.successRate * 100)} format={v => `${v}%`} higherIsBetter />
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
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Results by Persona</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="text-gray-500 font-medium pb-3">Persona</th>
              <th className="text-indigo-400 font-medium pb-3">Variant A</th>
              <th className="text-orange-400 font-medium pb-3">Variant B</th>
              <th className="text-gray-500 font-medium pb-3">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {personaResults.map((pr, i) => (
              <tr key={i} className="border-t border-gray-800">
                <td className="py-3 text-gray-200 font-medium whitespace-nowrap pr-4">{pr.personaName}</td>
                <td className="py-3">
                  {pr.variantA ? (
                    <span className={pr.variantA.success ? 'text-green-400' : 'text-red-400'}>
                      {pr.variantA.success ? '✓' : '✗'} {pr.variantA.steps} steps
                      <span className="text-gray-600 ml-1 text-xs">({(pr.variantA.timeMs / 1000).toFixed(1)}s)</span>
                    </span>
                  ) : <span className="text-gray-700">—</span>}
                </td>
                <td className="py-3">
                  {pr.variantB ? (
                    <span className={pr.variantB.success ? 'text-green-400' : 'text-red-400'}>
                      {pr.variantB.success ? '✓' : '✗'} {pr.variantB.steps} steps
                      <span className="text-gray-600 ml-1 text-xs">({(pr.variantB.timeMs / 1000).toFixed(1)}s)</span>
                    </span>
                  ) : <span className="text-gray-700">—</span>}
                </td>
                <td className="py-3 text-xs text-gray-500">
                  {pr.variantA && pr.variantB
                    ? pr.variantA.success && !pr.variantB.success ? '🔵 A only'
                    : !pr.variantA.success && pr.variantB.success ? '🟠 B only'
                    : pr.variantA.success && pr.variantB.success
                      ? pr.variantA.steps < pr.variantB.steps ? '🔵 A faster'
                      : pr.variantB.steps < pr.variantA.steps ? '🟠 B faster' : 'Equal'
                    : '✗ Both failed'
                    : '—'}
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

function Dashboard({ summary }: { summary: Summary }) {
  const taskIds = Object.keys(summary.tasks ?? {})
  const [activeTask, setActiveTask] = useState<string>(taskIds[0] ?? '')

  const taskData = summary.tasks?.[activeTask]
  const A = taskData?.A ?? summary.variants.A
  const B = taskData?.B ?? summary.variants.B
  const personaResults = taskData?.personaResults ?? summary.personaResults
  const winner = taskData?.winner ?? summary.winner

  return (
    <>
      {/* Task Tabs */}
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
    </>
  )
}
