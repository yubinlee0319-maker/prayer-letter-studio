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

// Every one of these is advisory/idempotent (CREATE TABLE IF NOT EXISTS,
// or an ADD COLUMN we only want once) — a transient lock error from
// another concurrent cold start racing to create the same tables just
// means someone else is doing (or already did) the same idempotent
// work, so swallow it rather than 500ing the whole request over it.
async function safeExec(client, sql) {
  try {
    await client.execute(sql);
  } catch (e) {}
}

// Cheap per-warm-container memo: once this instance has successfully
// run ensureSchema, skip the round trips on later requests it handles.
let schemaReady = false;

async function ensureSchema(client) {
  if (schemaReady) return;
  await safeExec(client, 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL)');
  await safeExec(client, 'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
  await safeExec(client, 'CREATE TABLE IF NOT EXISTS letters (id TEXT PRIMARY KEY, user_id TEXT, data TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  await safeExec(client, 'CREATE TABLE IF NOT EXISTS recipients (id TEXT PRIMARY KEY, user_id TEXT, data TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  // Best-effort: add user_id to tables created before accounts existed.
  // SQLite/libSQL has no "ADD COLUMN IF NOT EXISTS" — safeExec swallows
  // the duplicate-column error every later boot hits.
  await safeExec(client, 'ALTER TABLE letters ADD COLUMN user_id TEXT');
  await safeExec(client, 'ALTER TABLE recipients ADD COLUMN user_id TEXT');
  schemaReady = true;
}

module.exports = { getDb, ensureSchema };
