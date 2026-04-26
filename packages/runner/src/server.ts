import { config } from 'dotenv'
import { join } from 'path'
config({ path: join(__dirname, '..', '..', '..', '.env') })

import express from 'express'
import cors from 'cors'
import * as fs from 'fs'
import * as path from 'path'
import type { SubAgentType } from '@homc/shared'
import { loadSimConfig, clearSimConfigCache, writeSimConfig } from './config'
import { rebuildSummary } from './logger'

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
