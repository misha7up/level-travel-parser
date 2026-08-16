/** Динамический кэшбек партнёра tbank.level.travel (не хардкод). */

export const LT_SITE = "https://tbank.level.travel";

export type CashbackInfo = {
  rate: number; // 0.05 = 5%
  percentLabel: string; // "5%"
  tooltip: string;
  source: string;
};

function parsePercentFromText(text: string): number | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return n / 100;
}

function extractJsonAssignment(html: string, varName: string): unknown | null {
  const re = new RegExp(`window\\.${varName}\\s*=\\s*\\{`);
  const m = html.match(re);
  if (!m || m.index == null) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function cashbackFromPartnerHtml(html: string): CashbackInfo | null {
  // Самый стабильный сигнал — tooltip с процентом в partner embed.
  const tipMatch =
    html.match(/"cashbackTooltip"\s*:\s*"((?:\\.|[^"\\])*)"/) ||
    html.match(/"tooltip"\s*:\s*"(Получите кешб[еэ]к[^"]*)"/i);
  if (tipMatch) {
    const tooltip = tipMatch[1].replace(/\\u([\dA-Fa-f]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    ).replace(/\\"/g, '"');
    const rate = parsePercentFromText(tooltip);
    if (rate != null) {
      const pct = Math.round(rate * 1000) / 10;
      const percentLabel = `${pct}`.replace(/\.0$/, "") + "%";
      return {
        rate,
        percentLabel,
        tooltip,
        source: "cashbackTooltip",
      };
    }
  }

  const custom = extractJsonAssignment(html, "customCashback") as {
    cashbackTooltip?: string;
  } | null;
  // Только объект партнёра: window.cashback = {"id":...}
  const partnerRe = /window\.cashback\s*=\s*(\{(?:"id"|\{))/;
  const pm = html.match(partnerRe);
  let partner: { cashback?: { tooltip?: string } } | null = null;
  if (pm && pm.index != null) {
    const start = html.indexOf("{", pm.index);
    let depth = 0;
    for (let i = start; i < html.length; i++) {
      if (html[i] === "{") depth++;
      else if (html[i] === "}") {
        depth--;
        if (depth === 0) {
          try {
            partner = JSON.parse(html.slice(start, i + 1));
          } catch {
            partner = null;
          }
          break;
        }
      }
    }
  }

  const tooltip =
    custom?.cashbackTooltip || partner?.cashback?.tooltip || "";
  const rate = parsePercentFromText(tooltip);
  if (rate == null) {
    const m = html.match(/кешб[еэ]к[^%]{0,40}(\d+(?:[.,]\d+)?)\s*%/i);
    if (!m) return null;
    const n = Number(m[1].replace(",", "."));
    if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
    return {
      rate: n / 100,
      percentLabel: `${n}%`,
      tooltip: m[0],
      source: "html_fallback",
    };
  }
  const pct = Math.round(rate * 1000) / 10;
  const percentLabel = `${pct}`.replace(/\.0$/, "") + "%";
  return {
    rate,
    percentLabel,
    tooltip,
    source: custom?.cashbackTooltip ? "customCashback" : "window.cashback",
  };
}

export async function fetchTbankCashback(opts?: {
  packageId?: number;
}): Promise<CashbackInfo> {
  const urls: string[] = [];
  if (opts?.packageId) urls.push(`${LT_SITE}/packages/${opts.packageId}`);
  // Любая живая страница пакета на поддомене партнёра содержит percent в embed.
  urls.push(`${LT_SITE}/packages/404273168`);
  urls.push(`${LT_SITE}/`);

  let lastErr = "cashback percent not found";
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "text/html",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        lastErr = `tbank cashback HTTP ${res.status} (${url})`;
        continue;
      }
      const html = await res.text();
      const info = cashbackFromPartnerHtml(html);
      if (info) return info;
      lastErr = `no percent in ${url}`;
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastErr);
}

export function cashbackAmount(price: number, rate: number) {
  return Math.round(price * rate);
}

export function netAfterCashback(price: number, rate: number) {
  return price - cashbackAmount(price, rate);
}
