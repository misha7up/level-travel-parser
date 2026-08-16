import nacl from "tweetnacl";
import { inflate } from "pako";
import { createHash } from "crypto";

export const LT_KEY = "0fe9fb2ff35679322db5429b18a53aee";
export const LT_HOTEL_ID = 9162952;
export const LT_API = "https://api.level.travel";
export const ROOM_NEEDLE = "BLUE PLANET";
export const PREFERRED_OPERATORS = new Set([2, 3, 7, 8, 70]);

const BOX_KEYS = [
  "B1stAQVPJzJ015iJU8A1DP+i+d/5AbgIZavVPYKInrQ=",
  "6+uSlOycGhU6LmgIz1sXsnK6VuZHpPtVaiRbgF7WCg0=",
  "fve2pJpiBkJ5raA6EQCk2A21NDsFoP102jbDljzKDyc=",
  "1IsckNgz0hwlqpVT0ZsLvjAdd3VhANj9+770p+aKuns=",
  "DZllQsSt/82U/LdrlmoT+KNR578sK0y8E5709wjPPJQ=",
  "XRoiUKs7d0dXVjcvvhsYUZ6Oo/ekYXZR9p+21aT6DOI=",
  "3GV0SKSSEpNHxkwyU3VrCLgYJWrodLZJIZfpvJ3MVQY=",
];

const UA = "Mozilla/5.0";

function b64decode(s: string, urlsafe = false): Buffer {
  let t = s;
  if (urlsafe) t = t.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (t.length % 4)) % 4;
  if (pad) t += "=".repeat(pad);
  return Buffer.from(t, "base64");
}

export function decryptLt(text: string): unknown {
  if (!text.startsWith("!/")) return JSON.parse(text);
  const t = b64decode(text.slice(2), true);
  const keyIdx = Number(String.fromCharCode(23 ^ t[0]));
  const nonce = t.subarray(1, 25);
  const key = b64decode(BOX_KEYS[keyIdx - 1]);
  const opened = nacl.secretbox.open(new Uint8Array(t.subarray(25)), new Uint8Array(nonce), new Uint8Array(key));
  if (!opened) throw new Error("nacl open failed");
  let raw: Uint8Array;
  try {
    raw = inflate(opened);
  } catch {
    raw = inflate(opened, { windowBits: -15 });
  }
  return JSON.parse(Buffer.from(raw).toString("utf8"));
}

function flatten(obj: unknown, acc: unknown[] = []): unknown[] {
  if (typeof obj === "string") {
    acc.push(obj.trim());
    return acc;
  }
  if (obj && typeof obj === "object") {
    if (Array.isArray(obj)) {
      for (const v of obj) flatten(v, acc);
    } else {
      for (const v of Object.values(obj as Record<string, unknown>)) flatten(v, acc);
    }
    return acc;
  }
  acc.push(obj);
  return acc;
}

