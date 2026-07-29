import { NextRequest, NextResponse } from "next/server";
import { listBookings } from "@/lib/bookings";
import { checkDispatchAccess, tokenFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const access = checkDispatchAccess(tokenFromRequest(req));
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 401 });

  const tradespersonId = req.nextUrl.searchParams.get("tradespersonId");
  if (!tradespersonId) {
    return NextResponse.json({ error: "tradespersonId is required" }, { status: 400 });
  }
  return NextResponse.json({ bookings: listBookings(tradespersonId) });
}
