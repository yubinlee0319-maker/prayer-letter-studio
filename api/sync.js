const { createClient } = require('@libsql/client');

let db;
function getDb() {
  if (!db) {
    db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return db;
}

async function ensureSchema(client) {
  await client.execute(
    'CREATE TABLE IF NOT EXISTS letters (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)'
  );
  await client.execute(
    'CREATE TABLE IF NOT EXISTS recipients (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)'
  );
}

// Whole-state sync endpoint: the client keeps its full letters/recipients
// arrays in memory and mirrors them here. GET returns the current server
// state (used to hydrate a fresh browser); POST replaces the server's
// tables with exactly what the client sends (last full save wins —
// fine for a small, low-concurrency personal/church tool).
module.exports = async function handler(req, res) {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    res.status(503).json({ error: 'Turso가 설정되지 않았어요 (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 필요)' });
    return;
  }

  const client = getDb();

  try {
    await ensureSchema(client);

    if (req.method === 'GET') {
      const [lettersRes, recipientsRes] = await Promise.all([
        client.execute('SELECT data FROM letters ORDER BY updated_at DESC'),
        client.execute('SELECT data FROM recipients ORDER BY updated_at DESC'),
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
        { sql: 'DELETE FROM letters', args: [] },
        ...letters.map((l) => ({
          sql: 'INSERT INTO letters (id, data, updated_at) VALUES (?, ?, ?)',
          args: [String(l.id), JSON.stringify(l), now],
        })),
        { sql: 'DELETE FROM recipients', args: [] },
        ...recipients.map((r) => ({
          sql: 'INSERT INTO recipients (id, data, updated_at) VALUES (?, ?, ?)',
          args: [String(r.id), JSON.stringify(r), now],
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
