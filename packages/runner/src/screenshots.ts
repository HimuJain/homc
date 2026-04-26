import { chromium } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'

const VARIANT_URLS: Record<'A' | 'B', string> = {
  A: process.env.VARIANT_A_URL ?? 'http://localhost:5174/variant-a.html',
  B: process.env.VARIANT_B_URL ?? 'http://localhost:5174/variant-b.html',
}

const SCREENSHOTS_DIR = path.join(__dirname, '..', '..', '..', 'apps', 'web', 'public', 'screenshots')

export async function captureVariantScreenshots(): Promise<void> {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })

  for (const variant of ['A', 'B'] as const) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    try {
      await page.goto(VARIANT_URLS[variant], { timeout: 10000 })
      await page.waitForLoadState('networkidle').catch(() => {})
      const file = variant === 'A' ? 'variant-a-full.png' : 'variant-b-full.png'
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, file), fullPage: true })
      console.log(`[Screenshots] Variant ${variant} → public/screenshots/${file}`)
    } finally {
      await page.close()
    }
  }

  await browser.close()
}
