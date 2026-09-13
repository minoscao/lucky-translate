import { getAi } from '@/db';
import { recordServiceCost } from '@/lib/server/account';
import { base64ToAudio } from '@/lib/server/audio';
import { requireAccount } from '@/lib/server/auth';
import { json, readJson, sameOrigin } from '@/lib/server/http';
import { LANGUAGES } from '@/lib/translation';

const languageCode = (code: string) => ({ 'zh-CN': 'ZH', 'zh-TW': 'ZH', ja: 'jp', ko: 'kr', pt: 'pt-br' } as Record<string, string>)[code] || code.split('-')[0];

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'Please play audio from the current page.' }, 403);
  try {
    const started = performance.now();
    const account = await requireAccount(request), body = await readJson<{ text?: unknown; language?: unknown }>(request, 12 * 1024);
    const text = typeof body.text === 'string' ? body.text.trim() : '', selected = LANGUAGES.find(item => item.code === body.language);
    if (!text || text.length > 4000 || !selected) return json({ error: 'The text or language cannot be read aloud.' }, 400);
    const ai = getAi(); if (!ai) return json({ error: 'Voice playback is unavailable. Please contact the administrator.' }, 503);
    const synthesisStarted = performance.now();
    const result = await ai.run('@cf/myshell-ai/melotts', { prompt: text, lang: languageCode(selected.code) }, { returnRawResponse: true });
    const response = result instanceof Response ? result : null; if (!response?.ok || !response.body) return json({ error: 'The voice service is temporarily unavailable. Please tap the speaker to try again.' }, 502);
    const contentType = response.headers.get('content-type') || '';
    const audio = contentType.startsWith('audio/') ? null : await response.json().catch(() => null) as { audio?: unknown } | null;
    const audioData = typeof audio?.audio === 'string' ? base64ToAudio(audio.audio) : null;
    if (!contentType.startsWith('audio/') && !audioData?.byteLength) return json({ error: 'The voice service is temporarily unavailable. Please tap the speaker to try again.' }, 502);
    const synthesisMs = performance.now() - synthesisStarted;
    const estimatedSeconds = Math.max(1, text.length / 12), cost = estimatedSeconds / 60 * .0002;
    await recordServiceCost(account, '语音播放', 'cloudflare', 'melotts', cost, { usdPerMinute: .0002, estimatedSeconds, durationSource: 'text_estimate' });
    return new Response(audioData || response.body, { headers: { 'Content-Type': contentType.startsWith('audio/') ? contentType : 'audio/wav', 'Cache-Control': 'no-store', 'Server-Timing': `synthesis;dur=${synthesisMs.toFixed(1)},total;dur=${(performance.now() - started).toFixed(1)}`, 'X-Lucky-Usage-Tokens': '0', 'X-Lucky-Usage-Cost': cost.toFixed(12) } });
  } catch (error) { return json({ error: 'Could not generate the voice. Please tap the speaker to try again.' }, (error as { status?: number }).status || 500); }
}
