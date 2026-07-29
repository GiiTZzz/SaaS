import { NextRequest, NextResponse } from "next/server";
import { getTradesperson, handleTurn, history, startConversation } from "@/lib/conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { conversationId?: string; tradespersonId?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

  let conversationId = body.conversationId;
  if (!conversationId) {
    const tradespersonId = body.tradespersonId;
    if (!tradespersonId) {
      return NextResponse.json(
        { error: "tradespersonId is required to start a conversation" },
        { status: 400 },
      );
    }
    if (!getTradesperson(tradespersonId)) {
      return NextResponse.json({ error: "unknown tradesperson" }, { status: 404 });
    }
    conversationId = startConversation(tradespersonId);
  }

  try {
    const { reply, state } = await handleTurn(conversationId, text);
    return NextResponse.json({ conversationId, reply, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unexpected error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("conversationId");
  if (!id) return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  return NextResponse.json({ conversationId: id, messages: history(id) });
}
