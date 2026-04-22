import { describe, it, expect } from 'vitest';
import {
  BossScriptCatalogSchema,
  HexEffectCatalogSchema,
  MapCatalogSchema,
  TerrainCatalogSchema,
} from '../../src/map/core/mapSchema';

import terrainJson from '../../src/data/terrain.json';
import hexEffectsJson from '../../src/data/hexEffects.json';
import mapsJson from '../../src/data/maps.json';
import bossScriptsJson from '../../src/data/bossScripts.json';

/**
 * Phase 1 guardrails.
 *
 * Each catalog JSON must Zod-parse cleanly. We also spot-check a handful
 * of wiki-confirmed values so a silent edit to a magic number (e.g.
 * highGround's +50%) trips a red test rather than a subtly wrong battle.
 */

describe('terrain catalog', () => {
  it('parses against TerrainCatalogSchema', () => {
    const parsed = TerrainCatalogSchema.safeParse(terrainJson);
    if (!parsed.success) {
      // Emit the exact zod failure path so CI output is actionable.
      throw new Error(JSON.stringify(parsed.error.format(), null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  it('contains the wiki-confirmed terrain ids', () => {
    const parsed = TerrainCatalogSchema.parse(terrainJson);
    const ids = new Set(parsed.map((t) => t.id));
    for (const id of [
      'normal',
      'highGround',
      'lowGround',
      'razorWire',
      'tallGrass',
      'trenches',
      'ice',
      'brokenIce',
      'bridge',
      'impassable',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('highGround gives attacker +50% damage', () => {
    const parsed = TerrainCatalogSchema.parse(terrainJson);
    const high = parsed.find((t) => t.id === 'highGround');
    expect(high?.onAttackFromDamageMultiplier).toBe(1.5);
  });

  it('tallGrass cuts 2 ranged hits and blocks line-of-sight', () => {
    const parsed = TerrainCatalogSchema.parse(terrainJson);
    const grass = parsed.find((t) => t.id === 'tallGrass');
    expect(grass?.rangedHitsDelta).toBe(-2);
    expect(grass?.blocksLoS).toBe(true);
  });

  it('trenches halve defender damage on border cross', () => {
    const parsed = TerrainCatalogSchema.parse(terrainJson);
    const tr = parsed.find((t) => t.id === 'trenches');
    expect(tr?.crossingBorderDefenseMultiplier).toBe(0.5);
  });

  it('razorWire drops a fire effect when occupied', () => {
    const parsed = TerrainCatalogSchema.parse(terrainJson);
    const wire = parsed.find((t) => t.id === 'razorWire');
    expect(wire?.onOccupyEffect).toBe('fire');
    // Razor wire lets flying / vehicle units pass.
    expect(wire?.blocksMoveUnlessTrait).toEqual(
      expect.arrayContaining(['flying', 'vehicle']),
    );
  });

  it('impassable blocks both movement and line-of-sight', () => {
    const parsed = TerrainCatalogSchema.parse(terrainJson);
    const imp = parsed.find((t) => t.id === 'impassable');
    expect(imp?.blocksMove).toBe(true);
    expect(imp?.blocksLoS).toBe(true);
  });

  it('rejects an unknown terrain id', () => {
    const bad = [{ id: 'lava', displayName: 'Lava' }];
    expect(TerrainCatalogSchema.safeParse(bad).success).toBe(false);
  });
});

describe('hex-effect catalog', () => {
  it('parses against HexEffectCatalogSchema', () => {
    const parsed = HexEffectCatalogSchema.safeParse(hexEffectsJson);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.format(), null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  it('has all wiki-confirmed hex effect ids', () => {
    const parsed = HexEffectCatalogSchema.parse(hexEffectsJson);
    const ids = new Set(parsed.map((e) => e.id));
    for (const id of ['contamination', 'despoiledGround', 'fire', 'ice', 'sporeMine']) {
      expect(ids).toContain(id);
    }
  });

  it('fire is a 20% max-hp flame DoT lasting 2 turns', () => {
    const parsed = HexEffectCatalogSchema.parse(hexEffectsJson);
    const fire = parsed.find((e) => e.id === 'fire');
    expect(fire?.durationTurns).toBe(2);
    expect(fire?.modifier.kind).toBe('dotOfMaxHpPct');
    if (fire?.modifier.kind === 'dotOfMaxHpPct') {
      expect(fire.modifier.pct).toBe(0.2);
      expect(fire.modifier.damageType).toBe('flame');
    }
  });

  it('ice gives +25% crit damage taken', () => {
    const parsed = HexEffectCatalogSchema.parse(hexEffectsJson);
    const ice = parsed.find((e) => e.id === 'ice');
    expect(ice?.modifier.kind).toBe('critDamageDelta');
    if (ice?.modifier.kind === 'critDamageDelta') {
      expect(ice.modifier.pct).toBe(0.25);
    }
  });

  it('contamination deals -30% armor', () => {
    const parsed = HexEffectCatalogSchema.parse(hexEffectsJson);
    const c = parsed.find((e) => e.id === 'contamination');
    expect(c?.modifier.kind).toBe('armorDelta');
    if (c?.modifier.kind === 'armorDelta') {
      expect(c.modifier.pct).toBe(-0.3);
    }
  });

  it('despoiledGround boosts imperial damage taken by +20%', () => {
    const parsed = HexEffectCatalogSchema.parse(hexEffectsJson);
    const d = parsed.find((e) => e.id === 'despoiledGround');
    expect(d?.modifier.kind).toBe('factionDamageDelta');
    if (d?.modifier.kind === 'factionDamageDelta') {
      expect(d.modifier.alliance).toBe('imperial');
      expect(d.modifier.pct).toBe(0.2);
    }
  });

  it('sporeMine is a one-shot flat-damage trap that only hits enemies', () => {
    const parsed = HexEffectCatalogSchema.parse(hexEffectsJson);
    const spore = parsed.find((e) => e.id === 'sporeMine');
    expect(spore?.affects).toBe('enemy');
    expect(spore?.modifier.kind).toBe('flatDamageOnEnter');
    if (spore?.modifier.kind === 'flatDamageOnEnter') {
      expect(spore.modifier.oneShot).toBe(true);
      expect(spore.modifier.damage).toBeGreaterThan(0);
    }
  });

  it('rejects a hex effect with a bogus modifier kind', () => {
    const bad = [
      {
        id: 'fire',
        displayName: 'Bad Fire',
        durationTurns: 2,
        modifier: { kind: 'teleport', pct: 1 },
      },
    ];
    expect(HexEffectCatalogSchema.safeParse(bad).success).toBe(false);
  });
});

describe('map catalog', () => {
  it('parses against MapCatalogSchema', () => {
    const parsed = MapCatalogSchema.safeParse(mapsJson);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.format(), null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  it('contains at least one map with a non-empty hex list', () => {
    const parsed = MapCatalogSchema.parse(mapsJson);
    expect(parsed.length).toBeGreaterThan(0);
    for (const m of parsed) {
      expect(m.hexes.length).toBeGreaterThan(0);
    }
  });

  it('every hex uses a terrain id declared in the terrain catalog', () => {
    const terrain = TerrainCatalogSchema.parse(terrainJson);
    const terrainIds = new Set(terrain.map((t) => t.id));
    const maps = MapCatalogSchema.parse(mapsJson);
    for (const m of maps) {
      for (const h of m.hexes) {
        expect(terrainIds).toContain(h.terrain);
      }
    }
  });

  it('hex coordinates are unique within each map', () => {
    const maps = MapCatalogSchema.parse(mapsJson);
    for (const m of maps) {
      const keys = new Set(m.hexes.map((h) => `${h.q},${h.r}`));
      expect(keys.size).toBe(m.hexes.length);
    }
  });

  it('every referenced bossScriptId resolves to a boss script', () => {
    const maps = MapCatalogSchema.parse(mapsJson);
    const scripts = BossScriptCatalogSchema.parse(bossScriptsJson);
    const scriptIds = new Set(scripts.map((s) => s.id));
    for (const m of maps) {
      if (m.bossScriptId !== undefined) {
        expect(scriptIds).toContain(m.bossScriptId);
      }
    }
  });
});

describe('boss-script catalog', () => {
  it('parses against BossScriptCatalogSchema', () => {
    const parsed = BossScriptCatalogSchema.safeParse(bossScriptsJson);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.format(), null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  it('Avatar of Khaine script has the documented 4-turn rotation', () => {
    const parsed = BossScriptCatalogSchema.parse(bossScriptsJson);
    const avatar = parsed.find((s) => s.id === 'avatar_khaine_default');
    expect(avatar).toBeDefined();
    expect(avatar?.turns).toHaveLength(4);
    expect(avatar?.targetPolicy).toBe('preferSummonsThenWeakest');
    // Turn 1: Wailing Doom Strikes (ability)
    expect(avatar?.turns[0]).toEqual({
      kind: 'ability',
      abilityId: 'wailing_doom_strikes',
    });
    // Turn 2: Wailing Doom Sweeps
    expect(avatar?.turns[1]).toEqual({
      kind: 'ability',
      abilityId: 'wailing_doom_sweeps',
    });
    // Turn 3: Wrath of Khaine Unleashed
    expect(avatar?.turns[2]).toEqual({
      kind: 'ability',
      abilityId: 'wrath_of_khaine_unleashed',
    });
    // Turn 4: a normal attack on the weakest / a summon
    expect(avatar?.turns[3]).toEqual({ kind: 'normal' });
    // The rotation loops from the top.
    expect(avatar?.repeatsFrom).toBe(0);
  });

  it('rejects a script with an unknown targetPolicy', () => {
    const bad = [
      {
        id: 'x',
        targetPolicy: 'weakestAmongFlying',
        turns: [{ kind: 'normal' }],
      },
    ];
    expect(BossScriptCatalogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a script with an unknown turn kind', () => {
    const bad = [
      {
        id: 'x',
        targetPolicy: 'weakest',
        turns: [{ kind: 'teleport' }],
      },
    ];
    expect(BossScriptCatalogSchema.safeParse(bad).success).toBe(false);
  });
});
