import type { Step, Metrics } from '@homc/shared'

export function computeMetrics(steps: Step[], success: boolean, totalTimeMs: number): Metrics {
  const clickCount = steps.filter(s => s.action.type === 'click').length

  let backtrackCount = 0
  const urlHistory: string[] = []
  for (const step of steps) {
    if (urlHistory.includes(step.url)) backtrackCount++
    urlHistory.push(step.url)
  }

  const actionKeys = steps.map(s => JSON.stringify(s.action))
  const repeatedActionCount = actionKeys.length - new Set(actionKeys).size

  return {
    successRate: success ? 1 : 0,
    completionTimeMs: totalTimeMs,
    stepCount: steps.length,
    clickCount,
    backtrackCount,
    repeatedActionCount,
    timeoutCount: 0,
    recoverySuccessRate: 0,
  }
}
