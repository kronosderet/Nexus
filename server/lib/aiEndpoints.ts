/**
 * Shared AI endpoint detection — single source of truth.
 * Replaces duplicate AI_ENDPOINTS arrays across 7+ route files.
 *
 * v4.9.0 #736 — added 'anthropic' type so autoSummary.ts + plan.ts can use the
 * same detection path. Pre-fix they kept their own AI_ENDPOINTS arrays (one
 * with anthropic-only, one with anthropic+openai but no ollama). autoSummary
 * silently broke for Ollama-only users because of that local list.
 */

export type AIType = 'openai' | 'ollama' | 'anthropic';

export const AI_ENDPOINTS: Array<{ name: string; base: string; type: AIType }> = [
  { name: 'LM Studio', base: 'http://localhost:1234/v1', type: 'openai' },
  { name: 'Ollama', base: 'http://localhost:11434', type: 'ollama' },
];

/** Subset of endpoints that speak the Anthropic /messages shape. LM Studio
 *  exposes BOTH /v1/chat/completions (openai) and /v1/messages (anthropic) on
 *  the same port, so the entry shares its base with AI_ENDPOINTS[0]. Callers
 *  that specifically need /messages (autoSummary, plan, overseer) iterate this
 *  list instead. */
export const ANTHROPIC_ENDPOINTS: Array<{ name: string; base: string; type: AIType }> = [
  { name: 'LM Studio (Anthropic)', base: 'http://localhost:1234/v1', type: 'anthropic' },
];

export const EMBED_URL = 'http://localhost:1234/v1/embeddings';
export const EMBED_MODEL = 'text-embedding-nomic-embed-text-v1.5';

export type AIConnection = {
  available: boolean;
  provider?: string;
  base?: string;
  type?: AIType;
  model?: string;
};

/** Detect first available local AI provider matching the supplied endpoint list.
 *  Default: AI_ENDPOINTS (openai + ollama). Pass ANTHROPIC_ENDPOINTS to require
 *  the Anthropic shape. */
export async function detectAI(
  endpoints: Array<{ name: string; base: string; type: AIType }> = AI_ENDPOINTS,
): Promise<AIConnection> {
  for (const ep of endpoints) {
    try {
      const url = ep.type === 'ollama' ? `${ep.base}/api/tags` : `${ep.base}/models`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) continue;
      interface OpenAIModelsResponse { data?: Array<{ id: string }> }
      interface OllamaModelsResponse { models?: Array<{ name: string }> }
      const models = ep.type === 'ollama'
        ? ((await res.json() as OllamaModelsResponse).models || []).map((m) => m.name)
        : ((await res.json() as OpenAIModelsResponse).data || []).filter((m) => !m.id.includes('embed')).map((m) => m.id);
      if (models.length === 0) continue;
      return { available: true, provider: ep.name, base: ep.base, type: ep.type, model: models[0] };
    } catch {}
  }
  return { available: false };
}
