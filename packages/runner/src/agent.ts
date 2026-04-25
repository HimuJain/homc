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
): Promise<Action> {
  const recentHistory = previousSteps
    .slice(-5)
    .map(s => `  Step ${s.stepNumber}: ${JSON.stringify(s.action)}`)
    .join('\n') || '  (none yet)'

  const patienceLabel = persona.patience < 0.4 ? 'impatient' : persona.patience > 0.7 ? 'patient' : 'moderately patient'
  const explorationLabel = persona.explorationDepth > 0.6 ? 'explores thoroughly' : 'sticks to obvious paths'

  const prompt = `You are simulating a real user interacting with a web page to complete a task.

PERSONA: ${persona.name}
- Behavior: ${persona.description}
- Patience: ${patienceLabel} (score: ${persona.patience}/1)
- Exploration style: ${explorationLabel}
- Speed: ${persona.speedBias > 0.6 ? 'fast, skips details' : 'slow, reads carefully'}
- Error tolerance: ${persona.errorTolerance < 0.3 ? 'very low — one obstacle = give up' : persona.errorTolerance > 0.6 ? 'high — keeps trying through errors' : 'moderate'}

TASK GOAL: ${task.goal}
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
- If extremely impatient persona (patience < 0.2) and stuck for 2+ steps, use "fail" immediately`

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
      const fallback = fallbackAction(task, url, pageText, previousSteps)
      console.warn('[Agent] Falling back to deterministic action:', fallback.reason)
      return fallback
    }
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    try {
      return JSON.parse(text) as Action
    } catch {
      console.error('[Agent] JSON parse failed. Raw response:', raw)
      const fallback = fallbackAction(task, url, pageText, previousSteps)
      console.warn('[Agent] Falling back to deterministic action:', fallback.reason)
      return fallback
    }
  } catch (err) {
    console.error('[Agent] API call failed:', (err as Error).message)
    const fallback = fallbackAction(task, url, pageText, previousSteps)
    console.warn('[Agent] Falling back to deterministic action:', fallback.reason)
    return fallback
  }
}

function fallbackAction(task: Task, url: string, pageText: string, previousSteps: Step[]): Action {
  const text = pageText.toLowerCase()
  const filledSelectors = new Set(
    previousSteps
      .flatMap(step => (step.action.type === 'fill' ? [step.action.selector] : [])),
  )
  const clickedSelectors = new Set(
    previousSteps
      .flatMap(step => (step.action.type === 'click' ? [step.action.selector] : [])),
  )
  const cookieDismissed = previousSteps.some(
    step => step.action.type === 'click' && step.action.selector === '#btn-accept',
  )

  if (
    text.includes('welcome to shopease') ||
    text.includes('registration submitted') ||
    text.includes('your account is ready') ||
    text.includes('verification email has been sent')
  ) {
    return { type: 'done', reason: 'Confirmation text is visible' }
  }

  if (!cookieDismissed && (text.includes('accept all cookies') || text.includes('cookie policy'))) {
    return { type: 'click', selector: '#btn-accept', reason: 'Dismiss the cookie consent banner' }
  }

  if (task.id === 'find-pricing') {
    const isVariantB = url.includes('variant-b') || text.includes('member portal') || text.includes('registration system v2.1')

    if (text.includes('free plan') || text.includes('plus plan') || text.includes('shopease member plans')) {
      return { type: 'done', reason: 'Pricing information is visible on screen' }
    }

    if (isVariantB) {
      const scrollCount = previousSteps.filter(s => s.action.type === 'scroll').length
      if (scrollCount < 3) {
        return { type: 'scroll', direction: 'down', reason: 'Scroll down to find the pricing link' }
      }
      return { type: 'click', selector: '#pricing-link', reason: 'Click the pricing link to view plans' }
    }

    return { type: 'click', selector: '#nav-pricing', reason: 'Click the Pricing link in the navigation bar' }
  }

  if (task.id === 'create-account') {
    const isVariantB = url.includes('variant-b') || text.includes('member portal') || text.includes('registration system v2.1')

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
