import { Booking, Tradesperson, URGENCY_LABEL } from "./types";
import { formatSlot } from "./slots";

/**
 * Notification stubs. In production these become SMS (the tradesperson is on a
 * roof, not at a laptop) and a push/WhatsApp message respectively. They are
 * logged here so the whole flow is observable without external accounts.
 */

export function notifyTradesperson(tp: Tradesperson, b: Booking): void {
  const slot = formatSlot({ start: new Date(b.start_at), end: new Date(b.end_at) });
  console.log(
    `[notify:${tp.phone}] ${URGENCY_LABEL[b.urgency]} — ${b.customer_name}, ${b.address}. ` +
      `${slot}. "${b.problem}". Potvrdit: /dispatch`,
  );
}

export function notifyCustomer(b: Booking): void {
  const slot = formatSlot({ start: new Date(b.start_at), end: new Date(b.end_at) });
  const body =
    b.status === "confirmed"
      ? `Termín potvrzen: ${slot}.`
      : `Termín bohužel nevyšel${b.reject_reason ? ` — ${b.reject_reason}` : ""}. Ozveme se s náhradním.`;
  console.log(`[notify:${b.customer_phone}] ${body}`);
}
