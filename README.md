# Rixos Blue Planet — Level.Travel search UI

Next.js app: даты → пакеты Level → прямые рейсы (12 ночей в отеле) → топ выгодных.

## Локально

```bash
cd rixos-web
npm install
npx playwright install chromium   # для /api/enrich
npm run dev
```

Открой http://localhost:3000 → выставь даты → **Обновить**.

## Vercel

1. Import project, Root Directory: `rixos-web` (если репозиторий — родительская папка).
2. Framework: Next.js.
3. Нужен план с `maxDuration` ≥ 60 с (Pro) — поиск дня и Chromium для рейсов долгие.
4. Chromium: `@sparticuz/chromium` уже в зависимостях для `/api/enrich`.

Hobby (10s) для enrich обычно не хватает — тогда пакеты соберутся, рейсы могут падать по таймауту.

## API

- `GET /api/day?date=2026-09-22&perDay=3` — пакеты Blue Planet / 12н
- `GET /api/enrich?packageId=404272259` — прямые рейсы со страницы пакета
