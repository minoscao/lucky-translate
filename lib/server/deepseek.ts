import { Account } from './auth';
import { enforceLimits, recordDeepSeekUsage } from './account';
import { getDeepSeekKey } from './config';
import { readEventStream } from '@/lib/event-stream';

export type DeepSeekMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function deepSeekJson(account: Account, feature: string, messages: DeepSeekMessage[], signal: AbortSignal, maxTokens = 3000, validate?: (content: string) => void, retryInvalidOutput = false, preview?: (content: string) => boolean) {
  const [, key] = await Promise.all([enforceLimits(account), getDeepSeekKey()]);
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
  for (let attempt = 0; attempt < (retryInvalidOutput ? 2 : 1); attempt++) {
    requestSignal.throwIfAborted();
    const attemptMessages: DeepSeekMessage[] = attempt === 0 ? messages : [...messages, { role: 'user', content: 'The previous response did not match the required JSON output. Answer the same request again, using exactly the required field names and value types. Return actual content, not a JSON schema. Do not include Markdown fences.' }];
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', redirect: 'manual', signal: requestSignal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-v4-flash', thinking: { type: 'disabled' }, messages: attemptMessages, max_tokens: maxTokens, response_format: { type: 'json_object' }, ...(preview ? { stream: true, stream_options: { include_usage: true } } : {}) }),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw Object.assign(new Error('DeepSeek 服务配置无效，请联系管理员'), { status: 503 });
      if (response.status === 429) throw Object.assign(new Error('翻译服务请求较多，请稍后重试'), { status: 429 });
      throw Object.assign(new Error('DeepSeek 暂时无法回应'), { status: 502 });
    }
    type Completion = { choices?: Array<{ finish_reason?: string; message?: { content?: string } }>; usage?: Parameters<typeof recordDeepSeekUsage>[2] };
    let result: Completion, previewPublished = false;
    if (preview && response.headers.get('content-type')?.includes('text/event-stream')) {
      let content = '', finishReason: string | undefined, usage: Completion['usage'], done = false;
      try {
        await readEventStream(response, data => {
          if (data === '[DONE]') { done = true; return; }
          const event = JSON.parse(data) as { error?: unknown; choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>; usage?: Completion['usage'] };
          if (event.error) throw new Error('Model stream failed');
          if (event.usage) usage = event.usage;
          const choice = event.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (typeof choice?.delta?.content === 'string') {
            content += choice.delta.content;
            if (content.length > 100_000) throw new Error('Model response too large');
            if (!previewPublished) previewPublished = preview(content);
          }
        });
        if (!done || !finishReason) throw new Error('Model stream incomplete');
      } catch (error) { await recordDeepSeekUsage(account, feature, usage, false); throw error; }
      result = { choices: [{ message: { content }, finish_reason: finishReason }], usage };
    } else result = await response.json() as Completion;
    const content = result.choices?.[0]?.message?.content;
    try {
      if (!content || result.choices?.[0]?.finish_reason === 'length') throw new Error('incomplete');
      validate?.(content);
    } catch {
      // Preserve provider costs while charging no customer quota for unusable output.
      await recordDeepSeekUsage(account, feature, result.usage, false);
      console.warn('Model output rejected', { finishReason: result.choices?.[0]?.finish_reason, characters: content?.length || 0 });
      if (retryInvalidOutput && attempt === 0 && !previewPublished) continue;
      throw Object.assign(new Error('回复未完整生成，请重试。本次未扣除 小鱼干 或服务额度。'), { status: 502 });
    }
    const usage = await recordDeepSeekUsage(account, feature, result.usage);
    return { content, usage };
  }
  throw Object.assign(new Error('回复未完整生成，请稍后重试。本次未扣除 小鱼干 或服务额度。'), { status: 502 });
}
