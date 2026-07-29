import Link from "next/link";
import { db } from "@/lib/db";
import { listBookings } from "@/lib/bookings";
import { checkDispatchAccess } from "@/lib/auth";
import { Tradesperson } from "@/lib/types";
import Inbox from "./inbox";

export const dynamic = "force-dynamic";

export default async function Dispatch({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const access = checkDispatchAccess(token);

  if (!access.ok) {
    return (
      <main>
        <h1>Dispečink</h1>
        <p className="sub">{access.reason}</p>
      </main>
    );
  }

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
      <Inbox tradespersonId={tp.id} token={token ?? null} initial={listBookings(tp.id)} />
    </main>
  );
}
