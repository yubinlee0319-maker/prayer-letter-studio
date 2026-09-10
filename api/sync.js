const { getDb, ensureSchema } = require('../lib/db');
const { getSessionUser } = require('../lib/auth');

// Per-user whole-state sync endpoint: the client keeps its full
// letters/recipients arrays in memory and mirrors them here, scoped to
// the signed-in account. GET returns this user's server state (used to
// hydrate a fresh browser); POST replaces this user's rows with exactly
// what the client sends (last full save wins for THIS user — fine for a
// small, low-concurrency personal/church tool). Requires a valid
// session; other users' rows are never touched.
module.exports = async function handler(req, res) {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    res.status(503).json({ error: 'Turso가 설정되지 않았어요 (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 필요)' });
    return;
  }

  const client = getDb();

  try {
    await ensureSchema(client);

    const user = await getSessionUser(client, req);
    if (!user) {
      res.status(401).json({ error: 'not_logged_in' });
      return;
    }

    if (req.method === 'GET') {
      const [lettersRes, recipientsRes] = await Promise.all([
        client.execute({ sql: 'SELECT data FROM letters WHERE user_id = ? ORDER BY updated_at DESC', args: [user.id] }),
        client.execute({ sql: 'SELECT data FROM recipients WHERE user_id = ? ORDER BY updated_at DESC', args: [user.id] }),
      ]);
      const letters = lettersRes.rows.map((r) => JSON.parse(r.data));
      const recipients = recipientsRes.rows.map((r) => JSON.parse(r.data));
      res.status(200).json({ letters, recipients });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const letters = Array.isArray(body.letters) ? body.letters : [];
      const recipients = Array.isArray(body.recipients) ? body.recipients : [];
      const now = Date.now();

      const statements = [
        { sql: 'DELETE FROM letters WHERE user_id = ?', args: [user.id] },
        ...letters.map((l) => ({
          sql: 'INSERT INTO letters (id, user_id, data, updated_at) VALUES (?, ?, ?, ?)',
          args: [String(l.id), user.id, JSON.stringify(l), now],
        })),
        { sql: 'DELETE FROM recipients WHERE user_id = ?', args: [user.id] },
        ...recipients.map((r) => ({
          sql: 'INSERT INTO recipients (id, user_id, data, updated_at) VALUES (?, ?, ?, ?)',
          args: [String(r.id), user.id, JSON.stringify(r), now],
        })),
      ];

      await client.batch(statements, 'write');
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
