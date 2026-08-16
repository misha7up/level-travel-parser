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
  /** Сумма с карточки tbank («Кешбек + N»), не % */
  cashback: number | null;
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

function offerCashback(o: { cashback?: number | null }) {
  return typeof o.cashback === "number" && o.cashback > 0 ? o.cashback : 0;
}

function netOf(price: number, cashback: number | null | undefined) {
  return price - (typeof cashback === "number" && cashback > 0 ? cashback : 0);
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

export default function Home() {
  const [dateFrom, setDateFrom] = useState("2026-09-18");
  const [dateTo, setDateTo] = useState("2026-10-07"); // 20 дней вылета с 18.09
  const [hotelNights, setHotelNights] = useState<10 | 12>(10);
  const [topN, setTopN] = useState(25);
  /** На VPS 1GB: широкий охват дней, но лимит enrich (Chromium тяжёлый). */
  const PACKAGES_PER_DAY_SCAN = 5;
  const DAY_COVER = 18; // дешёвый пакет с каждого из N самых дешёвых дней
  const EXTRA_PACKAGES = 7; // итого до 25 пакетов на рейсы
  const PACKAGE_SCAN_CONCURRENCY = 2;
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

  const sortedOffers = useMemo(() => {
    const rows = [...offers];
    rows.sort((a, b) => {
      if (offerSort.key === "date") {
        const da = dateKey(a.checkIn || a.outboundDep);
        const db = dateKey(b.checkIn || b.outboundDep);
        const cmp =
          da.localeCompare(db) ||
          netOf(a.price, a.cashback) - netOf(b.price, b.cashback) ||
          prefScore(b) - prefScore(a);
        return offerSort.dir === "asc" ? cmp : -cmp;
      }
      const cmp =
        netOf(a.price, a.cashback) - netOf(b.price, b.cashback) ||
        prefScore(b) - prefScore(a);
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

  /** Грубая оценка: ~5с/день пакетов (×2 параллельно), ~18с на пакет с рейсами. */
  function estimateEta(opts: {
    phase: "packages" | "flights";
    dayIdx: number;
    days: number;
    flightIdx: number;
    flights: number;
  }) {
    const SEC_DAY = 5;
    const SEC_FLIGHT = 18;
    if (opts.phase === "packages") {
      const daysLeft = Math.max(0, opts.days - opts.dayIdx);
      return Math.ceil(daysLeft / PACKAGE_SCAN_CONCURRENCY) * SEC_DAY + opts.flights * SEC_FLIGHT;
    }
    const flightsLeft = Math.max(0, opts.flights - opts.flightIdx);
    return flightsLeft * SEC_FLIGHT;
  }

  function fetchWithTimeout(url: string, ms: number) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  async function mapPool<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    async function worker() {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }
    const n = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: n }, () => worker()));
    return out;
  }

  /** Выбор пакетов под enrich: покрыть дешёвые дни + добрать самые дешёвые пакеты. */
  function pickPackagesToEnrich(all: PackageRow[]): PackageRow[] {
    const byDay = new Map<string, PackageRow[]>();
    for (const p of all) {
      const list = byDay.get(p.departDate) || [];
      list.push(p);
      byDay.set(p.departDate, list);
    }
    const dayWinners: PackageRow[] = [];
    for (const [, list] of byDay) {
      list.sort((a, b) => a.price - b.price);
      if (list[0]) dayWinners.push(list[0]);
    }
    dayWinners.sort((a, b) => a.price - b.price);
    const picked: PackageRow[] = [];
    const seen = new Set<number>();
    for (const p of dayWinners.slice(0, DAY_COVER)) {
      picked.push(p);
      seen.add(p.packageId);
    }
    const rest = [...all]
      .filter((p) => !seen.has(p.packageId))
      .sort((a, b) => a.price - b.price);
    for (const p of rest) {
      if (picked.length >= DAY_COVER + EXTRA_PACKAGES) break;
      picked.push(p);
      seen.add(p.packageId);
    }
    return picked.sort((a, b) => a.price - b.price);
  }

  /** Hobby: ждём Level в браузере; сервер только короткие вызовы. */
  async function fetchDayPackages(day: string, perDay = 3): Promise<PackageRow[]> {
    const enqRes = await fetchWithTimeout(
      `/api/lt/enqueue?date=${day}&nights=${hotelNights}`,
      12_000,
    );
    const enq = await enqRes.json();
    if (!enqRes.ok) throw new Error(enq.error || `enqueue ${enqRes.status}`);
    const requestId = enq.requestId as string;

    let done = false;
    for (let i = 0; i < 30; i++) {
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
      await sleep(1000);
    }
    if (!done) pushLog(`  ${day}: status timeout — забираем офферы как есть…`);

    const pkgRes = await fetchWithTimeout(
      `/api/lt/packages?requestId=${encodeURIComponent(requestId)}&date=${day}&perDay=${perDay}&nights=${hotelNights}`,
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
      nights: String(hotelNights),
    });
    try {
      const res = await fetchWithTimeout(`/api/enrich?${q}`, 45_000);
      const data = await res.json();
      return { ok: !!data.ok, data };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = msg.toLowerCase().includes("abort");
      return { ok: false, data: { error: aborted ? "timeout_client_45s" : msg } };
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
    const flightBudget = DAY_COVER + EXTRA_PACKAGES;
    const all: PackageRow[] = [];
    try {
      setProgress({ dayIdx: 0, days, flightIdx: 0, flights: flightBudget });
      setEtaSec(estimateEta({ phase: "packages", dayIdx: 0, days, flightIdx: 0, flights: flightBudget }));

      // 1) Все дни диапазона — пакеты (2 параллельно, ок для 1 CPU)
      let doneDays = 0;
      const dayResults = await mapPool(dates, PACKAGE_SCAN_CONCURRENCY, async (day, i) => {
        setStatusMsg(`Пакеты · ${fmtDateRu(day)} (${i + 1}/${dates.length})…`);
        pushLog(`[${i + 1}/${dates.length}] пакеты ${day}…`);
        try {
          const pkgs = await fetchDayPackages(day, PACKAGES_PER_DAY_SCAN);
          pushLog(`  +${pkgs.length}`);
          return pkgs;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          pushLog(`  ошибка: ${msg}`);
          return [] as PackageRow[];
        } finally {
          doneDays += 1;
          setProgress({ dayIdx: doneDays, days, flightIdx: 0, flights: flightBudget });
          setEtaSec(
            estimateEta({
              phase: "packages",
              dayIdx: doneDays,
              days,
              flightIdx: 0,
              flights: flightBudget,
            }),
          );
        }
      });
      for (const pkgs of dayResults) all.push(...pkgs);
      setPackages([...all].sort((a, b) => a.price - b.price));
      pushLog(`Пакеты всего: ${all.length}`);

      // 2) Широкий отбор: дешёвые дни + доп. дешёвые пакеты (не только 3×3)
      const toEnrich = pickPackagesToEnrich(all);
      const daySet = new Set(toEnrich.map((p) => p.departDate));
      pushLog(
        `На рейсы: ${toEnrich.length} пакетов, ${daySet.size} дней (из ${all.length} пакетов)…`,
      );

      setPhase("flights");
      setStatusMsg(`Рейсы · туда до 09:00, обратно после 17:00…`);

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
            pushLog(`  skip: ${String(data.error || "no flights")}`);
            continue;
          }
          const filtered = (data.offers || []).filter(
            (o: FlightOffer) =>
              Number(o.hotelNights) === hotelNights &&
              outMin(o) < 9 * 60 &&
              retMin(o) >= 17 * 60,
          );
          const withCb = filtered.filter((o: FlightOffer) => offerCashback(o) > 0).length;
          pushLog(
            `  flights=${data.totalFlights} match=${filtered.length} cashback=${withCb}/${filtered.length}`,
          );
          collected.push(...filtered);
          setOffers(dedupeRank(collected, hotelNights).slice(0, topN));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          pushLog(`  skip: ${msg}`);
        }
      }
      setOffers(dedupeRank(collected, hotelNights).slice(0, topN));
      setPhase("done");
      setStatusMsg("");
      setEtaSec(null);
      if (!collected.length) {
        pushLog("Подходящих рейсов нет.");
      } else {
        pushLog("Готово.");
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

      <div className={`mx-auto max-w-[1400px] px-4 py-10 sm:px-6 ${running ? "pointer-events-none select-none" : ""}`}>
        <header className="mb-8 border-b border-[#1e332c] pb-6">
          <p className="text-sm tracking-[0.2em] text-[#7db89a] uppercase">tbank.level.travel</p>
          <h1 className="mt-2 font-serif text-3xl sm:text-4xl text-[#f3f7f4]">
            Rixos Radamis Blue Planet
          </h1>
          <p className="mt-2 max-w-2xl text-[#9bb5a8]">
            Ночи в отеле · только прямые рейсы · Москва.
            <br />
            Вылет туда только до 09:00 · обратно только после 17:00.
            <br />
            Нажмите «Обновить».
          </p>
        </header>

        <section className="grid gap-4 rounded-2xl border border-[#243a32] bg-[#111a17] p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#7db89a]">Вылет с</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              disabled={running}
              className="rounded-lg border border-[#2a453b] bg-[#0c1210] px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#7db89a]">Вылет по</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              disabled={running}
              className="rounded-lg border border-[#2a453b] bg-[#0c1210] px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#7db89a]">Ночей в отеле</span>
            <select
              value={hotelNights}
              onChange={(e) => setHotelNights(Number(e.target.value) === 12 ? 12 : 10)}
              disabled={running}
              className="rounded-lg border border-[#2a453b] bg-[#0c1210] px-3 py-2"
            >
              <option value={10}>10</option>
              <option value={12}>12</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#7db89a]">Сколько вариантов показать</span>
            <input
              type="number"
              min={5}
              max={40}
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value) || 25)}
              disabled={running}
              className="rounded-lg border border-[#2a453b] bg-[#0c1210] px-3 py-2"
            />
            <span className="text-xs text-[#6a8578]">по умолчанию 25</span>
          </label>
          <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-3 pt-1">
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
          <h2 className="mb-3 text-lg text-[#cfe3d8]">
            Топ: прямые + {hotelNights} ночей
          </h2>
          {!offers.length && (
            <p className="text-[#7a9488]">Пока пусто.</p>
          )}
          {!!offers.length && (
            <div className="overflow-x-auto rounded-xl border border-[#243a32]">
              <table className="w-full min-w-[1100px] table-fixed text-left text-sm">
                <thead className="bg-[#15211d] text-[#7db89a]">
                  <tr>
                    <th className="w-10 px-3 py-2">#</th>
                    <th className="w-[7.5rem] px-3 py-2">Цена</th>
                    <th className="w-[7.5rem] px-3 py-2">Кэшбек</th>
                    <th className="w-[7.5rem] px-3 py-2">
                      <button
                        type="button"
                        className="hover:text-[#cfe3d8]"
                        onClick={() => toggleSort(offerSort, "price", setOfferSort)}
                      >
                        Итог{sortMark(offerSort, "price")}
                      </button>
                    </th>
                    <th className="w-[6.5rem] px-3 py-2">
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
                    <th className="w-[7rem] px-3 py-2">Оператор</th>
                    <th className="w-[5rem] px-3 py-2">Ссылка</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOffers.map((o, i) => (
                    <tr
                      key={`${o.packageId}-${o.outboundFlight}-${o.returnFlight}-${o.outboundDep}-${i}`}
                      className="border-t border-[#1e332c]"
                    >
                      <td className="px-3 py-2 text-[#8aa597]">{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{money(o.price)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {offerCashback(o) > 0 ? `−${money(offerCashback(o))}` : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-[#6ecf9c]">
                        {money(netOf(o.price, o.cashback))}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtDateRu(o.checkIn || o.outboundDep)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtTime(o.outboundDep)} {o.outboundFrom}→{o.outboundTo}
                        <span className="block text-xs text-[#8aa597]">
                          {o.outboundAirline} {o.outboundFlight}
                          {o.earlyOut ? " · до 09:00" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtTime(o.returnDep)} {o.returnFrom}→{o.returnTo}
                        <span className="block text-xs text-[#8aa597]">
                          {o.returnAirline} {o.returnFlight}
                          {o.lateBack ? " · после 17:00" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2">{o.operator}</td>
                      <td className="px-3 py-2">
                        <a
                          href={o.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#6ecf9c] underline underline-offset-2"
                        >
                          открыть
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
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[#15211d] text-[#7db89a]">
                <tr>
                  <th className="px-3 py-2">Цена</th>
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
                {sortedPackages.slice(0, topN).map((p) => (
                  <tr key={p.packageId} className="border-t border-[#1e332c]">
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-[#6ecf9c]">
                      {money(p.price)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDateRu(p.departDate)}</td>
                    <td className="px-3 py-2">{p.operator}</td>
                    <td className="px-3 py-2">
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-[#6ecf9c]">
                        открыть
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

/** По итогу (цена − кэшбек с карточки) ↑; до 4 слотов на пакет. */
function dedupeRank(rows: FlightOffer[], hotelNights: number): FlightOffer[] {
  const need = hotelNights === 12 ? 12 : 10;
  const seen = new Set<string>();
  const unique: FlightOffer[] = [];
  const sorted = [...rows]
    .filter((r) => Number(r.hotelNights) === need)
    .sort(
      (a, b) =>
        netOf(a.price, a.cashback) - netOf(b.price, b.cashback) ||
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
  unique.sort(
    (a, b) =>
      netOf(a.price, a.cashback) - netOf(b.price, b.cashback) || prefScore(b) - prefScore(a),
  );
  return unique;
}
