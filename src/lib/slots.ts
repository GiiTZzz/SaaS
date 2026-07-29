import { db, expireStaleHolds } from "./db";
import { Tradesperson, Urgency, URGENCY_WINDOW_HOURS } from "./types";

export interface Slot {
  start: Date;
  end: Date;
}

/** Minimum notice before the earliest offered slot, per urgency. */
const LEAD_MINUTES: Record<Urgency, number> = {
  emergency: 45,
  urgent: 120,
  normal: 24 * 60,
};

const STEP_MINUTES = 30;

type WorkingHours = Record<string, [string, string][]>;

/**
 * Free slots for a tradesperson, soonest first.
 *
 * Times are interpreted in the server's local timezone. That is fine for a
 * single-country product but is the first thing to fix before selling abroad.
 */
export function findSlots(
  tp: Tradesperson,
  urgency: Urgency,
  limit = 3,
  now = new Date(),
): Slot[] {
  expireStaleHolds(now);

  const hours = JSON.parse(tp.working_hours) as WorkingHours;
  const windowEnd = new Date(now.getTime() + URGENCY_WINDOW_HOURS[urgency] * 3600_000);
  const busy = takenIntervals(tp.id, now, windowEnd);

  const out: Slot[] = [];
  let cursor = ceilToStep(new Date(now.getTime() + LEAD_MINUTES[urgency] * 60_000));

  while (cursor < windowEnd && out.length < limit) {
    const end = new Date(cursor.getTime() + tp.slot_minutes * 60_000);
    if (withinWorkingHours(cursor, end, hours) && !overlapsAny(cursor, end, busy)) {
      out.push({ start: new Date(cursor), end });
      // Don't offer three slots that all start 30 minutes apart — space them
      // out so the customer gets a real choice.
      cursor = new Date(end.getTime());
      continue;
    }
    cursor = new Date(cursor.getTime() + STEP_MINUTES * 60_000);
  }

  return out;
}

/** True only if the slot is still free. Callers must hold this check and the
 *  INSERT inside one transaction — see reserveSlot(). */
export function isSlotFree(
  tp: Tradesperson,
  start: Date,
  end: Date,
  now = new Date(),
): boolean {
  expireStaleHolds(now);
  const hours = JSON.parse(tp.working_hours) as WorkingHours;
  if (!withinWorkingHours(start, end, hours)) return false;
  return !overlapsAny(start, end, takenIntervals(tp.id, start, end));
}

function takenIntervals(tradespersonId: string, from: Date, to: Date): Slot[] {
  const rows = db()
    .prepare(
      `SELECT start_at, end_at FROM booking
       WHERE tradesperson_id = ?
         AND status IN ('held','confirmed')
         AND end_at > ? AND start_at < ?`,
    )
    .all(tradespersonId, from.toISOString(), to.toISOString()) as {
    start_at: string;
    end_at: string;
  }[];
  return rows.map((r) => ({ start: new Date(r.start_at), end: new Date(r.end_at) }));
}

function overlapsAny(start: Date, end: Date, intervals: Slot[]): boolean {
  return intervals.some((i) => start < i.end && end > i.start);
}

function withinWorkingHours(start: Date, end: Date, hours: WorkingHours): boolean {
  // A slot must sit entirely inside one working block on one day.
  const isoWeekday = String(start.getDay() === 0 ? 7 : start.getDay());
  const blocks = hours[isoWeekday];
  if (!blocks) return false;
  if (start.toDateString() !== end.toDateString()) return false;

  const startM = start.getHours() * 60 + start.getMinutes();
  const endM = end.getHours() * 60 + end.getMinutes();
  return blocks.some(([from, to]) => startM >= toMinutes(from) && endM <= toMinutes(to));
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function ceilToStep(d: Date): Date {
  const out = new Date(d);
  out.setSeconds(0, 0);
  const rem = out.getMinutes() % STEP_MINUTES;
  if (rem !== 0) out.setMinutes(out.getMinutes() + (STEP_MINUTES - rem));
  return out;
}

export function formatSlot(s: Slot): string {
  const day = s.start.toLocaleDateString("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "numeric",
  });
  const time = (d: Date) =>
    d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time(s.start)}–${time(s.end)}`;
}
