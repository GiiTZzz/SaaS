import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeTradesperson, useScratchDb, wednesday } from "./helpers";

useScratchDb();

import { handleTurn, startConversation, history } from "../src/lib/conversation";
import { listBookings } from "../src/lib/bookings";
import { ruleBased } from "../src/lib/triage";

// These tests exercise the rule-based path deliberately: the state machine
// must behave identically whether or not the model is reachable.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

// A fixed instant, so the suite does not change behaviour with the time of
// day. Late enough in the afternoon and only one slot fits before closing,
// which used to make the "pick option 2" test fail after ~13:00.
const NOW = wednesday(9);

async function intake(tradespersonId: string, turns: string[]) {
  const conv = startConversation(tradespersonId);
  let last = { reply: "", state: "collecting" as string };
  for (const text of turns) last = await handleTurn(conv, text, NOW);
  return { conv, ...last };
}

const FULL_INTAKE = [
  "Uniká mi voda z kotle a teče to na podlahu",
  "Dlouhá 12, Brno",
  "Jan Svoboda",
  "601 222 333",
];

describe("intake state machine", () => {
  it("asks for one missing field at a time and never skips ahead", async () => {
    const tp = makeTradesperson();
    const conv = startConversation(tp.id);

    const first = await handleTurn(conv, "Nejde mi kotel", NOW);
    assert.equal(first.state, "collecting");

    const second = await handleTurn(conv, "Dlouhá 12, Brno", NOW);
    assert.equal(second.state, "collecting");
    assert.ok(/jméno|koho/i.test(second.reply), `expected a name question, got: ${second.reply}`);
  });

  it("only proposes slots once every required field is present", async () => {
    const tp = makeTradesperson();
    const { state, reply } = await intake(tp.id, FULL_INTAKE);
    assert.equal(state, "proposing");
    assert.match(reply, /1\)/);
  });

  it("reserves a hold when the customer picks a number", async () => {
    const tp = makeTradesperson();
    const { conv } = await intake(tp.id, FULL_INTAKE);

    const chosen = await handleTurn(conv, "1", NOW);
    assert.equal(chosen.state, "held");

    const bookings = listBookings(tp.id, NOW);
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].status, "held");
    assert.equal(bookings[0].customer_name, "Jan Svoboda");
  });

  it("re-asks instead of guessing when the choice is unclear", async () => {
    const tp = makeTradesperson();
    const { conv } = await intake(tp.id, FULL_INTAKE);

    const vague = await handleTurn(conv, "kdykoliv, je mi to jedno", NOW);
    assert.equal(vague.state, "proposing");
    assert.equal(listBookings(tp.id, NOW).length, 0, "an unclear answer must not book anything");
  });

  it("does not book anything while waiting for the tradesperson", async () => {
    const tp = makeTradesperson();
    const { conv } = await intake(tp.id, FULL_INTAKE);
    await handleTurn(conv, "1", NOW);

    const after = await handleTurn(conv, "tak co, potvrdil to?", NOW);
    assert.equal(after.state, "held");
    assert.equal(listBookings(tp.id, NOW).length, 1, "chatting must not create a second booking");
  });

  it("hands off to the phone rather than claiming a hold it never made", async () => {
    // No working hours at all: nothing can ever be offered.
    const tp = makeTradesperson({ working_hours: "{}" });
    const { state } = await intake(tp.id, FULL_INTAKE);

    assert.equal(state, "handoff");
    assert.equal(listBookings(tp.id, NOW).length, 0);
  });

  it("keeps the whole transcript", async () => {
    const tp = makeTradesperson();
    const { conv } = await intake(tp.id, FULL_INTAKE);
    const turns = history(conv);
    assert.equal(turns.filter((t) => t.role === "customer").length, FULL_INTAKE.length);
    assert.equal(turns.filter((t) => t.role === "agent").length, FULL_INTAKE.length);
  });
});

describe("slot choice parsing", () => {
  // parseChoice is not exported; drive it through the state machine instead.
  async function pick(answer: string) {
    const tp = makeTradesperson();
    const { conv } = await intake(tp.id, FULL_INTAKE);
    const result = await handleTurn(conv, answer, NOW);
    return { state: result.state, bookings: listBookings(tp.id) };
  }

  it("accepts a bare number", async () => {
    assert.equal((await pick("2")).state, "held");
  });

  it("accepts an ordinal word", async () => {
    assert.equal((await pick("beru ten první")).state, "held");
  });

  it("does not mistake a clock time for an option number", async () => {
    // "14:30" contains a 1 and a 3; neither is a choice.
    const { state, bookings } = await pick("hodilo by se mi to kolem 14:30");
    assert.equal(state, "proposing");
    assert.equal(bookings.length, 0);
  });

  it("does not accept an option that closing time squeezed out", async () => {
    // With a 45-minute emergency lead time, 15:00-16:00 is the only slot that
    // still fits before the 16:00 close, so option 2 does not exist.
    const lateAfternoon = wednesday(14, 0);
    const tp = makeTradesperson();
    const conv = startConversation(tp.id);
    for (const text of FULL_INTAKE) await handleTurn(conv, text, lateAfternoon);

    const result = await handleTurn(conv, "2", lateAfternoon);
    assert.equal(result.state, "proposing");
    assert.equal(listBookings(tp.id, lateAfternoon).length, 0);
  });

  it("ignores an option number that was never offered", async () => {
    const { state, bookings } = await pick("dejte mi termín 9");
    assert.equal(state, "proposing");
    assert.equal(bookings.length, 0);
  });
});

describe("rule-based extraction", () => {
  it("classifies a leak as an emergency", () => {
    const { collected } = ruleBased(
      [{ role: "customer", text: "Uniká mi plyn u kotle" }],
      {},
    );
    assert.equal(collected.urgency, "emergency");
  });

  it("classifies a dead appliance as urgent, not an emergency", () => {
    const { collected } = ruleBased(
      [{ role: "customer", text: "Kotel nefunguje, nenaskočí" }],
      {},
    );
    assert.equal(collected.urgency, "urgent");
  });

  it("treats a routine service request as normal", () => {
    const { collected } = ruleBased(
      [{ role: "customer", text: "Chtěl bych objednat roční revizi" }],
      {},
    );
    assert.equal(collected.urgency, "normal");
  });

  it("picks a phone number out of free text", () => {
    const { collected } = ruleBased(
      [{ role: "customer", text: "Zavolejte na 602 111 222, jsem tam po druhé" }],
      {},
    );
    assert.equal(collected.phone, "602 111 222");
  });

  it("never erases a field it already knows", () => {
    const { collected } = ruleBased(
      [{ role: "customer", text: "aha dobře" }],
      { name: "Jan Novák", address: "Dlouhá 1" },
    );
    assert.equal(collected.name, "Jan Novák");
    assert.equal(collected.address, "Dlouhá 1");
  });
});
