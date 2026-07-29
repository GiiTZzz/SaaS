import Anthropic from "@anthropic-ai/sdk";
import { Collected, Urgency, missingFields } from "./types";

export interface TriageResult {
  collected: Collected;
  /** Natural-language reply for the customer, or null to use the canned question. */
  reply: string | null;
  /** True when the model (or the fallback) actually ran; false means we guessed. */
  usedModel: boolean;
}

const SYSTEM = `Jsi dispečer pro českou servisní firmu. Vedeš krátký, věcný rozhovor se zákazníkem, který hlásí poruchu.

Tvoje jediná práce je:
1. Z celé konverzace vytáhnout údaje, které zákazník už uvedl.
2. Odhadnout naléhavost.
3. Napsat jednu krátkou odpověď — nanejvýš dvě věty — která se zeptá právě na jeden chybějící údaj.

Pravidla:
- Nikdy nesliboj termín, cenu ani výjezd. Termíny přiděluje systém, ne ty.
- Nikdy si nevymýšlej údaje. Co zákazník neřekl, nech prázdné.
- Ptej se na jednu věc naráz. Piš česky, vykej, bez omáčky a bez emoji.
- Naléhavost: "emergency" = únik vody nebo plynu, žádné teplo v mrazu, riziko škody nebo ohrožení.
  "urgent" = nefunkční zařízení bez bezprostředního rizika. "normal" = servis, revize, drobnost.`;

const SCHEMA = {
  type: "object",
  properties: {
    problem: { type: "string", description: "Popis závady vlastními slovy zákazníka. Prázdné, pokud neuvedl." },
    address: { type: "string", description: "Adresa výjezdu. Prázdné, pokud neuvedl." },
    name: { type: "string", description: "Jméno zákazníka. Prázdné, pokud neuvedl." },
    phone: { type: "string", description: "Telefon zákazníka. Prázdné, pokud neuvedl." },
    urgency: { type: "string", enum: ["emergency", "urgent", "normal"] },
    reply: { type: "string", description: "Jedna krátká odpověď zákazníkovi, max dvě věty." },
  },
  required: ["problem", "address", "name", "phone", "urgency", "reply"],
  additionalProperties: false,
} as const;

export async function triage(
  history: { role: "customer" | "agent"; text: string }[],
  known: Collected,
): Promise<TriageResult> {
  if (!hasCredentials()) return { ...ruleBased(history, known), usedModel: false };

  try {
    const client = new Anthropic();
    const transcript = history
      .map((m) => `${m.role === "customer" ? "Zákazník" : "Dispečer"}: ${m.text}`)
      .join("\n");

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2000,
      system: SYSTEM,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [
        {
          role: "user",
          content:
            `Dosud známé údaje (JSON):\n${JSON.stringify(known)}\n\n` +
            `Přepis konverzace:\n${transcript}\n\n` +
            `Vrať aktualizované údaje a další odpověď.`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ...ruleBased(history, known), usedModel: false };
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return { ...ruleBased(history, known), usedModel: false };

    const raw = JSON.parse(text.text) as Record<string, string>;
    return {
      collected: merge(known, {
        problem: blankToUndefined(raw.problem),
        address: blankToUndefined(raw.address),
        name: blankToUndefined(raw.name),
        phone: blankToUndefined(raw.phone),
        urgency: asUrgency(raw.urgency),
      }),
      reply: blankToUndefined(raw.reply) ?? null,
      usedModel: true,
    };
  } catch {
    // A model outage must not take the intake form down with it.
    return { ...ruleBased(history, known), usedModel: false };
  }
}

function hasCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Deterministic fallback used when no API key is configured or the model call
 * fails. It is deliberately dumb: it only picks up things that are
 * unambiguous in free text, and lets the state machine ask for the rest.
 */
export function ruleBased(
  history: { role: "customer" | "agent"; text: string }[],
  known: Collected,
): { collected: Collected; reply: string | null } {
  const said = history.filter((m) => m.role === "customer");
  const last = said.at(-1)?.text.trim() ?? "";
  const all = said.map((m) => m.text).join(" ");

  const next: Collected = { ...known };

  const phone = all.match(/(\+420[\s]?)?\d{3}[\s]?\d{3}[\s]?\d{3}/);
  if (!next.phone && phone) next.phone = phone[0].trim();

  if (!next.problem && said.length > 0) next.problem = said[0].text.trim();

  // Whatever the customer typed right after we asked for a field is that field.
  const asked = history.at(-2);
  if (asked?.role === "agent" && last) {
    if (/adres/i.test(asked.text) && !next.address) next.address = last;
    else if (/jméno|koho/i.test(asked.text) && !next.name) next.name = last;
    else if (/telefon/i.test(asked.text) && !next.phone) next.phone = last;
  }

  if (!next.urgency) next.urgency = guessUrgency(all);

  return { collected: next, reply: null };
}

function guessUrgency(text: string): Urgency {
  const t = text.toLowerCase();
  if (/(uniká|únik|teče|vytop|plyn|zaplav|kouř|hoří|nesvítí vůbec|bez tepla|zamrz)/.test(t)) {
    return "emergency";
  }
  if (/(nefunguje|nejde|nestartuje|porucha|chybov|rozbi)/.test(t)) return "urgent";
  return "normal";
}

function merge(base: Collected, update: Collected): Collected {
  // Never let a later turn erase a field we already have — the customer only
  // ever adds information, and a model that returns "" must not undo that.
  return {
    problem: update.problem ?? base.problem,
    address: update.address ?? base.address,
    name: update.name ?? base.name,
    phone: update.phone ?? base.phone,
    urgency: update.urgency ?? base.urgency,
  };
}

function blankToUndefined(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function asUrgency(v: unknown): Urgency | undefined {
  return v === "emergency" || v === "urgent" || v === "normal" ? v : undefined;
}

export { missingFields };
