import { NextRequest, NextResponse } from "next/server";
import { enrichPackage } from "../../../lib/flights";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("packageId"));
  if (!id) {
    return NextResponse.json({ error: "packageId required" }, { status: 400 });
  }
  const operator = req.nextUrl.searchParams.get("operator") || undefined;
  const room = req.nextUrl.searchParams.get("room") || undefined;
  const meal = req.nextUrl.searchParams.get("meal") || undefined;
  try {
    const result = await enrichPackage(id, { operator, room, meal });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e), packageId: id },
      { status: 502 },
    );
  }
}
