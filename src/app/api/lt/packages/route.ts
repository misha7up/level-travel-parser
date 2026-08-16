import { NextRequest, NextResponse } from "next/server";
import { packagesFromRequest } from "../../../../lib/level";

export const runtime = "nodejs";
export const maxDuration = 30;

function parseNights(raw: string | null): 10 | 12 {
  return Number(raw) === 12 ? 12 : 10;
}

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get("requestId");
  const date = req.nextUrl.searchParams.get("date");
  const perDay = Number(req.nextUrl.searchParams.get("perDay") || "3");
  const nights = parseNights(req.nextUrl.searchParams.get("nights"));
  if (!requestId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "requestId + date required" }, { status: 400 });
  }
  try {
    const packages = await packagesFromRequest(
      requestId,
      date,
      Math.min(Math.max(perDay, 1), 5),
      undefined,
      nights,
    );
    return NextResponse.json({ date, requestId, nights, packages });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, date, requestId }, { status: 502 });
  }
}
