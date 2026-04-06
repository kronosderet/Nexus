import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

// LM Studio / Ollama auto-detection
// Anthropic endpoint first -- cleaner response for thinking models (no empty content issue)
const AI_ENDPOINTS = [
  { name: 'LM Studio (Anthropic)', base: 'http://localhost:1234/v1', type: 'anthropic' },
  { name: 'LM Studio', base: 'http://localhost:1234/v1', type: 'openai' },
  { name: 'Ollama', base: 'http://localhost:11434', type: 'ollama' },
];

async function detectAI() {
  for (const ep of AI_ENDPOINTS) {
    try {
      if (ep.type === 'anthropic') {
        // Probe Anthropic endpoint with a tiny request
        const res = await fetch(`${ep.base}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': 'none' },
          body: JSON.stringify({ model: 'test', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
          signal: AbortSignal.timeout(3000),
        });
        // LM Studio returns 200 even with wrong model -- or a model list via /models
        const modelsRes = await fetch(`${ep.base}/models`, { signal: AbortSignal.timeout(2000) });
        if (!modelsRes.ok) continue;
        const modelsData: any = await modelsRes.json();
        const models = (modelsData.data || [])
          .filter((m: any) => !m.id.includes('embed'))
          .map((m: any) => ({ id: m.id, name: m.id }));
        if (models.length === 0) continue;
        return { available: true, provider: ep.name, base: ep.base, type: 'anthropic', models };
      }

      const modelsUrl = ep.type === 'ollama' ? `${ep.base}/api/tags` : `${ep.base}/models`;
      const res = await fetch(modelsUrl, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) continue;
      const data: any = await res.json();

      let models: any[] = [];
      if (ep.type === 'ollama') {
        models = (data.models || []).map((m: any) => ({ id: m.name, name: m.name, size: m.size }));
      } else {
        models = (data.data || []).filter((m: any) => !m.id.includes('embed')).map((m: any) => ({ id: m.id, name: m.id }));
      }
      if (models.length === 0) continue;

      return { available: true, provider: ep.name, base: ep.base, type: ep.type, models };
    } catch {}
  }
  return { available: false } as any;
}

async function chat(base: string, type: string, model: string, messages: any[], maxTokens = 512) {
  // ── Anthropic Messages API (preferred -- clean output, no thinking model issues) ──
  if (type === 'anthropic') {
    // Anthropic format: system is separate, messages are user/assistant only
    const systemMsg = messages.find((m: any) => m.role === 'system');
    const chatMsgs = messages.filter((m: any) => m.role !== 'system');

    const body: any = {
      model,
      max_tokens: maxTokens,
      messages: chatMsgs,
    };
    if (systemMsg) body.system = systemMsg.content;

    const res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'none' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`AI returned ${res.status}`);
    const data: any = await res.json();
    // Anthropic format: content is array of {type, text} blocks
    const textBlocks = (data.content || []).filter((b: any) => b.type === 'text');
    return textBlocks.map((b: any) => b.text).join('\n').trim();
  }

  // ── OpenAI / Ollama ──
  const url = type === 'ollama' ? `${base}/api/chat` : `${base}/chat/completions`;

  const body = type === 'ollama'
    ? { model, messages, stream: false }
    : { model, messages, max_tokens: maxTokens + 2048, temperature: 0.7 };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) throw new Error(`AI returned ${res.status}`);
  const data: any = await res.json();

  if (type === 'ollama') {
    return data.message?.content || '';
  }
  const choice = data.choices?.[0]?.message;
  const content = choice?.content || '';
  const reasoning = choice?.reasoning_content || '';

  if (content.trim()) return content.trim();

  // Thinking model fallback: extract from reasoning_content
  if (reasoning) {
    const paragraphs = reasoning.trim().split(/\n\n+/).filter((p: string) => p.trim().length > 15);
    if (paragraphs.length > 0) {
      return paragraphs.slice(-2).join('\n\n').replace(/^\s*[*•-]\s+/gm, '').trim();
    }
    return reasoning.replace(/^\s*[*•-]\s+/gm, '').replace(/\s+/g, ' ').trim().slice(-500);
  }
  return '';
}

export function createAIRoutes(store: NexusStore) {
  const router = Router();

  // Check what's available
  router.get('/status', async (req: Request, res: Response) => {
    const status = await detectAI();
    res.json(status);
  });

  // Chat completion
  router.post('/chat', async (req: Request, res: Response) => {
    const { prompt, model, system, context } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt required.' });

    const ai = await detectAI();
    if (!ai.available) {
      return res.json({ available: false, error: 'No local AI detected. Start LM Studio or Ollama.' });
    }

    const selectedModel = model || ai.models[0]?.id;
    if (!selectedModel) {
      return res.json({ available: true, error: 'No models loaded.' });
    }

    const messages: any[] = [];
    if (system) messages.push({ role: 'system', content: system });
    if (context) messages.push({ role: 'user', content: `Context:\n${context}` });
    messages.push({ role: 'user', content: prompt });

    try {
      const response = await chat(ai.base, ai.type, selectedModel, messages);
      res.json({ response, model: selectedModel, provider: ai.provider });
    } catch (err: any) {
      res.json({ error: err.message });
    }
  });

  // Summarize activity (uses local AI)
  router.post('/summarize', async (req: Request, res: Response) => {
    const { range = '24h' } = req.body;
    const ai = await detectAI();
    if (!ai.available) {
      return res.json({ available: false, error: 'No local AI detected.' });
    }

    // Gather data
    const activity = store.getActivity(100);
    const sessions = store.getSessions({ limit: 5 });
    const tasks = store.getAllTasks();

    // Keep context short for small models
    const recentActivity = activity.slice(0, 15).map((a: any) => `- ${a.message}`);
    const recentSessions = sessions.slice(0, 3).map((s: any) => `- [${s.project}] ${s.summary.slice(0, 80)}`);
    const openTaskList = tasks.filter((t: any) => t.status !== 'done').map((t: any) => t.title).join(', ') || 'none';

    const context = [
      `Activity (last ${range}): ${activity.length} events total.`,
      ...recentActivity,
      '',
      'Sessions:',
      ...recentSessions,
      '',
      `Open tasks: ${openTaskList}`,
    ].join('\n');

    try {
      const response = await chat(
        ai.base, ai.type, ai.models[0]?.id,
        [
          { role: 'system', content: 'You are Nexus, a workspace dashboard. Give a concise 3-4 sentence summary. Do not use bullet points. Write plain text only.' },
          { role: 'user', content: `Summarize this workspace activity in 3-4 plain sentences:\n\n${context}` },
        ],
        600
      );
      res.json({ summary: response, model: ai.models[0]?.id, provider: ai.provider });
    } catch (err: any) {
      res.json({ error: err.message });
    }
  });

  // Scratchpad AI assist
  router.post('/assist', async (req: Request, res: Response) => {
    const { code, language, instruction = 'Explain this code briefly.' } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required.' });

    const ai = await detectAI();
    if (!ai.available) return res.json({ available: false, error: 'No local AI detected.' });

    try {
      const response = await chat(
        ai.base, ai.type, ai.models[0]?.id,
        [
          { role: 'system', content: `You are a concise coding assistant. The code is ${language || 'unknown language'}.` },
          { role: 'user', content: `${instruction}\n\n\`\`\`${language}\n${code}\n\`\`\`` },
        ],
        500
      );
      res.json({ response, model: ai.models[0]?.id });
    } catch (err: any) {
      res.json({ error: err.message });
    }
  });

  return router;
}
