import { config } from 'dotenv'
import { join } from 'path'
config({ path: join(__dirname, '..', '..', '..', '.env') })

import express from 'express'
import cors from 'cors'
import * as fs from 'fs'
import * as path from 'path'
import OpenAI from 'openai'
import type { SubAgentType, Summary } from '@homc/shared'
import { loadSimConfig, clearSimConfigCache, writeSimConfig } from './config'
import { rebuildSummary } from './logger'

const openai = new OpenAI()

const app = express()
app.use(cors())
app.use(express.json())

const LOGS_DIR = path.join(__dirname, '..', '..', '..', 'logs')

app.get('/api/summary', (_req, res) => {
  const summaryPath = path.join(LOGS_DIR, 'summary.json')
  if (!fs.existsSync(summaryPath)) {
    return res.json({ runCount: 0, variants: { A: null, B: null }, personaResults: [], winner: null })
  }
  res.json(JSON.parse(fs.readFileSync(summaryPath, 'utf-8')))
})

app.get('/api/results', (_req, res) => {
  if (!fs.existsSync(LOGS_DIR)) return res.json([])
  const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.json') && f !== 'summary.json')
  const results = files.map(f => JSON.parse(fs.readFileSync(path.join(LOGS_DIR, f), 'utf-8')))
  res.json(results)
})

app.get('/api/results/:id', (req, res) => {
  const filePath = path.join(LOGS_DIR, `${req.params.id}.json`)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' })
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')))
})

app.get('/api/heatmap', (req, res) => {
  const clicksPath = path.join(LOGS_DIR, 'clicks.json')
  if (!fs.existsSync(clicksPath)) return res.json([])
  let clicks: any[] = []
  try {
    clicks = JSON.parse(fs.readFileSync(clicksPath, 'utf-8'))
  } catch {
    return res.json([])
  }
  const { task, persona, variant } = req.query
  if (task) clicks = clicks.filter((c: any) => c.taskId === task)
  if (persona && persona !== 'all') {
    clicks = clicks.filter((c: any) => c.personaName?.split(' ')[0] === persona)
  }
  if (variant) clicks = clicks.filter((c: any) => c.variant === variant)
  res.json(clicks)
})

app.post('/api/suggestions', async (_req, res) => {
  const summaryPath = path.join(LOGS_DIR, 'summary.json')
  if (!fs.existsSync(summaryPath)) {
    return res.status(400).json({ error: 'No simulation data yet. Run the simulator first.' })
  }

  const summary: Summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))
  if (!summary.variants?.A || !summary.variants?.B) {
    return res.status(400).json({ error: 'Incomplete simulation data — need both variants.' })
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`
  const ms = (v: number) => `${(v / 1000).toFixed(1)}s`

  const taskLines = Object.values(summary.tasks ?? {}).map(t =>
    `  • "${t.taskGoal}": A=${pct(t.A.successRate)} (${t.A.avgStepCount.toFixed(1)} steps) vs B=${pct(t.B.successRate)} (${t.B.avgStepCount.toFixed(1)} steps), winner=${t.winner ?? 'unclear'}\n` +
    (t.A.topFrictionPoints.length ? `    A friction: ${t.A.topFrictionPoints.slice(0, 2).join(' | ')}\n` : '') +
    (t.B.topFrictionPoints.length ? `    B friction: ${t.B.topFrictionPoints.slice(0, 2).join(' | ')}` : '')
  ).join('\n')

  const personaLines = (summary.personaResults ?? []).map(p =>
    `  • ${p.personaName}: A=${p.variantA ? pct(p.variantA.successScore) : 'n/a'} (${p.variantA?.steps.toFixed(0) ?? '?'} steps) | B=${p.variantB ? pct(p.variantB.successScore) : 'n/a'} (${p.variantB?.steps.toFixed(0) ?? '?'} steps)`
  ).join('\n')

  const prompt = `You are a senior UX designer reviewing results from an AI-powered A/B test simulation. Simulated user personas completed tasks on two variants of a web product. Your job is to suggest concrete, actionable UI/UX improvements.

SIMULATION OVERVIEW (${summary.runCount} runs total, overall winner: ${summary.winner ?? 'unclear'}):

VARIANT A — overall success ${pct(summary.variants.A.successRate)}, avg ${ms(summary.variants.A.avgCompletionTimeMs)}, avg ${summary.variants.A.avgStepCount.toFixed(1)} steps
Top friction: ${summary.variants.A.topFrictionPoints.slice(0, 3).join(' | ') || 'none'}

VARIANT B — overall success ${pct(summary.variants.B.successRate)}, avg ${ms(summary.variants.B.avgCompletionTimeMs)}, avg ${summary.variants.B.avgStepCount.toFixed(1)} steps
Top friction: ${summary.variants.B.topFrictionPoints.slice(0, 3).join(' | ') || 'none'}

PER-TASK BREAKDOWN:
${taskLines}

PERSONA PATTERNS (success score | steps — higher-patience personas tolerate more friction, low-patience ones abandon quickly):
${personaLines}

Return ONLY a JSON object in this exact shape, no markdown, no explanation outside the JSON:
{
  "variantA": ["suggestion 1", "suggestion 2", ...],
  "variantB": ["suggestion 1", "suggestion 2", ...]
}

Rules:
- 5 to 7 bullets per variant
- Each bullet is a single, specific, actionable UX fix or recommendation
- Reference cross-variant comparisons where meaningful (e.g. "Unlike Variant B, Variant A…")
- Speak at a high level about user types (e.g. "impatient users", "privacy-conscious users") — do not name individual personas
- Focus on UI/UX improvements only — not simulation methodology`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = completion.choices[0]?.message?.content?.trim() ?? ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as { variantA: string[]; variantB: string[] }

    if (!Array.isArray(parsed.variantA) || !Array.isArray(parsed.variantB)) {
      throw new Error('Unexpected response shape')
    }

    res.json(parsed)
  } catch (err) {
    res.status(500).json({ error: `AI call failed: ${(err as Error).message}` })
  }
})

app.get('/api/weights', (_req, res) => {
  try {
    res.json(loadSimConfig())
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/weights', (req, res) => {
  try {
    const { personaGroupWeights, personaSubAgentWeights } = req.body as {
      personaGroupWeights: Record<string, number>
      personaSubAgentWeights: Record<string, Record<SubAgentType, number>>
    }

    if (!personaGroupWeights || !personaSubAgentWeights) {
      return res.status(400).json({ error: 'Missing personaGroupWeights or personaSubAgentWeights' })
    }

    const groupSum = Object.values(personaGroupWeights).reduce((a, b) => a + b, 0)
    if (Math.abs(groupSum - 1.0) > 0.001) {
      return res.status(400).json({ error: `Persona group weights sum to ${groupSum.toFixed(4)}, expected 1.0` })
    }

    for (const [pKey, weights] of Object.entries(personaSubAgentWeights)) {
      const sum = Object.values(weights).reduce((a, b) => a + b, 0)
      if (Math.abs(sum - 1.0) > 0.001) {
        return res.status(400).json({ error: `${pKey} sub-agent weights sum to ${sum.toFixed(4)}, expected 1.0` })
      }
    }

    clearSimConfigCache()
    writeSimConfig({ personaGroupWeights, personaSubAgentWeights })
    rebuildSummary()

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

const PORT = process.env.API_PORT ?? 3001
app.listen(PORT, () => {
  console.log(`[API] Running on http://localhost:${PORT}`)
  console.log(`[API] Reading logs from: ${LOGS_DIR}`)
})
