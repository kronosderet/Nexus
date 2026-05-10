/**
 * Runtime input validation at route boundaries via Zod.
 *
 * Closes #219 (deferred from the v4.3.6 audit). Express routes historically did
 * ad-hoc validation (`if (!body.title?.trim())`); this gives every mutation a
 * single source of truth for shape, range, and type before anything reaches
 * `NexusStore`. Malformed bodies fail fast with a 400 + descriptive message
 * instead of writing a partial/invalid object that the next reader has to
 * defensively guard against.
 *
 * Pattern: each route defines a schema (or imports one from `validators.ts`)
 * and uses `validateBody(schema, req.body)`. On success, returns the parsed
 * (typed) data. On failure, returns null and writes the 400 — caller just
 * `if (!parsed) return;`.
 */
import type { Request, Response } from 'express';
import type { ZodSchema, ZodError } from 'zod';

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues: ZodError['issues'] };

export function validate<T>(schema: ZodSchema<T>, input: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  // Surface the first issue's message for the user; preserve the full list for
  // anyone debugging via the response body.
  const first = parsed.error.issues[0];
  const path = first?.path?.length ? first.path.join('.') : '<body>';
  const message = `${path}: ${first?.message || 'invalid input'}`;
  return { ok: false, error: message, issues: parsed.error.issues };
}

/**
 * Convenience: validate `req.body`, write 400 + return `null` on failure, return
 * parsed data on success. Used like:
 *
 *   const body = validateBody(NewTaskSchema, req, res);
 *   if (!body) return; // 400 already sent
 *   store.createTask(body);
 */
export function validateBody<T>(schema: ZodSchema<T>, req: Request, res: Response): T | null {
  const result = validate(schema, req.body);
  if (result.ok) return result.data;
  res.status(400).json({ error: result.error, issues: result.issues });
  return null;
}
