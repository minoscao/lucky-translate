const COOKIE = 'lucky-site-access';
const encoder = new TextEncoder();

const accessPassword = () => process.env.SITE_PASSWORD || '';

async function expectedToken() {
  const password = accessPassword();
  if (!password) return '';
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`lucky-site-access\n${password}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function cookieValue(request: Request) {
  const cookies = request.headers.get('cookie') || '';
  for (const part of cookies.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return '';
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let index = 0; index < a.length; index++) different |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return different === 0;
}

const json = (body: object, status = 200, extraHeaders?: Record<string, string>) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...extraHeaders } });

export async function GET(request: Request) {
  const token = await expectedToken();
  return json({ unlocked: Boolean(token && safeEqual(cookieValue(request), token)) });
}

export async function POST(request: Request) {
  const expected = accessPassword();
  if (!expected) return json({error:'此登录入口未启用'},503);
  const token = await expectedToken();
  let password = '';
  try {
    const body = await request.json() as { password?: unknown };
    if (typeof body.password === 'string' && body.password.length <= 128) password = body.password;
  } catch {}
  if (!safeEqual(password, expected)) return json({ error: '密码不正确，请重试' }, 401);
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return json({ unlocked: true }, 200, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=2592000` });
}

export async function DELETE() {
  return json({ unlocked: false }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
}
