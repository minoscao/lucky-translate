import { monthsAgo, retentionMonths, retainedContent } from '@/lib/retention';
import { getRetentionRules } from '@/lib/server/retention';
import { getDb } from '@/db';
import { accountSnapshot } from '@/lib/server/account';
import { requireAccount } from '@/lib/server/auth';
import { json, readJson, sameOrigin } from '@/lib/server/http';

const allowed = new Set(['profile', 'preferences', 'translation', 'coach-state', 'coach-journal', 'coach-message']);

export async function GET(request: Request) {
  try {
    const account = await requireAccount(request), type = new URL(request.url).searchParams.get('type');
    const cutoff = monthsAgo(retentionMonths(account.level, await getRetentionRules()));
    const query = type && allowed.has(type) ? getDb().prepare('SELECT id, type, data, created_at, updated_at FROM cloud_records WHERE user_id = ?1 AND type = ?2 ORDER BY updated_at ASC').bind(account.id, type) : getDb().prepare("SELECT id, type, data, created_at, updated_at FROM cloud_records WHERE user_id = ?1 AND type IN ('profile','preferences','translation','coach-state','coach-journal') ORDER BY updated_at ASC").bind(account.id);
    const result = await query.all<{ id: string; type: string; data: string; created_at: number; updated_at: number }>();
    return json({ records: result.results.filter(row => row.type === 'profile' || row.type === 'preferences' || row.updated_at >= cutoff).map(row => ({ id: row.id, type: row.type, data: retainedContent(row.type, JSON.parse(row.data), cutoff), createdAt: row.created_at, updatedAt: row.updated_at })), account: await accountSnapshot(account) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : '无法读取云端记录' }, (error as { status?: number }).status || 500); }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return json({ error: '请从当前页面操作' }, 403);
  try {
    const account = await requireAccount(request), body = await readJson<{ id?: unknown; type?: unknown; data?: unknown }>(request, 2_200_000);
    const id = typeof body.id === 'string' ? body.id.slice(0, 120) : '', type = typeof body.type === 'string' ? body.type : '';
    if (!id || !allowed.has(type)) return json({ error: '云端记录无效' }, 400);
    const cutoff = monthsAgo(retentionMonths(account.level, await getRetentionRules()));
    const cleanData = retainedContent(type, body.data, cutoff);
    const data = JSON.stringify(cleanData), bytes = new TextEncoder().encode(data).byteLength;
    if (bytes > account.storage_limit_bytes) return json({ error: '这份记录超过个人云空间上限，请先导出并缩短记录' }, 413);
    const existing = await getDb().prepare('SELECT bytes, created_at FROM cloud_records WHERE user_id = ?1 AND id = ?2').bind(account.id, id).first<{ bytes: number; created_at: number }>();
    let total = (await getDb().prepare('SELECT COALESCE(SUM(bytes), 0) bytes FROM cloud_records WHERE user_id = ?1').bind(account.id).first<{ bytes: number }>())?.bytes || 0;
    total -= existing?.bytes || 0;
    const latest = type === 'coach-state' ? (cleanData as { history?: Array<{ id?: number; text?: string; role?: string; createdAt?: number }> })?.history?.at(-1) : undefined;
    const archive = latest && Number.isSafeInteger(latest.id) && typeof latest.text === 'string' && (latest.role === 'learner' || latest.role === 'coach') && typeof latest.createdAt === 'number' && latest.createdAt >= cutoff ? latest : undefined;
    const archiveId = archive ? `coach-message-${archive.id}` : '';
    const archiveData = archive ? JSON.stringify(archive) : '';
    const archiveBytes = new TextEncoder().encode(archiveData).byteLength;
    const archiveExists = archive && await getDb().prepare('SELECT 1 ok FROM cloud_records WHERE user_id=?1 AND id=?2').bind(account.id, archiveId).first();
    const requiredBytes = bytes + (archiveExists ? 0 : archiveBytes);
    if (requiredBytes > account.storage_limit_bytes) return json({ error: '记录超过个人云空间上限，请先导出' }, 413);
    const changes: D1PreparedStatement[] = [];
    if (total + requiredBytes > account.storage_limit_bytes) {
      const old = await getDb().prepare("SELECT id, bytes FROM cloud_records WHERE user_id = ?1 AND id != ?2 AND id != ?3 AND type NOT IN ('profile','preferences') ORDER BY updated_at ASC").bind(account.id, id, archiveId).all<{ id: string; bytes: number }>();
      for (const record of old.results) {
        changes.push(getDb().prepare('DELETE FROM cloud_records WHERE user_id = ?1 AND id = ?2').bind(account.id, record.id)); total -= record.bytes;
        if (total + requiredBytes <= account.storage_limit_bytes) break;
      }
    }
    if (total + requiredBytes > account.storage_limit_bytes) return json({ error: '云空间已满，请先导出并清理记录' }, 413);
    const now = Date.now();
    changes.push(getDb().prepare(`INSERT INTO cloud_records (id, user_id, type, data, bytes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT(user_id, id) DO UPDATE SET type = excluded.type, data = excluded.data, bytes = excluded.bytes, updated_at = excluded.updated_at`).bind(id, account.id, type, data, bytes, existing?.created_at || now, now));
    if (archive && !archiveExists) changes.push(getDb().prepare("INSERT OR IGNORE INTO cloud_records(id,user_id,type,data,bytes,created_at,updated_at) VALUES (?1,?2,'coach-message',?3,?4,?5,?5)").bind(archiveId, account.id, archiveData, archiveBytes, Math.min(now, archive.createdAt!)));
    await getDb().batch(changes);
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
