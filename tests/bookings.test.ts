import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeTradesperson, useScratchDb, wednesday } from "./helpers";

useScratchDb();

import { findSlots } from "../src/lib/slots";
import {
  reserveSlot,
  confirmBooking,
  rejectBooking,
  getBooking,
  listBookings,
  SlotTakenError,
} from "../src/lib/bookings";
import { startConversation } from "../src/lib/conversation";
import { db } from "../src/lib/db";

const CUSTOMER = {
  problem: "Kotel netopí",
  address: "Dlouhá 1, Brno",
  name: "Jan Novák",
  phone: "601111222",
  urgency: "urgent" as const,
};

const NOW = wednesday(9);

function reserveFirstSlot(now = NOW) {
  const tp = makeTradesperson();
  const conv = startConversation(tp.id);
  const [slot] = findSlots(tp, "emergency", 1, now);
  const booking = reserveSlot(tp, conv, slot.start, slot.end, CUSTOMER, now);
  return { tp, conv, slot, booking };
}

describe("reserveSlot", () => {
  it("creates a hold, not a confirmed booking", () => {
    const { booking } = reserveFirstSlot();
    assert.equal(booking.status, "held");
    assert.ok(booking.hold_expires_at, "a hold must carry an expiry");
  });

  it("copies the customer details onto the booking", () => {
    const { booking } = reserveFirstSlot();
    assert.equal(booking.customer_name, CUSTOMER.name);
    assert.equal(booking.address, CUSTOMER.address);
    assert.equal(booking.urgency, "urgent");
  });

  it("refuses to double-book the same slot", () => {
    const now = wednesday(9);
    const { tp, slot } = reserveFirstSlot(now);
    const other = startConversation(tp.id);

    assert.throws(
      () => reserveSlot(tp, other, slot.start, slot.end, CUSTOMER, now),
      SlotTakenError,
    );
  });

  it("refuses a slot outside working hours even if asked directly", () => {
    const tp = makeTradesperson();
    const conv = startConversation(tp.id);
    const now = wednesday(9);
    const start = new Date(2026, 6, 29, 22, 0, 0, 0); // 22:00, long after close
    const end = new Date(start.getTime() + 60 * 60_000);

    assert.throws(() => reserveSlot(tp, conv, start, end, CUSTOMER, now), SlotTakenError);
  });
});

describe("confirm and reject", () => {
  it("confirms a held booking and clears its expiry", () => {
    const { booking } = reserveFirstSlot();
    const confirmed = confirmBooking(booking.id, NOW);
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.hold_expires_at, null);
  });

  it("records the reason on a rejection", () => {
    const { booking } = reserveFirstSlot();
    const rejected = rejectBooking(booking.id, "Jsem na jiné zakázce", NOW);
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.reject_reason, "Jsem na jiné zakázce");
  });

  it("moves the conversation to a terminal state", () => {
    const { booking, conv } = reserveFirstSlot();
    confirmBooking(booking.id, NOW);

    const row = db().prepare(`SELECT state FROM conversation WHERE id = ?`).get(conv) as {
      state: string;
    };
    assert.equal(row.state, "confirmed");
  });

  it("rejects a second decision on the same booking", () => {
    const { booking } = reserveFirstSlot();
    confirmBooking(booking.id, NOW);
    assert.throws(() => confirmBooking(booking.id, NOW), /only a held booking can change/);
    assert.throws(() => rejectBooking(booking.id, null, NOW), /only a held booking can change/);
  });

  it("will not confirm a hold that has already expired", () => {
    const { booking } = reserveFirstSlot();
    // hold_minutes is 30, so the tradesperson is one minute too late.
    const tooLate = new Date(NOW.getTime() + 31 * 60_000);

    assert.throws(() => confirmBooking(booking.id, tooLate), /only a held booking can change/);
    assert.equal(getBooking(booking.id, tooLate)?.status, "expired");
  });
});

describe("listBookings", () => {
  it("puts the jobs awaiting a decision first", () => {
    const tp = makeTradesperson();
    const slots = findSlots(tp, "emergency", 2, NOW);

    const first = reserveSlot(tp, startConversation(tp.id), slots[0].start, slots[0].end, CUSTOMER, NOW);
    reserveSlot(tp, startConversation(tp.id), slots[1].start, slots[1].end, CUSTOMER, NOW);
    confirmBooking(first.id, NOW);

    const listed = listBookings(tp.id, NOW);
    assert.equal(listed[0].status, "held");
  });
});
