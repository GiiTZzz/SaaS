import { timingSafeEqual } from "node:crypto";

export type AccessCheck = { ok: true } | { ok: false; reason: string };

/**
 * Guards the dispatch side, which exposes customer names, phone numbers and
 * addresses and lets the caller accept or cancel work.
 *
 * A shared bookmarkable token is deliberately the whole mechanism: it is the
 * smallest thing that is actually closed, and it does not commit the product
 * to an account model before there is one. It is not per-user and there is no
 * revocation beyond rotating the value.
 */
export function checkDispatchAccess(supplied: string | undefined | null): AccessCheck {
  const expected = process.env.DISPECR_DISPATCH_TOKEN;

  if (!expected) {
    // Open by default only where it cannot leak real customer data.
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        reason:
          "Dispečink je uzamčen: nastavte proměnnou DISPECR_DISPATCH_TOKEN a otevřete /dispatch?token=…",
      };
    }
    return { ok: true };
  }

  if (!supplied) return { ok: false, reason: "Chybí přístupový token." };
  return equals(supplied, expected)
    ? { ok: true }
    : { ok: false, reason: "Neplatný přístupový token." };
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Token as sent by the dispatch UI on API calls. */
export function tokenFromRequest(req: Request): string | null {
  return req.headers.get("x-dispatch-token");
}
