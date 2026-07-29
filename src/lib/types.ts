export type Urgency = "emergency" | "urgent" | "normal";

export const URGENCY_LABEL: Record<Urgency, string> = {
  emergency: "Havárie",
  urgent: "Naléhavé",
  normal: "Běžné",
};

/**
 * How far out we are willing to propose a slot, per urgency. An emergency that
 * can only be served in four days is not an emergency the customer will wait
 * for, so we cap the search window instead of silently offering next week.
 */
export const URGENCY_WINDOW_HOURS: Record<Urgency, number> = {
  emergency: 12,
  urgent: 48,
  normal: 24 * 14,
};

/** Everything the agent must know before it may propose a slot. */
export interface Collected {
  problem?: string;
  address?: string;
  name?: string;
  phone?: string;
  urgency?: Urgency;
}

export const REQUIRED_FIELDS = ["problem", "address", "name", "phone"] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export const FIELD_QUESTION: Record<RequiredField, string> = {
  problem: "Popište prosím co nejkonkrétněji, co se děje — co nefunguje, od kdy, a jestli svítí nějaký chybový kód.",
  address: "Na jaké adrese to je? Stačí ulice, číslo popisné a město.",
  name: "Na koho mám zakázku napsat? Stačí jméno a příjmení.",
  phone: "A telefon, kdyby vás technik potřeboval cestou zastihnout?",
};

export type ConversationState =
  | "collecting"
  | "proposing"
  | "held"
  | "confirmed"
  | "rejected";

export type BookingStatus = "held" | "confirmed" | "rejected" | "expired";

export interface Tradesperson {
  id: string;
  name: string;
  trade: string;
  phone: string;
  slot_minutes: number;
  working_hours: string;
  hold_minutes: number;
}

export interface Booking {
  id: string;
  conversation_id: string;
  tradesperson_id: string;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  hold_expires_at: string | null;
  urgency: Urgency;
  customer_name: string;
  customer_phone: string;
  address: string;
  problem: string;
  reject_reason: string | null;
  created_at: string;
}

export function missingFields(c: Collected): RequiredField[] {
  return REQUIRED_FIELDS.filter((f) => {
    const v = c[f];
    return typeof v !== "string" || v.trim().length === 0;
  });
}
