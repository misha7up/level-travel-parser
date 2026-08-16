# Rixos Blue Planet — Level.Travel search UI

Next.js app: даты → пакеты Level → прямые рейсы (10 или 12 ночей в отеле, по умолчанию 10) → топ выгодных.

## Ubuntu (рекомендуется для рейсов)

Полная инструкция: **[DEPLOY_UBUNTU.md](./DEPLOY_UBUNTU.md)**.

Кратко: Node 22 + `chromium-browser` + `npm run build` + systemd + nginx → открываешь `http://IP/`. Browserless не нужен.

## Локально

```bash
cd rixos-web
npm install
npm run dev
```

Локально для `/api/enrich` нужен установленный Chrome/Edge (`puppeteer-core` channel).

Открой http://localhost:3000 → выставь даты → **Обновить**.

Фильтр: **10 или 12 ночей в отеле** (`datesInfo.nights_count`) + прямые рейсы. «Тур на N» с меньшим числом ночей в отеле отбрасывается.

## Vercel (Hobby) — рейсы

Chromium-pack на Hobby **зависает** (скачивание ~66MB). Варианты:

1. **Рекомендуется:** бесплатный [Browserless](https://www.browserless.io/) → в Vercel Env:
   - `BROWSERLESS_TOKEN=...`
   - или `BROWSER_WS_ENDPOINT=wss://...`
2. Локально: `npm run dev` + Chrome — рейсы работают без токена.
3. `ALLOW_VERCEL_CHROMIUM=1` — снова включить pack (не советую на Hobby).

Пакеты Level собираются без браузера. Enrich: таймаут 22с на сервере + 25с на клиенте, без вечного retry.

Оценка на блюре: ~9с/день пакетов + ~22с/пакет рейсов.
## API

- `GET /api/lt/enqueue?date=2026-09-22`
- `GET /api/lt/status?requestId=...`
- `GET /api/lt/packages?requestId=...&date=...&perDay=3`
- `GET /api/enrich?packageId=404272259&nights=10` — прямые + N ночей в отеле
- `GET /api/day?...` — старый монолит (можно не использовать)