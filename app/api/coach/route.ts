import { requireAccount } from '@/lib/server/auth';
import { getCoachSkill } from '@/lib/server/config';
import { deepSeekJson, DeepSeekMessage } from '@/lib/server/deepseek';
import { json, readJson, sameOrigin } from '@/lib/server/http';
import { coachTimeBasis, parseCoachContent } from '@/lib/text-time';
import { chargeTextTime } from '@/lib/server/text-time';
import { assertCoachEnglish, COACH_LANGUAGE_POLICY } from '@/lib/coach-language';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'Please open English Coach to continue.' }, 403);
  try {
    const account = await requireAccount(request), body = await readJson<{ messages?: unknown; maxTokens?: unknown }>(request, 48 * 1024);
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) return json({ error: 'Invalid conversation. Please try again.' }, 400);
    const messages: DeepSeekMessage[] = [];
    for (const item of body.messages) {
      const row = item as { role?: unknown; content?: unknown };
      if (!['system', 'user', 'assistant'].includes(String(row.role)) || typeof row.content !== 'string' || row.content.length > 20_000) return json({ error: 'Invalid conversation. Please try again.' }, 400);
      messages.push({ role: row.role as DeepSeekMessage['role'], content: row.content });
    }
    if (messages[0]?.role === 'system' && messages[0].content.includes('affectionate and adaptive English conversation coach')) {
      messages[0] = { role: 'system', content: await getCoachSkill() };
    }
    for (const message of messages) if (message.role === 'system' && !message.content.endsWith(COACH_LANGUAGE_POLICY)) message.content += `\n\n${COACH_LANGUAGE_POLICY}`;
    if (!messages.some(message => message.role === 'system')) messages.unshift({ role: 'system', content: COACH_LANGUAGE_POLICY });
    const validate = (content: string) => {
      let parsed: Record<string, unknown>;
      try { parsed = parseCoachContent(content); }
      catch { console.warn('Coach invalid JSON', { characters: content.length }); throw new Error('invalid_json'); }
      try { coachTimeBasis(messages, parsed); assertCoachEnglish(parsed); }
      catch { console.warn('Coach unexpected response fields', { fields: Object.entries(parsed).map(([key, value]) => `${key.slice(0, 40)}:${Array.isArray(value) ? 'array' : typeof value}`).slice(0, 12) }); throw new Error('invalid_fields'); }
    };
    const result = await deepSeekJson(account, '英语训练', messages, request.signal, Math.max(200, Math.min(3000, Number(body.maxTokens) || 1800)), validate, true);
    let parsed: Record<string, unknown>, basis: ReturnType<typeof coachTimeBasis>;
    try { parsed = parseCoachContent(result.content); assertCoachEnglish(parsed); basis = coachTimeBasis(messages, parsed); }
    catch { console.warn('Coach response validation failed', { characters: result.content.length }); return json({ error: 'Lucky could not finish this reply. Please try again. No fish were used.' }, 502); }
    const time = await chargeTextTime(account, basis.category, basis.texts, basis.label, result.usage.eventId);
    return json({ content: JSON.stringify(parsed), usage: { ...result.usage, time } });
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    return json({ error: status === 429 ? 'Your service limit has been reached or the service is busy. Please try again later or contact the administrator.' : status === 401 || status === 409 ? 'Please sign in again to continue.' : 'Lucky could not finish this reply. Please try again. No fish were used.' }, status);
  }
}
