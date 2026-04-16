/**
 * Shared AI endpoint detection — single source of truth.
 * Replaces duplicate AI_ENDPOINTS arrays across 7+ route files.
 */

export const AI_ENDPOINTS = [
  { name: 'LM Studio', base: 'http://localhost:1234/v1', type: 'openai' as const },
  { name: 'Ollama', base: 'http://localhost:11434', type: 'ollama' as const },
];

export const EMBED_URL = 'http://localhost:1234/v1/embeddings';
export const EMBED_MODEL = 'text-embedding-nomic-embed-text-v1.5';

export type AIConnection = {
  available: boolean;
  provider?: string;
  base?: string;
  type?: string;
  model?: string;
};

/** Detect first available local AI provider. */
export async function detectAI(): Promise<AIConnection> {
  for (const ep of AI_ENDPOINTS) {
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
