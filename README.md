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

## Vercel (Hobby)

Лайфхак: ожидание поиска Level крутится **в браузере** (`/api/lt/enqueue` → poll `/status` → `/packages`), а не в одной длинной serverless-функции.

Рейсы: `/api/enrich` по одному пакету подряд (Fluid греет Chromium на повторных вызовах), retry ×1, выход как только есть direct+12н.

На Hobby с Fluid `maxDuration` до **300 с** — нам хватает 60 с на enrich. В Project Settings включи Fluid Compute, если выключен.

```bash
# после деплоя жми Обновить; первый enrich холодный и может skip — второй обычно ок
```

## API

- `GET /api/lt/enqueue?date=2026-09-22`
- `GET /api/lt/status?requestId=...`
- `GET /api/lt/packages?requestId=...&date=...&perDay=3`
- `GET /api/enrich?packageId=404272259` — прямые + строго 12 ночей в отеле
- `GET /api/day?...` — старый монолит (можно не использовать)