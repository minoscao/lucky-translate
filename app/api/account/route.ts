import { accountSnapshot, addActiveSeconds } from '@/lib/server/account';
import { requireAccount } from '@/lib/server/auth';
import { json, readJson, sameOrigin } from '@/lib/server/http';

export async function GET(request: Request) {
  try { return json({ account: await accountSnapshot(await requireAccount(request, false)) }); }
  catch (error) { return json({ error: error instanceof Error ? error.message : '无法读取账户' }, (error as { status?: number }).status || 500); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: '请从当前页面操作' }, 403);
  try {
    const account = await requireAccount(request), body = await readJson<{ seconds?: unknown; category?: unknown }>(request, 1024);
    const seconds = typeof body.seconds === 'number' ? body.seconds : 0, category = body.category === 'training' ? 'training' : body.category === 'translation' ? 'translation' : null;
    if (!category || seconds <= 0 || seconds > 60) return json({ error: '计时数据无效' }, 400);
    return json({ account: await addActiveSeconds(account, seconds, category) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : '无法记录使用时间' }, (error as { status?: number }).status || 500); }
}
