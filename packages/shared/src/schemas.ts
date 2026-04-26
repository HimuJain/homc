import { z } from 'zod'

export const SubAgentTypeSchema = z.enum(['A_00', 'A_10', 'A_11', 'A_12'])

export const PersonaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  patience: z.number().min(0).max(1),
  trustThreshold: z.number().min(0).max(1),
  explorationDepth: z.number().min(0).max(1),
  errorTolerance: z.number().min(0).max(1),
  speedBias: z.number().min(0).max(1),
})

export const TaskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  preconditions: z.array(z.string()),
  successCondition: z.string(),
  failureCondition: z.string(),
})

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), selector: z.string(), reason: z.string() }),
  z.object({ type: z.literal('fill'), selector: z.string(), value: z.string(), reason: z.string() }),
  z.object({ type: z.literal('scroll'), direction: z.enum(['up', 'down']), reason: z.string() }),
  z.object({ type: z.literal('done'), reason: z.string() }),
  z.object({ type: z.literal('fail'), reason: z.string() }),
])

export const StepSchema = z.object({
  stepNumber: z.number(),
  timestamp: z.number(),
  action: ActionSchema,
  url: z.string(),
  durationMs: z.number(),
})

export const MetricsSchema = z.object({
  successRate: z.number(),
  completionTimeMs: z.number(),
  stepCount: z.number(),
  clickCount: z.number(),
  backtrackCount: z.number(),
  repeatedActionCount: z.number(),
  timeoutCount: z.number(),
  recoverySuccessRate: z.number(),
})

export const TaskHistoryEntrySchema = z.object({
  stepNumber: z.number(),
  taskId: z.string(),
  taskGoal: z.string(),
  trigger: z.enum(['primary', 'chaos', 'return']),
  outcome: z.enum(['success', 'fail', 'incomplete']).optional(),
})

export const RunResultSchema = z.object({
  id: z.string(),
  variant: z.enum(['A', 'B']),
  persona: PersonaSchema,
  task: TaskSchema,
  subAgentType: SubAgentTypeSchema.optional(),
  success: z.boolean(),
  successScore: z.number().min(0).max(1),
  taskHistory: z.array(TaskHistoryEntrySchema),
  steps: z.array(StepSchema),
  metrics: MetricsSchema,
  startedAt: z.number(),
  endedAt: z.number(),
  frictionPoints: z.array(z.string()),
})

export type SubAgentType = z.infer<typeof SubAgentTypeSchema>
export type Persona = z.infer<typeof PersonaSchema>
export type Task = z.infer<typeof TaskSchema>
export type Action = z.infer<typeof ActionSchema>
export type Step = z.infer<typeof StepSchema>
export type Metrics = z.infer<typeof MetricsSchema>
export type TaskHistoryEntry = z.infer<typeof TaskHistoryEntrySchema>
export type RunResult = z.infer<typeof RunResultSchema>

export interface VariantStats {
  runs: number
  successRate: number
  avgCompletionTimeMs: number
  avgStepCount: number
  avgClickCount: number
  topFrictionPoints: string[]
}

export interface PersonaResult {
  personaName: string
  variantA: { success: boolean; successScore: number; steps: number; timeMs: number; taskDrift: string } | null
  variantB: { success: boolean; successScore: number; steps: number; timeMs: number; taskDrift: string } | null
}

export interface TaskStats {
  taskId: string
  taskGoal: string
  A: VariantStats
  B: VariantStats
  personaResults: PersonaResult[]
  winner: 'A' | 'B' | 'tie' | null
}

export interface SubAgentResult {
  subAgentType: SubAgentType
  weight: number
  variantA: { successScore: number; steps: number; timeMs: number; taskDrift: string } | null
  variantB: { successScore: number; steps: number; timeMs: number; taskDrift: string } | null
  weightedScore: { A: number; B: number }
}

export interface PersonaWeightedScore {
  personaName: string
  groupWeight: number
  subAgents: SubAgentResult[]
  weightedPersonaScore: { A: number; B: number }
}

export interface PopulationModel {
  personaScores: PersonaWeightedScore[]
  overallScore: { A: number; B: number }
  winner: 'A' | 'B' | 'tie' | null
}

export interface Summary {
  runCount: number
  lastUpdated: number
  variants: { A: VariantStats; B: VariantStats }
  personaResults: PersonaResult[]
  winner: 'A' | 'B' | 'tie' | null
  tasks: Record<string, TaskStats>
  populationModel?: PopulationModel
}

export interface ClickEvent {
  x: number
  y: number
  selector: string
  description?: string
  taskId: string
  personaName: string
  variant: 'A' | 'B'
  subAgentType: SubAgentType
  success: boolean
  timestamp: number
}
