# Tacticus Calculator

A local-first damage calculator for **Warhammer 40,000: Tacticus**.

- Implements the current `HDTW` damage formula from [tacticus.wiki.gg](https://tacticus.wiki.gg/wiki/HDTW_Damage).
- Pulls your owned-unit data via the official Tacticus API.
- Models full ability rotations, not just single hits.
- Calibrated against live in-game numbers and [tacticustable.com](https://www.tacticustable.com/).

Everything runs in your browser. Your API key is stored only in `localStorage` on your machine.

---

## Requirements

- **Node.js 18+** and **npm** (or pnpm / yarn — examples use npm)
- A Tacticus API key (from the official Tacticus API portal)

## Install

```bash
git clone https://github.com/fillslava/TacticusCalculator.git
cd TacticusCalculator
npm install
```

## Configure your API key

Copy the example env file and paste your key:

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```
VITE_TACTICUS_API_KEY=your-api-key-uuid
```

`.env.local` is gitignored and never committed. Alternatively you can skip the env file and paste your key into the app's import bar on first run — it's saved to `localStorage`.

## Run locally

```bash
npm run dev
```

Then open the URL Vite prints (default http://localhost:5173).

## Run the tests

```bash
npm test            # one-shot
npm run test:watch  # watch mode
npm run typecheck   # tsc --noEmit
```

## Build a static bundle

```bash
npm run build
npm run preview   # serves the built bundle locally
```

The output goes to `dist/`.

---

## Using the API from a hosted build (CORS)

The Tacticus API doesn't send CORS headers for third-party origins, so a
static build hosted on GitHub Pages can't call it directly from the browser.
Two ways around this:

- **`npm run fetch:player`** — runs locally, saves `player.json` to disk,
  upload it through the app's upload button. Works anywhere, no infra.
- **Cloudflare Worker proxy** (free tier). Deploy the worker in
  [cloudflare-worker/](cloudflare-worker/) to your own Cloudflare account,
  then build with `VITE_API_BASE=https://...workers.dev`. See
  [cloudflare-worker/README.md](cloudflare-worker/README.md) for a one-time
  setup walkthrough.

---

## Catalog data

Character base stats, equipment mods, ability factor tables, and rank/star curves are bundled in `src/data/*.json`. They're regenerated from upstream sources via:

```bash
npm run scrape            # pulls from tacticus.wiki.gg
npm run import:halmmar    # cross-check against the older dump
```

Scraper output is committed — you don't need to run it to use the app.

---

## Project layout

```
src/
  engine/     Pure TypeScript damage engine (no React, no fetch).
  data/       Zod-validated catalog JSON + loader.
  api/        Tacticus API client + player-data merge.
  state/      Zustand store.
  ui/         React components.
scripts/      Offline scrapers / importers.
tests/        Vitest unit + fixture tests.
```

See each module's source for specifics. `src/engine/attack.ts` is the main orchestrator — every damage number flows through it.

---

## Status

Early / hobby project. Expect rough edges. Patches and calibration fixtures welcome.

## License

MIT — see [LICENSE](LICENSE).

---

## 🇷🇺 Установка локально (русский)

Полностью локальный калькулятор — ничего не загружается в интернет, ваш API-ключ хранится только у вас в браузере (`localStorage`).

### Что нужно поставить заранее

| Инструмент | Минимальная версия | Зачем нужен | Где взять |
|---|---|---|---|
| **Node.js** | 18 или новее | Запускает сборку Vite и тесты | https://nodejs.org/ (LTS-версия) |
| **npm** | ставится вместе с Node.js | Установка зависимостей, запуск команд `npm run …` | — |
| **git** | 2.30+ | Клонирование репозитория | https://git-scm.com/ |
| **API-ключ Tacticus** | действующий uuid | Загрузка ваших войск через `/api/v1/player` | Официальный портал Tacticus API |

Проверить, что всё стоит:

```bash
node --version      # должно быть ≥ v18
npm --version
git --version
```

Если `node` или `npm` не находятся — установите Node.js LTS и **перезапустите терминал** (или перелогиньтесь), чтобы `PATH` подхватил новые бинарники.

### Установка

```bash
git clone https://github.com/fillslava/TacticusCalculator.git
cd TacticusCalculator
npm install
```

`npm install` поставит React, Vite, Tailwind, Zustand, Zod, vitest и т.п. (~200 МБ в `node_modules/`). Занимает 1–3 минуты при первом запуске.

### Указать API-ключ

Скопируйте шаблон:

```bash
cp .env.example .env.local
```

Откройте `.env.local` и впишите свой ключ:

```
VITE_TACTICUS_API_KEY=ваш-api-uuid
```

`.env.local` в `.gitignore` — он не попадёт в git. Можно и не создавать файл: при первом запуске в UI появится поле «API Key», значение сохранится в `localStorage`.

### Запуск

```bash
npm run dev
```

Откройте адрес, который напечатал Vite (обычно http://localhost:5173). В dev-режиме запросы к API идут через встроенный прокси Vite — CORS не мешает.

### Если что-то сломалось

- **`command not found: npm`** — Node.js не стоит или терминал старый. Переустановите и откройте новый терминал.
- **`EACCES` / ошибки прав при `npm install`** — Windows: запустите PowerShell от имени администратора. macOS/Linux: не ставьте npm через `sudo`, используйте [nvm](https://github.com/nvm-sh/nvm).
- **Ошибка порта `5173 in use`** — `npm run dev -- --port 3000`, либо закройте программу, которая занимает порт.
- **`API 404` или CORS-ошибка** — в продакшн-сборке (GitHub Pages) браузер не может ходить в `api.tacticusgame.com` напрямую. Запустите локально через `npm run dev` либо используйте `npm run fetch:player`, чтобы сохранить `player.json` на диск, и загрузите его через кнопку **«или загрузить player.json»**.
- **Тесты падают** — `npm run typecheck` покажет, что не компилируется; `npm test` запустит vitest. Скопируйте вывод в issue.

### Сборка под GitHub Pages / свой хостинг

```bash
npm run build        # кладёт статику в dist/
npm run preview      # локальный просмотр собранной версии
```

По умолчанию сборка настроена на префикс `/TacticusCalculator/`. Для своего домена или корневого пути:

```bash
VITE_BASE=/ npm run build
```
