import type { AISelectionRequest, AISelectionResult } from '../iqn/ai-selection';

export async function requestAISelection(input: AISelectionRequest, signal?: AbortSignal): Promise<AISelectionResult | null> {
  async function call(path: string, body?: unknown) {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(35_000) });
    let payload;
    try { payload = await response.json(); } catch { throw new Error('AI xizmati javobi o‘qilmadi.'); }
    if (!response.ok || payload.error) throw new Error(payload.error?.message ?? 'AI xizmati bilan bog‘lanib bo‘lmadi.');
    return payload.data;
  }
  // Only an explicit unconfigured status enables the clearly labelled demo.
  // Provider failure never silently becomes a successful AI recommendation.
  const status = await call('/api/ai/status');
  if (status?.configured === false) return null;
  if (status?.configured !== true) throw new Error('AI ulanish holati aniqlanmadi.');
  return await call('/api/ai/work-selection', input) as AISelectionResult;
}
