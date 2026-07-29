import { randomUUID } from "node:crypto";
import { db, queryAll, queryOne } from "./db";
import { findSlots, formatSlot, Slot } from "./slots";
import { reserveSlot, SlotTakenError } from "./bookings";
import { triage } from "./triage";
import {
  Collected,
  ConversationState,
  FIELD_QUESTION,
  Tradesperson,
  URGENCY_LABEL,
  missingFields,
} from "./types";

export interface Turn {
  role: "customer" | "agent";
  text: string;
}

interface ConversationRow {
  id: string;
  tradesperson_id: string;
  state: ConversationState;
  collected: string;
  offers: string;
}

export function startConversation(tradespersonId: string): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO conversation (id, tradesperson_id, state, collected, offers, created_at, updated_at)
       VALUES (?, ?, 'collecting', '{}', '[]', ?, ?)`,
    )
    .run(id, tradespersonId, now, now);
  return id;
}

export function getTradesperson(id: string): Tradesperson | undefined {
  return queryOne<Tradesperson>(`SELECT * FROM tradesperson WHERE id = ?`, id);
}

export function history(conversationId: string): Turn[] {
  return queryAll<Turn>(
    `SELECT role, text FROM message WHERE conversation_id = ? ORDER BY id`,
    conversationId,
  );
}

function append(conversationId: string, role: Turn["role"], text: string): void {
  db()
    .prepare(
      `INSERT INTO message (conversation_id, role, text, created_at) VALUES (?, ?, ?, ?)`,
    )
    .run(conversationId, role, text, new Date().toISOString());
}

function save(
  id: string,
  state: ConversationState,
  collected: Collected,
  offers: Slot[],
): void {
  db()
    .prepare(
      `UPDATE conversation SET state = ?, collected = ?, offers = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      state,
      JSON.stringify(collected),
      JSON.stringify(offers.map((s) => [s.start.toISOString(), s.end.toISOString()])),
      new Date().toISOString(),
      id,
    );
}

/**
 * One customer turn. The model extracts and phrases; this function decides.
 * Every state change and every calendar write happens here, deterministically,
 * so the agent cannot invent a slot or skip a required field.
 */
export async function handleTurn(
  conversationId: string,
  customerText: string,
  now = new Date(),
): Promise<{ reply: string; state: ConversationState }> {
  const row = queryOne<ConversationRow>(`SELECT * FROM conversation WHERE id = ?`, conversationId);
  if (!row) throw new Error("conversation not found");

  const tp = getTradesperson(row.tradesperson_id);
  if (!tp) throw new Error("tradesperson not found");

  append(conversationId, "customer", customerText);

  const collected = JSON.parse(row.collected) as Collected;
  const offers = (JSON.parse(row.offers) as [string, string][]).map(([s, e]) => ({
    start: new Date(s),
    end: new Date(e),
  }));

  const result = await route(row.state, tp, conversationId, collected, offers, now);
  append(conversationId, "agent", result.reply);
  save(conversationId, result.state, result.collected, result.offers);
  return { reply: result.reply, state: result.state };
}

interface Outcome {
  reply: string;
  state: ConversationState;
  collected: Collected;
  offers: Slot[];
}

async function route(
  state: ConversationState,
  tp: Tradesperson,
  conversationId: string,
  collected: Collected,
  offers: Slot[],
  now: Date,
): Promise<Outcome> {
  switch (state) {
    case "collecting":
      return collect(tp, conversationId, collected, now);
    case "proposing":
      return choose(tp, conversationId, collected, offers, now);
    case "held":
      return {
        reply:
          "Termín držíme a čekáme na potvrzení od technika. Jakmile ho potvrdí, dáme vám vědět SMS.",
        state: "held",
        collected,
        offers,
      };
    case "handoff":
      return {
        reply: `Vaši poptávku už má ${tp.name} u sebe a ozve se vám telefonicky.`,
        state: "handoff",
        collected,
        offers,
      };
    case "confirmed":
      return {
        reply: "Termín je potvrzený. Pokud potřebujete něco změnit, zavolejte nám prosím.",
        state: "confirmed",
        collected,
        offers,
      };
    case "rejected":
      return {
        reply: "Tento termín bohužel nevyšel. Kolega se vám ozve s náhradním.",
        state: "rejected",
        collected,
        offers,
      };
  }
}

