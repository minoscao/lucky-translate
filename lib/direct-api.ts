import { Pair } from './translation';

export type TranslationProvider = 'deepseek';
export type DirectUsage = { tokens: number; cost: number };

export class DirectApiError extends Error {
  constructor(message: string, public kind = 'service') { super(message); }
}

async function responseError(response: Response): Promise<never> {
  const detail = await response.json().catch(() => null) as { error?: string } | null;
  const kind = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 429 ? 'limit' : 'service';
  throw new DirectApiError(detail?.error || '服务暂时不可用', kind);
}

export async function verifyDirectKey() { throw new DirectApiError('服务密钥由管理员统一配置'); }

export async function transcribeDirect(audio: Blob, _key: string, signal: AbortSignal) {
  const response = await fetch('/api/transcribe', { method: 'POST', credentials: 'same-origin', body: audio, signal, headers: { 'Content-Type': audio.type || 'audio/wav', 'X-Lucky-Account': _key } });
  if (!response.ok) return responseError(response);
  return response.json() as Promise<{ text: string; usage: DirectUsage }>;
}

export async function translateDirect(input: { audio?: Blob; text?: string; pair: Pair; context: string[]; provider?: TranslationProvider; openaiKey?: string; deepseekKey?: string; signal: AbortSignal; onTranscribed?: (text: string) => void | Promise<void> }) {
  const form = new FormData(); form.set('upper', input.pair[0]); form.set('lower', input.pair[1]); form.set('context', JSON.stringify(input.context));
  if (input.audio) form.set('audio', input.audio, 'speech.wav'); else form.set('text', input.text || '');
  const response = await fetch('/api/translate', { method: 'POST', credentials: 'same-origin', body: form, signal: input.signal, headers: { 'X-Lucky-Account': input.deepseekKey || '' } });
  if (!response.ok) return responseError(response);
  const result = await response.json() as { empty?: boolean; original?: string; upper?: string; lower?: string; model?: string; usage: DirectUsage };
  if (result.original) await input.onTranscribed?.(result.original);
  if (result.empty) return { empty: true as const, usage: result.usage };
  if (!result.original || !result.upper || !result.lower) throw new DirectApiError('没有收到完整译文，请重试');
  return { empty: false as const, original: result.original, upper: result.upper, lower: result.lower, model: result.model || 'deepseek-v4-flash', usage: result.usage };
}

export async function synthesizeSpeechDirect(input: { accountId: string; text: string; language: string; voiceId?: string; speed: number; key?: string; signal: AbortSignal }) {
  const response = await fetch('/api/speech', { method: 'POST', credentials: 'same-origin', signal: input.signal, headers: { 'Content-Type': 'application/json', 'X-Lucky-Account': input.accountId }, body: JSON.stringify({ text: input.text, language: input.language }) });
  if (!response.ok) return responseError(response);
  return { audio: await response.blob(), usage: { tokens: Number(response.headers.get('X-Lucky-Usage-Tokens')) || 0, cost: Number(response.headers.get('X-Lucky-Usage-Cost')) || 0 } };
}

export async function createCustomVoiceDirect() { throw new DirectApiError('当前版本使用 Cloudflare 语音，不保存个人声音样本', 'voice_unavailable'); }
