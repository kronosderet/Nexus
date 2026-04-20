// v4.4.8 #307 — unit tests for the contradiction-scan engine.
// Tests the pure helpers (pairing shortlist, JSON parsing) and store methods
// in isolation. The end-to-end route + LLM integration is covered by the
// mcpb smoke tests / live dashboard, not here.

import { describe, it, expect } from 'vitest';
import {
  shortlistContradictionPairs,
  buildContradictionPrompt,
  parseContradictionResponse,
} from '../server/routes/overseer.ts';
import type { Decision } from '../server/types.ts';

// Minimal fake decision factory
function mkDecision(id: number, text: string, project = 'Nexus', lifecycle?: Decision['lifecycle']): Decision {
  return {
    id,
    decision: text,
    context: '',
    project,
    alternatives: [],
    tags: [],
    created_at: new Date(2026, 3, id).toISOString(),
    lifecycle,
  };
}

// Deterministic fake embedding: returns a 3-dim vector from an ASCII-sum hash,
// so two texts sharing keywords score high, different texts score low.
function fakeEmbed(weights: Record<string, number[]>): (text: string) => Promise<number[] | null> {
  return async (text: string) => {
    // Pick the first matching keyword in weights
    for (const [k, v] of Object.entries(weights)) {
      if (text.toLowerCase().includes(k)) return v;
    }
    // Default vector — low overlap with anything in weights
    return [1, 1, 1];
  };
}

