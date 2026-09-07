import { json } from '@/lib/server/http';
export async function GET() { return json({ unlocked: false }, 410); }
export async function POST() { return json({ error: '此密码入口已停用，请使用账户登录' }, 410); }
export async function DELETE() { return json({ unlocked: false }, 200, { 'Set-Cookie': 'lucky-site-access=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' }); }
