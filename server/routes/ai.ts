import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';
import type { ActivityEntry, Session, Task } from '../types.ts';

// v4.3.5 P1 — typed AI endpoint + response shapes (minimal, matches what we consume)
type AIEndpointType = 'anthropic' | 'openai' | 'ollama';
interface AIEndpointConfig { name: string; base: string; type: AIEndpointType }

interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

interface AIModel { id: string; name: string; size?: number }
interface DetectResultAvailable {
  available: true;
  provider: string;
  base: string;
  type: AIEndpointType;
  models: AIModel[];
}
interface DetectResultUnavailable { available: false }
type DetectResult = DetectResultAvailable | DetectResultUnavailable;

// Response shapes from the three supported AI backends. Only fields we actually read.
interface OpenAIModelsResponse { data?: Array<{ id: string }> }
interface OllamaModelsResponse { models?: Array<{ name: string; size?: number }> }
interface AnthropicMessagesResponse { content?: Array<{ type?: string; text?: string }> }
interface OpenAIChatResponse { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> }
interface OllamaChatResponse { message?: { content?: string } }

// LM Studio / Ollama auto-detection
// Anthropic endpoint first -- cleaner response for thinking models (no empty content issue)
const AI_ENDPOINTS: AIEndpointConfig[] = [
  { name: 'LM Studio (Anthropic)', base: 'http://localhost:1234/v1', type: 'anthropic' },
  { name: 'LM Studio', base: 'http://localhost:1234/v1', type: 'openai' },
  { name: 'Ollama', base: 'http://localhost:11434', type: 'ollama' },
];

async function detectAI(): Promise<DetectResult> {
  for (const ep of AI_ENDPOINTS) {
    try {
      if (ep.type === 'anthropic') {
        // Probe Anthropic endpoint with a tiny request
        await fetch(`${ep.base}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': 'none' },
          body: JSON.stringify({ model: 'test', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
          signal: AbortSignal.timeout(3000),
        });
        // LM Studio returns 200 even with wrong model -- or a model list via /models
        const modelsRes = await fetch(`${ep.base}/models`, { signal: AbortSignal.timeout(2000) });
        if (!modelsRes.ok) continue;
        const modelsData: OpenAIModelsResponse = await modelsRes.json();
        const models: AIModel[] = (modelsData.data || [])
          .filter((m) => !m.id.includes('embed'))
          .map((m) => ({ id: m.id, name: m.id }));
        if (models.length === 0) continue;
        return { available: true, provider: ep.name, base: ep.base, type: 'anthropic', models };
      }

      const modelsUrl = ep.type === 'ollama' ? `${ep.base}/api/tags` : `${ep.base}/models`;
      const res = await fetch(modelsUrl, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) continue;

      let models: AIModel[] = [];
      if (ep.type === 'ollama') {
        const data: OllamaModelsResponse = await res.json();
        models = (data.models || []).map((m) => ({ id: m.name, name: m.name, size: m.size }));
      } else {
        const data: OpenAIModelsResponse = await res.json();
        models = (data.data || []).filter((m) => !m.id.includes('embed')).map((m) => ({ id: m.id, name: m.id }));
      }
      if (models.length === 0) continue;

      return { available: true, provider: ep.name, base: ep.base, type: ep.type, models };
    } catch {}
  }
  return { available: false };
}

async function chat(base: string, type: AIEndpointType, model: string, messages: ChatMessage[], maxTokens = 512): Promise<string> {
  // ── Anthropic Messages API (preferred -- clean output, no thinking model issues) ──
  if (type === 'anthropic') {
    // Anthropic format: system is separate, messages are user/assistant only
    const systemMsg = messages.find((m) => m.role === 'system');
    const chatMsgs = messages.filter((m) => m.role !== 'system');

    // Anthropic body shape — `system` is optional string, messages are user/assistant only.
    const body: { model: string; max_tokens: number; messages: ChatMessage[]; system?: string } = {
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
    const data: AnthropicMessagesResponse = await res.json();
    // Anthropic format: content is array of {type, text} blocks
    const textBlocks = (data.content || []).filter((b) => b.type === 'text');
    return textBlocks.map((b) => b.text || '').join('\n').trim();
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

  if (type === 'ollama') {
    const data: OllamaChatResponse = await res.json();
    return data.message?.content || '';
  }
  const data: OpenAIChatResponse = await res.json();
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

    const messages: ChatMessage[] = [];
    if (system) messages.push({ role: 'system', content: system });
    if (context) messages.push({ role: 'user', content: `Context:\n${context}` });
    messages.push({ role: 'user', content: prompt });

    try {
      const response = await chat(ai.base, ai.type, selectedModel, messages);
      res.json({ response, model: selectedModel, provider: ai.provider });
    } catch (err) {
      res.json({ error: (err as Error).message });
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
    const recentActivity = activity.slice(0, 15).map((a: ActivityEntry) => `- ${a.message}`);
    const recentSessions = sessions.slice(0, 3).map((s: Session) => `- [${s.project}] ${s.summary.slice(0, 80)}`);
    const openTaskList = tasks.filter((t: Task) => t.status !== 'done').map((t: Task) => t.title).join(', ') || 'none';

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
    } catch (err) {
      res.json({ error: (err as Error).message });
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
    } catch (err) {
      res.json({ error: (err as Error).message });
    }
  });

  return router;
}
