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

## Catalog data

Character base stats, equipment mods, ability factor tables, and rank/star curves are bundled in `src/data/*.json`. They're regenerated from upstream sources via:

```bash
npm run scrape            # pulls from tacticus.wiki.gg
npm run import:halmmar    # cross-check against the older halmmar dump
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
