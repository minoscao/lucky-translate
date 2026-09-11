import { accountSnapshot } from '@/lib/server/account';
import { requireAccount } from '@/lib/server/auth';
import { json, sameOrigin } from '@/lib/server/http';
import { getTextTimeRules, timeLedger } from '@/lib/server/text-time';
import { usageDashboard } from '@/lib/server/usage-dashboard';

export async function GET(request: Request) {
  try {
    const account = await requireAccount(request, false);
    if (new URL(request.url).searchParams.has('dashboard')) return json({ dashboard: await usageDashboard(account.id) });
    return json({ account: await accountSnapshot(account), ...(new URL(request.url).searchParams.has('ledger') ? { ledger: await timeLedger(account.id), timeRules: await getTextTimeRules() } : {}) });
  }
  catch (error) { return json({ error: error instanceof Error ? error.message : '无法读取账户' }, (error as { status?: number }).status || 500); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: '请从当前页面操作' }, 403);
  try {
    // Older open tabs still send elapsed-time heartbeats. Never charge them.
    return json({ account: await accountSnapshot(await requireAccount(request)), ignored: true });
  } catch (error) { return json({ error: error instanceof Error ? error.message : '无法记录使用时间' }, (error as { status?: number }).status || 500); }
}
