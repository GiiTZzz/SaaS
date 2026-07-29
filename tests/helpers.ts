import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db, resetDbForTests } from "../src/lib/db";
import { Tradesperson } from "../src/lib/types";

/**
 * Point the library at a scratch database. Must run before anything imports a
 * connection, so every test file calls this at the top of its first hook.
 */
export function useScratchDb(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispecr-test-"));
  process.env.DISPECR_DB = path.join(dir, "test.db");
  resetDbForTests();
}

const WEEKDAYS_8_TO_16 = JSON.stringify({
  "1": [["08:00", "16:00"]],
  "2": [["08:00", "16:00"]],
  "3": [["08:00", "16:00"]],
  "4": [["08:00", "16:00"]],
  "5": [["08:00", "16:00"]],
});

export function makeTradesperson(overrides: Partial<Tradesperson> = {}): Tradesperson {
  const tp: Tradesperson = {
    id: `tp_${Math.random().toString(36).slice(2, 8)}`,
    name: "Testovací servis",
    trade: "Topení",
    phone: "+420600000000",
    slot_minutes: 60,
    working_hours: WEEKDAYS_8_TO_16,
    hold_minutes: 30,
    ...overrides,
  };

  db()
    .prepare(
      `INSERT INTO tradesperson (id, name, trade, phone, slot_minutes, working_hours, hold_minutes)
       VALUES (@id, @name, @trade, @phone, @slot_minutes, @working_hours, @hold_minutes)`,
    )
    .run(tp);

  return tp;
}

/** A fixed Wednesday 09:00 local time, so slot maths never depends on today. */
export function wednesday(hour = 9, minute = 0): Date {
  const d = new Date(2026, 6, 29, hour, minute, 0, 0); // 29 Jul 2026 is a Wednesday
  if (d.getDay() !== 3) throw new Error("fixture date is not a Wednesday");
  return d;
}

/** A Saturday, which the default fixture treats as non-working. */
export function saturday(hour = 9): Date {
  return new Date(2026, 7, 1, hour, 0, 0, 0); // 1 Aug 2026
}
