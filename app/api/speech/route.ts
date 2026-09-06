import { getAi } from '@/db';
import { recordServiceCost } from '@/lib/server/account';
import { requireAccount } from '@/lib/server/auth';
import { json, readJson, sameOrigin } from '@/lib/server/http';
import { LANGUAGES } from '@/lib/translation';

const languageCode = (code: string) => ({ 'zh-CN': 'zh', 'zh-TW': 'zh', ja: 'jp', ko: 'kr', pt: 'pt-br' } as Record<string, string>)[code] || code.split('-')[0];

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: '请从当前页面播放语音' }, 403);
  try {
    const account = await requireAccount(request), body = await readJson<{ text?: unknown; language?: unknown }>(request, 12 * 1024);
    const text = typeof body.text === 'string' ? body.text.trim() : '', selected = LANGUAGES.find(item => item.code === body.language);
    if (!text || text.length > 4000 || !selected) return json({ error: '朗读内容或语言无效' }, 400);
    const ai = getAi(); if (!ai) return json({ error: 'Cloudflare 语音播放尚未连接，请联系管理员' }, 503);
    const result = await ai.run('@cf/myshell-ai/melotts', { prompt: text, lang: languageCode(selected.code) }, { returnRawResponse: true });
    const response = result instanceof Response ? result : null; if (!response?.ok || !response.body) return json({ error: '语音播放暂时不可用' }, 502);
    const estimatedSeconds = Math.max(1, text.length / 12), cost = estimatedSeconds / 60 * .0002;
    await recordServiceCost(account, '语音播放', 'cloudflare', 'melotts', cost, { usdPerMinute: .0002, estimatedSeconds });
    return new Response(response.body, { headers: { 'Content-Type': response.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Lucky-Usage-Tokens': '0', 'X-Lucky-Usage-Cost': cost.toFixed(12) } });
  } catch (error) { return json({ error: error instanceof Error ? error.message : '无法生成语音' }, (error as { status?: number }).status || 500); }
}
