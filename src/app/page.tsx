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
  preferenceScore: number;
  operator: string;
  room: string;
  meal: string;
  url: string;
  packageId: number;
  why: string;
};

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

function fmtDt(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function Home() {
  const [dateFrom, setDateFrom] = useState("2026-09-18");
  const [dateTo, setDateTo] = useState("2026-10-10");
  const [topN, setTopN] = useState(10);
  const [enrichTop, setEnrichTop] = useState(12);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [offers, setOffers] = useState<FlightOffer[]>([]);
  const [phase, setPhase] = useState<"idle" | "packages" | "flights" | "done">("idle");

  const dates = useMemo(() => daysBetween(dateFrom, dateTo), [dateFrom, dateTo]);

  function pushLog(line: string) {
    setLog((prev) => [...prev.slice(-80), line]);
  }

  async function run() {
    if (running) return;
    setRunning(true);
    setPhase("packages");
    setPackages([]);
    setOffers([]);
    setLog([]);
    const all: PackageRow[] = [];
    try {
      for (let i = 0; i < dates.length; i++) {
        const day = dates[i];
        pushLog(`[${i + 1}/${dates.length}] пакеты ${day}…`);
        const res = await fetch(`/api/day?date=${day}&perDay=3`);
        const data = await res.json();
        if (!res.ok) {
          pushLog(`  ошибка: ${data.error || res.status}`);
          continue;
        }
        const pkgs: PackageRow[] = data.packages || [];
        all.push(...pkgs);
        setPackages([...all].sort((a, b) => a.price - b.price));
        pushLog(`  +${pkgs.length} (всего ${all.length})`);
      }

      const sorted = [...all].sort((a, b) => a.price - b.price);
      const toEnrich = sorted.slice(0, enrichTop);
      setPhase("flights");
      pushLog(`Рейсы (прямые + 12 ночей) по топ-${toEnrich.length} пакетам…`);

      const collected: FlightOffer[] = [];
      for (let i = 0; i < toEnrich.length; i++) {
        const p = toEnrich[i];
        pushLog(`[${i + 1}/${toEnrich.length}] ${p.packageId} ${money(p.price)} ${p.operator}`);
        const q = new URLSearchParams({
          packageId: String(p.packageId),
          operator: p.operator || "",
          room: p.room || "",
          meal: p.meal || "",
        });
        const res = await fetch(`/api/enrich?${q}`);
        const data = await res.json();
        if (!data.ok) {
          pushLog(`  skip: ${data.error || "no flights"}`);
          continue;
        }
        pushLog(`  flights=${data.totalFlights} direct12=${data.direct12n}`);
        collected.push(...(data.offers || []));
        // live top
        const uniq = dedupeRank(collected).slice(0, topN);
        setOffers(uniq);
      }
      setOffers(dedupeRank(collected).slice(0, topN));
      setPhase("done");
      pushLog("Готово.");
    } catch (e: any) {
      pushLog(`Сбой: ${e?.message || e}`);
      setPhase("idle");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0c1210] text-[#e8efe9]">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <header className="mb-8 border-b border-[#1e332c] pb-6">
          <p className="text-sm tracking-[0.2em] text-[#7db89a] uppercase">Level.Travel</p>
          <h1 className="mt-2 font-serif text-3xl sm:text-4xl text-[#f3f7f4]">
            Rixos Radamis Blue Planet
          </h1>
          <p className="mt-2 max-w-2xl text-[#9bb5a8]">
            12 ночей в отеле · только прямые рейсы · Москва. Нажми «Обновить» — соберёт все даты
            диапазона и топ выгодных слотов.
          </p>
        </header>

        <section className="grid gap-4 rounded-2xl border border-[#243a32] bg-[#111a17] p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
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
            <span className="text-[#7db89a]">Топ в выдаче</span>
            <input
              type="number"
              min={5}
              max={30}
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value) || 10)}
              className="rounded-lg border border-[#2a453b] bg-[#0c1210] px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#7db89a]">Пакетов для рейсов</span>
            <input
              type="number"
              min={3}
              max={25}
              value={enrichTop}
              onChange={(e) => setEnrichTop(Number(e.target.value) || 12)}
              className="rounded-lg border border-[#2a453b] bg-[#0c1210] px-3 py-2"
            />
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
            <span className="text-sm text-[#8aa597]">
              {dates.length} дн. · фаза: {phase}
              {packages.length ? ` · пакетов: ${packages.length}` : ""}
              {offers.length ? ` · слотов: ${offers.length}` : ""}
            </span>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-lg text-[#cfe3d8]">Топ прямых + 12 ночей</h2>
          {!offers.length && (
            <p className="text-[#7a9488]">
              Пока пусто. После обновления здесь появятся лучшие варианты с рейсами.
            </p>
          )}
          <ol className="space-y-3">
            {offers.map((o, i) => (
              <li
                key={`${o.packageId}-${o.outboundFlight}-${o.returnFlight}-${o.outboundDep}-${i}`}
                className="rounded-xl border border-[#243a32] bg-[#111a17] p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xl font-medium text-[#f3f7f4]">
                    #{i + 1} {money(o.price)}
                  </span>
                  <span className="text-sm text-[#8aa597]">{o.operator}</span>
                </div>
                <p className="mt-1 text-sm text-[#9bb5a8]">
                  {o.room} · {o.meal}
                </p>
                <p className="mt-2 text-sm">
                  Отель: {o.checkIn} → {o.checkOut} (12 ночей)
                </p>
                <p className="mt-1 text-sm">
                  Туда: {fmtDt(o.outboundDep)} {o.outboundFrom}→{o.outboundTo} {o.outboundAirline}{" "}
                  {o.outboundFlight}
                  {o.earlyOut ? " · рано" : ""}
                </p>
                <p className="text-sm">
                  Обратно: {fmtDt(o.returnDep)} {o.returnFrom}→{o.returnTo} {o.returnAirline}{" "}
                  {o.returnFlight}
                  {o.lateBack ? " · поздно" : ""}
                </p>
                <p className="mt-2 text-sm text-[#7db89a]">Почему выгодно: {o.why}</p>
                <a
                  href={o.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-sm text-[#6ecf9c] underline underline-offset-2"
                >
                  Открыть на Level
                </a>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10">
          <h2 className="mb-3 text-lg text-[#cfe3d8]">Пакеты (до выбора рейса)</h2>
          <div className="overflow-x-auto rounded-xl border border-[#243a32]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#15211d] text-[#7db89a]">
                <tr>
                  <th className="px-3 py-2">Цена</th>
                  <th className="px-3 py-2">Вылет</th>
                  <th className="px-3 py-2">Оператор</th>
                  <th className="px-3 py-2">Номер</th>
                  <th className="px-3 py-2">Ссылка</th>
                </tr>
              </thead>
              <tbody>
                {packages.slice(0, 40).map((p) => (
                  <tr key={p.packageId} className="border-t border-[#1e332c]">
                    <td className="px-3 py-2 whitespace-nowrap">{money(p.price)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{p.departDate}</td>
                    <td className="px-3 py-2">{p.operator}</td>
                    <td className="px-3 py-2 max-w-[220px] truncate">{p.room}</td>
                    <td className="px-3 py-2">
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-[#6ecf9c]">
                        {p.packageId}
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

function dedupeRank(rows: FlightOffer[]): FlightOffer[] {
  const seen = new Set<string>();
  const unique: FlightOffer[] = [];
  const sorted = [...rows].sort(
    (a, b) => a.price - b.price || (b.preferenceScore || 0) - (a.preferenceScore || 0),
  );
  const perPkg = new Map<number, number>();
  for (const r of sorted) {
    const key = [r.price, r.outboundDep, r.returnDep, r.outboundFlight, r.returnFlight, r.packageId].join("|");
    if (seen.has(key)) continue;
    const n = perPkg.get(r.packageId) || 0;
    if (n >= 2) continue;
    seen.add(key);
    perPkg.set(r.packageId, n + 1);
    unique.push(r);
  }
  return unique;
}
