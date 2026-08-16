"use client";

import { useMemo, useState } from "react";

type PackageRow = {
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

type FlightOffer = {
  price: number;
  hotelNights: number;
  checkIn: string;
  checkOut: string;
  outboundDep: string;
  outboundArr?: string;
  outboundFrom: string;
  outboundTo: string;
  outboundFlight: string;
  outboundAirline: string;
  returnDep: string;
  returnArr?: string;
  returnFrom: string;
  returnTo: string;
  returnFlight: string;
  returnAirline: string;
  earlyOut: boolean;
  lateBack: boolean;
  outMinutes?: number;
  retMinutes?: number;
  preferenceScore: number;
  operator: string;
  room: string;
  meal: string;
  url: string;
  packageId: number;
  why: string;
};

type SortKey = "price" | "date";
type SortDir = "asc" | "desc";

const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const a = new Date(from + "T12:00:00");
  const b = new Date(to + "T12:00:00");
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function money(n: number) {
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`;
}

function fmtDateRu(iso: string) {
  const raw = (iso || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return iso || "—";
  const day = Number(m[3]);
  const month = Number(m[2]);
  return `${day} ${MONTHS_RU[month - 1]}`;
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function dateKey(isoOrDate: string) {
  return (isoOrDate || "").slice(0, 10);
}

function minutesOf(iso: string) {
  try {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  } catch {
    return 12 * 60;
  }
}

function outMin(o: FlightOffer) {
  return o.outMinutes ?? minutesOf(o.outboundDep);
}

function retMin(o: FlightOffer) {
  return o.retMinutes ?? minutesOf(o.returnDep);
}

function prefScore(o: FlightOffer) {
  if (typeof o.preferenceScore === "number" && o.preferenceScore > 10) return o.preferenceScore;
  return 24 * 60 - outMin(o) + retMin(o);
}

function fmtDeltaHours(mins: number) {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

/** Сравнение с самым дешёвым: сколько доплатить за более ранний туда / поздний обратно. */
function altNote(o: FlightOffer, cheapest: FlightOffer | null): string {
  if (!cheapest || o.packageId === cheapest.packageId && o.outboundDep === cheapest.outboundDep && o.returnDep === cheapest.returnDep) {
    return "мин. цена";
  }
  const delta = o.price - cheapest.price;
  const earlier = outMin(cheapest) - outMin(o);
  const laterBack = retMin(o) - retMin(cheapest);
  const parts: string[] = [];
  if (earlier > 0) parts.push(`вылет раньше на ${fmtDeltaHours(earlier)}`);
  if (laterBack > 0) parts.push(`обратно позже на ${fmtDeltaHours(laterBack)}`);
  if (!parts.length) {
    if (delta <= 0) return "дешевле / тот же слот";
    return delta > 0 ? `+${money(delta)} без выигрыша по времени` : "";
  }
  if (delta <= 0) return parts.join(" · ");
  return `+${money(delta)} за ${parts.join(" и ")}`;
}

export default function Home() {
  const [dateFrom, setDateFrom] = useState("2026-09-18");
  const [dateTo, setDateTo] = useState("2026-09-28");
  const [topN, setTopN] = useState(20);
  const enrichTop = 12;
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [offers, setOffers] = useState<FlightOffer[]>([]);
  const [phase, setPhase] = useState<"idle" | "packages" | "flights" | "done">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [etaSec, setEtaSec] = useState<number | null>(null);
  const [progress, setProgress] = useState({ dayIdx: 0, days: 0, flightIdx: 0, flights: 0 });
  const [offerSort, setOfferSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "price",
    dir: "asc",
  });
  const [pkgSort, setPkgSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "price",
    dir: "asc",
  });

  const dates = useMemo(() => daysBetween(dateFrom, dateTo), [dateFrom, dateTo]);

  const cheapestOffer = useMemo(() => {
    if (!offers.length) return null;
    return [...offers].sort((a, b) => a.price - b.price || prefScore(b) - prefScore(a))[0];
  }, [offers]);

  const sortedOffers = useMemo(() => {
    const rows = [...offers];
    rows.sort((a, b) => {
      if (offerSort.key === "date") {
        const da = dateKey(a.checkIn || a.outboundDep);
        const db = dateKey(b.checkIn || b.outboundDep);
        const cmp = da.localeCompare(db) || a.price - b.price || prefScore(b) - prefScore(a);
        return offerSort.dir === "asc" ? cmp : -cmp;
      }
      // цена, при равной — раньше туда / позже обратно
      const cmp = a.price - b.price || prefScore(b) - prefScore(a);
      return offerSort.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [offers, offerSort]);

  const sortedPackages = useMemo(() => {
    const rows = [...packages];
    rows.sort((a, b) => {
      if (pkgSort.key === "date") {
        const cmp = a.departDate.localeCompare(b.departDate) || a.price - b.price;
        return pkgSort.dir === "asc" ? cmp : -cmp;
      }
      const cmp = a.price - b.price || a.departDate.localeCompare(b.departDate);
      return pkgSort.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [packages, pkgSort]);

  function pushLog(line: string) {
    setLog((prev) => [...prev.slice(-80), line]);
  }

  function toggleSort(
    current: { key: SortKey; dir: SortDir },
    key: SortKey,
    setter: (v: { key: SortKey; dir: SortDir }) => void,
  ) {
    if (current.key === key) {
      setter({ key, dir: current.dir === "asc" ? "desc" : "asc" });
    } else {
      setter({ key, dir: key === "price" ? "asc" : "asc" });
    }
  }

  function sortMark(current: { key: SortKey; dir: SortDir }, key: SortKey) {
    if (current.key !== key) return "";
    return current.dir === "asc" ? " ↑" : " ↓";
  }

  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function fmtEta(sec: number | null) {
    if (sec == null || sec < 0) return "";
    if (sec < 60) return `≈ ${Math.max(5, Math.round(sec))} сек`;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return s > 0 ? `≈ ${m} мин ${s} сек` : `≈ ${m} мин`;
  }

  /** Грубая оценка: ~9с на день пакетов, ~22с на пакет с рейсами. */
  function estimateEta(opts: {
    phase: "packages" | "flights";
    dayIdx: number;
    days: number;
    flightIdx: number;
    flights: number;
  }) {
    const SEC_DAY = 9;
    const SEC_FLIGHT = 22;
    if (opts.phase === "packages") {
      const daysLeft = Math.max(0, opts.days - opts.dayIdx);
      return daysLeft * SEC_DAY + opts.flights * SEC_FLIGHT;
    }
    const flightsLeft = Math.max(0, opts.flights - opts.flightIdx);
    return flightsLeft * SEC_FLIGHT;
  }

  function fetchWithTimeout(url: string, ms: number) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  /** Hobby: ждём Level в браузере; сервер только короткие вызовы. */
  async function fetchDayPackages(day: string, perDay = 3): Promise<PackageRow[]> {
    setStatusMsg(`Загружаю ${fmtDateRu(day)}…`);
    const enqRes = await fetchWithTimeout(`/api/lt/enqueue?date=${day}`, 12_000);
    const enq = await enqRes.json();
    if (!enqRes.ok) throw new Error(enq.error || `enqueue ${enqRes.status}`);
    const requestId = enq.requestId as string;

    let done = false;
    for (let i = 0; i < 30; i++) {
      setStatusMsg(`Жду туроператоров · ${fmtDateRu(day)}…`);
      const stRes = await fetchWithTimeout(
        `/api/lt/status?requestId=${encodeURIComponent(requestId)}`,
        10_000,
      );
      const st = await stRes.json();
      if (!stRes.ok) throw new Error(st.error || `status ${stRes.status}`);
      if (st.done) {
        done = true;
        break;
      }
      await sleep(1200);
    }
    if (!done) pushLog("  status timeout — забираем офферы как есть…");

    setStatusMsg(`Собираю пакеты · ${fmtDateRu(day)}…`);
    const pkgRes = await fetchWithTimeout(
      `/api/lt/packages?requestId=${encodeURIComponent(requestId)}&date=${day}&perDay=${perDay}`,
      20_000,
    );
    const pkgData = await pkgRes.json();
    if (!pkgRes.ok) throw new Error(pkgData.error || `packages ${pkgRes.status}`);
    return pkgData.packages || [];
  }

  async function enrichOnce(p: PackageRow): Promise<{ ok: boolean; data: any }> {
    setStatusMsg(`Смотрю рейсы · ${fmtDateRu(p.departDate)} · ${p.operator}…`);
    const q = new URLSearchParams({
      packageId: String(p.packageId),
      operator: p.operator || "",
      room: p.room || "",
      meal: p.meal || "",
    });
    try {
      const res = await fetchWithTimeout(`/api/enrich?${q}`, 25_000);
      const data = await res.json();
      return { ok: !!data.ok, data };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = msg.toLowerCase().includes("abort");
      return { ok: false, data: { error: aborted ? "timeout_client_25s" : msg } };
    }
  }

  async function run() {
    if (running) return;
    setRunning(true);
    setPhase("packages");
    setPackages([]);
    setOffers([]);
    setLog([]);
    setStatusMsg("Стартую поиск…");
    setOfferSort({ key: "price", dir: "asc" });
    const days = dates.length;
    const all: PackageRow[] = [];
    try {
      setProgress({ dayIdx: 0, days, flightIdx: 0, flights: enrichTop });
      setEtaSec(estimateEta({ phase: "packages", dayIdx: 0, days, flightIdx: 0, flights: enrichTop }));

      for (let i = 0; i < dates.length; i++) {
        const day = dates[i];
        setProgress({ dayIdx: i, days, flightIdx: 0, flights: enrichTop });
        setEtaSec(estimateEta({ phase: "packages", dayIdx: i, days, flightIdx: 0, flights: enrichTop }));
        pushLog(`[${i + 1}/${dates.length}] пакеты ${day}…`);
        try {
          const pkgs = await fetchDayPackages(day, 3);
          all.push(...pkgs);
          setPackages([...all].sort((a, b) => a.price - b.price));
          pushLog(`  +${pkgs.length} (всего ${all.length})`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          pushLog(`  ошибка: ${msg}`);
        }
      }

      const sorted = [...all].sort((a, b) => a.price - b.price);
      const toEnrich = sorted.slice(0, enrichTop);
      setPhase("flights");
      pushLog(`Рейсы по ${toEnrich.length} пакетам (таймаут 25с, без вечного retry)…`);

      const collected: FlightOffer[] = [];
      for (let i = 0; i < toEnrich.length; i++) {
        const p = toEnrich[i];
        setProgress({ dayIdx: days, days, flightIdx: i, flights: toEnrich.length });
        setEtaSec(
          estimateEta({
            phase: "flights",
            dayIdx: days,
            days,
            flightIdx: i,
            flights: toEnrich.length,
          }),
        );
        pushLog(`[${i + 1}/${toEnrich.length}] ${p.packageId} ${money(p.price)} ${p.operator}`);
        try {
          const { ok, data } = await enrichOnce(p);
          if (!ok) {
            pushLog(`  skip: ${data.error || "no flights"}`);
            continue;
          }
          pushLog(`  flights=${data.totalFlights} direct12=${data.direct12n}`);
          collected.push(
            ...(data.offers || []).filter((o: FlightOffer) => Number(o.hotelNights) === 12),
          );
          setOffers(dedupeRank(collected).slice(0, topN));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          pushLog(`  skip: ${msg}`);
        }
      }
      setOffers(dedupeRank(collected).slice(0, topN));
      setPhase("done");
      setStatusMsg("");
      setEtaSec(null);
      if (!collected.length) {
        pushLog(
          "Рейсы не собрались (нужен BROWSERLESS_TOKEN в Vercel). Ниже — пакеты с 12н в отеле, рейсы выбирай на Level.",
        );
      } else {
        pushLog("Готово (в топе только прямые + 12 ночей в отеле).");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      pushLog(`Сбой: ${msg}`);
      setPhase("idle");
      setStatusMsg("");
      setEtaSec(null);
    } finally {
      setRunning(false);
      setStatusMsg("");
      setEtaSec(null);
    }
  }

  return (
    <main className="relative min-h-screen bg-[#0c1210] text-[#e8efe9]">
      {running && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0c1210]/55 backdrop-blur-md">
          <div className="mx-4 flex max-w-md flex-col items-center gap-4 rounded-2xl border border-[#2a453b] bg-[#111a17]/95 px-8 py-7 shadow-2xl">
            <div
              className="h-10 w-10 animate-spin rounded-full border-2 border-[#2f9e6d] border-t-transparent"
              aria-hidden
            />
            <p className="text-center text-base text-[#f3f7f4]">{statusMsg || "Загружаю…"}</p>
            <p className="text-center text-sm text-[#7db89a]">{fmtEta(etaSec)}</p>
            <p className="text-center text-xs text-[#7a9488]">
              {phase === "packages"
                ? `Пакеты: день ${Math.min(progress.dayIdx + 1, progress.days || 1)}/${progress.days || "—"}`
                : `Рейсы: ${Math.min(progress.flightIdx + 1, progress.flights || 1)}/${progress.flights || "—"}`}
            </p>
          </div>
        </div>
      )}

      <div className={`mx-auto max-w-5xl px-4 py-10 sm:px-6 ${running ? "pointer-events-none select-none" : ""}`}>
        <header className="mb-8 border-b border-[#1e332c] pb-6">
          <p className="text-sm tracking-[0.2em] text-[#7db89a] uppercase">Level.Travel</p>
          <h1 className="mt-2 font-serif text-3xl sm:text-4xl text-[#f3f7f4]">
            Rixos Radamis Blue Planet
          </h1>
          <p className="mt-2 max-w-2xl text-[#9bb5a8]">
            12 ночей в отеле · только прямые рейсы · Москва.
            <br />
            Нажми «Обновить» — соберёт все даты диапазона.
          </p>
        </header>

        <section className="grid gap-4 rounded-2xl border border-[#243a32] bg-[#111a17] p-4 sm:grid-cols-2 lg:grid-cols-3 sm:p-5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#7db89a]">Вылет с</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-[#2a453b] bg-[#0c1210] px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#7db89a]">Вылет по</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-[#2a453b] bg-[#0c1210] px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#7db89a]">Сколько вариантов показать</span>
            <input
              type="number"
              min={5}
              max={40}
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value) || 20)}
              className="rounded-lg border border-[#2a453b] bg-[#0c1210] px-3 py-2"
            />
            <span className="text-xs text-[#6a8578]">по умолчанию 20</span>
          </label>
          <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              disabled={running || !dates.length}
              onClick={run}
              className="rounded-xl bg-[#2f9e6d] px-5 py-2.5 font-medium text-[#04110a] disabled:opacity-50 hover:bg-[#3bb87f]"
            >
              {running ? "Собираю…" : "Обновить"}
            </button>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-lg text-[#cfe3d8]">Топ: прямые + 12 ночей</h2>
          {!offers.length && (
            <p className="text-[#7a9488]">
              Пока пусто. Если рейсы не подтянулись на Vercel — добавь env{" "}
              <code className="text-[#9bb5a8]">BROWSERLESS_TOKEN</code> (см. README). Пакеты с 12
              ночами в отеле всё равно будут в таблице ниже.
            </p>
          )}
          {!!offers.length && (
            <div className="overflow-x-auto rounded-xl border border-[#243a32]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#15211d] text-[#7db89a]">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">
                      <button
                        type="button"
                        className="hover:text-[#cfe3d8]"
                        onClick={() => toggleSort(offerSort, "price", setOfferSort)}
                      >
                        Цена{sortMark(offerSort, "price")}
                      </button>
                    </th>
                    <th className="px-3 py-2">
                      <button
                        type="button"
                        className="hover:text-[#cfe3d8]"
                        onClick={() => toggleSort(offerSort, "date", setOfferSort)}
                      >
                        Дата{sortMark(offerSort, "date")}
                      </button>
                    </th>
                    <th className="px-3 py-2">Туда</th>
                    <th className="px-3 py-2">Обратно</th>
                    <th className="px-3 py-2">Vs мин. цена</th>
                    <th className="px-3 py-2">Оператор</th>
                    <th className="px-3 py-2">Ссылка</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOffers.map((o, i) => (
                    <tr
                      key={`${o.packageId}-${o.outboundFlight}-${o.returnFlight}-${o.outboundDep}-${i}`}
                      className="border-t border-[#1e332c]"
                    >
                      <td className="px-3 py-2 text-[#8aa597]">{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">{money(o.price)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtDateRu(o.checkIn || o.outboundDep)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtTime(o.outboundDep)} {o.outboundFrom}→{o.outboundTo}
                        <span className="block text-xs text-[#8aa597]">
                          {o.outboundAirline} {o.outboundFlight}
                          {o.earlyOut ? " · рано" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtTime(o.returnDep)} {o.returnFrom}→{o.returnTo}
                        <span className="block text-xs text-[#8aa597]">
                          {o.returnAirline} {o.returnFlight}
                          {o.lateBack ? " · поздно" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-[#9bb5a8] max-w-[220px]">
                        {altNote(o, cheapestOffer)}
                      </td>
                      <td className="px-3 py-2">{o.operator}</td>
                      <td className="px-3 py-2">
                        <a
                          href={o.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#6ecf9c] underline underline-offset-2"
                        >
                          Level
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-10">
          <h2 className="mb-3 text-lg text-[#cfe3d8]">Пакеты (до выбора рейса)</h2>
          <div className="overflow-x-auto rounded-xl border border-[#243a32]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#15211d] text-[#7db89a]">
                <tr>
                  <th className="px-3 py-2">
                    <button
                      type="button"
                      className="hover:text-[#cfe3d8]"
                      onClick={() => toggleSort(pkgSort, "price", setPkgSort)}
                    >
                      Цена{sortMark(pkgSort, "price")}
                    </button>
                  </th>
                  <th className="px-3 py-2">
                    <button
                      type="button"
                      className="hover:text-[#cfe3d8]"
                      onClick={() => toggleSort(pkgSort, "date", setPkgSort)}
                    >
                      Дата{sortMark(pkgSort, "date")}
                    </button>
                  </th>
                  <th className="px-3 py-2">Оператор</th>
                  <th className="px-3 py-2">Ссылка</th>
                </tr>
              </thead>
              <tbody>
                {sortedPackages.slice(0, 40).map((p) => (
                  <tr key={p.packageId} className="border-t border-[#1e332c]">
                    <td className="px-3 py-2 whitespace-nowrap">{money(p.price)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDateRu(p.departDate)}</td>
                    <td className="px-3 py-2">{p.operator}</td>
                    <td className="px-3 py-2">
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-[#6ecf9c]">
                        Level
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-2 text-lg text-[#cfe3d8]">Лог</h2>
          <pre className="max-h-64 overflow-auto rounded-xl border border-[#243a32] bg-[#0a0f0d] p-3 text-xs text-[#8aa597]">
            {log.join("\n") || "—"}
          </pre>
        </section>
      </div>
    </main>
  );
}

/** Цена ↑, при равной — раньше туда / позже обратно; до 4 слотов на пакет. */
function dedupeRank(rows: FlightOffer[]): FlightOffer[] {
  const seen = new Set<string>();
  const unique: FlightOffer[] = [];
  const sorted = [...rows]
    .filter((r) => Number(r.hotelNights) === 12)
    .sort(
      (a, b) =>
        a.price - b.price ||
        prefScore(b) - prefScore(a) ||
        a.outboundDep.localeCompare(b.outboundDep),
    );
  const perPkg = new Map<number, number>();
  for (const r of sorted) {
    const key = [r.price, r.outboundDep, r.returnDep, r.outboundFlight, r.returnFlight, r.packageId].join(
      "|",
    );
    if (seen.has(key)) continue;
    const n = perPkg.get(r.packageId) || 0;
    if (n >= 4) continue;
    seen.add(key);
    perPkg.set(r.packageId, n + 1);
    unique.push(r);
  }
  unique.sort((a, b) => a.price - b.price || prefScore(b) - prefScore(a));
  return unique;
}
