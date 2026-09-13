import { getAi } from '@/db';
import { recordServiceCost } from '@/lib/server/account';
import { requireAccount } from '@/lib/server/auth';
import { audioToBase64 } from '@/lib/server/audio';
import { json, sameOrigin } from '@/lib/server/http';
import { MAX_COACH_AUDIO_BYTES, COACH_RECORDING } from '@/lib/recording-limits';

const MAX_AUDIO = MAX_COACH_AUDIO_BYTES;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'Please record from the current page.' }, 403);
  try {
    const started = performance.now();
    const account = await requireAccount(request);
    const tooLong = () => json({ error: `Each voice message can be up to ${COACH_RECORDING.maxSeconds} seconds. Please refresh the page for the recording countdown.` }, 413);
    if (Number(request.headers.get('content-length')) > MAX_AUDIO) return tooLong();
    const reader = request.body?.getReader(); if (!reader) return json({ error: 'No recording was received.' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > MAX_AUDIO) { await reader.cancel(); return tooLong(); } chunks.push(chunk.value); }
    if (size <= 44) return json({ error: 'The recording is empty. Please try again.' }, 400);
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const ai = getAi(); if (!ai) return json({ error: 'Speech recognition is unavailable. Please contact the administrator.' }, 503);
    const inferenceStarted = performance.now();
    const result = await ai.run('@cf/openai/whisper-large-v3-turbo', { audio: audioToBase64(bytes), task: 'transcribe', vad_filter: true, condition_on_previous_text: true }) as { text?: string; transcription_info?: { text?: string } };
    const inferenceMs = performance.now() - inferenceStarted;
    const text = (result.text || result.transcription_info?.text || '').trim(), seconds = Math.max(0, bytes.byteLength - 44) / 32000, cost = seconds / 60 * .00051;
    await recordServiceCost(account, '训练语音识别', 'cloudflare', 'whisper-large-v3-turbo', cost, { usdPerMinute: .00051, seconds });
    return json({ text, usage: { tokens: 0, cost } }, 200, { 'Server-Timing': `recognition;dur=${inferenceMs.toFixed(1)},total;dur=${(performance.now() - started).toFixed(1)}` });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Could not recognize your speech. Please try again.' }, (error as { status?: number }).status || 500); }
}
