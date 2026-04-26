import { chromium } from 'playwright'
import type { Persona, Task, RunResult, Step, TaskHistoryEntry, SubAgentType } from '@homc/shared'
import { computeMetrics } from '@homc/eval'
import { decideAction } from './agent'
import { writeRunResult, appendClickEvents } from './logger'

const VARIANT_URLS: Record<'A' | 'B', string> = {
  A: process.env.VARIANT_A_URL ?? 'http://localhost:5174/variant-a.html',
  B: process.env.VARIANT_B_URL ?? 'http://localhost:5174/variant-b.html',
}

const MAX_STEPS = 15
const ACTION_TIMEOUT = 8000

const SUCCESS_PATTERNS: Record<string, string[]> = {
  'create-account': [
    'welcome to shopease!',
    'registration submitted',
    'account created for',
    'your account is ready',
    'verification email has been sent',
    'start saving today',
  ],
  'find-pricing': [
    'shopease member plans',
  ],
  'learn-about-company': [
    'shopease was founded in',
    'meet the team',
  ],
}

const TASK_KEYWORDS: Record<string, string[]> = {
  'find-pricing': ['pricing', 'plans', 'price', 'cost', 'subscribe', 'per month', '$', 'free plan', 'plus plan', 'member plan'],
  'create-account': ['sign up', 'signup', 'register', 'create account', 'join', 'get started', 'start for free'],
  'learn-about-company': ['about', 'team', 'story', 'founded', 'mission', 'our values', 'who we are', 'company'],
}

function isSuccessDeterministic(taskId: string, pageText: string): boolean {
  const lower = pageText.toLowerCase()
  return (SUCCESS_PATTERNS[taskId] ?? []).some(p => lower.includes(p))
}

// Picks the non-primary task most relevant to the current page's content.
function selectChaosTask(pageText: string, primaryTask: Task, allTasks: Task[]): Task {
  const lower = pageText.toLowerCase()
  const candidates = allTasks.filter(t => t.id !== primaryTask.id)
  let best = candidates[0]
  let bestScore = -1
  for (const t of candidates) {
    const score = (TASK_KEYWORDS[t.id] ?? []).filter(kw => lower.includes(kw)).length
    if (score > bestScore) { bestScore = score; best = t }
  }
  return best
}

function computeSuccessScore(
  subAgentType: SubAgentType,
  primarySuccess: boolean,
  chaosTask: Task | null,
  resolvedTasks: Map<string, boolean>,
): number {
  const chaosSuccess = chaosTask ? resolvedTasks.get(chaosTask.id) === true : false
  switch (subAgentType) {
    case 'A_00': return primarySuccess ? 1.0 : 0.0
    case 'A_10': return 0.80 * (primarySuccess ? 1 : 0) + 0.20 * (chaosSuccess ? 1 : 0)
    case 'A_11': return 0.60 * (primarySuccess ? 1 : 0) + 0.40 * (chaosSuccess ? 1 : 0)
    case 'A_12': return chaosSuccess ? 1.0 : 0.0
  }
}

