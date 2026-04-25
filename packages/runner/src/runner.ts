import { chromium } from 'playwright'
import type { Persona, Task, RunResult, Step, TaskHistoryEntry } from '@homc/shared'
import { computeMetrics } from '@homc/eval'
import { decideAction } from './agent'
import { writeRunResult } from './logger'

const VARIANT_URLS: Record<'A' | 'B', string> = {
  A: process.env.VARIANT_A_URL ?? 'http://localhost:5174/variant-a.html',
  B: process.env.VARIANT_B_URL ?? 'http://localhost:5174/variant-b.html',
}

const MAX_STEPS = 15
const ACTION_TIMEOUT = 8000

// Task-specific success patterns — prevents pricing text on the home page from
// falsely triggering success for the create-account or learn-about-company tasks.
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

function isSuccessDeterministic(taskId: string, pageText: string): boolean {
  const lower = pageText.toLowerCase()
  return (SUCCESS_PATTERNS[taskId] ?? []).some(p => lower.includes(p))
}

export async function runSimulation(
  variant: 'A' | 'B',
  persona: Persona,
  task: Task,
  allTasks: Task[],
): Promise<RunResult> {
  console.log(`  → Variant ${variant} | ${persona.name}`)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  const originalTask = task
  let currentTask = task
  const taskStack: Task[] = []
  const taskHistory: TaskHistoryEntry[] = [
    { stepNumber: 0, taskId: task.id, taskGoal: task.goal, trigger: 'primary' }
  ]
  const resolvedTasks = new Map<string, boolean>()

  const startedAt = Date.now()
  const steps: Step[] = []
  const frictionPoints: string[] = []
  let success = false

  try {
    await page.goto(VARIANT_URLS[variant], { timeout: 10000 })

    for (let i = 0; i < MAX_STEPS; i++) {
      const stepStart = Date.now()
      const screenshot = await page.screenshot({ type: 'png' })
      const url = page.url()
      const pageText = await page.locator('body').innerText().catch(() => '')
      const pageElements = await extractPageElements(page)

      // Success check for current task
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

      // Chaos check - may switch to a different task
      const tasksInPlay = new Set([currentTask.id, ...taskStack.map(t => t.id)])
      const available = allTasks.filter(t => !tasksInPlay.has(t.id) && !resolvedTasks.has(t.id))
      if (available.length > 0 && Math.random() < persona.chaosRate) {
        const chaosTask = available[Math.floor(Math.random() * available.length)]
        console.log(`    ↳ Chaos at step ${i + 1}: ${currentTask.id} → ${chaosTask.id}`)
        frictionPoints.push(`Chaos distraction at step ${i + 1}: switched from ${currentTask.id} to ${chaosTask.id}`)
        taskStack.push(currentTask)
        currentTask = chaosTask
        taskHistory.push({ stepNumber: i + 1, taskId: chaosTask.id, taskGoal: chaosTask.goal, trigger: 'chaos' })
        // Immediate success check for new task on current page
        if (isSuccessDeterministic(currentTask.id, pageText)) {
          resolvedTasks.set(currentTask.id, true)
          setLastOutcome(taskHistory, currentTask.id, 'success')
          console.log(`    ✓ Completed ${currentTask.id} at step ${i + 1} (immediate)`)
          currentTask = taskStack.pop()!
          taskHistory.push({ stepNumber: i + 1, taskId: currentTask.id, taskGoal: currentTask.goal, trigger: 'return' })
          continue
        }
      }

      // Decide action (pass originalTask context when in chaos state)
      const inChaosState = taskStack.length > 0
      const action = await decideAction(
        persona, currentTask, screenshot, url, pageText, pageElements, steps,
        inChaosState ? originalTask : undefined,
        inChaosState ? persona.distractionDepth : undefined,
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
      try {
        await executeAction(page, action)
      } catch (err) {
        const msg = `Step ${i + 1}: Could not execute "${action.type}" on "${(action as any).selector ?? ''}"`
        frictionPoints.push(msg)
        console.log(`    ⚠ ${msg}`)
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
  success = resolvedTasks.get(originalTask.id) === true

  // Calculate successScore
  const primaryWeight = Math.max(0, 0.95 - persona.chaosRate * persona.distractionDepth)
  const chaosIds = [...new Set(taskHistory.map(e => e.taskId).filter(id => id !== originalTask.id))]
  const chaosAttempted = chaosIds.length
  const chaosCompleted = chaosIds.filter(id => resolvedTasks.get(id) === true).length
  const chaosScore = chaosAttempted > 0 ? chaosCompleted / chaosAttempted : 0
  const successScore = Math.max(0, Math.min(1,
    primaryWeight * (success ? 1 : 0) + (1 - primaryWeight) * chaosScore
  ))

  const metrics = computeMetrics(steps, success, endedAt - startedAt)

  const result: RunResult = {
    id: crypto.randomUUID(),
    variant,
    persona,
    task: originalTask,
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
    // Include a[id] so nav/action links (e.g. #nav-pricing, #pricing-link) are visible to the agent
    document.querySelectorAll('input, button, select, textarea, a[id]').forEach((el: any) => {
      const tag = el.tagName.toLowerCase()
      const id = el.id ? `#${el.id}` : ''
      // getAttribute returns only explicitly-set attributes; el.type includes browser defaults (e.g. buttons default to "submit")
      const typeAttr = el.getAttribute('type')
      const type = typeAttr ? `[type="${typeAttr}"]` : ''
      const name = el.name ? `[name="${el.name}"]` : ''
      const placeholder = el.placeholder ? ` — "${el.placeholder}"` : ''
      const dateHint = typeAttr === 'date' ? ' — format: YYYY-MM-DD (e.g. 1990-01-15)' : ''
      const text = el.textContent?.trim()
      // Always show text content for clickable elements so the agent understands what they do
      const clickText = (tag === 'a' || tag === 'button') && text ? ` "${text}"` : ''
      const label = id || name
        ? `${tag}${id}${type}${name}${placeholder}${dateHint}${clickText}`
        : `${tag}${type} "${text}"`
      if (label.trim()) lines.push(label)
    })
    return lines.join('\n')
  }).catch(() => '')
}

async function executeAction(page: any, action: Step['action']) {
  if (action.type === 'click') {
    try {
      await page.click(action.selector, { timeout: ACTION_TIMEOUT })
    } catch {
      await page.locator(action.selector).first().click({ timeout: ACTION_TIMEOUT, force: true })
    }
  } else if (action.type === 'fill') {
    try {
      await page.fill(action.selector, action.value, { timeout: ACTION_TIMEOUT })
    } catch {
      // Fallback: set value directly via evaluate (required for date inputs and stubborn fields)
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
}
