import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Secondary publication URLs send visitors to the single Cloudflare account store.
// Never forward a password submission to a different origin.
export function middleware(request: NextRequest) {
  const canonical = process.env.CANONICAL_APP_URL;
  if (!canonical || request.nextUrl.origin === new URL(canonical).origin) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method)) {
    return NextResponse.json({ error: '请从正式网站登录', url: canonical }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.redirect(new URL(request.nextUrl.pathname, canonical), 307);
}
export const config = { matcher: ['/((?!_next|assets|favicon.ico).*)'] };