export async function runSimulation(
  variant: 'A' | 'B',
  persona: Persona,
  task: Task,
  allTasks: Task[],
  subAgentType: SubAgentType,
): Promise<RunResult> {
  console.log(`  → Variant ${variant} | ${persona.name} [${subAgentType}]`)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  const originalTask = task
  let currentTask = task
  const taskStack: Task[] = []
  const taskHistory: TaskHistoryEntry[] = [
    { stepNumber: 0, taskId: task.id, taskGoal: task.goal, trigger: 'primary' }
  ]
  const resolvedTasks = new Map<string, boolean>()

  // Page-based chaos state (A_10, A_11, A_12 only)
  const pagesVisited = new Set<string>()
  let chaosEvaluated = false   // true once the evaluation window is closed
  let chaosFiredTask: Task | null = null

  const startedAt = Date.now()
  const steps: Step[] = []
  const frictionPoints: string[] = []
  const pendingClicks: Array<{ x: number; y: number; selector: string; description: string; taskId: string }> = []

  try {
    await page.goto(VARIANT_URLS[variant], { timeout: 10000 })

    for (let i = 0; i < MAX_STEPS; i++) {
      const stepStart = Date.now()
      const screenshot = await page.screenshot({ type: 'png' })
      const url = page.url()
      const pageText = await page.locator('body').innerText().catch(() => '')
      const pageElements = await extractPageElements(page)

      // === Page-entry chaos evaluation (A_10, A_11, A_12 only) ===
      if (subAgentType !== 'A_00' && !chaosEvaluated && !pagesVisited.has(url)) {
        pagesVisited.add(url)
        const pageNumber = pagesVisited.size

        let fireChaos = false
        if (pageNumber === 1) {
          fireChaos = Math.random() < 0.70
        } else {
          // Page 2+: guaranteed
          fireChaos = true
          chaosEvaluated = true
        }

        if (fireChaos) {
          chaosEvaluated = true
          const chaosTarget = selectChaosTask(pageText, originalTask, allTasks)
          chaosFiredTask = chaosTarget

          if (subAgentType === 'A_12') {
            // Abandon primary entirely — no stack push, no return planned
            console.log(`    ↳ Full chaos [${subAgentType}] at step ${i + 1}: abandoned ${currentTask.id}, now pursuing ${chaosTarget.id}`)
            frictionPoints.push(`Full chaos at step ${i + 1}: abandoned ${currentTask.id}, pursuing ${chaosTarget.id}`)
            taskHistory.push({ stepNumber: i + 1, taskId: chaosTarget.id, taskGoal: chaosTarget.goal, trigger: 'chaos' })
            currentTask = chaosTarget
          } else {
            // A_10 / A_11: push primary, pursue chaos, return after
            const modeLabel = subAgentType === 'A_11' ? 'blend' : 'return'
            console.log(`    ↳ Chaos [${subAgentType}/${modeLabel}] at step ${i + 1}: ${currentTask.id} → ${chaosTarget.id}`)
            frictionPoints.push(`Chaos distraction at step ${i + 1}: switched from ${currentTask.id} to ${chaosTarget.id}`)
            taskStack.push(currentTask)
            currentTask = chaosTarget
            taskHistory.push({ stepNumber: i + 1, taskId: chaosTarget.id, taskGoal: chaosTarget.goal, trigger: 'chaos' })
          }

          // Immediate success check on this page for the new task
          if (isSuccessDeterministic(currentTask.id, pageText)) {
            resolvedTasks.set(currentTask.id, true)
            setLastOutcome(taskHistory, currentTask.id, 'success')
            console.log(`    ✓ Completed ${currentTask.id} at step ${i + 1} (immediate after chaos)`)
            if (taskStack.length > 0) {
              currentTask = taskStack.pop()!
              taskHistory.push({ stepNumber: i + 1, taskId: currentTask.id, taskGoal: currentTask.goal, trigger: 'return' })
              continue
            }
            break
          }
        }
      } else if (!pagesVisited.has(url)) {
        // Track page visits even when chaos is off or already evaluated
        pagesVisited.add(url)
      }

      // === Success check for current task ===
      if (isSuccessDeterministic(currentTask.id, pageText)) {
        resolvedTasks.set(currentTask.id, true)
        setLastOutcome(taskHistory, currentTask.id, 'success')
        console.log(`    ✓ Completed ${currentTask.id} at step ${i + 1}`)
        if (taskStack.length > 0) {
          currentTask = taskStack.pop()!
          taskHistory.push({ stepNumber: i + 1, taskId: currentTask.id, taskGoal: currentTask.goal, trigger: 'return' })
          continue
        }
        break
      }

      // === Decide action ===
      // Pass chaos context based on sub-agent type
      const inStack = taskStack.length > 0
      const agentOriginalTask = inStack ? originalTask : undefined
      const agentDistractionDepth = (inStack && subAgentType === 'A_10') ? 0.3 : undefined
      const agentBlendMode = (inStack && subAgentType === 'A_11') ? true : undefined

      const action = await decideAction(
        persona, currentTask, screenshot, url, pageText, pageElements, steps,
        agentOriginalTask, agentDistractionDepth, agentBlendMode,
      )

      // Handle done
      if (action.type === 'done') {
        if (isSuccessDeterministic(currentTask.id, pageText)) {
          resolvedTasks.set(currentTask.id, true)
          setLastOutcome(taskHistory, currentTask.id, 'success')
          console.log(`    ✓ Done at step ${i + 1}: ${action.reason}`)
        } else {
          console.log(`    ⚠ Agent claimed done but no success text found — continuing`)
        }
        if (taskStack.length > 0) {
          currentTask = taskStack.pop()!
          taskHistory.push({ stepNumber: i + 1, taskId: currentTask.id, taskGoal: currentTask.goal, trigger: 'return' })
          continue
        }
        break
      }

      // Handle fail
      if (action.type === 'fail') {
        resolvedTasks.set(currentTask.id, false)
        setLastOutcome(taskHistory, currentTask.id, 'fail')
        frictionPoints.push(action.reason)
        console.log(`    ✗ Failed ${currentTask.id} at step ${i + 1}: ${action.reason}`)
        if (taskStack.length > 0) {
          currentTask = taskStack.pop()!
          taskHistory.push({ stepNumber: i + 1, taskId: currentTask.id, taskGoal: currentTask.goal, trigger: 'return' })
          continue
        }
        break
      }

      // Execute action
      let clickCoords: { x: number; y: number } | null = null
      try {
        clickCoords = await executeAction(page, action)
      } catch (err) {
        const msg = `Step ${i + 1}: Could not execute "${action.type}" on "${(action as any).selector ?? ''}"`
        frictionPoints.push(msg)
        console.log(`    ⚠ ${msg}`)
      }
      if (action.type === 'click' && clickCoords) {
        pendingClicks.push({ ...clickCoords, selector: action.selector, description: action.reason, taskId: currentTask.id })
      }

      steps.push({
        stepNumber: i + 1,
        timestamp: Date.now(),
        action,
        url,
        durationMs: Date.now() - stepStart,
      })

      // Patience bail for very impatient personas
      if (persona.patience < 0.25 && steps.length >= 3) {
        const last3 = steps.slice(-3).map(s => JSON.stringify(s.action))
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
          const reason = `Gave up after ${steps.length} steps — repeated same action`
          frictionPoints.push(reason)
          resolvedTasks.set(currentTask.id, false)
          setLastOutcome(taskHistory, currentTask.id, 'fail')
          console.log(`    ✗ Patience bail at step ${steps.length}: ${reason}`)
          if (taskStack.length > 0) {
            currentTask = taskStack.pop()!
            taskHistory.push({ stepNumber: steps.length, taskId: currentTask.id, taskGoal: currentTask.goal, trigger: 'return' })
          }
          break
        }
      }
    }

    // Post-loop: mark anything still unresolved
    if (!resolvedTasks.has(currentTask.id)) {
      resolvedTasks.set(currentTask.id, false)
      setLastOutcome(taskHistory, currentTask.id, 'incomplete')
      frictionPoints.push(`Reached max step limit (${MAX_STEPS}) without completing task`)
      console.log(`    ✗ Hit max step limit (${MAX_STEPS}) — task not completed`)
    }
    for (const t of taskStack) {
      if (!resolvedTasks.has(t.id)) {
        resolvedTasks.set(t.id, false)
        setLastOutcome(taskHistory, t.id, 'incomplete')
      }
    }

  } finally {
    await browser.close()
  }

  const endedAt = Date.now()
  const primarySuccess = resolvedTasks.get(originalTask.id) === true
  const success = subAgentType === 'A_12'
    ? (chaosFiredTask ? resolvedTasks.get(chaosFiredTask.id) === true : false)
    : primarySuccess

  const successScore = computeSuccessScore(subAgentType, primarySuccess, chaosFiredTask, resolvedTasks)
  const metrics = computeMetrics(steps, success, endedAt - startedAt)

  const result: RunResult = {
    id: crypto.randomUUID(),
    variant,
    persona,
    task: originalTask,
    subAgentType,
    success,
    successScore,
    taskHistory,
    steps,
    metrics,
    startedAt,
    endedAt,
    frictionPoints,
  }

  await writeRunResult(result)
  try {
    appendClickEvents(pendingClicks.map(c => ({
      x: c.x,
      y: c.y,
      selector: c.selector,
      description: c.description,
      taskId: c.taskId,
      personaName: persona.name,
      variant,
      subAgentType,
      success,
      timestamp: endedAt,
    })))
  } catch { /* non-fatal */ }
  return result
}

