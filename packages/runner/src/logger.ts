import * as fs from 'fs'
import * as path from 'path'
import type {
  RunResult, Summary, VariantStats, PersonaResult, TaskStats, TaskHistoryEntry,
  SubAgentType, SubAgentResult, PersonaWeightedScore, PopulationModel,
} from '@homc/shared'
import { loadSimConfig, personaConfigKey } from './config'

const LOGS_DIR = path.join(__dirname, '..', '..', '..', 'logs')
const SUB_AGENT_TYPES: SubAgentType[] = ['A_00', 'A_10', 'A_11', 'A_12']

export async function writeRunResult(result: RunResult): Promise<void> {
  fs.mkdirSync(LOGS_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(LOGS_DIR, `${result.id}.json`),
    JSON.stringify(result, null, 2),
  )
  updateSummary()
}

export function rebuildSummary(): void {
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
    const avgSuccessScore = avg(runs.map(r => r.successScore))
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

  // Per-persona raw results: average across all sub-agents and tasks
  const personaNames = [...new Set(results.map(r => r.persona.name))]
  const personaResults: PersonaResult[] = personaNames.map(name => {
    const aRuns = aResults.filter(r => r.persona.name === name)
    const bRuns = bResults.filter(r => r.persona.name === name)
    // Use the A_10 run's taskDrift as the representative (most illustrative)
    const a10RunA = aRuns.find(r => r.subAgentType === 'A_10') ?? aRuns[0]
    const a10RunB = bRuns.find(r => r.subAgentType === 'A_10') ?? bRuns[0]
    return {
      personaName: name,
      variantA: aRuns.length > 0 ? {
        success: aRuns.some(r => r.success),
        successScore: avg(aRuns.map(r => r.successScore)),
        steps: avg(aRuns.map(r => r.metrics.stepCount)),
        timeMs: avg(aRuns.map(r => r.metrics.completionTimeMs)),
        taskDrift: a10RunA ? buildTaskDrift(a10RunA.taskHistory) : '',
      } : null,
      variantB: bRuns.length > 0 ? {
        success: bRuns.some(r => r.success),
        successScore: avg(bRuns.map(r => r.successScore)),
        steps: avg(bRuns.map(r => r.metrics.stepCount)),
        timeMs: avg(bRuns.map(r => r.metrics.completionTimeMs)),
        taskDrift: a10RunB ? buildTaskDrift(a10RunB.taskHistory) : '',
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
      const aRuns = trA.filter(r => r.persona.name === name)
      const bRuns = trB.filter(r => r.persona.name === name)
      const a10RunA = aRuns.find(r => r.subAgentType === 'A_10') ?? aRuns[0]
      const a10RunB = bRuns.find(r => r.subAgentType === 'A_10') ?? bRuns[0]
      return {
        personaName: name,
        variantA: aRuns.length > 0 ? {
          success: aRuns.some(r => r.success),
          successScore: avg(aRuns.map(r => r.successScore)),
          steps: avg(aRuns.map(r => r.metrics.stepCount)),
          timeMs: avg(aRuns.map(r => r.metrics.completionTimeMs)),
          taskDrift: a10RunA ? buildTaskDrift(a10RunA.taskHistory) : '',
        } : null,
        variantB: bRuns.length > 0 ? {
          success: bRuns.some(r => r.success),
          successScore: avg(bRuns.map(r => r.successScore)),
          steps: avg(bRuns.map(r => r.metrics.stepCount)),
          timeMs: avg(bRuns.map(r => r.metrics.completionTimeMs)),
          taskDrift: a10RunB ? buildTaskDrift(a10RunB.taskHistory) : '',
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

  // Population model
  let populationModel: PopulationModel | undefined
  try {
    populationModel = buildPopulationModel(results)
  } catch {
    // Config not yet available (partial run or test) — skip
  }

  return {
    runCount: results.length,
    lastUpdated: Date.now(),
    variants: { A: aStats, B: bStats },
    personaResults,
    winner,
    tasks,
    populationModel,
  }
}

function buildPopulationModel(results: RunResult[]): PopulationModel {
  const simConfig = loadSimConfig()
  const personaNames = [...new Set(results.map(r => r.persona.name))]

  const personaScores: PersonaWeightedScore[] = personaNames.map(personaName => {
    const pKey = personaConfigKey(personaName)
    const groupWeight = simConfig.personaGroupWeights[pKey] ?? (1 / personaNames.length)
    const saWeights = simConfig.personaSubAgentWeights[pKey] ?? {}

    const subAgents: SubAgentResult[] = SUB_AGENT_TYPES.map(saType => {
      const weight = saWeights[saType] ?? 0.25
      const aRuns = results.filter(r => r.persona.name === personaName && r.variant === 'A' && (r.subAgentType ?? 'A_00') === saType)
      const bRuns = results.filter(r => r.persona.name === personaName && r.variant === 'B' && (r.subAgentType ?? 'A_00') === saType)

      const aScore = aRuns.length > 0 ? avg(aRuns.map(r => r.successScore)) : 0
      const bScore = bRuns.length > 0 ? avg(bRuns.map(r => r.successScore)) : 0

      const aRep = aRuns[0]
      const bRep = bRuns[0]

      return {
        subAgentType: saType,
        weight,
        variantA: aRep ? {
          successScore: aScore,
          steps: avg(aRuns.map(r => r.metrics.stepCount)),
          timeMs: avg(aRuns.map(r => r.metrics.completionTimeMs)),
          taskDrift: buildTaskDrift(aRep.taskHistory),
        } : null,
        variantB: bRep ? {
          successScore: bScore,
          steps: avg(bRuns.map(r => r.metrics.stepCount)),
          timeMs: avg(bRuns.map(r => r.metrics.completionTimeMs)),
          taskDrift: buildTaskDrift(bRep.taskHistory),
        } : null,
        weightedScore: { A: weight * aScore, B: weight * bScore },
      }
    })

    const weightedPersonaScore = {
      A: subAgents.reduce((s, sa) => s + sa.weightedScore.A, 0),
      B: subAgents.reduce((s, sa) => s + sa.weightedScore.B, 0),
    }

    return { personaName, groupWeight, subAgents, weightedPersonaScore }
  })

  const overallScore = {
    A: personaScores.reduce((s, ps) => s + ps.groupWeight * ps.weightedPersonaScore.A, 0),
    B: personaScores.reduce((s, ps) => s + ps.groupWeight * ps.weightedPersonaScore.B, 0),
  }

  const diff = overallScore.A - overallScore.B
  const popWinner: PopulationModel['winner'] = Math.abs(diff) < 0.05 ? 'tie' : diff > 0 ? 'A' : 'B'

  return { personaScores, overallScore, winner: popWinner }
}

const avg = (nums: number[]) => nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0

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
