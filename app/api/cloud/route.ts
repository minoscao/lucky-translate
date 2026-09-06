import { getDb } from '@/db';
import { accountSnapshot } from '@/lib/server/account';
import { requireAccount } from '@/lib/server/auth';
import { json, readJson, sameOrigin } from '@/lib/server/http';

const allowed = new Set(['profile', 'preferences', 'translation', 'coach-state', 'coach-journal']);

export async function GET(request: Request) {
  try {
    const account = await requireAccount(request), type = new URL(request.url).searchParams.get('type');
    const query = type && allowed.has(type) ? getDb().prepare('SELECT id, type, data, created_at, updated_at FROM cloud_records WHERE user_id = ?1 AND type = ?2 ORDER BY updated_at ASC').bind(account.id, type) : getDb().prepare('SELECT id, type, data, created_at, updated_at FROM cloud_records WHERE user_id = ?1 ORDER BY updated_at ASC').bind(account.id);
    const result = await query.all<{ id: string; type: string; data: string; created_at: number; updated_at: number }>();
    return json({ records: result.results.map(row => ({ id: row.id, type: row.type, data: JSON.parse(row.data), createdAt: row.created_at, updatedAt: row.updated_at })), account: await accountSnapshot(account) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : '无法读取云端记录' }, (error as { status?: number }).status || 500); }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return json({ error: '请从当前页面操作' }, 403);
  try {
    const account = await requireAccount(request), body = await readJson<{ id?: unknown; type?: unknown; data?: unknown }>(request, 2_200_000);
    const id = typeof body.id === 'string' ? body.id.slice(0, 120) : '', type = typeof body.type === 'string' ? body.type : '';
    if (!id || !allowed.has(type)) return json({ error: '云端记录无效' }, 400);
    const data = JSON.stringify(body.data), bytes = new TextEncoder().encode(data).byteLength;
    if (bytes > account.storage_limit_bytes) return json({ error: '这份记录超过个人云空间上限，请先导出并缩短记录' }, 413);
    const existing = await getDb().prepare('SELECT bytes, created_at FROM cloud_records WHERE user_id = ?1 AND id = ?2').bind(account.id, id).first<{ bytes: number; created_at: number }>();
    let total = (await getDb().prepare('SELECT COALESCE(SUM(bytes), 0) bytes FROM cloud_records WHERE user_id = ?1').bind(account.id).first<{ bytes: number }>())?.bytes || 0;
    total -= existing?.bytes || 0;
    if (total + bytes > account.storage_limit_bytes) {
      const old = await getDb().prepare('SELECT id, bytes FROM cloud_records WHERE user_id = ?1 AND id != ?2 ORDER BY updated_at ASC').bind(account.id, id).all<{ id: string; bytes: number }>();
      for (const record of old.results) {
        await getDb().prepare('DELETE FROM cloud_records WHERE user_id = ?1 AND id = ?2').bind(account.id, record.id).run(); total -= record.bytes;
        if (total + bytes <= account.storage_limit_bytes) break;
      }
    }
    const now = Date.now();
    await getDb().prepare(`INSERT INTO cloud_records (id, user_id, type, data, bytes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
      ON CONFLICT(user_id, id) DO UPDATE SET type = excluded.type, data = excluded.data, bytes = excluded.bytes, updated_at = excluded.updated_at`).bind(id, account.id, type, data, bytes, existing?.created_at || now).run();
    return json({ saved: true, account: await accountSnapshot(account) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : '无法保存云端记录' }, (error as { status?: number }).status || 500); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: '请从当前页面操作' }, 403);
  try {
    const account = await requireAccount(request), url = new URL(request.url), id = url.searchParams.get('id')?.slice(0, 120), type = url.searchParams.get('type');
    if (type && allowed.has(type)) await getDb().prepare('DELETE FROM cloud_records WHERE user_id = ?1 AND type = ?2').bind(account.id, type).run();
    else if (id) await getDb().prepare('DELETE FROM cloud_records WHERE user_id = ?1 AND id = ?2').bind(account.id, id).run();
    else return json({ error: '请选择要删除的记录' }, 400);
    return json({ deleted: true, account: await accountSnapshot(account) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : '无法删除云端记录' }, (error as { status?: number }).status || 500); }
}
