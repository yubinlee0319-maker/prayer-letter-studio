const crypto = require('crypto');

const SESSION_DAYS = 30;
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60; // seconds

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(check, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(req) {
  const header = (req.headers && req.headers.cookie) || '';
  const out = {};
  header.split(';').forEach(function (part) {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    'session=' + token + '; HttpOnly; Secure; SameSite=Lax; Max-Age=' + SESSION_MAX_AGE + '; Path=/'
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
}

async function getSessionUser(client, req) {
  const cookies = parseCookies(req);
  const token = cookies.session;
  if (!token) return null;
  const sessionRes = await client.execute({
    sql: 'SELECT user_id, expires_at FROM sessions WHERE token = ?',
    args: [token],
  });
  if (!sessionRes.rows.length) return null;
  const row = sessionRes.rows[0];
  if (Number(row.expires_at) < Date.now()) return null;
  const userRes = await client.execute({
    sql: 'SELECT id, email FROM users WHERE id = ?',
    args: [row.user_id],
  });
  if (!userRes.rows.length) return null;
  return { id: userRes.rows[0].id, email: userRes.rows[0].email, token };
}

module.exports = {
  SESSION_MAX_AGE,
  hashPassword,
  verifyPassword,
  newToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getSessionUser,
};