function stringify(e: unknown): string {
  let t = JSON.stringify(e).replace(/"/g, "");
  if ((t === "[]" || t === "{}") && typeof e !== "string") t = "";
  return t;
}

export function ltSign(params: Record<string, unknown>, endpoint: string): string {
  const mapped = flatten(params).map(stringify);
  const raw = mapped.sort().join("") + endpoint + LT_KEY + "2qqRS1f8TyuF";
  return createHash("md5").update(raw).digest("hex");
}

export async function ltGet(path: string, params: Record<string, string>, apiVersion = "3.14"): Promise<any> {
  const endpoint = path.replace(/\/$/, "").split("/").pop()!;
  const q: Record<string, string> = {
    ...params,
    key: LT_KEY,
    api_version: apiVersion,
    js: "true",
  };
  q.sign = ltSign(q, endpoint);
  const url = `${LT_API}${path}?${new URLSearchParams(q).toString()}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      Origin: "https://level.travel",
      Referer: "https://level.travel/",
      "X-Cnt": "ru",
      "X-Lang": "ru",
      "X-Cur": "RUB",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Level ${path} HTTP ${res.status}`);
  const ctype = res.headers.get("content-type") || "";
  const text = await res.text();
  if (ctype.includes("json") && !text.startsWith("!/")) return JSON.parse(text);
  return decryptLt(text);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ltEnqueue(dayIso: string): Promise<string> {
  const [y, m, d] = dayIso.split("-");
  const payload = await ltGet("/search/enqueue", {
    from_city: "Moscow",
    to_country: "EG",
    hotel_ids: String(LT_HOTEL_ID),
    nights: "12",
    adults: "2",
    start_date: `${d}.${m}.${y}`,
    stars_from: "1",
    stars_to: "5",
  });
  return payload.request_id as string;
}

export async function ltWaitStatus(requestId: string, timeoutMs = 35000): Promise<any> {
  const t0 = Date.now();
  let last: any = {};
  while (Date.now() - t0 < timeoutMs) {
    last = await ltGet("/search/status", { request_id: requestId });
    const status = last.status || {};
    const pending = Object.entries(status).filter(([, v]) =>
      ["pending", "in_progress", "queued"].includes(String(v)),
    );
    if (!pending.length) return last;
    await sleep(1200);
  }
  return last;
}

export function ltOkOperators(statusPayload: any): string[] {
  const status = statusPayload?.status || {};
  return Object.entries(status)
    .filter(([, v]) => ["cached", "success", "ok", "done", "all_filtered"].includes(String(v)))
    .map(([k]) => k);
}

function isBluePlanet(offer: any): boolean {
  const room = String(offer.room_type || "");
  const roomRu = String(offer.room_type_ru || "");
  return room.toUpperCase().includes(ROOM_NEEDLE) || roomRu.toUpperCase().includes(ROOM_NEEDLE);
}

export function pickOffers(offers: any[], limit = 3): any[] {
  const bp = offers.filter((o) => isBluePlanet(o) && Number(o.nights_count || 0) === 12);
  bp.sort((a, b) => {
    const ap = PREFERRED_OPERATORS.has(Number(a.operator)) ? 0 : 1;
    const bp_ = PREFERRED_OPERATORS.has(Number(b.operator)) ? 0 : 1;
    if (ap !== bp_) return ap - bp_;
    return Number(a.price || a.net_price || 1e12) - Number(b.price || b.net_price || 1e12);
  });
  const picked: any[] = [];
  const seen = new Set<number>();
  for (const o of bp) {
    const op = Number(o.operator || 0);
    if (seen.has(op)) continue;
    picked.push(o);
    seen.add(op);
    if (picked.length >= limit) break;
  }
  return picked;
}

export type PackageRow = {
  departDate: string;
  tourId: string;
  operator: string;
  price: number;
  room: string;
  meal: string;
  nights: number | null;
  checkIn: string;
  checkOut: string;
  packageId: number;
  url: string;
};

export async function searchDay(dayIso: string, perDay = 3): Promise<PackageRow[]> {
  const rid = await ltEnqueue(dayIso);
  const ops = ltOkOperators(await ltWaitStatus(rid));
  const offersPayload = await ltGet("/search/get_hotel_offers", {
    request_id: rid,
    hotel_id: String(LT_HOTEL_ID),
    operator_ids: ops.join(","),
  });
  const offers = offersPayload.hotel_offers || [];
  const picked = pickOffers(offers, perDay);
  const packages: PackageRow[] = [];
  for (const o of picked) {
    const go = await ltGet("/search/get_offer", { request_id: rid, tour_id: o.id });
    const pkg = go.package || {};
    if (!pkg.id) continue;
    // строго ночи в отеле (dates_info.nights_count), не «тур на 12»
    const nights = Number(pkg.dates_info?.nights_count ?? o.nights_count ?? 0);
    if (nights !== 12) continue;
    packages.push({
      departDate: dayIso,
      tourId: o.id,
      operator: pkg.operator?.name || o.operator_name || String(o.operator || ""),
      price: Math.round(Number(pkg.price || o.price || 0)),
      room: pkg.room_type || o.room_type || "",
      meal: pkg.pansion_description || "",
      nights: 12,
      checkIn: pkg.dates_info?.check_in || "",
      checkOut: pkg.dates_info?.check_out || "",
      packageId: pkg.id,
      url: `https://level.travel/packages/${pkg.id}`,
    });
  }
  return packages;
}
