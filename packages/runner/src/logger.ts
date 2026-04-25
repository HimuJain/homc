import * as fs from 'fs'
import * as path from 'path'
import type { RunResult, Summary, VariantStats, PersonaResult } from '@homc/shared'

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
    const successCount = runs.filter(r => r.success).length
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
      successRate: successCount / runs.length,
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
      variantA: aRun ? { success: aRun.success, steps: aRun.metrics.stepCount, timeMs: aRun.metrics.completionTimeMs } : null,
      variantB: bRun ? { success: bRun.success, steps: bRun.metrics.stepCount, timeMs: bRun.metrics.completionTimeMs } : null,
    }
  })

  return {
    runCount: results.length,
    lastUpdated: Date.now(),
    variants: { A: aStats, B: bStats },
    personaResults,
    winner,
  }
}

const avg = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / nums.length
