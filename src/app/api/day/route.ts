import { NextRequest, NextResponse } from "next/server";
import { searchDay } from "../../../lib/level";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  const perDay = Number(req.nextUrl.searchParams.get("perDay") || "3");
  const nights = Number(req.nextUrl.searchParams.get("nights")) === 12 ? 12 : 10;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }
  try {
    const packages = await searchDay(date, Math.min(Math.max(perDay, 1), 5), nights);
    return NextResponse.json({ date, nights, packages });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e), date }, { status: 502 });
  }
}
