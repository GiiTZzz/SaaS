import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { makeTradesperson, saturday, useScratchDb, wednesday } from "./helpers";

useScratchDb();

import { findSlots, isSlotFree } from "../src/lib/slots";
import { reserveSlot, confirmBooking } from "../src/lib/bookings";
import { startConversation } from "../src/lib/conversation";

const CUSTOMER = {
  problem: "Kotel netopí",
  address: "Dlouhá 1, Brno",
  name: "Jan Novák",
  phone: "601111222",
};

describe("findSlots", () => {
  let tp: ReturnType<typeof makeTradesperson>;
  before(() => {
    tp = makeTradesperson();
  });

  it("respects the per-urgency lead time", () => {
    const now = wednesday(9);
    const [first] = findSlots(tp, "emergency", 1, now);
    // Emergency lead time is 45 minutes, rounded up to the next 30-minute grid slot.
    assert.equal(first.start.getHours(), 10);
    assert.equal(first.start.getMinutes(), 0);
  });

  it("gives a normal job a full day of notice", () => {
    const now = wednesday(9);
    const [first] = findSlots(tp, "normal", 1, now);
    assert.ok(first.start.getTime() - now.getTime() >= 24 * 3600_000);
  });

  it("never proposes a slot outside working hours", () => {
    const now = wednesday(9);
    for (const slot of findSlots(tp, "normal", 10, now)) {
      assert.ok(slot.start.getHours() >= 8, `starts at ${slot.start}`);
      assert.ok(
        slot.end.getHours() < 16 || (slot.end.getHours() === 16 && slot.end.getMinutes() === 0),
        `ends at ${slot.end}`,
      );
      assert.notEqual(slot.start.getDay(), 0);
      assert.notEqual(slot.start.getDay(), 6);
    }
  });

  it("never proposes a slot that would run past closing time", () => {
    const tp90 = makeTradesperson({ slot_minutes: 90 });
    // 15:00 + 90 min would end at 16:30, past the 16:00 close.
    const slots = findSlots(tp90, "emergency", 10, wednesday(13, 45));
    assert.ok(slots.every((s) => s.end.getHours() <= 16));
    assert.ok(!slots.some((s) => s.start.getHours() === 15));
  });

  it("returns nothing when the urgency window contains no working time", () => {
    // Saturday 09:00 + a 12-hour emergency window never reaches Monday.
    assert.deepEqual(findSlots(tp, "emergency", 3, saturday(9)), []);
  });

  it("returns offers in chronological order without overlapping each other", () => {
    const slots = findSlots(tp, "emergency", 3, wednesday(9));
    for (let i = 1; i < slots.length; i++) {
      assert.ok(slots[i].start.getTime() >= slots[i - 1].end.getTime());
    }
  });
});

describe("availability against existing bookings", () => {
  it("hides a slot that is already held, and frees it once the hold expires", () => {
    const tp = makeTradesperson();
    const now = wednesday(9);
    const conv = startConversation(tp.id);

    const [target] = findSlots(tp, "emergency", 1, now);
    reserveSlot(tp, conv, target.start, target.end, CUSTOMER, now);

    const afterHold = findSlots(tp, "emergency", 3, now);
    assert.ok(
      !afterHold.some((s) => s.start.getTime() === target.start.getTime()),
      "a held slot must not be offered again",
    );

    // hold_minutes is 30, so 31 minutes later the hold is stale.
    const later = new Date(now.getTime() + 31 * 60_000);
    assert.ok(isSlotFree(tp, target.start, target.end, later), "expired hold must free the slot");
  });

  it("keeps a confirmed booking blocked forever", () => {
    const tp = makeTradesperson();
    const now = wednesday(9);
    const conv = startConversation(tp.id);

    const [target] = findSlots(tp, "emergency", 1, now);
    const booking = reserveSlot(tp, conv, target.start, target.end, CUSTOMER, now);

    // Confirming clears the expiry; the slot must stay blocked well past it.
    confirmBooking(booking.id, now);

    const later = new Date(now.getTime() + 5 * 3600_000);
    assert.equal(isSlotFree(tp, target.start, target.end, later), false);
  });

  it("treats a partial overlap as a conflict", () => {
    const tp = makeTradesperson({ slot_minutes: 60 });
    const now = wednesday(9);
    const conv = startConversation(tp.id);

    const [target] = findSlots(tp, "emergency", 1, now);
    reserveSlot(tp, conv, target.start, target.end, CUSTOMER, now);

    // Shifted 30 minutes: starts inside the existing booking.
    const overlapStart = new Date(target.start.getTime() + 30 * 60_000);
    const overlapEnd = new Date(overlapStart.getTime() + 60 * 60_000);
    assert.equal(isSlotFree(tp, overlapStart, overlapEnd, now), false);
  });
});
