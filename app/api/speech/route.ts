import { LANGUAGES } from '../../../lib/translation';

const MAX_BODY = 12 * 1024;
const MODEL = 'gpt-4o-mini-tts';
const reply = (body: object, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply({ error: '请从翻译页面发起请求' }, 403);
  const key = request.headers.get('x-translation-key')?.trim();
  if (!key || key.length > 512 || /[\r\n]/.test(key)) return reply({ error: '请先在设置中填写服务密钥' }, 401);
  if (Number(request.headers.get('content-length')) > MAX_BODY) return reply({ error: '朗读内容太长' }, 413);

  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply({ error: '朗读内容太长' }, 413);
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return reply({ error: '朗读内容无效' }, 400); }
    const input = data as { text?: unknown; language?: unknown; voiceId?: unknown };
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    const selected = LANGUAGES.find(item => item.code === input.language);
    const voiceId = typeof input.voiceId === 'string' && /^voice_[A-Za-z0-9_-]{3,128}$/.test(input.voiceId) ? input.voiceId : '';
    if (!text || text.length > 4000 || !selected || (input.voiceId && !voiceId)) return reply({ error: '朗读内容、语言或声音无效' }, 400);

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', redirect: 'manual', signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        voice: voiceId ? { id: voiceId } : 'marin',
        input: text,
        instructions: `Speak in ${selected.name}. Use a clear, warm, natural conversational interpreter voice. Preserve the exact wording without adding commentary.`,
        response_format: 'mp3',
        stream_format: 'sse',
        speed: 1,
      }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return reply({ error: '服务密钥无效，或当前账户不能使用语音朗读' }, 401);
      if (response.status === 429) return reply({ error: '语音额度不足或请求较多，请稍后重试' }, 429);
      return reply({ error: '语音朗读暂时不可用，请稍后重试' }, 502);
    }
    const events = await response.text();
    const audio: Uint8Array[] = []; let length = 0;
    let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    for (const line of events.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const value = line.slice(5).trim(); if (!value || value === '[DONE]') continue;
      let event: { type?: string; audio?: string; usage?: typeof usage };
      try { event = JSON.parse(value); } catch { continue; }
      if (event.type === 'speech.audio.delta' && typeof event.audio === 'string') {
        const binary = atob(event.audio), chunk = Uint8Array.from(binary, character => character.charCodeAt(0));
        length += chunk.length; if (length > 8 * 1024 * 1024) return reply({ error: '生成的语音太长，请缩短内容' }, 413); audio.push(chunk);
      }
      if (event.type === 'speech.audio.done' && event.usage) usage = event.usage;
    }
    if (!length) return reply({ error: '没有收到有效语音，请重试' }, 502);
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of audio) { bytes.set(chunk, offset); offset += chunk.length; }
    const inputTokens = Math.max(0, usage.input_tokens || 0), outputTokens = Math.max(0, usage.output_tokens || 0);
    const totalTokens = Math.max(inputTokens + outputTokens, usage.total_tokens || 0);
    const cost = (inputTokens * .6 + outputTokens * 12) / 1_000_000;
    return new Response(bytes, { headers: {
      'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Lucky-Speech-Model': MODEL,
      'X-Lucky-Usage-Tokens': String(totalTokens), 'X-Lucky-Usage-Cost': cost.toFixed(12),
    } });
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return reply({ error: '语音生成超时，请重试' }, 504);
    return reply({ error: '无法生成语音，请检查网络后重试' }, 502);
  }
}