function setLastOutcome(
  history: TaskHistoryEntry[],
  taskId: string,
  outcome: 'success' | 'fail' | 'incomplete',
): void {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].taskId === taskId) {
      history[i].outcome = outcome
      return
    }
  }
}

async function extractPageElements(page: any): Promise<string> {
  return page.evaluate(() => {
    const lines: string[] = []
    document.querySelectorAll('input, button, select, textarea, a[id]').forEach((el: any) => {
      const tag = el.tagName.toLowerCase()
      const id = el.id ? `#${el.id}` : ''
      const typeAttr = el.getAttribute('type')
      const type = typeAttr ? `[type="${typeAttr}"]` : ''
      const name = el.name ? `[name="${el.name}"]` : ''
      const placeholder = el.placeholder ? ` — "${el.placeholder}"` : ''
      const dateHint = typeAttr === 'date' ? ' — format: YYYY-MM-DD (e.g. 1990-01-15)' : ''
      const text = el.textContent?.trim()
      const clickText = (tag === 'a' || tag === 'button') && text ? ` "${text}"` : ''
      const label = id || name
        ? `${tag}${id}${type}${name}${placeholder}${dateHint}${clickText}`
        : `${tag}${type} "${text}"`
      if (label.trim()) lines.push(label)
    })
    return lines.join('\n')
  }).catch(() => '')
}

