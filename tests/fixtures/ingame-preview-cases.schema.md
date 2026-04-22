# In-game preview calibration fixtures — schema

This file documents the shape of `ingame-preview-cases.json`, consumed by
`tests/engine/calibration.test.ts`. The JSON is checked at load time by the
harness; mismatches fail the test loudly rather than silently skipping.

## Top-level shape

```jsonc
{
  "version": 1,
  "description": "...",
  "cases": [ /* CalibrationCase[] */ ]
}
```

The harness only knows `version: 1` for now. Bump this whenever the schema
changes incompatibly so older fixture files don't silently drift.

## `CalibrationCase`

```jsonc
{
  "id": "calgar_legendary3_r17_L50_vs_avatar_s0_melee",
  "notes": "Observed 2026-04-20 on build 0.49.0. Hover preview on melee attack button.",

  "attacker": {
    "characterId": "calgar",       // must match an id in src/data/characters.json

    // Exactly one of the two progression styles:
    "progression": 14,              // 0..19 — see engine/progression.ts, maps to rarity+stars
    // OR:
    // "rarity": "legendary", "stars": 2,   // stars is 0..N within the rarity

    "rank": 15,                     // 0..19, the 0-indexed rank from the API
    "xpLevel": 50,                  // 1..50
    "equipment": [                  // catalog ids from src/data/equipment.json
      "crit_20_legendary_crit-dmg_L11",
      "block_30_legendary_block_L11",
      "defense_0_legendary_armour_L11"
    ],
    "abilityLevels": [5, 5, 5]      // index-aligned with the hero's abilities array
  },

  "target": {
    // Either a boss+stage…
    "bossId": "avatar",             // must match an id in src/data/bosses.json
    "stageIndex": 0,                // 0-indexed; clamped to valid range

    // …or a custom target (set bossId: null or omit it, supply these):
    // "customArmor": 120, "customHp": 800000, "customShield": 0,
    // "customTraits": ["gravisArmor"],

    // Optional prime-level debuffs, index-aligned with boss.primes:
    "primeLevels": [0, 0]
  },

  "attack": "melee",                // "melee" | "ranged" | "ability:<abilityId>"

  "expected": 54321,                // damage number shown in the in-game preview
  "tolerance": 0.02                 // allowed relative error, default 0.02 (±2%)
}
```

## Authoring a new case

1. In-game, navigate to the attack preview screen and hover the attack button
   to see the expected damage number.
2. Screenshot the hero build (rarity, stars, rank, XP level, equipment) and
   the target selection (boss, stage).
3. Fill in a new entry in `cases[]`. Prefer `progression` over `{rarity,stars}`
   for brevity once you've internalised the index, but either works.
4. Run `npm run test -- calibration` and check the per-case diff output.

## When a case fails

The harness logs each miss as `caseId: expected X, got Y (±Z%)`. Decide:

- **Engine bug** — fix the engine; the case stays.
- **Stale fixture** (game update changed the formula) — re-observe, update
  `expected`, bump `notes` with a date.
- **Tolerance too tight** — bump `tolerance` on that case to cover legitimate
  off-by-one rounding in the preview.

Don't blanket-raise the global tolerance to paper over an outlier; local
`tolerance` lets one noisy case stay soft without hiding real drift.
