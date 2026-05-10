/**
 * Zod schemas for Nexus mutation endpoints. Co-located so future routes can
 * reuse and extend rather than re-derive shapes from `req.body` destructuring.
 *
 * Conventions:
 * - Optional fields use `.optional()` (not `.nullable()`) so missing keys are
 *   fine but `null` is rejected — matches the existing route behavior.
 * - Strings that the store will use as identifiers use `.trim().min(1)` so
 *   whitespace-only values are 400'd at the boundary, not silently coerced.
 * - Coerce numeric query params via `z.coerce.number()` since Express delivers
 *   query strings as `string`.
 */
import { z } from 'zod';

// ── Tasks ─────────────────────────────────────────────────

export const NewTaskSchema = z.object({
  title: z.string().trim().min(1, 'Task title required.'),
  description: z.string().optional(),
  status: z.enum(['backlog', 'in_progress', 'review', 'done']).optional(),
  priority: z.number().int().min(0).max(2).optional(),
  decision_ids: z.array(z.number().int()).optional(),
  project: z.string().trim().min(1).optional(),
});
export type NewTaskInput = z.infer<typeof NewTaskSchema>;

export const UpdateTaskSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['backlog', 'in_progress', 'review', 'done']).optional(),
  priority: z.number().int().min(0).max(2).optional(),
  project: z.string().trim().min(1).optional(),
  sort_order: z.number().optional(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

// ── Decisions / Ledger ────────────────────────────────────

export const NewDecisionSchema = z.object({
  decision: z.string().trim().min(1, 'Decision text required.'),
  context: z.string().optional(),
  project: z.string().trim().min(1).optional(),
  alternatives: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});
export type NewDecisionInput = z.infer<typeof NewDecisionSchema>;

// ── Sessions ──────────────────────────────────────────────

export const NewSessionSchema = z.object({
  project: z.string().trim().min(1),
  summary: z.string().trim().min(1, 'Session summary required.'),
  decisions: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  files_touched: z.array(z.string()).optional(),
});
export type NewSessionInput = z.infer<typeof NewSessionSchema>;

// ── Thoughts ──────────────────────────────────────────────

export const NewThoughtSchema = z.object({
  text: z.string().trim().min(1, 'Thought text required.'),
  context: z.string().optional(),
  project: z.string().trim().min(1).optional(),
  related_task_id: z.number().int().optional(),
});
export type NewThoughtInput = z.infer<typeof NewThoughtSchema>;

// ── Usage / Fuel ──────────────────────────────────────────

export const NewUsageSchema = z.object({
  session_percent: z.number().min(0).max(100).optional(),
  weekly_percent: z.number().min(0).max(100).optional(),
  sonnet_weekly_percent: z.number().min(0).max(100).optional(),
  reset_in_minutes: z.number().min(0).optional(),
  weekly_reset_in_hours: z.number().min(0).optional(),
  weekly_reset_at: z.string().optional(),
  plan: z.enum(['free', 'pro', 'max5', 'max20', 'team', 'team_premium', 'enterprise', 'api']).optional(),
  timezone: z.string().optional(),
  extra_usage: z.boolean().optional(),
  note: z.string().optional(),
});
export type NewUsageInput = z.infer<typeof NewUsageSchema>;

// ── Auto-link config (v4.8.0 #280) ────────────────────────

export const AutolinkConfigSchema = z.object({
  semanticThreshold: z.number().min(0.4).max(0.95),
});
export type AutolinkConfigInput = z.infer<typeof AutolinkConfigSchema>;

// ── Activity ──────────────────────────────────────────────

export const NewActivitySchema = z.object({
  type: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1, 'Activity message required.'),
});
export type NewActivityInput = z.infer<typeof NewActivitySchema>;
