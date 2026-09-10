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
    'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL)'
  );
  await client.execute(
    'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)'
  );
  await client.execute(
    'CREATE TABLE IF NOT EXISTS letters (id TEXT PRIMARY KEY, user_id TEXT, data TEXT NOT NULL, updated_at INTEGER NOT NULL)'
  );
  await client.execute(
    'CREATE TABLE IF NOT EXISTS recipients (id TEXT PRIMARY KEY, user_id TEXT, data TEXT NOT NULL, updated_at INTEGER NOT NULL)'
  );
  // Best-effort: add user_id to tables created before accounts existed.
  // SQLite/libSQL has no "ADD COLUMN IF NOT EXISTS" — swallow the
  // duplicate-column error on every later boot.
  try { await client.execute('ALTER TABLE letters ADD COLUMN user_id TEXT'); } catch (e) {}
  try { await client.execute('ALTER TABLE recipients ADD COLUMN user_id TEXT'); } catch (e) {}
}

module.exports = { getDb, ensureSchema };
