import { chromium } from 'playwright'
import type { Persona, Task, RunResult, Step } from '@homc/shared'
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
): Promise<RunResult> {
  console.log(`  → Variant ${variant} | ${persona.name}`)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

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

      // Deterministic check first — never rely solely on LLM judgment.
      if (isSuccessDeterministic(task.id, pageText)) {
        success = true
        console.log(`    ✓ Done at step ${i + 1}: success text confirmed on page`)
        break
      }

      const action = await decideAction(persona, task, screenshot, url, pageText, pageElements, steps)

      if (action.type === 'done') {
        if (isSuccessDeterministic(task.id, pageText)) {
          success = true
          console.log(`    ✓ Done at step ${i + 1}: ${action.reason}`)
        } else {
          console.log(`    ⚠ Agent claimed done but no success text found — marking failed`)
        }
        break
      }

      if (action.type === 'fail') {
        frictionPoints.push(action.reason)
        console.log(`    ✗ Failed at step ${i + 1}: ${action.reason}`)
        break
      }

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

      // Programmatic bail for very impatient personas: if same action repeated 3 times, they give up
      if (persona.patience < 0.25 && steps.length >= 3) {
        const last3 = steps.slice(-3).map(s => JSON.stringify(s.action))
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
          const reason = `Gave up after ${steps.length} steps — repeated same action, too much friction`
          frictionPoints.push(reason)
          console.log(`    ✗ Patience bail at step ${steps.length}: ${reason}`)
          break
        }
      }
    }

    if (!success && steps.length >= MAX_STEPS) {
      frictionPoints.push(`Reached max step limit (${MAX_STEPS}) without completing task`)
      console.log(`    ✗ Hit max step limit (${MAX_STEPS}) — task not completed`)
    }
  } finally {
    await browser.close()
  }

  const endedAt = Date.now()
  const metrics = computeMetrics(steps, success, endedAt - startedAt)

  const result: RunResult = {
    id: crypto.randomUUID(),
    variant,
    persona,
    task,
    success,
    steps,
    metrics,
    startedAt,
    endedAt,
    frictionPoints,
  }

  await writeRunResult(result)
  return result
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
