import { requireAccount } from '@/lib/server/auth';
import { getCoachSkill } from '@/lib/server/config';
import { deepSeekJson, DeepSeekMessage } from '@/lib/server/deepseek';
import { json, readJson, sameOrigin } from '@/lib/server/http';
import { coachTimeBasis, parseCoachContent } from '@/lib/text-time';
import { chargeTextTime } from '@/lib/server/text-time';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: '请从 English Coach 页面发起请求' }, 403);
  try {
    const account = await requireAccount(request), body = await readJson<{ messages?: unknown; maxTokens?: unknown; voiceMode?: unknown }>(request, 48 * 1024);
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) return json({ error: '对话内容无效' }, 400);
    const messages: DeepSeekMessage[] = [];
    for (const item of body.messages) {
      const row = item as { role?: unknown; content?: unknown };
      if (!['system', 'user', 'assistant'].includes(String(row.role)) || typeof row.content !== 'string' || row.content.length > 20_000) return json({ error: '对话内容无效' }, 400);
      messages.push({ role: row.role as DeepSeekMessage['role'], content: row.content });
    }
    if (messages[0]?.role === 'system' && messages[0].content.includes('affectionate and adaptive English conversation coach')) {
      messages[0] = { role: 'system', content: await getCoachSkill() };
    }
    const result = await deepSeekJson(account, '英语训练', messages, request.signal, Math.max(200, Math.min(3000, Number(body.maxTokens) || 1800)), body.voiceMode === true ? 2 : 1);
    let parsed: Record<string, unknown>, basis: ReturnType<typeof coachTimeBasis>;
    try { parsed = parseCoachContent(result.content); basis = coachTimeBasis(messages, parsed); }
    catch { console.warn('Coach response validation failed', { characters: result.content.length }); return json({ error: 'Lucky 的回复未完整生成，请重试。本次未扣除对话 Points。' }, 502); }
    const time = await chargeTextTime(account, basis.category, basis.texts, basis.label, result.usage.eventId);
    return json({ content: JSON.stringify(parsed), usage: { ...result.usage, time } });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'English Coach 暂时无法回应' }, (error as { status?: number }).status || 500); }
}
