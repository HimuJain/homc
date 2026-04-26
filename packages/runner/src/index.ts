import { config } from 'dotenv'
import { join } from 'path'
config({ path: join(__dirname, '..', '..', '..', '.env') })
import { personas } from './personas'
import { tasks } from './tasks'
import { runSimulation } from './runner'
import { loadSimConfig } from './config'
import { captureVariantScreenshots } from './screenshots'
import type { SubAgentType } from '@homc/shared'

const VARIANTS: Array<'A' | 'B'> = ['A', 'B']
const SELECTED_PERSONAS = personas.slice(0, 5)
const SELECTED_TASKS = tasks
const SUB_AGENT_TYPES: SubAgentType[] = ['A_00', 'A_10', 'A_11', 'A_12']

async function main() {
  const simConfig = loadSimConfig()

  console.log('=== AI UX Simulator ===')
  console.log(`Tasks: ${SELECTED_TASKS.map(t => t.id).join(', ')}`)
  console.log(`Personas: ${SELECTED_PERSONAS.map(p => p.name).join(', ')}`)
  console.log(`Sub-agents per persona: ${SUB_AGENT_TYPES.join(', ')}`)
  console.log(`Variants: A, B`)
  console.log(`Total runs: ${SELECTED_TASKS.length} tasks × ${VARIANTS.length} variants × ${SELECTED_PERSONAS.length} personas × ${SUB_AGENT_TYPES.length} sub-agents = ${SELECTED_TASKS.length * VARIANTS.length * SELECTED_PERSONAS.length * SUB_AGENT_TYPES.length}\n`)

  const results = []

  for (const task of SELECTED_TASKS) {
    console.log(`\n=== Task: ${task.goal} ===`)
    for (const variant of VARIANTS) {
      console.log(`\n[Variant ${variant}]`)
      for (const persona of SELECTED_PERSONAS) {
        for (const subAgentType of SUB_AGENT_TYPES) {
          const result = await runSimulation(variant, persona, task, SELECTED_TASKS, subAgentType)
          results.push(result)
        }
      }
    }
  }

  console.log('\n=== Simulation Complete ===')
  for (const task of SELECTED_TASKS) {
    const taskResults = results.filter(r => r.task.id === task.id)
    const aRuns = taskResults.filter(r => r.variant === 'A')
    const bRuns = taskResults.filter(r => r.variant === 'B')
    const aScore = aRuns.length > 0 ? aRuns.reduce((s, r) => s + r.successScore, 0) / aRuns.length : 0
    const bScore = bRuns.length > 0 ? bRuns.reduce((s, r) => s + r.successScore, 0) / bRuns.length : 0
    console.log(`[${task.id}] A: ${Math.round(aScore * 100)}% | B: ${Math.round(bScore * 100)}% (raw avg across all sub-agents)`)
  }

  // Population-weighted scores
  console.log('\n--- Population-Weighted Scores ---')
  const personaKeys = SELECTED_PERSONAS.map(p => p.name.split(' ')[0])
  for (const task of SELECTED_TASKS) {
    const taskResults = results.filter(r => r.task.id === task.id)
    let wA = 0; let wB = 0
    for (const pKey of personaKeys) {
      const persona = SELECTED_PERSONAS.find(p => p.name.startsWith(pKey))!
      const groupW = simConfig.personaGroupWeights[pKey] ?? (1 / SELECTED_PERSONAS.length)
      const saWeights = simConfig.personaSubAgentWeights[pKey] ?? {}
      const pRuns = taskResults.filter(r => r.persona.name === persona.name)
      let personaA = 0; let personaB = 0
      for (const saType of SUB_AGENT_TYPES) {
        const saW = saWeights[saType] ?? 0.25
        const aRun = pRuns.find(r => r.variant === 'A' && r.subAgentType === saType)
        const bRun = pRuns.find(r => r.variant === 'B' && r.subAgentType === saType)
        personaA += saW * (aRun?.successScore ?? 0)
        personaB += saW * (bRun?.successScore ?? 0)
      }
      wA += groupW * personaA
      wB += groupW * personaB
    }
    console.log(`[${task.id}] Weighted A: ${Math.round(wA * 100)}% | Weighted B: ${Math.round(wB * 100)}%`)
  }

  console.log(`\nLogs written to /logs. Open the dashboard to see full results.`)

  console.log('\nCapturing full-page screenshots of both variants…')
  await captureVariantScreenshots().catch(err =>
    console.warn('[Screenshots] Failed (non-fatal):', err.message)
  )
}

main().catch(err => {
  console.error('Simulation failed:', err)
  process.exit(1)
})
