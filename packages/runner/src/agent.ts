import { config } from 'dotenv'
import { join } from 'path'
import OpenAI from 'openai'
import type { Persona, Task, Step, Action } from '@homc/shared'

config({ path: join(__dirname, '..', '..', '..', '.env') })

const client = new OpenAI()

export async function decideAction(
  persona: Persona,
  task: Task,
  screenshot: Buffer,
  url: string,
  pageText: string,
  pageElements: string,
  previousSteps: Step[],
  originalTask?: Task,
  distractionDepth?: number,
): Promise<Action> {
  const recentHistory = previousSteps
    .slice(-5)
    .map(s => `  Step ${s.stepNumber}: ${JSON.stringify(s.action)}`)
    .join('\n') || '  (none yet)'

  const patienceLabel = persona.patience < 0.4 ? 'impatient' : persona.patience > 0.7 ? 'patient' : 'moderately patient'
  const explorationLabel = persona.explorationDepth > 0.6 ? 'explores thoroughly' : 'sticks to obvious paths'

  // Build chaos context when in a distracted state
  let chaosContext = ''
  if (originalTask && distractionDepth !== undefined) {
    if (distractionDepth <= 0.5) {
      chaosContext = `\nBACKGROUND TASK (you still plan to complete this after): ${originalTask.goal}`
    } else if (distractionDepth <= 0.75) {
      chaosContext = `\nSECONDARY GOAL (return to this after current task resolves): ${originalTask.goal}`
    }
    // distractionDepth > 0.75: no mention of original task
  }

  const chaosRule = originalTask ? '\n- You got distracted from another task. Complete your CURRENT TASK GOAL first, then you will return.' : ''

  const prompt = `You are simulating a real user interacting with a web page to complete a task.

PERSONA: ${persona.name}
- Behavior: ${persona.description}
- Patience: ${patienceLabel} (score: ${persona.patience}/1)
- Exploration style: ${explorationLabel}
- Speed: ${persona.speedBias > 0.6 ? 'fast, skips details' : 'slow, reads carefully'}
- Error tolerance: ${persona.errorTolerance < 0.3 ? 'very low — one obstacle = give up' : persona.errorTolerance > 0.6 ? 'high — keeps trying through errors' : 'moderate'}

TASK GOAL: ${task.goal}${chaosContext}
SUCCESS CONDITION: ${task.successCondition}
CURRENT URL: ${url}

RECENT ACTIONS:
${recentHistory}

INTERACTIVE ELEMENTS ON THIS PAGE (use these exact selectors):
${pageElements || '(none detected)'}

Look at the screenshot and decide the single best next action to complete the task.

Respond with ONLY a JSON object (no markdown, no explanation):
- To click something: {"type":"click","selector":"#exact-id or selector from the list above","reason":"why"}
- To type in a field: {"type":"fill","selector":"#exact-id from the list above","value":"text to type","reason":"why"}
- To scroll: {"type":"scroll","direction":"down","reason":"why"}
- If task is complete: {"type":"done","reason":"what you see that confirms success"}
- If task is impossible: {"type":"fail","reason":"specific obstacle preventing completion"}

Rules:
- ALWAYS use selectors from the INTERACTIVE ELEMENTS list above — never guess attribute names
- If you see a success/confirmation screen, respond with "done"
- If there is a blocking overlay or cookie banner, click its dismiss/accept button first
- If you cannot find the target, scroll down to check below the fold before concluding the task is impossible
- If impatient persona (patience < 0.4) and stuck for 3+ steps, use "fail" rather than keep trying
- If extremely impatient persona (patience < 0.2) and stuck for 2+ steps, use "fail" immediately${chaosRule}`

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${screenshot.toString('base64')}`,
                detail: 'low',
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    })

    const raw = response.choices[0]?.message?.content?.trim() ?? ''
    if (!raw) {
      console.error('[Agent] Empty response from API')
      const fallback = fallbackAction(task, url, pageText, previousSteps, originalTask, distractionDepth)
      console.warn('[Agent] Falling back to deterministic action:', fallback.reason)
      return fallback
    }
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    try {
      return JSON.parse(text) as Action
    } catch {
      console.error('[Agent] JSON parse failed. Raw response:', raw)
      const fallback = fallbackAction(task, url, pageText, previousSteps, originalTask, distractionDepth)
      console.warn('[Agent] Falling back to deterministic action:', fallback.reason)
      return fallback
    }
  } catch (err) {
    console.error('[Agent] API call failed:', (err as Error).message)
    const fallback = fallbackAction(task, url, pageText, previousSteps, originalTask, distractionDepth)
    console.warn('[Agent] Falling back to deterministic action:', fallback.reason)
    return fallback
  }
}

function fallbackAction(task: Task, url: string, pageText: string, previousSteps: Step[], originalTask?: Task, distractionDepth?: number): Action {
  const text = pageText.toLowerCase()
  const filledSelectors = new Set(
    previousSteps.flatMap(s => (s.action.type === 'fill' ? [s.action.selector] : [])),
  )
  const clickedSelectors = new Set(
    previousSteps.flatMap(s => (s.action.type === 'click' ? [s.action.selector] : [])),
  )
  const cookieDismissed = previousSteps.some(
    s => s.action.type === 'click' && s.action.selector === '#btn-accept',
  )

  const isVariantB = url.includes('variant-b')
  const onSignupPage = url.includes('signup')
  const onAboutPage = url.includes('about')

  // Task-specific done checks
  const donePatterns: Record<string, string[]> = {
    'create-account': ['welcome to shopease!', 'registration submitted', 'account created for', 'your account is ready', 'verification email has been sent'],
    'find-pricing': ['shopease member plans'],
    'learn-about-company': ['shopease was founded in', 'meet the team'],
  }
  if ((donePatterns[task.id] ?? []).some(p => text.includes(p))) {
    return { type: 'done', reason: 'Task completion confirmed' }
  }

  // Cookie banner must be dismissed first on any B page
  if (!cookieDismissed && (text.includes('accept all cookies') || text.includes('cookie policy'))) {
    return { type: 'click', selector: '#btn-accept', reason: 'Dismiss the cookie consent banner' }
  }

  if (task.id === 'find-pricing') {
    if (isVariantB) {
      const scrollCount = previousSteps.filter(s => s.action.type === 'scroll').length
      if (scrollCount < 3) {
        return { type: 'scroll', direction: 'down', reason: 'Scroll down to find the pricing link' }
      }
      return { type: 'click', selector: '#pricing-link', reason: 'Click the pricing link to view plans' }
    }
    // Variant A: pricing is visible on the home page — scroll to it
    return { type: 'scroll', direction: 'down', reason: 'Scroll to the pricing section' }
  }

  if (task.id === 'learn-about-company') {
    if (isVariantB) {
      return { type: 'click', selector: '#nav-resources', reason: 'Click Resources to find company information' }
    }
    return { type: 'click', selector: '#nav-about', reason: 'Click About in navigation' }
  }

  if (task.id === 'create-account') {
    // Navigate from home to signup page first
    if (!onSignupPage) {
      if (isVariantB) {
        return { type: 'click', selector: '#nav-portal', reason: 'Navigate to Member Portal to find the signup form' }
      }
      return { type: 'click', selector: '#nav-signup', reason: 'Click Sign Up in navigation' }
    }

    // Now on the signup page — fill the form
    const orderedFields = isVariantB
      ? [
          ['#email', 'alex@example.com'],
          ['#password', 'Password123!'],
          ['#confirm-password', 'Password123!'],
          ['#first-name', 'Alex'],
          ['#last-name', 'User'],
          ['#phone', '+15555550123'],
          ['#dob', '1990-01-01'],
        ]
      : [
          ['#email', 'alex@example.com'],
          ['#password', 'Password123!'],
        ]

    for (const [selector, value] of orderedFields) {
      if (!filledSelectors.has(selector)) {
        return { type: 'fill', selector, value, reason: `Fill ${selector.replace('#', '')} to continue registration` }
      }
    }

    if (isVariantB && !clickedSelectors.has('#terms-check')) {
      return { type: 'click', selector: '#terms-check', reason: 'Accept the required terms' }
    }

    return { type: 'click', selector: '#cta', reason: 'Submit the completed signup form' }
  }

  return { type: 'fail', reason: 'No deterministic fallback is available for this task' }
}
