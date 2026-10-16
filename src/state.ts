import { z } from 'zod';

export const FixSchema = z.object({ old: z.string().min(1).max(200000), new: z.string().max(200000) }).strict();
export const StartSchema = z.object({ mode: z.enum(['full', 'optimize-only']), input: z.string().min(1).max(200000), priorities: z.string().max(20000).optional() }).strict();
export const SubmitSchema = z.object({ run_id: z.uuid(), dispatch_id: z.uuid(), execution_id: z.string().trim().min(1).max(200), fresh_context: z.boolean(), output: z.string().min(1).max(200000) }).strict();
export const ArtifactSchema = z.object({ name: z.string().regex(/^\d{2}[a-z]?(?:-[a-z0-9]+)+\.md$/), kind: z.enum(['input', 'stage', 'rejected', 'final', 'provisional', 'fixed']), text: z.string() });
const DispatchSchema = z.object({ id: z.uuid(), skill: z.string(), stage: z.enum(['generate', 'judge', 'rewrite', 'confirm']), instructions: z.string(), input: z.record(z.string(), z.unknown()), attempt: z.number().int().min(0).max(1), validation_error: z.string().optional() });
const HistorySchema = z.object({ score: z.number().min(0).max(10), verdict: z.enum(['STOP', 'CONTINUE']), file: z.string(), prompt: z.string(), scorecard: z.string() });
export const RunSchema = z.object({
  schema_version: z.literal(1), id: z.uuid(), mode: z.enum(['full', 'optimize-only']), created_at: z.string(),
  status: z.enum(['running', 'paused', 'completed', 'capped', 'blocked', 'confirming']),
  original: z.string(), current: z.string(), priorities: z.string(), user_decisions: z.array(z.string()),
  skill_sources: z.record(z.string(), z.string()),
  history: z.array(HistorySchema).max(4), artifacts: z.array(ArtifactSchema),
  provenance: z.array(z.object({ dispatch_id: z.uuid(), execution_id: z.string(), skill: z.string(), fresh_context: z.literal(true), accepted: z.boolean(), brief: DispatchSchema, output_file: z.string(), submitted_at: z.string() })),
  dispatch: DispatchSchema.optional(), deferred: z.string(), reason: z.string().optional(),
  paused_dispatch: DispatchSchema.optional(),
  final: z.object({ file: z.string(), text: z.string(), approved: z.boolean(), label: z.string() }).optional(),
  fixes: z.array(FixSchema).optional(),
});
export type Run = z.infer<typeof RunSchema>;
export type Dispatch = NonNullable<Run['dispatch']>;
