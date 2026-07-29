import Link from "next/link";
import { db } from "@/lib/db";
import { listBookings } from "@/lib/bookings";
import { Tradesperson } from "@/lib/types";
import Inbox from "./inbox";

export const dynamic = "force-dynamic";

export default function Dispatch() {
  const tp = db().prepare(`SELECT * FROM tradesperson LIMIT 1`).get() as
    | Tradesperson
    | undefined;

  if (!tp) {
    return (
      <main>
        <h1>Dispečink</h1>
        <p className="sub">
          Databáze je prázdná. Spusťte <code>npm run seed</code>.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Dispečink — {tp.name}</h1>
      <p className="sub">
        Držené termíny čekají na vaše potvrzení {tp.hold_minutes} minut, pak se uvolní.
        {" · "}
        <Link href="/">Zpět na příjem poptávek</Link>
      </p>
      <Inbox tradespersonId={tp.id} initial={listBookings(tp.id)} />
    </main>
  );
}
