import { DEFAULT_RETENTION, monthsAgo, retentionMonths, retainedContent, validateRetention } from '../lib/retention';

// No public maintenance endpoint. Cloudflare invokes this scheduled handler.
export default {
  async scheduled(_event: ScheduledController, env: { DB: D1Database }) {
    const row = await env.DB.prepare("SELECT value FROM app_config WHERE key='retention_months'").first<{ value: string }>();
    let rules = DEFAULT_RETENTION;
    try { if (row) rules = validateRetention(JSON.parse(row.value)); } catch { return; }
    // Keyset batches keep memory bounded. Accounts and financial records never expire here.
    let cursor = '';
    while (true) {
      const users = await env.DB.prepare('SELECT id,level FROM users WHERE id>?1 ORDER BY id LIMIT 50').bind(cursor).all<{ id: string; level: string }>();
      if (!users.results.length) break;
      await env.DB.batch(users.results.map(user => env.DB.prepare("DELETE FROM cloud_records WHERE user_id=?1 AND type NOT IN ('profile','preferences') AND updated_at<?2").bind(user.id, monthsAgo(retentionMonths(user.level, rules)))));
      for (const user of users.results) {
        const cutoff = monthsAgo(retentionMonths(user.level, rules));
        const bundles = await env.DB.prepare("SELECT id,type,data FROM cloud_records WHERE user_id=?1 AND type IN ('coach-state','coach-journal')").bind(user.id).all<{ id: string; type: string; data: string }>();
        for (const row of bundles.results) {
          try {
            const data = JSON.stringify(retainedContent(row.type, JSON.parse(row.data), cutoff));
            if (data !== row.data) await env.DB.prepare('UPDATE cloud_records SET data=?1,bytes=?2 WHERE user_id=?3 AND id=?4 AND data=?5').bind(data, new TextEncoder().encode(data).byteLength, user.id, row.id, row.data).run();
          } catch { /* Preserve malformed historical records for recovery. */ }
        }
      }
      cursor = users.results[users.results.length - 1].id;
    }
  },
};
