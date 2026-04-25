import * as fs from 'fs'
import * as path from 'path'
import type { RunResult, Summary, VariantStats, PersonaResult, TaskStats, TaskHistoryEntry } from '@homc/shared'

const LOGS_DIR = path.join(__dirname, '..', '..', '..', 'logs')

export async function writeRunResult(result: RunResult): Promise<void> {
  fs.mkdirSync(LOGS_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(LOGS_DIR, `${result.id}.json`),
    JSON.stringify(result, null, 2),
  )
  updateSummary()
}

function updateSummary(): void {
  const files = fs
    .readdirSync(LOGS_DIR)
    .filter(f => f.endsWith('.json') && f !== 'summary.json')

  const results: RunResult[] = files.map(f =>
    JSON.parse(fs.readFileSync(path.join(LOGS_DIR, f), 'utf-8')),
  )

  const summary = buildSummary(results)
  fs.writeFileSync(path.join(LOGS_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
}

function buildSummary(results: RunResult[]): Summary {
  const aResults = results.filter(r => r.variant === 'A')
  const bResults = results.filter(r => r.variant === 'B')

  const computeStats = (runs: RunResult[]): VariantStats => {
    if (runs.length === 0) {
      return { runs: 0, successRate: 0, avgCompletionTimeMs: 0, avgStepCount: 0, avgClickCount: 0, topFrictionPoints: [] }
    }
    const avgSuccessScore = runs.reduce((s, r) => s + r.successScore, 0) / runs.length
    const fpCount: Record<string, number> = {}
    runs.flatMap(r => r.frictionPoints).forEach(fp => {
      fpCount[fp] = (fpCount[fp] ?? 0) + 1
    })
    const topFrictionPoints = Object.entries(fpCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([fp]) => fp)

    return {
      runs: runs.length,
      successRate: avgSuccessScore,
      avgCompletionTimeMs: avg(runs.map(r => r.metrics.completionTimeMs)),
      avgStepCount: avg(runs.map(r => r.metrics.stepCount)),
      avgClickCount: avg(runs.map(r => r.metrics.clickCount)),
      topFrictionPoints,
    }
  }

  const aStats = computeStats(aResults)
  const bStats = computeStats(bResults)

  let winner: Summary['winner'] = null
  if (aResults.length > 0 && bResults.length > 0) {
    const diff = aStats.successRate - bStats.successRate
    winner = Math.abs(diff) < 0.1 ? 'tie' : diff > 0 ? 'A' : 'B'
  }

  const personaNames = [...new Set(results.map(r => r.persona.name))]
  const personaResults: PersonaResult[] = personaNames.map(name => {
    const aRun = aResults.find(r => r.persona.name === name)
    const bRun = bResults.find(r => r.persona.name === name)
    return {
      personaName: name,
      variantA: aRun ? {
        success: aRun.success,
        successScore: aRun.successScore,
        steps: aRun.metrics.stepCount,
        timeMs: aRun.metrics.completionTimeMs,
        taskDrift: buildTaskDrift(aRun.taskHistory),
      } : null,
      variantB: bRun ? {
        success: bRun.success,
        successScore: bRun.successScore,
        steps: bRun.metrics.stepCount,
        timeMs: bRun.metrics.completionTimeMs,
        taskDrift: buildTaskDrift(bRun.taskHistory),
      } : null,
    }
  })

  // Per-task breakdown
  const taskIds = [...new Set(results.map(r => r.task.id))]
  const tasks: Record<string, TaskStats> = {}
  for (const taskId of taskIds) {
    const tr = results.filter(r => r.task.id === taskId)
    const trA = tr.filter(r => r.variant === 'A')
    const trB = tr.filter(r => r.variant === 'B')
    const tsA = computeStats(trA)
    const tsB = computeStats(trB)
    const tdiff = tsA.successRate - tsB.successRate
    const tWinner: Summary['winner'] = trA.length > 0 && trB.length > 0
      ? (Math.abs(tdiff) < 0.1 ? 'tie' : tdiff > 0 ? 'A' : 'B')
      : null
    const tPersonaNames = [...new Set(tr.map(r => r.persona.name))]
    const tPersonaResults: PersonaResult[] = tPersonaNames.map(name => {
      const aRun = trA.find(r => r.persona.name === name)
      const bRun = trB.find(r => r.persona.name === name)
      return {
        personaName: name,
        variantA: aRun ? {
          success: aRun.success,
          successScore: aRun.successScore,
          steps: aRun.metrics.stepCount,
          timeMs: aRun.metrics.completionTimeMs,
          taskDrift: buildTaskDrift(aRun.taskHistory),
        } : null,
        variantB: bRun ? {
          success: bRun.success,
          successScore: bRun.successScore,
          steps: bRun.metrics.stepCount,
          timeMs: bRun.metrics.completionTimeMs,
          taskDrift: buildTaskDrift(bRun.taskHistory),
        } : null,
      }
    })
    tasks[taskId] = {
      taskId,
      taskGoal: tr[0].task.goal,
      A: tsA,
      B: tsB,
      personaResults: tPersonaResults,
      winner: tWinner,
    }
  }

  return {
    runCount: results.length,
    lastUpdated: Date.now(),
    variants: { A: aStats, B: bStats },
    personaResults,
    winner,
    tasks,
  }
}

const avg = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / nums.length

const TASK_SHORT: Record<string, string> = {
  'create-account': 'signup',
  'find-pricing': 'pricing',
  'learn-about-company': 'about',
}

function buildTaskDrift(history: TaskHistoryEntry[]): string {
  if (!history || history.length <= 1) return ''
  return history.map(e => {
    const name = TASK_SHORT[e.taskId] ?? e.taskId
    const oc = e.outcome === 'success' ? ' ✓' : e.outcome === 'fail' ? ' ✗' : e.outcome === 'incomplete' ? ' …' : ''
    const prefix = e.trigger === 'chaos' ? '[chaos] ' : e.trigger === 'return' ? '[return] ' : ''
    return `${prefix}${name}${oc}`
  }).join(' → ')
}
