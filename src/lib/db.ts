import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Storage is Node's built-in SQLite rather than a native module, so a clone
 * needs no compiler toolchain — `npm install` cannot fail on a machine
 * without Visual Studio Build Tools or Xcode.
 */
let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instance) return instance;

  // Resolved on first use rather than at import time, so tests can point
  // DISPECR_DB at a scratch file before touching the database.
  const dbPath = process.env.DISPECR_DB ?? path.join(process.cwd(), "data", "dispecr.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  instance = new DatabaseSync(dbPath);
  instance.exec("PRAGMA journal_mode = WAL");
  instance.exec("PRAGMA foreign_keys = ON");
  migrate(instance);
  return instance;
}

/**
 * node:sqlite returns rows as Record<string, SQLOutputValue> and accepts only
 * primitive bind values. Our row shapes are fixed by the schema in migrate(),
 * so the casts are safe — they live here rather than at every call site.
 */
export function queryAll<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db().prepare(sql).all(...params) as unknown as T[];
}

export function queryOne<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db().prepare(sql).get(...params) as unknown as T | undefined;
}

/** Insert/update using @named placeholders bound from an object. */
export function runNamed(sql: string, row: object): void {
  db().prepare(sql).run(row as Record<string, SQLInputValue>);
}

/**
 * Run `fn` inside a transaction. node:sqlite has no transaction() wrapper, so
 * this is the single place BEGIN/COMMIT lives. Calls must not nest — SQLite
 * rejects a nested BEGIN.
 */
export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

/** Test helper: drop the cached handle so the next db() reopens DISPECR_DB. */
export function resetDbForTests(): void {
  instance?.close();
  instance = null;
}

function migrate(d: DatabaseSync) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS tradesperson (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      trade         TEXT NOT NULL,
      phone         TEXT NOT NULL,
      slot_minutes  INTEGER NOT NULL DEFAULT 90,
      -- JSON: { "1": [["08:00","16:00"]], ... } keyed by ISO weekday (1=Mon)
      working_hours TEXT NOT NULL,
      -- how long a proposed slot is held before it auto-expires
      hold_minutes  INTEGER NOT NULL DEFAULT 30
    );

    CREATE TABLE IF NOT EXISTS conversation (
      id              TEXT PRIMARY KEY,
      tradesperson_id TEXT NOT NULL REFERENCES tradesperson(id),
      state           TEXT NOT NULL,
      collected       TEXT NOT NULL DEFAULT '{}',
      -- slots most recently offered to the customer, so "the second one" resolves
      offers          TEXT NOT NULL DEFAULT '[]',
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversation(id),
      role            TEXT NOT NULL,
      text            TEXT NOT NULL,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_message_conv ON message(conversation_id, id);

    CREATE TABLE IF NOT EXISTS booking (
      id               TEXT PRIMARY KEY,
      conversation_id  TEXT NOT NULL REFERENCES conversation(id),
      tradesperson_id  TEXT NOT NULL REFERENCES tradesperson(id),
      start_at         TEXT NOT NULL,
      end_at           TEXT NOT NULL,
      status           TEXT NOT NULL,
      hold_expires_at  TEXT,
      urgency          TEXT NOT NULL,
      customer_name    TEXT NOT NULL,
      customer_phone   TEXT NOT NULL,
      address          TEXT NOT NULL,
      problem          TEXT NOT NULL,
      reject_reason    TEXT,
      created_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_booking_slot
      ON booking(tradesperson_id, start_at);
  `);
}

/**
 * Holds are released lazily rather than by a background job: any read that
 * cares about availability calls this first, so an abandoned conversation
 * cannot block a slot indefinitely.
 */
export function expireStaleHolds(now = new Date()): void {
  db()
    .prepare(
      `UPDATE booking SET status = 'expired'
       WHERE status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?`,
    )
    .run(now.toISOString());
}
