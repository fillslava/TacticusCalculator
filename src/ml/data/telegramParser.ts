/**
 * Telegram Data Parser for Tacticus Guild Boss Runs
 * 
 * This module parses data from Telegram channel posts containing
 * best guild boss runs and converts them into structured training data.
 * 
 * Expected input format (adjust based on actual Telegram posts):
 * - Boss name/ID
 * - Unit compositions
 * - Damage numbers per turn
 * - Final score/damage
 * - Optional: screenshots with OCR, text descriptions
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TelegramPost {
  id: string;
  date: Date;
  bossId: string;
  playerName: string;
  units: TelegramUnit[];
  totalDamage: number;
  turns: number;
  rawText: string;
  mediaFiles?: string[];
}

export interface TelegramUnit {
  characterId: string;
  stars: number;
  gearLevel: number;
  abilityLevels: number[];
  damageDealt: number;
}

export interface ParsedReplay {
  replayId: string;
  source: 'telegram';
  bossId: string;
  timestamp: Date;
  frames: ReplayFrame[];
  metadata: ReplayMetadata;
}

export interface ReplayFrame {
  turn: number;
  bossHp: number;
  bossShields: number;
  bossBuffs: string[];
  unitStates: UnitState[];
  action: ActionTaken | null;
  damageThisTurn: number;
  cumulativeDamage: number;
}

export interface UnitState {
  unitId: string;
  characterId: string;
  hp: number;
  shields: number;
  position: { q: number; r: number } | null;
  buffs: string[];
  cooldowns: Record<string, number>;
  hasAction: boolean;
}

export interface ActionTaken {
  unitId: string;
  actionType: 'attack' | 'ability' | 'move' | 'wait';
  targetHex?: { q: number; r: number };
  abilityId?: string;
  rotationIndex?: number;
  hit: boolean;
  damage: number;
  crit: boolean;
}

export interface ReplayMetadata {
  sourceUrl: string;
  playerName: string;
  guildName?: string;
  notes?: string;
  verified: boolean;
}

/**
 * Parser configuration for different Telegram channel formats
 */
export interface ParserConfig {
  channelId: string;
  dateFormat: string;
  damagePattern: RegExp;
  bossPattern: RegExp;
  unitPattern: RegExp;
}

// Example configs for common formats
export const PRESET_CONFIGS: Record<string, ParserConfig> = {
  // Adjust these patterns based on actual Telegram post formats
  'default': {
    channelId: 'tacticus_best_runs',
    dateFormat: 'DD.MM.YYYY HH:mm',
    damagePattern: /(?:damage|dmg)[:\s]+(\d+(?:[,.]\d+)?)k?/i,
    bossPattern: /(?:boss|vs)[:\s]+([A-Za-z\s]+)/i,
    unitPattern: /([A-Za-z\s]+)\s*[-–—]?\s*(\d+)k/i,
  },
};

/**
 * Parse Telegram export data into structured replays
 */
export class TelegramParser {
  private config: ParserConfig;

  constructor(config: ParserConfig = PRESET_CONFIGS['default']) {
    this.config = config;
  }

  /**
   * Parse raw Telegram JSON export
   */
  parseExport(exportPath: string): TelegramPost[] {
    const rawData = fs.readFileSync(exportPath, 'utf-8');
    const exportData = JSON.parse(rawData);
    
    // Telegram export format varies; adjust based on actual structure
    const posts = exportData.messages || exportData.posts || [];
    
    return posts
      .filter((post: any) => this.isBossRunPost(post))
      .map((post: any) => this.parsePost(post));
  }

  /**
   * Check if a post is a guild boss run report
   */
  private isBossRunPost(post: any): boolean {
    const text = post.text || post.caption || '';
    return this.config.bossPattern.test(text) && this.config.damagePattern.test(text);
  }

  /**
   * Parse individual post into structured format
   */
  private parsePost(post: any): TelegramPost {
    const text = typeof post.text === 'string' 
      ? post.text 
      : post.text?.reduce((acc: string, p: any) => acc + (p.text || ''), '');
    
    const bossMatch = text.match(this.config.bossPattern);
    const damageMatch = text.match(this.config.damagePattern);
    
    const units: TelegramUnit[] = [];
    const unitMatches = text.matchAll(this.config.unitPattern);
    for (const match of unitMatches) {
      units.push({
        characterId: this.normalizeCharacterName(match[1]),
        stars: 0, // Would need additional parsing or OCR
        gearLevel: 0,
        abilityLevels: [],
        damageDealt: parseInt(match[2]) * 1000,
      });
    }

    return {
      id: post.id?.toString() || `post_${Date.now()}`,
      date: new Date(post.date || post.datetime || Date.now()),
      bossId: this.normalizeBossId(bossMatch?.[1] || 'unknown'),
      playerName: post.from?.username || post.author || 'anonymous',
      units,
      totalDamage: parseInt(damageMatch?.[1] || '0') * 1000,
      turns: this.extractTurnCount(text),
      rawText: text,
      mediaFiles: post.photo?.map((p: any) => p.file) || post.media?.map((m: any) => m.url) || [],
    };
  }

