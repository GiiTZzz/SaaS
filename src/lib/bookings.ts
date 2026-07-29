import { randomUUID } from "node:crypto";
import { db, expireStaleHolds, queryAll, queryOne, runNamed, tx } from "./db";
import { isSlotFree } from "./slots";
import { Booking, Collected, Tradesperson, Urgency } from "./types";
import { notifyTradesperson, notifyCustomer } from "./notify";

export class SlotTakenError extends Error {
  constructor() {
    super("slot no longer available");
  }
}

/**
 * Create a *hold*, not a booking. The agent is never allowed to promise a
 * technician's time — it reserves the slot, the tradesperson confirms it, and
 * the hold expires on its own if they don't.
 */
export function reserveSlot(
  tp: Tradesperson,
  conversationId: string,
  start: Date,
  end: Date,
  collected: Collected,
  now = new Date(),
): Booking {
  const urgency: Urgency = collected.urgency ?? "normal";

  const booking = tx((): Booking => {
    // Re-check inside the transaction: the availability the customer saw may
    // be seconds stale, and two customers can pick the same slot.
    if (!isSlotFree(tp, start, end, now)) throw new SlotTakenError();

    const row: Booking = {
      id: randomUUID(),
      conversation_id: conversationId,
      tradesperson_id: tp.id,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status: "held",
      hold_expires_at: new Date(now.getTime() + tp.hold_minutes * 60_000).toISOString(),
      urgency,
      customer_name: collected.name ?? "",
      customer_phone: collected.phone ?? "",
      address: collected.address ?? "",
      problem: collected.problem ?? "",
      reject_reason: null,
      created_at: now.toISOString(),
    };

    runNamed(
      `INSERT INTO booking (id, conversation_id, tradesperson_id, start_at, end_at,
           status, hold_expires_at, urgency, customer_name, customer_phone, address,
           problem, reject_reason, created_at)
         VALUES (@id, @conversation_id, @tradesperson_id, @start_at, @end_at,
           @status, @hold_expires_at, @urgency, @customer_name, @customer_phone,
           @address, @problem, @reject_reason, @created_at)`,
      row,
    );

    return row;
  });

  notifyTradesperson(tp, booking);
  return booking;
}

export function getBooking(id: string, now = new Date()): Booking | undefined {
  expireStaleHolds(now);
  return queryOne<Booking>(`SELECT * FROM booking WHERE id = ?`, id);
}

export function listBookings(tradespersonId: string, now = new Date()): Booking[] {
  expireStaleHolds(now);
  return queryAll<Booking>(
    `SELECT * FROM booking WHERE tradesperson_id = ?
     ORDER BY CASE status WHEN 'held' THEN 0 ELSE 1 END, start_at`,
    tradespersonId,
  );
}

/** Tradesperson accepts the hold. Only a live hold can be confirmed. */
export function confirmBooking(id: string, now = new Date()): Booking {
  return transition(id, "confirmed", null, now);
}

export function rejectBooking(id: string, reason: string | null, now = new Date()): Booking {
  return transition(id, "rejected", reason, now);
}

/**
 * `now` is threaded through rather than read from the clock inside, so that
 * expiry is decided by the same instant the caller used to reserve the slot.
 */
function transition(
  id: string,
  to: "confirmed" | "rejected",
  reason: string | null,
  now: Date,
): Booking {
  expireStaleHolds(now);
  const booking = tx((): Booking => {
    const current = queryOne<Booking>(`SELECT * FROM booking WHERE id = ?`, id);
    if (!current) throw new Error("booking not found");
    if (current.status !== "held") {
      throw new Error(`booking is ${current.status}, only a held booking can change`);
    }

    db()
      .prepare(
        `UPDATE booking SET status = ?, reject_reason = ?, hold_expires_at = NULL WHERE id = ?`,
      )
      .run(to, reason, id);

    db()
      .prepare(`UPDATE conversation SET state = ?, updated_at = ? WHERE id = ?`)
      .run(to === "confirmed" ? "confirmed" : "rejected", now.toISOString(), current.conversation_id);

    return { ...current, status: to, reject_reason: reason, hold_expires_at: null };
  });

  notifyCustomer(booking);
  return booking;
}
