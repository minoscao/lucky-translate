import { getAi } from '@/db';
import { recordServiceCost } from '@/lib/server/account';
import { requireAccount } from '@/lib/server/auth';
import { audioToBase64 } from '@/lib/server/audio';
import { json, sameOrigin } from '@/lib/server/http';

const MAX_AUDIO = 1024 * 1024;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: '请从当前页面录音' }, 403);
  try {
    const account = await requireAccount(request);
    if (Number(request.headers.get('content-length')) > MAX_AUDIO) return json({ error: '录音太长，请分段说话' }, 413);
    const bytes = new Uint8Array(await request.arrayBuffer()); if (!bytes.length || bytes.length > MAX_AUDIO) return json({ error: '录音内容无效' }, 400);
    const ai = getAi(); if (!ai) return json({ error: 'Cloudflare 语音识别尚未连接，请联系管理员' }, 503);
    const result = await ai.run('@cf/openai/whisper-large-v3-turbo', { audio: audioToBase64(bytes), task: 'transcribe', vad_filter: true, condition_on_previous_text: true }) as { text?: string; transcription_info?: { text?: string } };
    const text = (result.text || result.transcription_info?.text || '').trim(), seconds = Math.max(0, bytes.byteLength - 44) / 32000, cost = seconds / 60 * .00051;
    await recordServiceCost(account, '训练语音识别', 'cloudflare', 'whisper-large-v3-turbo', cost, { usdPerMinute: .00051, seconds });
    return json({ text, usage: { tokens: 0, cost } });
  } catch (error) { return json({ error: error instanceof Error ? error.message : '语音识别失败' }, (error as { status?: number }).status || 500); }
}
