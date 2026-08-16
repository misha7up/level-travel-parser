import { existsSync } from "fs";
import type { Browser, Page } from "puppeteer-core";

/** Runs in page context: only direct flights with hotel nights_count === 12. */
export const EXTRACT_FLIGHTS_JS = `(() => {
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

  /** Суммы «Кешбек + N» с карточек (не процент из tooltip). */
  function scrapeCashbackByPrice() {
    const map = {};
    const nodes = document.querySelectorAll('div');
    for (let i = 0; i < nodes.length; i++) {
      const t = (nodes[i].innerText || '').replace(/\\s+/g, ' ').trim();
      if (t.length < 15 || t.length > 120) continue;
      const cm = t.match(/Кешб[еэ]к\\s*\\+?\\s*([\\d\\s]+)/i);
      const pm = t.match(/([\\d\\s]{4,})\\s*₽/);
      if (!cm || !pm) continue;
      const price = Number(pm[1].replace(/\\s+/g, ''));
      const cash = Number(cm[1].replace(/\\s+/g, ''));
      if (price > 10000 && cash > 0) map[price] = cash;
    }
    return map;
  }

  const store = findStore();
  if (!store) return { ok: false, error: 'no_store' };
  const st = store.getState();
  const loading = st.flights && st.flights.loadingState;
  try {
    store.dispatch({ type: 'flights/setVisibleFlights', payload: 120 });
  } catch (e) {}
  const all = [...(st.flights.economFlights || []), ...(st.flights.businessFlights || [])];
  const pkg = st.package || {};
  const pkgNights = Number((pkg.dates_info && pkg.dates_info.nights_count) || pkg.nights_count || 0);
  const cashByPrice = scrapeCashbackByPrice();
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
    const outMin = out.getHours() * 60 + out.getMinutes();
    const retMin = ret.getHours() * 60 + ret.getMinutes();
    if (outMin >= 9 * 60) continue;
    if (retMin < 17 * 60) continue;
    const preferenceScore = (24 * 60 - outMin) + retMin;
    const price = f.total_package_price;
    const cashback = cashByPrice[price] != null ? cashByPrice[price] : null;
    rows.push({
      price,
      cashback,
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
      earlyOut: outMin < 9 * 60,
      lateBack: retMin >= 17 * 60,
      outMinutes: outMin,
      retMinutes: retMin,
      preferenceScore,
    });
  }
  rows.sort((a, b) => {
    const na = a.price - (a.cashback || 0);
    const nb = b.price - (b.cashback || 0);
    return na - nb || b.preferenceScore - a.preferenceScore;
  });
  return {
    ok: true,
    loading,
    totalFlights: all.length,
    direct12n: rows.length,
    packageHotelNights: pkgNights || null,
    packagePrice: pkg.price || pkg.net_price || null,
    room: pkg.room_type || null,
    meal: pkg.pansion_description || pkg.pansion || null,
    operator: (pkg.operator && pkg.operator.name) || null,
    cashbackMapped: Object.keys(cashByPrice).length,
    best: rows.slice(0, 24),
  };
})()`;

export type FlightOffer = {
  price: number;
  /** Сумма кэшбека с карточки tbank (₽), не %. */
  cashback: number | null;
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
  outMinutes?: number;
  retMinutes?: number;
  preferenceScore: number;
  source: string;
  operator: string;
  room: string;
  meal: string;
  url: string;
  packageId: number;
  why: string;
};

const ENRICH_BUDGET_MS = process.env.VERCEL ? 22_000 : 40_000;

function fmtMoney(n: number) {
  return `${Math.round(n).toLocaleString("ru-RU")} руб.`;
}

function whyText(row: FlightOffer) {
  const parts = [`прямые рейсы, 12 ночей в отеле, ${fmtMoney(row.price)}`];
  if (row.earlyOut && row.lateBack) {
    parts.push("вылет до 09:00 и возврат после 17:00");
  } else if (row.earlyOut) {
    parts.push("вылет до 09:00");
  } else if (row.lateBack) {
    parts.push("возврат после 17:00");
  }
  if (row.cashback != null && row.cashback > 0) {
    parts.push(`кэшбек ${fmtMoney(row.cashback)}`);
  }
  return parts.join("; ");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function browserWsEndpoint(): string | null {
  if (process.env.BROWSER_WS_ENDPOINT) return process.env.BROWSER_WS_ENDPOINT;
  const token = process.env.BROWSERLESS_TOKEN;
  if (token) return `wss://production-sfo.browserless.io?token=${token}`;
  return null;
}

function resolveChromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : [
          "/usr/bin/chromium-browser",
          "/usr/bin/chromium",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/google-chrome",
          "/snap/bin/chromium",
        ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "no_chrome: поставь Chromium (`sudo apt install -y chromium-browser`) или задай CHROME_PATH",
  );
}

/** Один Chromium на процесс (VPS 1GB) — не поднимать браузер на каждый пакет. */
let sharedBrowser: Browser | null = null;
let sharedLaunch: Promise<Browser> | null = null;
let enrichLock: Promise<unknown> = Promise.resolve();

function withEnrichLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = enrichLock.then(fn, fn);
  enrichLock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  const ws = browserWsEndpoint();
  if (ws) {
    return puppeteer.default.connect({ browserWSEndpoint: ws });
  }

  const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (isServerless) {
    if (process.env.ALLOW_VERCEL_CHROMIUM === "1") {
      const chromiumMod = await import("@sparticuz/chromium");
      const chromium = chromiumMod.default ?? chromiumMod;
      const packUrl =
        process.env.CHROMIUM_PACK_URL ||
        "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";
      const executablePath = await chromium.executablePath(packUrl);
      const args = Array.isArray(chromium.args) ? chromium.args : await chromium.args;
      return puppeteer.default.launch({
        args,
        defaultViewport: { width: 1280, height: 720 },
        executablePath,
        headless: true,
      });
    }
    throw new Error(
      "no_browser: задай BROWSERLESS_TOKEN (или BROWSER_WS_ENDPOINT) в Vercel env — Chromium на Hobby зависает",
    );
  }

  const executablePath = resolveChromePath();
  return puppeteer.default.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1280, height: 720 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-first-run",
      "--font-render-hinting=none",
      "--js-flags=--max-old-space-size=192",
    ],
  });
}

async function getBrowser(): Promise<{ browser: Browser; shared: boolean }> {
  const ws = browserWsEndpoint();
  const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (ws || isServerless) {
    return { browser: await launchBrowser(), shared: false };
  }
  if (sharedBrowser) {
    try {
      if (sharedBrowser.connected) return { browser: sharedBrowser, shared: true };
    } catch {
      sharedBrowser = null;
      sharedLaunch = null;
    }
  }
  if (!sharedLaunch) {
    sharedLaunch = launchBrowser().then((b) => {
      sharedBrowser = b;
      b.on("disconnected", () => {
        sharedBrowser = null;
        sharedLaunch = null;
      });
      return b;
    });
  }
  return { browser: await sharedLaunch, shared: true };
}

async function blockHeavyAssets(page: Page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const t = req.resourceType();
    // CSS не режем — иначе вёрстка/часть UI кэшбека может не дойти
    if (t === "image" || t === "media" || t === "font") {
      req.abort().catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  });
}

async function waitFlights(page: Page, timeoutMs = 14_000) {
  await sleep(500);
  const deadline = Date.now() + timeoutMs;
  let last: any = { ok: false };
  while (Date.now() < deadline) {
    last = await page.evaluate(EXTRACT_FLIGHTS_JS);
    if (last?.ok && last.loading === "fetchFinished") {
      await sleep(500);
      last = await page.evaluate(EXTRACT_FLIGHTS_JS);
      return last;
    }
    if (last?.ok && (last.direct12n || 0) > 0 && (last.cashbackMapped || 0) > 0) {
      return last;
    }
    await sleep(600);
  }
  return last;
}

async function enrichPackageInner(
  packageId: number,
  meta?: { operator?: string; room?: string; meal?: string },
) {
  const url = `https://tbank.level.travel/packages/${packageId}`;
  let browser: Browser | null = null;
  let shared = false;
  try {
    const got = await getBrowser();
    browser = got.browser;
    shared = got.shared;
    const page = await browser.newPage();
    try {
      await page.setUserAgent("Mozilla/5.0");
      await blockHeavyAssets(page);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const last = await waitFlights(page, 14_000);

      if (!last?.ok) {
        return { ok: false as const, error: last?.error || "no_flights", url, packageId };
      }

      const offers: FlightOffer[] = (last.best || [])
        .filter((row: any) => Number(row.hotelNights) === 12)
        .map((row: any) => {
          const fo: FlightOffer = {
            ...row,
            cashback: typeof row.cashback === "number" ? row.cashback : null,
            hotelNights: 12,
            source: "tbank.level.travel",
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

      if (!offers.length) {
        return {
          ok: false as const,
          error: `no_direct_12_hotel_nights (flights=${last.totalFlights || 0})`,
          url,
          packageId,
        };
      }

      return {
        ok: true as const,
        url,
        packageId,
        totalFlights: last.totalFlights,
        direct12n: offers.length,
        cashbackMapped: last.cashbackMapped || 0,
        offers,
      };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    if (browser && !shared) {
      try {
        if (browserWsEndpoint()) await browser.disconnect();
        else await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function enrichPackage(
  packageId: number,
  meta?: { operator?: string; room?: string; meal?: string },
) {
  const url = `https://tbank.level.travel/packages/${packageId}`;
  return withEnrichLock(async () => {
    try {
      return await Promise.race([
        enrichPackageInner(packageId, meta),
        sleep(ENRICH_BUDGET_MS).then(() => ({
          ok: false as const,
          error: `timeout_${ENRICH_BUDGET_MS / 1000}s`,
          url,
          packageId,
        })),
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error: msg, url, packageId };
    }
  });
}
