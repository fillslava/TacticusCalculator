/**
 * One-time map-image scraper for tacticus.wiki.gg.
 *
 * Downloads the `GR<Boss>_<N>.{png,jpg}` battlefield images into
 * `public/maps/` and emits a `src/data/maps.skeleton.json` with
 * placeholder calibration values. The dev-only `?calibrate=1` MapCalibrator
 * then refines origin/hexSizePx/orientation/terrain per map and writes the
 * final shape into `src/data/maps.json`.
 *
 * Run: `npm run scrape:maps`
 *
 * Design notes:
 *  - No MediaWiki API round-trip needed — the wiki serves full-size
 *    images directly at /images/<filename>, which keeps the script short
 *    and CORS-safe when re-run from CI.
 *  - Skips already-downloaded files (idempotent). Re-download by deleting
 *    the file in `public/maps/` first.
 *  - Image dimensions are fetched with a `HEAD` + a lightweight PNG/JPEG
 *    header probe so the skeleton carries real numbers instead of 0/0.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const PUBLIC_MAPS = join(ROOT, 'public', 'maps');
const DATA_DIR = join(ROOT, 'src', 'data');

const BASE = 'https://tacticus.wiki.gg/images';

interface MapEntry {
  /** Map id used in `maps.json`. Kebab-case: `avatar_khaine_aethana`. */
  id: string;
  displayName: string;
  /** Remote filename relative to `/images/` on the wiki. */
  remote: string;
  /** Local filename dropped into `public/maps/`. */
  local: string;
  /** Boss this map ships as part of (used to seed bossScriptId). */
  bossScriptId?: string;
}

/**
 * The canonical catalogue. Update as new maps are scraped / calibrated.
 * Ordering follows in-game "wave" ordering — wave 1 first (typically
 * the lightest variant). Aethana = Avatar of Khaine wave 1.
 */
const MAPS: MapEntry[] = [
  // Avatar of Khaine — 4 waves
  {
    id: 'avatar_khaine_aethana',
    displayName: 'Avatar of Khaine — Aethana',
    remote: 'GRAvatar_1.png',
    local: 'avatar_khaine_aethana.png',
    bossScriptId: 'avatar_khaine_default',
  },
  {
    id: 'avatar_khaine_w2',
    displayName: 'Avatar of Khaine — Wave 2',
    remote: 'GRAvatar_2.png',
    local: 'avatar_khaine_w2.png',
    bossScriptId: 'avatar_khaine_default',
  },
  {
    id: 'avatar_khaine_w3',
    displayName: 'Avatar of Khaine — Wave 3',
    remote: 'GRAvatar_3.png',
    local: 'avatar_khaine_w3.png',
    bossScriptId: 'avatar_khaine_default',
  },
  {
    id: 'avatar_khaine_w4',
    displayName: 'Avatar of Khaine — Wave 4',
    remote: 'GRAvatar_4.png',
    local: 'avatar_khaine_w4.png',
    bossScriptId: 'avatar_khaine_default',
  },

  // Szarekh — 4 waves
  { id: 'szarekh_w1', displayName: 'Szarekh — Wave 1', remote: 'GRSzarekh_1.jpg', local: 'szarekh_w1.jpg' },
  { id: 'szarekh_w2', displayName: 'Szarekh — Wave 2', remote: 'GRSzarekh_2.jpg', local: 'szarekh_w2.jpg' },
  { id: 'szarekh_w3', displayName: 'Szarekh — Wave 3', remote: 'GRSzarekh_3.jpg', local: 'szarekh_w3.jpg' },
  { id: 'szarekh_w4', displayName: 'Szarekh — Wave 4', remote: 'GRSzarekh_4.jpg', local: 'szarekh_w4.jpg' },

  // Belisarius Cawl — 3 waves
  { id: 'belisarius_cawl_w1', displayName: 'Belisarius Cawl — Wave 1', remote: 'GRBelisarius_Cawl_1.png', local: 'belisarius_cawl_w1.png' },
  { id: 'belisarius_cawl_w2', displayName: 'Belisarius Cawl — Wave 2', remote: 'GRBelisarius_Cawl_2.png', local: 'belisarius_cawl_w2.png' },
  { id: 'belisarius_cawl_w3', displayName: 'Belisarius Cawl — Wave 3', remote: 'GRBelisarius_Cawl_3.png', local: 'belisarius_cawl_w3.png' },

  // Mortarion — 5 waves
  { id: 'mortarion_w1', displayName: 'Mortarion — Wave 1', remote: 'GRMortarion_1.jpg', local: 'mortarion_w1.jpg' },
  { id: 'mortarion_w2', displayName: 'Mortarion — Wave 2', remote: 'GRMortarion_2.jpg', local: 'mortarion_w2.jpg' },
  { id: 'mortarion_w3', displayName: 'Mortarion — Wave 3', remote: 'GRMortarion_3.jpg', local: 'mortarion_w3.jpg' },
  { id: 'mortarion_w4', displayName: 'Mortarion — Wave 4', remote: 'GRMortarion_4.jpg', local: 'mortarion_w4.jpg' },
  { id: 'mortarion_w5', displayName: 'Mortarion — Wave 5', remote: 'GRMortarion_5.png', local: 'mortarion_w5.png' },
];

