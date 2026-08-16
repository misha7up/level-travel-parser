import { NextResponse } from "next/server";
import { fetchTbankCashback } from "../../../lib/cashback";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const packageId = Number(u.searchParams.get("packageId") || 0) || undefined;
    const info = await fetchTbankCashback({ packageId });
    return NextResponse.json(info);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
