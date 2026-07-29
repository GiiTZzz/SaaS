"use client";

import { useEffect, useState } from "react";
import { Booking, URGENCY_LABEL } from "@/lib/types";

const STATUS_LABEL: Record<Booking["status"], string> = {
  held: "Čeká na potvrzení",
  confirmed: "Potvrzeno",
  rejected: "Odmítnuto",
  expired: "Vypršelo",
};

export default function Inbox({
  tradespersonId,
  initial,
}: {
  tradespersonId: string;
  initial: Booking[];
}) {
  const [bookings, setBookings] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/bookings?tradespersonId=${tradespersonId}`);
    if (res.ok) setBookings((await res.json()).bookings);
  }

  // Holds expire on a timer, so a stale page would show a slot as actionable
  // after it has already been released.
  useEffect(() => {
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradespersonId]);

  async function act(id: string, action: "confirm" | "reject") {
    const reason =
      action === "reject" ? window.prompt("Důvod (nepovinný):")?.trim() || null : null;

    setPending(id);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Akce se nezdařila.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Neznámá chyba.");
      await refresh();
    } finally {
      setPending(null);
    }
  }

  if (bookings.length === 0) {
    return <p className="sub">Zatím žádné zakázky.</p>;
  }

  return (
    <>
      {error && <p className="meta">{error}</p>}
      {bookings.map((b) => (
        <article className="card" key={b.id}>
          <header>
            <strong>{formatRange(b.start_at, b.end_at)}</strong>
            <span className={`tag ${b.urgency}`}>{URGENCY_LABEL[b.urgency]}</span>
          </header>
          <p className="meta">
            {b.customer_name} · {b.customer_phone}
          </p>
          <p className="meta">{b.address}</p>
          <p>{b.problem}</p>
          <p className="meta">
            {STATUS_LABEL[b.status]}
            {b.reject_reason ? ` — ${b.reject_reason}` : ""}
          </p>

          {b.status === "held" && (
            <div className="actions">
              <button
                className="primary"
                onClick={() => act(b.id, "confirm")}
                disabled={pending === b.id}
              >
                Potvrdit
              </button>
              <button onClick={() => act(b.id, "reject")} disabled={pending === b.id}>
                Odmítnout
              </button>
            </div>
          )}
        </article>
      ))}
    </>
  );
}

function formatRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const day = s.toLocaleDateString("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "numeric",
  });
  const time = (d: Date) =>
    d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time(s)}–${time(e)}`;
}
