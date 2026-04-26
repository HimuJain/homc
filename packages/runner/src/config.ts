import * as fs from 'fs'
import * as path from 'path'
import type { SubAgentType } from '@homc/shared'

const CONFIG_DIR = path.join(__dirname, '..', 'config')

export interface SimConfig {
  personaGroupWeights: Record<string, number>
  personaSubAgentWeights: Record<string, Record<SubAgentType, number>>
}

function parseTxtConfig(filePath: string): Record<string, number> {
  const content = fs.readFileSync(filePath, 'utf-8')
  const result: Record<string, number> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = parseFloat(trimmed.slice(eqIdx + 1).trim())
    if (key && !isNaN(val)) result[key] = val
  }
  return result
}

function validateSum(weights: Record<string, number>, label: string): void {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(`${label} weights sum to ${sum.toFixed(4)}, expected 1.0`)
  }
}

let _cached: SimConfig | null = null

export function loadSimConfig(): SimConfig {
  if (_cached) return _cached

  const groupRaw = parseTxtConfig(path.join(CONFIG_DIR, 'persona-group-weights.txt'))
  validateSum(groupRaw, 'Persona group')

  const subAgentRaw = parseTxtConfig(path.join(CONFIG_DIR, 'persona-subagent-weights.txt'))

  const personaSubAgentWeights: Record<string, Record<SubAgentType, number>> = {}
  for (const [key, weight] of Object.entries(subAgentRaw)) {
    const dotIdx = key.indexOf('.')
    if (dotIdx === -1) continue
    const personaKey = key.slice(0, dotIdx)
    const agentType = key.slice(dotIdx + 1) as SubAgentType
    if (!personaSubAgentWeights[personaKey]) {
      personaSubAgentWeights[personaKey] = {} as Record<SubAgentType, number>
    }
    personaSubAgentWeights[personaKey][agentType] = weight
  }

  for (const [personaKey, weights] of Object.entries(personaSubAgentWeights)) {
    validateSum(weights, `${personaKey} sub-agent`)
  }

  _cached = { personaGroupWeights: groupRaw, personaSubAgentWeights }
  return _cached
}

export function personaConfigKey(personaName: string): string {
  return personaName.split(' ')[0]
}

export function clearSimConfigCache(): void {
  _cached = null
}

export function writeSimConfig(cfg: SimConfig): void {
  const groupLines = Object.entries(cfg.personaGroupWeights)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n'
  fs.writeFileSync(path.join(CONFIG_DIR, 'persona-group-weights.txt'), groupLines)

  const saLines: string[] = []
  for (const [personaKey, weights] of Object.entries(cfg.personaSubAgentWeights)) {
    for (const [saType, weight] of Object.entries(weights)) {
      saLines.push(`${personaKey}.${saType}=${weight}`)
    }
  }
  fs.writeFileSync(
    path.join(CONFIG_DIR, 'persona-subagent-weights.txt'),
    saLines.join('\n') + '\n',
  )

  _cached = cfg
}
