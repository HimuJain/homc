import { config } from 'dotenv'
import { join } from 'path'
config({ path: join(__dirname, '..', '..', '..', '.env') })
import { personas } from './personas'
import { tasks } from './tasks'
import { runSimulation } from './runner'

const VARIANTS: Array<'A' | 'B'> = ['A', 'B']
const SELECTED_PERSONAS = personas.slice(0, 5)
const SELECTED_TASKS = tasks

async function main() {
  console.log('=== AI UX Simulator ===')
  console.log(`Tasks: ${SELECTED_TASKS.map(t => t.id).join(', ')}`)
  console.log(`Personas: ${SELECTED_PERSONAS.map(p => p.name).join(', ')}`)
  console.log(`Variants: A, B\n`)

  const results = []

  for (const task of SELECTED_TASKS) {
    console.log(`\n=== Task: ${task.goal} ===`)
    for (const variant of VARIANTS) {
      console.log(`\n[Variant ${variant}]`)
      for (const persona of SELECTED_PERSONAS) {
        const result = await runSimulation(variant, persona, task)
        results.push(result)
      }
    }
  }

  console.log('\n=== Simulation Complete ===')
  for (const task of SELECTED_TASKS) {
    const taskResults = results.filter(r => r.task.id === task.id)
    const aRate = taskResults.filter(r => r.variant === 'A' && r.success).length / SELECTED_PERSONAS.length
    const bRate = taskResults.filter(r => r.variant === 'B' && r.success).length / SELECTED_PERSONAS.length
    console.log(`[${task.id}] A: ${Math.round(aRate * 100)}% | B: ${Math.round(bRate * 100)}%`)
  }
  console.log(`\nLogs written to /logs. Open the dashboard to see full results.`)
}

main().catch(err => {
  console.error('Simulation failed:', err)
  process.exit(1)
})
