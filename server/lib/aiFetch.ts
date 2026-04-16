import { request } from 'undici';

/**
 * AI-specific HTTP request that doesn't time out during long prefills.
 *
 * Problem: Node.js's built-in fetch() (via undici) has a default
 * headersTimeout of 300,000ms (5 minutes). LM Studio can take >5 min
 * to send the first byte back during large context prefills (e.g.,
 * 75k tokens at 25% GPU offload). Node disconnects, LM Studio sees
 * "client disconnected" and stops the inference.
 *
 * Solution: use undici's request() directly with headersTimeout and
 * bodyTimeout set to 0 (disabled). Only our GPU-aware AbortSignal
 * controls the lifecycle.
 */
export async function aiFetch(
  url: string,
  body: unknown,
  signal?: AbortSignal
): Promise<any> {
  const { statusCode, body: responseBody } = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'none' },
    body: JSON.stringify(body),
    signal: signal ?? undefined,
    headersTimeout: 0,  // Disable — GPU signal handles abort
    bodyTimeout: 0,     // Disable — GPU signal handles abort
  });

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`AI ${statusCode}`);
  }

  return responseBody.json();
}
