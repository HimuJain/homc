// Backfills clicks.json from existing run logs that pre-date coordinate capture.
// Assigns approximate normalized coordinates based on selector + URL context,
// converting viewport-relative y to page-relative y using actual screenshot heights.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGS_DIR = path.join(__dirname, '..', 'logs')
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'apps', 'web', 'public', 'screenshots')

// Read page height from PNG header (bytes 20-23 = height uint32 BE).
function pngHeight(filePath) {
  try {
    const buf = fs.readFileSync(filePath)
    return buf.readUInt32BE(20)
  } catch {
    return null
  }
}

const PAGE_HEIGHTS = {
  'variant-a':        pngHeight(path.join(SCREENSHOTS_DIR, 'variant-a-full.png')) ?? 1583,
  'variant-b':        pngHeight(path.join(SCREENSHOTS_DIR, 'variant-b-full.png')) ?? 949,
  'variant-a-signup': 900,   // estimated — no separate screenshot
  'variant-b-signup': 1100,  // estimated — longer form
  'variant-a-about':  1200,
  'variant-b-about':  1200,
}

const VIEWPORT_H = 800  // Playwright viewport height used during all runs

// For each selector, approximate position in the 800px viewport (x, viewportY).
// These are converted to page-relative y at write time using PAGE_HEIGHTS.
const VIEWPORT_COORDS = {
  // ── Shared navigation ──
  '#nav-home':      [0.05, 30],
  '#nav-about':     [0.72, 30],
  'a#nav-about':    [0.72, 30],
  'a#nav-pricing':  [0.81, 30],
  '#nav-signup':    [0.90, 30],
  'a#nav-signup':   [0.90, 30],
  '#nav-explore':   [0.65, 30],
  '#nav-resources': [0.73, 30],
  '#nav-portal':    [0.82, 30],
  '#nav-start':     [0.92, 30],
  // ── Cookie banner (Variant B, near top of overlay) ──
  '#btn-reject':  [0.35, 112],
  '#btn-manage':  [0.50, 112],
  '#btn-accept':  [0.65, 112],
  // ── Variant A home ──
  '#hero-cta':    [0.35, 290],
  // ── Variant B home ──
  '#hero-cta-join': [0.35, 370],
  '#pricing-link':  [0.43, 660],
  // ── Signup forms ──
  '#email':            [0.50, 220],
  '#password':         [0.50, 300],
  '#confirm-password': [0.50, 380],
  '#first-name':       [0.38, 380],
  '#last-name':        [0.62, 380],
  '#phone':            [0.50, 460],
  '#dob':              [0.50, 540],
  '#terms-check':      [0.28, 620],
  '#cta':              [0.50, 700],
  'button#cta':        [0.50, 700],
}

function jitter(v, amount = 0.018) {
  return Math.max(0, Math.min(1, v + (Math.random() * 2 - 1) * amount))
}

function pageKey(url) {
  const m = url?.match(/\/(variant-[ab](?:-\w+)?)\.html/)
  return m ? m[1] : null
}

function resolveCoords(selector, url) {
  const vc = VIEWPORT_COORDS[selector]
  if (!vc) return null
  const [vpX, vpY] = vc
  const key = pageKey(url)
  const pageH = PAGE_HEIGHTS[key] ?? VIEWPORT_H
  const normalizedY = Math.max(0, Math.min(1, vpY / pageH))
  return { x: jitter(vpX), y: jitter(normalizedY, 0.008) }
}

// Human-readable descriptions for common selectors.
const DESCRIPTIONS = {
  '#nav-home':         'Home / Logo',
  '#nav-about':        'About nav link',
  'a#nav-about':       'About nav link',
  'a#nav-pricing':     'Pricing nav link',
  '#nav-signup':       'Sign Up nav button',
  'a#nav-signup':      'Sign Up nav button',
  '#nav-explore':      'Explore nav link',
  '#nav-resources':    'Resources nav link',
  '#nav-portal':       'Member Portal nav link',
  '#nav-start':        'Get Started nav button',
  '#btn-reject':       'Reject cookies',
  '#btn-manage':       'Manage cookie prefs',
  '#btn-accept':       'Accept all cookies',
  '#hero-cta':         'Get Started Free hero CTA',
  '#hero-cta-join':    'Join Today hero CTA',
  '#pricing-link':     'Pricing info link',
  '#email':            'Email field',
  '#password':         'Password field',
  '#confirm-password': 'Confirm password field',
  '#first-name':       'First name field',
  '#last-name':        'Last name field',
  '#phone':            'Phone number field',
  '#dob':              'Date of birth field',
  '#terms-check':      'Accept terms checkbox',
  '#cta':              'Submit / CTA button',
  'button#cta':        'Submit / CTA button',
}

const files = fs.readdirSync(LOGS_DIR)
  .filter(f => f.endsWith('.json') && f !== 'summary.json' && f !== 'clicks.json')

const clicks = []

for (const file of files) {
  const run = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, file), 'utf-8'))
  const { variant, persona, task, subAgentType, success, endedAt, steps = [] } = run

  for (const step of steps) {
    if (step.action.type !== 'click') continue
    const coords = resolveCoords(step.action.selector, step.url)
    if (!coords) continue

    clicks.push({
      x: coords.x,
      y: coords.y,
      selector: step.action.selector,
      description: step.action.reason || DESCRIPTIONS[step.action.selector] || step.action.selector,
      taskId: task.id,
      personaName: persona.name,
      variant,
      subAgentType: subAgentType ?? 'A_00',
      success,
      timestamp: endedAt ?? step.timestamp,
    })
  }
}

fs.writeFileSync(path.join(LOGS_DIR, 'clicks.json'), JSON.stringify(clicks, null, 2))
console.log(`Wrote ${clicks.length} click events to logs/clicks.json`)
console.log(`  Variant A: ${clicks.filter(c => c.variant === 'A').length} clicks`)
console.log(`  Variant B: ${clicks.filter(c => c.variant === 'B').length} clicks`)
console.log(`  Page heights used — A: ${PAGE_HEIGHTS['variant-a']}px, B: ${PAGE_HEIGHTS['variant-b']}px`)
