import { NextRequest, NextResponse } from "next/server";
import { ltEnqueue } from "../../../../lib/level";

export const runtime = "nodejs";
export const maxDuration = 15;

function parseNights(raw: string | null): 10 | 12 {
  return Number(raw) === 12 ? 12 : 10;
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }
  const nights = parseNights(req.nextUrl.searchParams.get("nights"));
  try {
    const requestId = await ltEnqueue(date, nights);
    return NextResponse.json({ date, requestId, nights });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, date }, { status: 502 });
  }
}
