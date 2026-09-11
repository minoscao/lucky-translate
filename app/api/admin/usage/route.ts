import { getDb } from '@/db';
import { requireAdmin } from '@/lib/server/auth';
import { json } from '@/lib/server/http';
import { usageDashboard, usageDirectory } from '@/lib/server/usage-dashboard';

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    if (!new URL(request.url).searchParams.has('id')) return json(await usageDirectory());
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!await getDb().prepare('SELECT id FROM users WHERE id=?1').bind(id).first()) return json({ error: 'Client not found.' }, 404);
    return json({ dashboard: await usageDashboard(id) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Could not load usage.' }, (error as { status?: number }).status || 500); }
}
