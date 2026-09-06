const reply = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply({ error: '请从翻译页面发起请求' }, 403);
  const key = request.headers.get('x-translation-key')?.trim();
  if (!key || key.length > 512 || /[\r\n]/.test(key)) return reply({ error: '请填写有效的 OpenAI 服务密钥' }, 401);
  try {
    const response = await fetch('https://api.openai.com/v1/models/gpt-4o-mini', {
      method: 'GET', redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
      headers: { Authorization: `Bearer ${key}` },
    });
    if (response.ok) return reply({ valid: true });
    if (response.status === 401) return reply({ error: '这个服务密钥无效，请重新复制完整密钥' }, 401);
    if (response.status === 403 || response.status === 404) return reply({ error: '这个密钥没有使用轻量翻译模型的权限' }, 403);
    if (response.status === 429) return reply({ error: '密钥有效，但当前账户额度不足或请求较多' }, 429);
    return reply({ error: '暂时无法验证密钥，请稍后重试' }, 502);
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return reply({ error: '验证密钥超时，请检查网络后重试' }, 504);
    return reply({ error: '无法连接 OpenAI 验证密钥，请稍后重试' }, 502);
  }
}
