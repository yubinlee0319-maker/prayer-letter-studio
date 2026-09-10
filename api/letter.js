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

// Public, read-only lookup of a single letter by id — backs the shareable
// /l/<id> viewer page. Only ever reads; writing still goes through
// /api/sync (the compose app owns writes).
module.exports = async function handler(req, res) {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    res.status(503).json({ error: 'Turso가 설정되지 않았어요' });
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const id = (req.query && req.query.id) || '';
  if (!id) {
    res.status(400).json({ error: 'id가 필요해요' });
    return;
  }

  try {
    const client = getDb();
    const result = await client.execute({
      sql: 'SELECT data FROM letters WHERE id = ?',
      args: [String(id)],
    });
    if (!result.rows.length) {
      res.status(404).json({ error: '편지를 찾을 수 없어요' });
      return;
    }
    const letter = JSON.parse(result.rows[0].data);
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.status(200).json({ letter });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
