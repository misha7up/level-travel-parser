import { NextRequest, NextResponse } from "next/server";
import { ltStatusOnce } from "../../../../lib/level";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get("requestId");
  if (!requestId) {
    return NextResponse.json({ error: "requestId required" }, { status: 400 });
  }
  try {
    const once = await ltStatusOnce(requestId);
    return NextResponse.json({
      requestId,
      done: once.done,
      pending: once.pending,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, requestId }, { status: 502 });
  }
}
