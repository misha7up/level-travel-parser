import { NextRequest, NextResponse } from "next/server";
import { packagesFromRequest } from "../../../../lib/level";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get("requestId");
  const date = req.nextUrl.searchParams.get("date");
  const perDay = Number(req.nextUrl.searchParams.get("perDay") || "3");
  if (!requestId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "requestId + date required" }, { status: 400 });
  }
  try {
    const packages = await packagesFromRequest(requestId, date, Math.min(Math.max(perDay, 1), 5));
    return NextResponse.json({ date, requestId, packages });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, date, requestId }, { status: 502 });
  }
}
