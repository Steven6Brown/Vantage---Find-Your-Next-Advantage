import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "./paths";

// Accounts, sessions and the security log live in a local SQLite file (Node's built-in driver).
// Always use parameterised statements (?), never string-built SQL.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  email_verified_at INTEGER,
  totp_secret TEXT,
  totp_pending TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_last_step INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  password_changed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  mfa_verified INTEGER NOT NULL,
  remember INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS recovery_codes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  event TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  detail TEXT,
  at INTEGER NOT NULL
);
`;

const g = globalThis as unknown as { __authDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (g.__authDb) return g.__authDb;
  const file = process.env.AUTH_DB_PATH ?? path.join(dataDir(), "auth.db");
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  d.exec(SCHEMA);
  g.__authDb = d;
  return d;
}

/** Test helper: closes and forgets the connection so the next call opens a fresh one. */
export function resetDbForTests() {
  g.__authDb?.close();
  g.__authDb = undefined;
}
