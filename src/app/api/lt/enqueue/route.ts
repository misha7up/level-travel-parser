import { NextRequest, NextResponse } from "next/server";
import { ltEnqueue } from "../../../../lib/level";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }
  try {
    const requestId = await ltEnqueue(date);
    return NextResponse.json({ date, requestId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, date }, { status: 502 });
  }
}
