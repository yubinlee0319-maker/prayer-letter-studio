const crypto = require('crypto');
const { getDb, ensureSchema } = require('../lib/db');
const {
  hashPassword,
  verifyPassword,
  newToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getSessionUser,
} = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    res.status(503).json({ error: 'Turso가 설정되지 않았어요' });
    return;
  }

  const client = getDb();
  const action = (req.query && req.query.action) || '';

  try {
    await ensureSchema(client);

    if (req.method === 'GET' && action === 'me') {
      const user = await getSessionUser(client, req);
      if (!user) {
        res.status(401).json({ error: 'not_logged_in' });
        return;
      }
      res.status(200).json({ email: user.email });
      return;
    }

    if (req.method === 'POST' && action === 'signup') {
      const body = req.body || {};
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || !email.includes('@') || email.length > 254) {
        res.status(400).json({ error: '올바른 이메일 주소를 입력해주세요.' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: '비밀번호는 6자 이상이어야 해요.' });
        return;
      }
      const existing = await client.execute({
        sql: 'SELECT id FROM users WHERE email = ?',
        args: [email],
      });
      if (existing.rows.length) {
        res.status(409).json({ error: '이미 가입된 이메일이에요. 로그인해주세요.' });
        return;
      }
      const { salt, hash } = hashPassword(password);
      const id = crypto.randomUUID();
      const now = Date.now();
      await client.execute({
        sql: 'INSERT INTO users (id, email, salt, hash, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [id, email, salt, hash, now],
      });
      const token = newToken();
      await client.execute({
        sql: 'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        args: [token, id, now, now + require('../lib/auth').SESSION_MAX_AGE * 1000],
      });
      setSessionCookie(res, token);
      res.status(200).json({ email });
      return;
    }

    if (req.method === 'POST' && action === 'login') {
      const body = req.body || {};
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const result = await client.execute({
        sql: 'SELECT id, salt, hash FROM users WHERE email = ?',
        args: [email],
      });
      if (!result.rows.length || !verifyPassword(password, result.rows[0].salt, result.rows[0].hash)) {
        res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않아요.' });
        return;
      }
      const userId = result.rows[0].id;
      const token = newToken();
      const now = Date.now();
      await client.execute({
        sql: 'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        args: [token, userId, now, now + require('../lib/auth').SESSION_MAX_AGE * 1000],
      });
      setSessionCookie(res, token);
      res.status(200).json({ email });
      return;
    }

    if (req.method === 'POST' && action === 'logout') {
      const cookies = parseCookies(req);
      if (cookies.session) {
        await client.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [cookies.session] });
      }
      clearSessionCookie(res);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