async function collect(
  tp: Tradesperson,
  conversationId: string,
  known: Collected,
  now: Date,
): Promise<Outcome> {
  const { collected, reply } = await triage(history(conversationId), known);
  const missing = missingFields(collected);

  if (missing.length > 0) {
    // Prefer the model's phrasing, but fall back to the canned question so the
    // intake still works with no API key and never asks for nothing.
    return {
      reply: reply ?? FIELD_QUESTION[missing[0]],
      state: "collecting",
      collected,
      offers: [],
    };
  }

  return propose(tp, collected, now);
}

function propose(tp: Tradesperson, collected: Collected, now: Date): Outcome {
  const urgency = collected.urgency ?? "normal";
  const slots = findSlots(tp, urgency, 3, now);

  if (slots.length === 0) {
    // Deliberately not "held": nothing was reserved, and telling the customer
    // we are holding a slot that does not exist is the one lie that costs the
    // tradesperson a callout.
    return {
      reply:
        `Díky, mám všechno potřebné. V rámci ${URGENCY_LABEL[urgency].toLowerCase()} zakázky ` +
        `teď bohužel nevidím volný termín — předávám to ${tp.name} a ozve se vám telefonicky.`,
      state: "handoff",
      collected,
      offers: [],
    };
  }

  const list = slots.map((s, i) => `${i + 1}) ${formatSlot(s)}`).join("\n");
  return {
    reply:
      `Díky, mám všechno potřebné. Naléhavost jsem vyhodnotil jako ${URGENCY_LABEL[urgency].toLowerCase()}.\n` +
      `Volné termíny:\n${list}\n\nNapište prosím číslo termínu, který vám vyhovuje.`,
    state: "proposing",
    collected,
    offers: slots,
  };
}

function choose(
  tp: Tradesperson,
  conversationId: string,
  collected: Collected,
  offers: Slot[],
  now: Date,
): Outcome {
  const last = history(conversationId).at(-1)?.text ?? "";
  const index = parseChoice(last, offers.length);

  if (index === null) {
    const list = offers.map((s, i) => `${i + 1}) ${formatSlot(s)}`).join("\n");
    return {
      reply: `Napište prosím číslo termínu:\n${list}`,
      state: "proposing",
      collected,
      offers,
    };
  }

  const slot = offers[index];
  try {
    reserveSlot(tp, conversationId, slot.start, slot.end, collected, now);
  } catch (err) {
    if (err instanceof SlotTakenError) {
      // Someone else took it between the offer and the answer. Re-offer rather
      // than confirming a slot we can no longer honour.
      const fresh = propose(tp, collected, now);
      return { ...fresh, reply: `Tento termín právě obsadil jiný zákazník.\n\n${fresh.reply}` };
    }
    throw err;
  }

  return {
    reply:
      `Termín ${formatSlot(slot)} držíme. Posílám ho ${tp.name} k potvrzení — ` +
      `jakmile ho odsouhlasí, přijde vám SMS. Pokud ho do ${tp.hold_minutes} minut nepotvrdí, ` +
      `termín uvolníme a ozveme se vám.`,
    state: "held",
    collected,
    offers: [],
  };
}

function parseChoice(text: string, count: number): number | null {
  // Strip anything that looks like a clock time first. "beru ten v 14:30"
  // must not resolve to option 1 just because a 1 appears in the hour.
  const cleaned = text.replace(/\d{1,2}[:.]\d{2}/g, " ");

  // Only a digit standing on its own is a choice — "12" or a house number is not.
  const standalone = cleaned.match(/(?:^|\s)([1-9])(?=[\s.,!)]|$)/);
  if (standalone) {
    const n = Number(standalone[1]) - 1;
    if (n >= 0 && n < count) return n;
  }

  const words: [RegExp, number][] = [
    [/prvn/i, 0],
    [/druh/i, 1],
    [/třet|tret/i, 2],
  ];
  for (const [re, i] of words) if (re.test(cleaned) && i < count) return i;
  return null;
}
