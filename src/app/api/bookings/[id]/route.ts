import { NextRequest, NextResponse } from "next/server";
import { confirmBooking, getBooking, rejectBooking } from "@/lib/bookings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: { action?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!getBooking(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    if (body.action === "confirm") {
      return NextResponse.json({ booking: confirmBooking(id) });
    }
    if (body.action === "reject") {
      return NextResponse.json({ booking: rejectBooking(id, body.reason?.trim() || null) });
    }
    return NextResponse.json({ error: "action must be confirm or reject" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unexpected error";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
