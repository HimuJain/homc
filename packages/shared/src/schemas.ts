import { z } from 'zod'

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

export const RunResultSchema = z.object({
  id: z.string(),
  variant: z.enum(['A', 'B']),
  persona: PersonaSchema,
  task: TaskSchema,
  success: z.boolean(),
  steps: z.array(StepSchema),
  metrics: MetricsSchema,
  startedAt: z.number(),
  endedAt: z.number(),
  frictionPoints: z.array(z.string()),
})

export type Persona = z.infer<typeof PersonaSchema>
export type Task = z.infer<typeof TaskSchema>
export type Action = z.infer<typeof ActionSchema>
export type Step = z.infer<typeof StepSchema>
export type Metrics = z.infer<typeof MetricsSchema>
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
  variantA: { success: boolean; steps: number; timeMs: number } | null
  variantB: { success: boolean; steps: number; timeMs: number } | null
}

export interface Summary {
  runCount: number
  lastUpdated: number
  variants: { A: VariantStats; B: VariantStats }
  personaResults: PersonaResult[]
  winner: 'A' | 'B' | 'tie' | null
}