  /**
   * Convert Telegram posts to replay format for training
   */
  convertToReplay(post: TelegramPost, estimatedFrames: number = 10): ParsedReplay {
    const frames: ReplayFrame[] = [];
    const avgDamagePerTurn = post.totalDamage / Math.max(post.turns, estimatedFrames);
    
    let cumulativeDamage = 0;
    let bossHp = 1000000; // Default boss HP, would need boss-specific data
    
    for (let turn = 1; turn <= Math.max(post.turns, estimatedFrames); turn++) {
      const turnDamage = avgDamagePerTurn * (0.8 + Math.random() * 0.4); // Approximation
      cumulativeDamage += turnDamage;
      bossHp -= turnDamage;
      
      frames.push({
        turn,
        bossHp: Math.max(0, bossHp),
        bossShields: 0, // Would need actual data
        bossBuffs: [],
        unitStates: post.units.map((u, i) => ({
          unitId: `unit_${i}`,
          characterId: u.characterId,
          hp: 100,
          shields: 0,
          position: null, // Would need actual positioning data
          buffs: [],
          cooldowns: {},
          hasAction: true,
        })),
        action: null, // Would need detailed action data
        damageThisTurn: turnDamage,
        cumulativeDamage,
      });
    }

    return {
      replayId: `replay_${post.id}`,
      source: 'telegram',
      bossId: post.bossId,
      timestamp: post.date,
      frames,
      metadata: {
        sourceUrl: `https://t.me/${this.config.channelId}/${post.id}`,
        playerName: post.playerName,
        verified: post.totalDamage > 500000, // Example threshold
      },
    };
  }

  /**
   * Normalize character names to internal IDs
   */
  private normalizeCharacterName(name: string): string {
    const normalizations: Record<string, string> = {
      'marneus calgar': 'marneus_calgar',
      'lysander': 'lysander',
      'pedro cantor': 'pedro_cantor',
      'cato sicarius': 'cato_sicarius',
      // Add more mappings
    };
    const normalized = name.toLowerCase().trim();
    return normalizations[normalized] || normalized.replace(/\s+/g, '_');
  }

  /**
   * Normalize boss names to internal IDs
   */
  private normalizeBossId(name: string): string {
    const normalizations: Record<string, string> = {
      'avatar of khaine': 'avatar_khaine',
      'khorne bloodthirster': 'bloodthirster',
      'necron monarch': 'monarch',
      'tyrannofex': 'tyrannofex',
      // Add more mappings
    };
    const normalized = name.toLowerCase().trim();
    return normalizations[normalized] || normalized.replace(/\s+/g, '_');
  }

  /**
   * Extract turn count from post text
   */
  private extractTurnCount(text: string): number {
    const turnMatch = text.match(/(\d+)\s*(?:turns?|rnds?)/i);
    return turnMatch ? parseInt(turnMatch[1]) : 10;
  }

  /**
   * Save parsed replays to JSONL format for training
   */
  saveReplays(replays: ParsedReplay[], outputPath: string): void {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const lines = replays.map(r => JSON.stringify(r)).join('\n');
    fs.writeFileSync(outputPath, lines, 'utf-8');
    
    console.log(`Saved ${replays.length} replays to ${outputPath}`);
  }

  /**
   * Load replays from JSONL format
   */
  loadReplays(inputPath: string): ParsedReplay[] {
    const content = fs.readFileSync(inputPath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  }
}

/**
 * CLI usage example
 */
if (require.main === module) {
  const parser = new TelegramParser();
  
  // Example: Parse Telegram export and convert to training data
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: ts-node telegramParser.ts <input.json> <output.jsonl>');
    process.exit(1);
  }
  
  const [inputPath, outputPath] = args;
  const posts = parser.parseExport(inputPath);
  console.log(`Parsed ${posts.length} boss run posts`);
  
  const replays = posts.map(post => parser.convertToReplay(post));
  parser.saveReplays(replays, outputPath);
}
