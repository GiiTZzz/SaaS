import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = process.env.DISPECR_DB ?? path.join(process.cwd(), "data", "dispecr.db");

let instance: Database.Database | null = null;

export function db(): Database.Database {
  if (instance) return instance;

  const fs = require("node:fs") as typeof import("node:fs");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  instance = new Database(DB_PATH);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  migrate(instance);
  return instance;
}

function migrate(d: Database.Database) {
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
