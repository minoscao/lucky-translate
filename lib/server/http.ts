export const json = (body: object, status = 200, headers: Record<string, string> = {}) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store', ...headers },
});

export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function readJson<T>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new Error('请求内容太大');
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('请求内容太大');
  return JSON.parse(text) as T;
}