describe('shortlistContradictionPairs', () => {
  it('skips pairs that are already linked via any edge', async () => {
    const decisions = [
      mkDecision(1, 'use cloud storage'),
      mkDecision(2, 'use cloud storage for everything'),
    ];
    const out = await shortlistContradictionPairs(decisions, {
      existingPairs: new Set(['1-2']),
      pastSuggestions: new Set(),
      similarityThreshold: 0.5,
      maxPairs: 10,
      getEmbeddingImpl: fakeEmbed({ cloud: [1, 0, 0] }),
    });
    expect(out).toHaveLength(0);
  });

  it('skips pairs previously suggested or dismissed', async () => {
    const decisions = [
      mkDecision(5, 'cloud a'),
      mkDecision(6, 'cloud b'),
    ];
    const out = await shortlistContradictionPairs(decisions, {
      existingPairs: new Set(),
      pastSuggestions: new Set(['5-6']),
      similarityThreshold: 0.5,
      maxPairs: 10,
      getEmbeddingImpl: fakeEmbed({ cloud: [1, 0, 0] }),
    });
    expect(out).toHaveLength(0);
  });

  it('excludes cross-project pairs even when similarity is high', async () => {
    const decisions = [
      mkDecision(1, 'cloud decision', 'Nexus'),
      mkDecision(2, 'cloud decision', 'Shadowrun'),
    ];
    const out = await shortlistContradictionPairs(decisions, {
      existingPairs: new Set(),
      pastSuggestions: new Set(),
      similarityThreshold: 0.5,
      maxPairs: 10,
      getEmbeddingImpl: fakeEmbed({ cloud: [1, 0, 0] }),
    });
    expect(out).toHaveLength(0);
  });

  it('drops pairs below similarity threshold', async () => {
    const decisions = [
      mkDecision(1, 'cloud decision'),
      mkDecision(2, 'local decision'),
    ];
    const out = await shortlistContradictionPairs(decisions, {
      existingPairs: new Set(),
      pastSuggestions: new Set(),
      similarityThreshold: 0.95, // very strict
      maxPairs: 10,
      // These vectors are orthogonal, cosine ≈ 0
      getEmbeddingImpl: fakeEmbed({ cloud: [1, 0, 0], local: [0, 1, 0] }),
    });
    expect(out).toHaveLength(0);
  });

  it('includes highly-similar same-project pairs with no prior link', async () => {
    const decisions = [
      mkDecision(1, 'cloud decision'),
      mkDecision(2, 'cloud alternative'),
    ];
    const out = await shortlistContradictionPairs(decisions, {
      existingPairs: new Set(),
      pastSuggestions: new Set(),
      similarityThreshold: 0.5,
      maxPairs: 10,
      getEmbeddingImpl: fakeEmbed({ cloud: [1, 0, 0] }),
    });
    expect(out).toHaveLength(1);
    expect(out[0].a.id).toBe(1);
    expect(out[0].b.id).toBe(2);
    expect(out[0].similarity).toBeGreaterThan(0.9); // same vector → cosine ≈ 1
  });

  it('tags lifecycle-divergent pairs and applies similarity boost', async () => {
    // Two nearly-orthogonal vectors: cosine ~0.6, below a 0.65 strict threshold.
    // But with the lifecycle boost (+0.08) a divergent pair squeaks through.
    const decisions = [
      mkDecision(1, 'strategy foo', 'Nexus', 'active'),
      mkDecision(2, 'strategy bar', 'Nexus', 'deprecated'),
    ];
    const out = await shortlistContradictionPairs(decisions, {
      existingPairs: new Set(),
      pastSuggestions: new Set(),
      similarityThreshold: 0.65,
      maxPairs: 10,
      // [0.8, 0.6, 0] and [1, 0, 0] → cosine = 0.8 / (1 * ~1) = 0.8, well above 0.65
      getEmbeddingImpl: async (text: string) => {
        if (text.includes('foo')) return [0.8, 0.6, 0];
        if (text.includes('bar')) return [1, 0, 0];
        return null;
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].lifecycleDivergent).toBe(true);
  });

  it('sorts by similarity desc and caps at maxPairs', async () => {
    const decisions = [
      mkDecision(1, 'cloud a'),
      mkDecision(2, 'cloud b'),
      mkDecision(3, 'cloud c'),
    ];
    // All three pair up with cosine = 1 against each other, so 3 pairs total.
    // With maxPairs=2, only top 2 returned.
    const out = await shortlistContradictionPairs(decisions, {
      existingPairs: new Set(),
      pastSuggestions: new Set(),
      similarityThreshold: 0.5,
      maxPairs: 2,
      getEmbeddingImpl: fakeEmbed({ cloud: [1, 0, 0] }),
    });
    expect(out).toHaveLength(2);
  });
});

describe('buildContradictionPrompt', () => {
  it('renders each pair with ids, projects, lifecycle, similarity', () => {
    const pair = {
      a: mkDecision(10, 'decision A text', 'Nexus', 'active'),
      b: mkDecision(11, 'decision B text', 'Nexus', 'deprecated'),
      similarity: 0.73,
      lifecycleDivergent: true,
    };
    const prompt = buildContradictionPrompt([pair]);
    expect(prompt).toContain('PAIR similarity=0.73');
    expect(prompt).toContain('LIFECYCLE-DIVERGENT');
    expect(prompt).toContain('A #10 [Nexus · active]');
    expect(prompt).toContain('B #11 [Nexus · deprecated]');
    expect(prompt).toContain('decision A text');
    expect(prompt).toContain('decision B text');
  });

  it('omits lifecycle tag when both pair members have no lifecycle', () => {
    const pair = {
      a: mkDecision(1, 'text', 'P'),
      b: mkDecision(2, 'text', 'P'),
      similarity: 0.9,
      lifecycleDivergent: false,
    };
    const prompt = buildContradictionPrompt([pair]);
    expect(prompt).not.toContain('LIFECYCLE-DIVERGENT');
    // Should show project without lifecycle suffix
    expect(prompt).toMatch(/#1 \[P\] /);
  });
});

describe('parseContradictionResponse', () => {
  it('returns empty suggestions on empty input', () => {
    expect(parseContradictionResponse('')).toEqual({ suggestions: [] });
    expect(parseContradictionResponse(undefined as unknown as string)).toEqual({ suggestions: [] });
  });

  it('parses clean JSON', () => {
    const raw = '{"suggestions": [{"from_id": 1, "to_id": 2, "is_contradiction": true, "confidence": 0.8, "reason": "opposite"}]}';
    const out = parseContradictionResponse(raw);
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions![0].from_id).toBe(1);
    expect(out.suggestions![0].is_contradiction).toBe(true);
  });

  it('strips ```json code fences', () => {
    const raw = '```json\n{"suggestions": [{"from_id": 1, "to_id": 2, "is_contradiction": false, "confidence": 0.2, "reason": "just overlap"}]}\n```';
    const out = parseContradictionResponse(raw);
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions![0].is_contradiction).toBe(false);
  });

  it('handles prose prefix before JSON', () => {
    const raw = 'Here is the JSON:\n{"suggestions": []}';
    const out = parseContradictionResponse(raw);
    expect(out.suggestions).toEqual([]);
  });

  it('returns empty on malformed JSON rather than throwing', () => {
    const out = parseContradictionResponse('{broken: not valid');
    expect(out).toEqual({ suggestions: [] });
  });

  it('returns empty when suggestions field is missing', () => {
    const out = parseContradictionResponse('{"other_field": 123}');
    expect(out.suggestions).toEqual([]);
  });
});