async function executeAction(page: any, action: Step['action']): Promise<{ x: number; y: number } | null> {
  if (action.type === 'click') {
    let coords: { x: number; y: number } | null = null
    try {
      const box = await page.locator(action.selector).first().boundingBox({ timeout: 2000 })
      const vp = page.viewportSize()
      const [scrollY, scrollHeight] = await page.evaluate(
        () => [window.scrollY, document.documentElement.scrollHeight] as [number, number]
      ).catch(() => [0, 0] as [number, number])
      if (box && vp && scrollHeight > 0) {
        coords = {
          x: Math.max(0, Math.min(1, (box.x + box.width / 2) / vp.width)),
          y: Math.max(0, Math.min(1, (box.y + box.height / 2 + scrollY) / scrollHeight)),
        }
      }
    } catch { /* element not yet visible */ }
    try {
      await page.click(action.selector, { timeout: ACTION_TIMEOUT })
    } catch {
      await page.locator(action.selector).first().click({ timeout: ACTION_TIMEOUT, force: true })
    }
    return coords
  } else if (action.type === 'fill') {
    try {
      await page.fill(action.selector, action.value, { timeout: ACTION_TIMEOUT })
    } catch {
      const ok = await page.evaluate(([sel, val]: [string, string]) => {
        const el = document.querySelector(sel) as HTMLInputElement | null
        if (!el) return false
        el.value = val
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }, [action.selector, action.value]).catch(() => false)
      if (!ok) await page.locator(action.selector).first().fill(action.value)
    }
  } else if (action.type === 'scroll') {
    await page.evaluate(() => window.scrollBy(0, 300))
  }
  return null
}