interface ImageDims {
  width: number;
  height: number;
}

/**
 * Read raw dimensions from a PNG or JPEG buffer. Handles both formats
 * without dragging in an image library. Returns `null` if the file isn't
 * a format we can parse — caller falls back to a default placeholder.
 */
function readImageDims(buf: Buffer): ImageDims | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A, then IHDR with width(4) / height(4)
  if (
    buf.length > 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  }
  // JPEG: SOI 0xFFD8; walk markers looking for SOFn (0xFFC0–0xFFCF excl C4/C8/CC)
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length) {
      if (buf[offset] !== 0xff) return null;
      const marker = buf[offset + 1];
      const segLen = buf.readUInt16BE(offset + 2);
      // SOF markers excluding DHT/DAC/DNL/DRI: 0xC0..0xCF except 0xC4/0xC8/0xCC
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return { width, height };
      }
      offset += 2 + segLen;
    }
  }
  return null;
}

async function fetchImage(remote: string, localPath: string): Promise<Buffer> {
  if (existsSync(localPath)) {
    return readFileSync(localPath);
  }
  const url = `${BASE}/${remote}`;
  process.stdout.write(`  GET  ${url}\n`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'tacticus-calc-scraper/0.1 (+local dev)' },
  });
  if (!res.ok) {
    throw new Error(`fetch ${url} -> ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  mkdirSync(dirname(localPath), { recursive: true });
  writeFileSync(localPath, buf);
  process.stdout.write(`       wrote ${localPath} (${buf.length} bytes)\n`);
  return buf;
}

interface MapSkeleton {
  id: string;
  displayName: string;
  image: { href: string; width: number; height: number };
  origin: { xPx: number; yPx: number };
  hexSizePx: number;
  orientation: 'pointy' | 'flat';
  hexes: Array<{ q: number; r: number; terrain: string }>;
  bossScriptId?: string;
}

/**
 * Produce a first-pass skeleton with a blank hex grid sized to the
 * image. Real calibration happens in `?calibrate=1` — this is just a
 * "open this map, it's roughly centred" default so you don't stare at a
 * blank map page.
 */
function skeletonFor(
  entry: MapEntry,
  dims: ImageDims,
): MapSkeleton {
  // Tacticus maps are typically ~16 wide × ~10 deep. We generate a 16x10
  // blank grid so the MapCalibrator has something to paint onto. The user
  // trims extras during calibration.
  const cols = 16;
  const rows = 10;
  const hexSizePx = Math.round(Math.min(dims.width / cols, dims.height / rows) / 1.85);
  const origin = {
    xPx: Math.round(hexSizePx * 1.1),
    yPx: Math.round(hexSizePx * 1.1),
  };
  const hexes: MapSkeleton['hexes'] = [];
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      hexes.push({ q, r, terrain: 'normal' });
    }
  }
  return {
    id: entry.id,
    displayName: entry.displayName,
    image: { href: entry.local, width: dims.width, height: dims.height },
    origin,
    hexSizePx,
    orientation: 'pointy',
    hexes,
    ...(entry.bossScriptId ? { bossScriptId: entry.bossScriptId } : {}),
  };
}

async function main(): Promise<void> {
  mkdirSync(PUBLIC_MAPS, { recursive: true });
  const skeletons: MapSkeleton[] = [];
  for (const entry of MAPS) {
    const localPath = join(PUBLIC_MAPS, entry.local);
    process.stdout.write(`[${entry.id}]\n`);
    try {
      const buf = await fetchImage(entry.remote, localPath);
      const dims = readImageDims(buf) ?? { width: 1920, height: 1080 };
      skeletons.push(skeletonFor(entry, dims));
    } catch (err) {
      process.stderr.write(
        `  FAIL ${entry.remote}: ${(err as Error).message}\n`,
      );
    }
  }
  const outPath = join(DATA_DIR, 'maps.skeleton.json');
  writeFileSync(outPath, JSON.stringify(skeletons, null, 2) + '\n');
  process.stdout.write(`\nWrote ${skeletons.length} map skeletons to ${outPath}\n`);
  process.stdout.write(
    `Next: open the app with ?calibrate=1 for each map to lock origin/hex size/terrain,\n` +
      `then copy calibrated entries into src/data/maps.json.\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`scrape-maps failed: ${(err as Error).stack}\n`);
  process.exit(1);
});
