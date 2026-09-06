const MAX_UPLOAD = 21 * 1024 * 1024;
const ALLOWED_AUDIO = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/aac', 'audio/flac', 'audio/webm', 'audio/mp4'];
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function upload(path: string, form: FormData, key: string, signal: AbortSignal) {
  const response = await fetch(`https://api.openai.com/v1${path}`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${key}` }, signal, redirect: 'manual' });
  const data = await response.json().catch(() => null) as { id?: unknown; error?: { code?: string } } | null;
  if (!response.ok) {
    if ([401, 403, 404].includes(response.status)) throw Object.assign(new Error('当前 OpenAI 账户尚未开放自定义声音，可继续使用默认 AI 声音'), { status: 403 });
    if (response.status === 429) throw Object.assign(new Error('服务额度不足或请求较多，请稍后重试'), { status: 429 });
    throw Object.assign(new Error('暂时无法创建声音，请稍后重试'), { status: 502 });
  }
  if (typeof data?.id !== 'string') throw Object.assign(new Error('没有收到声音编号，请重试'), { status: 502 });
  return data.id;
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply({ error: '请从翻译页面发起请求' }, 403);
  const key = request.headers.get('x-translation-key')?.trim();
  if (!key || key.length > 512 || /[\r\n]/.test(key)) return reply({ error: '请先在设置中填写服务密钥' }, 401);
  if (Number(request.headers.get('content-length')) > MAX_UPLOAD) return reply({ error: '录音文件太大，请重新录制' }, 413);
  let consentId = '';
  try {
    const reader = request.body?.getReader(); if (!reader) return reply({ error: '没有收到录音' }, 400);
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > MAX_UPLOAD) { await reader.cancel(); return reply({ error: '录音文件太大，请重新录制' }, 413); } chunks.push(chunk.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
    const consent = form.get('consent'), sample = form.get('sample'), rawName = form.get('name'), name = typeof rawName === 'string' ? rawName.trim().slice(0, 64) : '';
    const consentType = consent instanceof File ? consent.type.toLowerCase().split(';', 1)[0] : '';
    const sampleType = sample instanceof File ? sample.type.toLowerCase().split(';', 1)[0] : '';
    if (!(consent instanceof File) || !(sample instanceof File) || !name || !consent.size || !sample.size || consent.size > 10 * 1024 * 1024 || sample.size > 10 * 1024 * 1024 || !ALLOWED_AUDIO.includes(consentType) || !ALLOWED_AUDIO.includes(sampleType)) return reply({ error: '请重新录制两段有效声音' }, 400);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90000)]);
    const consentForm = new FormData(); consentForm.set('name', `${name} consent`); consentForm.set('language', 'en'); consentForm.set('recording', consent, `consent.${consent.type.includes('mp4') ? 'mp4' : 'webm'}`);
    consentId = await upload('/audio/voice_consents', consentForm, key, signal);
    const voiceForm = new FormData(); voiceForm.set('name', name); voiceForm.set('consent', consentId); voiceForm.set('audio_sample', sample, `sample.${sample.type.includes('mp4') ? 'mp4' : 'webm'}`);
    const voiceId = await upload('/audio/voices', voiceForm, key, signal);
    return reply({ voiceId });
  } catch (cause) {
    if (consentId) void fetch(`https://api.openai.com/v1/audio/voice_consents/${encodeURIComponent(consentId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}` } }).catch(() => {});
    if (cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name)) return reply({ error: '创建声音超时，请重试' }, 504);
    const error = cause as Error & { status?: number }; return reply({ error: error.message || '无法创建声音，请重试' }, error.status || 502);
  }
}
