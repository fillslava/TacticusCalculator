/**
 * Board State Encoder for ML Model Input
 * 
 * Converts Tacticus game state into tensor-ready features for ML models.
 * This is the critical bridge between the game engine and the neural network.
 */

import { MapBattleState } from '../../map/battleState';
import { UnitState } from '../../map/unitState';
import { HexCoord, TerrainType, HexEffect } from '../../map/hexGrid';
import { BossState } from '../../map/ai/bossAi';

/**
 * Feature configuration for board encoding
 */
export interface EncoderConfig {
  gridSize: number; // N x N grid (typically 7x7 or similar)
  includeTerrain: boolean;
  includeEffects: boolean;
  includeBuffs: boolean;
  includeCooldowns: boolean;
  normalizeValues: boolean;
}

export const DEFAULT_CONFIG: EncoderConfig = {
  gridSize: 7,
  includeTerrain: true,
  includeEffects: true,
  includeBuffs: true,
  includeCooldowns: true,
  normalizeValues: true,
};

/**
 * Encoded feature planes for neural network input
 * Each plane is a 2D array representing the hex grid
 */
export interface EncodedBoardState {
  // Unit presence planes (one per unit type)
  unitPlanes: number[][][]; // [unitType, q, r]
  
  // Unit state planes
  hpPlane: number[][]; // [q, r] - normalized HP
  shieldPlane: number[][]; // [q, r] - normalized shields
  
  // Boss state planes
  bossHpPlane: number[][]; // [q, r] - boss HP at boss position
  bossShieldPlane: number[][]; // [q, r] - boss shields
  
  // Terrain planes (one-hot encoded)
  terrainPlanes: number[][][]; // [terrainType, q, r]
  
  // Effect planes
  effectPlanes: number[][][]; // [effectType, q, r]
  
  // Buff/debuff planes
  buffPlanes: number[][][]; // [buffType, q, r]
  
  // Cooldown planes
  cooldownPlanes: number[][][]; // [abilityIndex, q, r]
  
  // Action availability
  canActPlane: number[][]; // [q, r] - 1 if unit can act
  
  // Turn information (broadcast to all cells)
  turnPlane: number[][]; // [q, r] - normalized turn number
  
  // Metadata for decoding
  metadata: EncodingMetadata;
}

export interface EncodingMetadata {
  unitTypeCount: number;
  terrainTypeCount: number;
  effectTypeCount: number;
  buffTypeCount: number;
  maxCooldown: number;
  totalChannels: number;
  gridSize: number;
}

/**
 * Maps character IDs to numeric indices for one-hot encoding
 */
const UNIT_TYPE_MAP: Record<string, number> = {
  'marneus_calgar': 0,
  'lysander': 1,
  'pedro_cantor': 2,
  'cato_sicarius': 3,
  'chapter_master_dante': 4,
  'kayvaan_kyne': 5,
  'tyrannofex': 6,
  'swarmlord': 7,
  'ghazghkull': 8,
  'ciaphas_cain': 9,
  // Add more as needed
};

/**
 * Maps terrain types to indices
 */
const TERRAIN_TYPE_MAP: Record<TerrainType, number> = {
  'open': 0,
  'cover': 1,
  'obstacle': 2,
  'objective': 3,
};

/**
 * Maps common buffs/debuffs to indices
 */
const BUFF_TYPE_MAP: Record<string, number> = {
  'furious_charge': 0,
  'feel_no_pain': 1,
  'shrouded': 2,
  'counter_attack': 3,
  'armor_reduction': 4,
  'damage_boost': 5,
  'stunned': 6,
  'immobilized': 7,
  // Add more as needed
};

/**
 * Maps hex effects to indices
 */
const EFFECT_TYPE_MAP: Record<HexEffect, number> = {
  'none': 0,
  'spawn_blocker': 1,
  'boss_zone': 2,
  'deployment': 3,
};

/**
 * Encode battle state into ML-ready features
 */
export class BoardEncoder {
  private config: EncoderConfig;

