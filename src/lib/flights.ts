export const EXTRACT_FLIGHTS_JS = `() => {
  function findStore() {
    const root = document.getElementById('checkout_page') || document.body;
    let store = null;
    function dfs(node, depth) {
      if (!node || depth > 45 || store) return;
      const props = node.memoizedProps;
      if (props && props.store && typeof props.store.getState === 'function') store = props.store;
      if (node.child) dfs(node.child, depth + 1);
      if (node.sibling) dfs(node.sibling, depth);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = walker.nextNode())) {
      const ck = Object.keys(el).find(k => k.startsWith('__reactContainer'));
      if (ck) {
        const c = el[ck];
        const start = c.stateNode && c.stateNode.current ? c.stateNode.current : (c.child || c);
        dfs(start, 0);
        break;
      }
    }
    return store;
  }
  const store = findStore();
  if (!store) return { ok: false, error: 'no_store' };
  const st = store.getState();
  const loading = st.flights && st.flights.loadingState;
  const all = [...(st.flights.economFlights || []), ...(st.flights.businessFlights || [])];
  const pkg = st.package || {};
  function back0(f) {
    const b = f.back;
    return Array.isArray(b) ? b[0] : b;
  }
  function isDirect(f) {
    const to = f.to || {};
    const backs = Array.isArray(f.back) ? f.back : [f.back].filter(Boolean);
    if (to.transition || !to.direct) return false;
    return backs.every(b => b && b.direct && !b.transition);
  }
  const rows = [];
  for (const f of all) {
    const di = f.datesInfo || {};
    if (!isDirect(f)) continue;
    if (Number(di.nights_count) !== 12) continue;
    const to = f.to;
    const b = back0(f);
    if (!to || !b) continue;
    const out = new Date(to.departure);
    const ret = new Date(b.departure);
    const early = out.getHours() * 60 + out.getMinutes() < 8 * 60;
    const late = ret.getHours() * 60 + ret.getMinutes() >= 18 * 60;
    rows.push({
      price: f.total_package_price,
      hotelNights: di.nights_count,
      checkIn: di.check_in,
      checkOut: di.check_out,
      outboundDep: to.departure,
      outboundArr: to.arrival,
      outboundFrom: (to.origin || {}).code,
      outboundTo: (to.destination || {}).code,
      outboundFlight: to.flight_no,
      outboundAirline: (to.airline || {}).name,
      returnDep: b.departure,
      returnArr: b.arrival,
      returnFrom: (b.origin || {}).code,
      returnTo: (b.destination || {}).code,
      returnFlight: b.flight_no,
      returnAirline: (b.airline || {}).name,
      earlyOut: early,
      lateBack: late,
      preferenceScore: (early ? 1 : 0) + (late ? 1 : 0),
    });
  }
  rows.sort((a, b) => a.price - b.price || b.preferenceScore - a.preferenceScore);
  return {
    ok: true,
    loading,
    totalFlights: all.length,
    direct12n: rows.length,
    packagePrice: pkg.price || pkg.net_price || null,
    room: pkg.room_type || null,
    meal: pkg.pansion_description || pkg.pansion || null,
    operator: (pkg.operator && pkg.operator.name) || null,
    best: rows.slice(0, 12),
  };
}`;

export type FlightOffer = {
  price: number;
  hotelNights: number;
  checkIn: string;
  checkOut: string;
  outboundDep: string;
  outboundArr: string;
  outboundFrom: string;
  outboundTo: string;
  outboundFlight: string;
  outboundAirline: string;
  returnDep: string;
  returnArr: string;
  returnFrom: string;
  returnTo: string;
  returnFlight: string;
  returnAirline: string;
  earlyOut: boolean;
  lateBack: boolean;
  preferenceScore: number;
  source: string;
  operator: string;
  room: string;
  meal: string;
  url: string;
  packageId: number;
  why: string;
};

function fmtMoney(n: number) {
  return `${Math.round(n).toLocaleString("ru-RU")} руб.`;
}

function whyText(row: FlightOffer) {
  const parts = [`прямые рейсы, 12 ночей в отеле, ${fmtMoney(row.price)}`];
  if (row.earlyOut && row.lateBack) {
    parts.push("ранний вылет из Москвы до 08:00 и поздний из Египта после 18:00");
  } else if (row.earlyOut) {
    parts.push("ранний вылет из Москвы до 08:00");
  } else if (row.lateBack) {
    parts.push("поздний вылет из Египта после 18:00");
  }
  return parts.join("; ");
}

async function launchBrowser() {
  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    const chromium = await import("@sparticuz/chromium");
    const puppeteer = await import("playwright-core");
    const executablePath = await chromium.default.executablePath();
    return puppeteer.chromium.launch({
      args: chromium.default.args,
      executablePath,
      headless: true,
    });
  }
  try {
    const pw = await import("playwright");
    return pw.chromium.launch({ headless: true });
  } catch {
    const core = await import("playwright-core");
    return core.chromium.launch({ headless: true, channel: "chrome" });
  }
}

export async function enrichPackage(packageId: number, meta?: { operator?: string; room?: string; meal?: string }) {
  const url = `https://level.travel/packages/${packageId}`;
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0",
      locale: "ru-RU",
      viewport: { width: 1440, height: 900 },
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    const deadline = Date.now() + 90000;
    let last: any = { ok: false };
    while (Date.now() < deadline) {
      last = await page.evaluate(EXTRACT_FLIGHTS_JS);
      if (last?.ok && (last.loading === "fetchFinished" || (last.totalFlights || 0) > 0)) {
        break;
      }
      await page.waitForTimeout(1500);
    }
    await page.close();
    if (!last?.ok) {
      return { ok: false as const, error: last?.error || "no_flights", url, packageId };
    }
    const offers: FlightOffer[] = (last.best || []).map((row: any) => {
      const fo: FlightOffer = {
        ...row,
        source: "level.travel",
        operator: last.operator || meta?.operator || "",
        room: last.room || meta?.room || "",
        meal: last.meal || meta?.meal || "",
        url,
        packageId,
        why: "",
      };
      fo.why = whyText(fo);
      return fo;
    });
    return {
      ok: true as const,
      url,
      packageId,
      totalFlights: last.totalFlights,
      direct12n: last.direct12n,
      offers,
    };
  } finally {
    await browser.close();
  }
}
