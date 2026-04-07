import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

/**
 * Auto-Summary: The Overseer writes session logs for you.
 *
 * Given the activity stream, completed tasks, and decisions since the last
 * session log, it generates a proper session summary with decisions and
 * blockers — then optionally saves it as a real session entry.
 */

const AI_ENDPOINTS = [
  { name: 'LM Studio (Anthropic)', base: 'http://localhost:1234/v1', type: 'anthropic' },
];

async function detectAI(): Promise<{ available: boolean; base?: string; model?: string }> {
  for (const ep of AI_ENDPOINTS) {
    try {
      const res = await fetch(`${ep.base}/models`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) continue;
      const data: any = await res.json();
      const models = (data.data || [])
        .filter((m: any) => !m.id.includes('embed'))
        .map((m: any) => m.id);
      if (models.length === 0) continue;
      return { available: true, base: ep.base, model: models[0] };
    } catch {}
  }
  return { available: false };
}

async function askAI(ai: any, system: string, prompt: string, maxTokens = 1000): Promise<string> {
  const res = await fetch(`${ai.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'none' },
    body: JSON.stringify({
      model: ai.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`AI ${res.status}`);
  const data: any = await res.json();
  return (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}

const SUMMARY_SYSTEM = `You are the Overseer writing a concise session log summary for Nexus.

Given the activity, completed tasks, and recent decisions from this work session, write a JSON response with this EXACT structure:

{
  "summary": "1-2 sentence narrative of what was accomplished this session",
  "decisions": ["decision 1", "decision 2", "decision 3"],
  "blockers": ["blocker 1"],
  "tags": ["tag1", "tag2"]
}

Rules:
- summary: concrete accomplishments, not vague process descriptions
- decisions: actual architectural/technical choices made (3-5 items max)
- blockers: things that got in the way (empty array if none)
- tags: 2-4 short tags summarizing the work
- Output ONLY valid JSON, no markdown code fences, no preamble
- Be factual and specific — reference actual task/version names`;

export function createAutoSummaryRoutes(store: NexusStore, broadcast: (data: any) => void) {
  const router = Router();

  // Preview: generate a summary but don't save
  router.get('/', async (req: Request, res: Response) => {
    const project = typeof req.query.project === 'string' ? req.query.project : 'Nexus';
    const summary = await generateSummary(store, project);
    res.json(summary);
  });

  // Commit: generate and save as an actual session entry
  router.post('/', async (req: Request, res: Response) => {
    const { project = 'Nexus' } = req.body || {};
    const result = await generateSummary(store, project);

    if (result.error || !result.parsed) {
      return res.status(400).json(result);
    }

    // Save as a real session
    const session = store.createSession({
      project,
      summary: result.parsed.summary,
      decisions: result.parsed.decisions || [],
      blockers: result.parsed.blockers || [],
      tags: [...(result.parsed.tags || []), 'auto-summary'],
    });

    const entry = store.addActivity('auto_summary', `Overseer auto-logged session for ${project}`);
    broadcast({ type: 'activity', payload: entry });
    broadcast({ type: 'session_created', payload: session });

    res.status(201).json({ session, source: result });
  });

  return router;
}

async function generateSummary(store: NexusStore, project: string) {
  const ai = await detectAI();
  if (!ai.available) {
    return { error: 'No local AI detected. Start LM Studio.' };
  }

  // ── Gather context since the last session log ──
  const sessions = store.getSessions({ project, limit: 1 });
  const lastSessionTime = sessions[0] ? new Date(sessions[0].created_at).getTime() : 0;

  // Activity since last session (or last 4 hours if never)
  const activity = store.getActivity(200).filter(a => {
    const t = new Date(a.created_at).getTime();
    return t > Math.max(lastSessionTime, Date.now() - 4 * 3600000);
  });

  // Tasks completed in this window
  const completedTasks = store.getAllTasks().filter(t => {
    if (t.status !== 'done') return false;
    const t2 = new Date(t.updated_at).getTime();
    return t2 > lastSessionTime;
  });

  // Decisions recorded in this window
  const recentDecisions = (store.data.ledger || []).filter(d => {
    const t = new Date(d.created_at).getTime();
    return t > lastSessionTime;
  });

  if (activity.length === 0 && completedTasks.length === 0 && recentDecisions.length === 0) {
    return { error: 'No activity to summarize since last session.' };
  }

  // ── Build context prompt ──
  const contextLines: string[] = [];
  contextLines.push(`PROJECT: ${project}`);
  if (sessions[0]) contextLines.push(`LAST SESSION: ${sessions[0].summary.slice(0, 150)}`);
  contextLines.push('');

  if (completedTasks.length > 0) {
    contextLines.push(`COMPLETED TASKS (${completedTasks.length}):`);
    for (const t of completedTasks.slice(0, 15)) contextLines.push(`  ✓ ${t.title}`);
    contextLines.push('');
  }

  if (recentDecisions.length > 0) {
    contextLines.push(`DECISIONS RECORDED (${recentDecisions.length}):`);
    for (const d of recentDecisions.slice(0, 10)) contextLines.push(`  · ${d.decision}`);
    contextLines.push('');
  }

  if (activity.length > 0) {
    contextLines.push(`ACTIVITY (last ${activity.length} events):`);
    for (const a of activity.slice(0, 30)) contextLines.push(`  - ${a.message.slice(0, 100)}`);
  }

  // ── Ask the AI ──
  try {
    const raw = await askAI(ai, SUMMARY_SYSTEM, contextLines.join('\n'));

    // Extract JSON (sometimes model wraps in code fences)
    let jsonText = raw.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) jsonText = fenceMatch[1];

    let parsed: any = null;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      // Try to find the first {...} block
      const braceMatch = raw.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try { parsed = JSON.parse(braceMatch[0]); } catch {}
      }
    }

    return {
      raw,
      parsed,
      context: {
        completedTasks: completedTasks.length,
        decisions: recentDecisions.length,
        activityEvents: activity.length,
      },
      model: ai.model,
    };
  } catch (err: any) {
    return { error: `AI failed: ${err.message}` };
  }
}