  constructor(config: EncoderConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  /**
   * Main encoding function - converts battle state to feature tensors
   */
  encode(battle: MapBattleState): EncodedBoardState {
    const size = this.config.gridSize;
    
    // Initialize all planes with zeros
    const unitTypeCount = Object.keys(UNIT_TYPE_MAP).length;
    const terrainTypeCount = Object.keys(TERRAIN_TYPE_MAP).length;
    const effectTypeCount = Object.keys(EFFECT_TYPE_MAP).length;
    const buffTypeCount = Math.max(Object.keys(BUFF_TYPE_MAP).length, 16); // Reserve space
    const maxCooldown = 6; // Typical max ability cooldown
    
    // Create zero-filled 2D arrays
    const create2D = () => Array(size).fill(0).map(() => Array(size).fill(0));
    const create3D = (depth: number) => 
      Array(depth).fill(0).map(() => create2D());
    
    // Initialize planes
    const unitPlanes = create3D(unitTypeCount);
    const hpPlane = create2D();
    const shieldPlane = create2D();
    const bossHpPlane = create2D();
    const bossShieldPlane = create2D();
    const terrainPlanes = create3D(terrainTypeCount);
    const effectPlanes = create3D(effectTypeCount);
    const buffPlanes = create3D(buffTypeCount);
    const cooldownPlanes = create3D(maxCooldown);
    const canActPlane = create2D();
    const turnPlane = create2D();
    
    // Encode units
    for (const unit of battle.units) {
      if (!unit.position) continue;
      
      const { q, r } = unit.position;
      const gridQ = q + Math.floor(size / 2);
      const gridR = r + Math.floor(size / 2);
      
      if (gridQ < 0 || gridQ >= size || gridR < 0 || gridR >= size) continue;
      
      // Unit type one-hot
      const unitTypeIdx = UNIT_TYPE_MAP[unit.characterId] ?? 0;
      unitPlanes[unitTypeIdx][gridQ][gridR] = 1;
      
      // HP and shields (normalized)
      const maxHp = unit.maxHp || 100;
      const maxShields = unit.maxShields || 0;
      
      if (this.config.normalizeValues) {
        hpPlane[gridQ][gridR] = unit.hp / maxHp;
        shieldPlane[gridQ][gridR] = maxShields > 0 ? unit.shields / maxShields : 0;
      } else {
        hpPlane[gridQ][gridR] = unit.hp;
        shieldPlane[gridQ][gridR] = unit.shields;
      }
      
      // Action availability
      canActPlane[gridQ][gridR] = unit.hasAction ? 1 : 0;
      
      // Buffs
      if (this.config.includeBuffs) {
        for (const buff of unit.buffs) {
          const buffIdx = BUFF_TYPE_MAP[buff.type] ?? 0;
          if (buffIdx < buffTypeCount) {
            buffPlanes[buffIdx][gridQ][gridR] = buff.stacks || 1;
          }
        }
      }
      
      // Cooldowns
      if (this.config.includeCooldowns) {
        for (let i = 0; i < Math.min(unit.abilities.length, maxCooldown); i++) {
          const cd = unit.abilities[i]?.cooldown || 0;
          cooldownPlanes[i][gridQ][gridR] = this.config.normalizeValues 
            ? cd / maxCooldown 
            : cd;
        }
      }
    }
    
    // Encode boss
    const boss = battle.boss;
    if (boss && boss.position) {
      const { q, r } = boss.position;
      const gridQ = q + Math.floor(size / 2);
      const gridR = r + Math.floor(size / 2);
      
      if (gridQ >= 0 && gridQ < size && gridR >= 0 && gridR < size) {
        const maxBossHp = boss.maxHp || 1000000;
        
        if (this.config.normalizeValues) {
          bossHpPlane[gridQ][gridR] = boss.hp / maxBossHp;
          bossShieldPlane[gridQ][gridR] = boss.maxShields > 0 
            ? boss.shields / boss.maxShields 
            : 0;
        } else {
          bossHpPlane[gridQ][gridR] = boss.hp;
          bossShieldPlane[gridQ][gridR] = boss.shields;
        }
        
        // Boss buffs
        if (this.config.includeBuffs && boss.buffs) {
          for (const buff of boss.buffs) {
            const buffIdx = BUFF_TYPE_MAP[buff.type] ?? 0;
            if (buffIdx < buffTypeCount) {
              buffPlanes[buffIdx][gridQ][gridR] = (buffPlanes[buffIdx][gridQ][gridR] || 0) + 1;
            }
          }
        }
      }
    }
    
    // Encode terrain
    if (this.config.includeTerrain && battle.grid) {
      for (let q = -Math.floor(size / 2); q <= Math.floor(size / 2); q++) {
        for (let r = -Math.floor(size / 2); r <= Math.floor(size / 2); r++) {
          const gridQ = q + Math.floor(size / 2);
          const gridR = r + Math.floor(size / 2);
          
          if (gridQ < 0 || gridQ >= size || gridR < 0 || gridR >= size) continue;
          
          const hex = battle.grid.getHex({ q, r });
          if (hex) {
            const terrainIdx = TERRAIN_TYPE_MAP[hex.terrain] ?? 0;
            terrainPlanes[terrainIdx][gridQ][gridR] = 1;
          }
        }
      }
    }
    
    // Encode hex effects
    if (this.config.includeEffects && battle.grid) {
      for (let q = -Math.floor(size / 2); q <= Math.floor(size / 2); q++) {
        for (let r = -Math.floor(size / 2); r <= Math.floor(size / 2); r++) {
          const gridQ = q + Math.floor(size / 2);
          const gridR = r + Math.floor(size / 2);
          
          if (gridQ < 0 || gridQ >= size || gridR < 0 || gridR >= size) continue;
          
          const hex = battle.grid.getHex({ q, r });
          if (hex?.effect) {
            const effectIdx = EFFECT_TYPE_MAP[hex.effect] ?? 0;
            effectPlanes[effectIdx][gridQ][gridR] = 1;
          }
        }
      }
    }
    
    // Encode turn number (broadcast to all cells)
    const normalizedTurn = this.config.normalizeValues 
      ? Math.min(battle.turn / 20, 1) // Assume max 20 turns
      : battle.turn;
    
    for (let q = 0; q < size; q++) {
      for (let r = 0; r < size; r++) {
        turnPlane[q][r] = normalizedTurn;
      }
    }
    
    // Calculate total channels for model config
    const totalChannels = 
      unitTypeCount + // Unit planes
      2 + // HP, Shield
      2 + // Boss HP, Boss Shield
      (this.config.includeTerrain ? terrainTypeCount : 0) +
      (this.config.includeEffects ? effectTypeCount : 0) +
      (this.config.includeBuffs ? buffTypeCount : 0) +
      (this.config.includeCooldowns ? maxCooldown : 0) +
      1 + // Can act
      1; // Turn
    
    return {
      unitPlanes,
      hpPlane,
      shieldPlane,
      bossHpPlane,
      bossShieldPlane,
      terrainPlanes,
      effectPlanes,
      buffPlanes,
      cooldownPlanes,
      canActPlane,
      turnPlane,
      metadata: {
        unitTypeCount,
        terrainTypeCount,
        effectTypeCount,
        buffTypeCount,
        maxCooldown,
        totalChannels,
        gridSize: size,
      },
    };
  }

  /**
   * Convert encoded state to flat array for TensorFlow/PyTorch
   */
  flatten(encoded: EncodedBoardState): Float32Array {
    const { gridSize } = encoded.metadata;
    const totalCells = gridSize * gridSize;
    
    // Concatenate all planes in order
    const planes: number[][][] = [
      ...encoded.unitPlanes,
      [encoded.hpPlane],
      [encoded.shieldPlane],
      [encoded.bossHpPlane],
      [encoded.bossShieldPlane],
      ...encoded.terrainPlanes,
      ...encoded.effectPlanes,
      ...encoded.buffPlanes,
      ...encoded.cooldownPlanes,
      [encoded.canActPlane],
      [encoded.turnPlane],
    ];
    
    const flat = new Float32Array(totalCells * encoded.metadata.totalChannels);
    let offset = 0;
    
    for (const plane of planes) {
      for (const channel of plane) {
        for (let q = 0; q < gridSize; q++) {
          for (let r = 0; r < gridSize; r++) {
            flat[offset++] = channel[q]?.[r] ?? 0;
          }
        }
      }
    }
    
    return flat;
  }

  /**
   * Get input shape for model definition
   */
  getInputShape(): [number, number, number] {
    // Returns [channels, height, width] for CNN input
    const size = this.config.gridSize;
    const channels = 
      Object.keys(UNIT_TYPE_MAP).length +
      2 + 2 + // HP, Shield, Boss HP, Boss Shield
      (this.config.includeTerrain ? 4 : 0) +
      (this.config.includeEffects ? 4 : 0) +
      16 + // Buffs
      6 + // Cooldowns
      1 + 1; // Can act, Turn
    
    return [channels, size, size];
  }
}

/**
 * Decode model output back to game actions
 */
export interface MoveDistribution {
  moves: ProbabilisticMove[];
  valueEstimate: number; // Expected damage from this position
}

export interface ProbabilisticMove {
  unitId: string;
  actionType: 'attack' | 'ability' | 'move' | 'wait';
  targetHex?: HexCoord;
  abilityId?: string;
  probability: number;
  expectedDamage?: number;
}

/**
 * Placeholder for decoder - would be implemented with model-specific logic
 */
export class MoveDecoder {
  decode(
    policyOutput: Float32Array, 
    valueOutput: number,
    battle: MapBattleState
  ): MoveDistribution {
    // This would be implemented based on the specific model architecture
    // For now, returns a placeholder
    return {
      moves: [],
      valueEstimate: valueOutput,
    };
  }
}
