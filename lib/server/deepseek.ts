import { Account } from './auth';
import { enforceLimits, recordDeepSeekUsage } from './account';
import { getDeepSeekKey } from './config';

export type DeepSeekMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function deepSeekJson(account: Account, feature: string, messages: DeepSeekMessage[], signal: AbortSignal, maxTokens = 3000, tokenMultiplier = 1) {
  await enforceLimits(account); const key = await getDeepSeekKey();
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-v4-flash', thinking: { type: 'disabled' }, messages, max_tokens: maxTokens, response_format: { type: 'json_object' } }),
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw Object.assign(new Error('DeepSeek 服务配置无效，请联系管理员'), { status: 503 });
    if (response.status === 429) throw Object.assign(new Error('翻译服务请求较多，请稍后重试'), { status: 429 });
    throw Object.assign(new Error('DeepSeek 暂时无法回应'), { status: 502 });
  }
  const result = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }>; usage?: Parameters<typeof recordDeepSeekUsage>[2] };
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw Object.assign(new Error('没有收到完整内容，请重试'), { status: 502 });
  const usage = await recordDeepSeekUsage(account, feature, result.usage, tokenMultiplier);
  if (result.choices?.[0]?.finish_reason === 'length') throw Object.assign(new Error('回复未生成完整，请重试。本次未扣除对话 Points。'), { status: 502 });
  return { content, usage };
}
