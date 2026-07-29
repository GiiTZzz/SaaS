import Link from "next/link";
import { db } from "@/lib/db";
import { Tradesperson } from "@/lib/types";
import Chat from "./chat";

export const dynamic = "force-dynamic";

export default function Home() {
  const tp = db().prepare(`SELECT * FROM tradesperson LIMIT 1`).get() as
    | Tradesperson
    | undefined;

  if (!tp) {
    return (
      <main>
        <h1>Dispečr</h1>
        <p className="sub">
          Databáze je prázdná. Spusťte <code>npm run seed</code> a načtěte stránku znovu.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>{tp.name}</h1>
      <p className="sub">
        {tp.trade} · nonstop příjem poptávek
        {" · "}
        <Link href="/dispatch">Zobrazit dispečink</Link>
      </p>
      <Chat tradespersonId={tp.id} />
    </main>
  );
}
