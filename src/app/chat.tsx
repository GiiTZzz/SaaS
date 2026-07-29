"use client";

import { useEffect, useRef, useState } from "react";

interface Bubble {
  role: "customer" | "agent";
  text: string;
}

const GREETING =
  "Dobrý den, jsem automatický dispečer. Popište mi prosím, co se stalo — " +
  "co nefunguje a od kdy. Zjistím naléhavost a rovnou nabídnu termín výjezdu.";

export default function Chat({ tradespersonId }: { tradespersonId: string }) {
  const [thread, setThread] = useState<Bubble[]>([{ role: "agent", text: GREETING }]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    setInput("");
    setError(null);
    setThread((t) => [...t, { role: "customer", text }]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, tradespersonId, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Nepodařilo se odeslat zprávu.");

      setConversationId(data.conversationId);
      setThread((t) => [...t, { role: "agent", text: data.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Neznámá chyba.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="thread">
        {thread.map((b, i) => (
          <div key={i} className={`bubble ${b.role}`}>
            {b.text}
          </div>
        ))}
        {busy && <div className="bubble agent">…</div>}
        <div ref={bottom} />
      </div>

      {error && <p className="meta">{error}</p>}

      <form className="composer" onSubmit={send}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Napište zprávu…"
          disabled={busy}
          autoFocus
        />
        <button className="primary" type="submit" disabled={busy || !input.trim()}>
          Odeslat
        </button>
      </form>
    </div>
  );
}
