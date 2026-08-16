# Rixos Blue Planet — Level.Travel search UI

Next.js app: даты → пакеты Level → прямые рейсы (12 ночей в отеле) → топ выгодных.

## Локально

```bash
cd rixos-web
npm install
npm run dev
```

Локально для `/api/enrich` нужен установленный Chrome/Edge (`puppeteer-core` channel).

Открой http://localhost:3000 → выставь даты → **Обновить**.

Фильтр: только **12 ночей в отеле** (`datesInfo.nights_count === 12`) + прямые рейсы. «Тур на 12» с 11 ночами в отеле отбрасывается.

## Vercel

1. Framework: Next.js.
2. Нужен план с `maxDuration` ≥ 60 с (Pro) — поиск дня и Chromium для рейсов долгие.
3. Рейсы: `puppeteer-core` + `@sparticuz/chromium` (не Playwright — на Vercel у него нет browsers.json).

Hobby (10s) для enrich обычно не хватает — пакеты соберутся, рейсы упадут по таймауту.

## API

- `GET /api/day?date=2026-09-22&perDay=3` — пакеты Blue Planet / 12н
- `GET /api/enrich?packageId=404272259` — прямые рейсы со страницы пакета
