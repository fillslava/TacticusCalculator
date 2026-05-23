/**
 * ML Policy Interface for Tacticus
 * 
 * This integrates the trained ML model into the existing policy system,
 * allowing it to be used alongside or instead of heuristic policies.
 */

import { Policy, SuggestedAction } from '../../map/ai/policy';
import { MapBattleState } from '../../map/battleState';
import { BoardEncoder, MoveDecoder, MoveDistribution } from '../features/boardEncoder';

/**
 * Configuration for ML policy
 */
export interface MLPolicyConfig {
  modelPath: string; // Path to ONNX model file
  useGPU: boolean;
  confidenceThreshold: number; // Min confidence to use ML suggestion
  fallbackToHeuristic: boolean; // Use heuristic if ML confidence is low
  maxInferenceTime: number; // Max time for inference in ms
}

const DEFAULT_CONFIG: MLPolicyConfig = {
  modelPath: '/models/model.onnx',
  useGPU: false, // WebGPU when available
  confidenceThreshold: 0.3,
  fallbackToHeuristic: true,
  maxInferenceTime: 100,
};

/**
 * Wrapper for ONNX runtime (lazy loaded)
 */
class ONNXRuntime {
  private session: any = null;
  private loading: Promise<void> | null = null;

  async loadModel(modelPath: string): Promise<void> {
    if (this.session) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      // Dynamic import for browser compatibility
      const ort = await import('onnxruntime-web');
      
      // Load model
      const modelArrayBuffer = await fetch(modelPath).then(r => r.arrayBuffer());
      this.session = await ort.InferenceSession.create(modelArrayBuffer);
      
      console.log('[ML Policy] Model loaded successfully');
    })();

    return this.loading;
  }

  async infer(inputTensor: Float32Array, shape: number[]): Promise<{ policy: Float32Array; value: number }> {
    if (!this.session) {
      throw new Error('Model not loaded');
    }

    const ort = await import('onnxruntime-web');
    
    // Create input tensor
    const input = new ort.Tensor('float32', inputTensor, shape);
    
    // Run inference
    const feeds = { input };
    const results = await this.session.run(feeds);
    
    // Extract outputs
    const policyOutput = results.policy.data as Float32Array;
    const valueOutput = (results.value.data as Float32Array)[0];
    
    return {
      policy: policyOutput,
      value: valueOutput,
    };
  }
}

/**
 * ML-based policy that uses trained neural network
 */
export class MLPolicy implements Policy {
  readonly id = 'ml-policy';
  readonly displayName = 'ML-Predicted (Neural Network)';
  
  private config: MLPolicyConfig;
  private encoder: BoardEncoder;
  private decoder: MoveDecoder;
  private runtime: ONNXRuntime;
  private loaded: boolean = false;

  constructor(config: Partial<MLPolicyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.encoder = new BoardEncoder();
    this.decoder = new MoveDecoder();
    this.runtime = new ONNXRuntime();
  }

  /**
   * Load the ML model (call once at initialization)
   */
  async initialize(): Promise<boolean> {
    try {
      await this.runtime.loadModel(this.config.modelPath);
      this.loaded = true;
      return true;
    } catch (error) {
      console.error('[ML Policy] Failed to load model:', error);
      this.loaded = false;
      return false;
    }
  }

  /**
   * Check if model is ready
   */
  isReady(): boolean {
    return this.loaded;
  }

  /**
   * Suggest actions using ML model
   */
  suggest(activeUnitId: string | null, battle: MapBattleState): SuggestedAction[] {
    if (!this.loaded) {
      console.warn('[ML Policy] Model not loaded, returning empty suggestions');
      return [];
    }

    const startTime = performance.now();

    try {
      // Encode board state
      const encoded = this.encoder.encode(battle);
      const flatInput = this.encoder.flatten(encoded);
      const inputShape = [1, ...this.encoder.getInputShape()];

      // Run inference
      const { policy, value } = await this.runtime.infer(flatInput, inputShape);

      // Decode to game actions
      const distribution = this.decoder.decode(policy, value, battle);

      const inferenceTime = performance.now() - startTime;
      console.log(`[ML Policy] Inference took ${inferenceTime.toFixed(2)}ms`);

      if (inferenceTime > this.config.maxInferenceTime) {
        console.warn(`[ML Policy] Inference exceeded time limit (${inferenceTime}ms > ${this.config.maxInferenceTime}ms)`);
      }

      // Filter by confidence threshold
      const confidentMoves = distribution.moves.filter(
        move => move.probability >= this.config.confidenceThreshold
      );

      // Convert to SuggestedAction format
      return confidentMoves.map(move => ({
        unitId: move.unitId,
        actionType: move.actionType,
        targetHex: move.targetHex,
        abilityId: move.abilityId,
        expectedValue: move.expectedDamage || 0,
        confidence: move.probability,
        source: 'ml',
      }));

    } catch (error) {
      console.error('[ML Policy] Inference failed:', error);
      
      if (this.config.fallbackToHeuristic) {
        // Could import and call heuristic policy here
        console.log('[ML Policy] Falling back to heuristic (not implemented in this example)');
      }
      
      return [];
    }
  }

  /**
   * Get value estimate for current position
   */
  getValueEstimate(battle: MapBattleState): number {
    if (!this.loaded) return 0;

    const encoded = this.encoder.encode(battle);
    const flatInput = this.encoder.flatten(encoded);
    
    // Would need to modify runtime.infer to return value separately
    // For now, this is a placeholder
    return 0;
  }

  /**
   * Get top N moves with probabilities
   */
  async getTopMoves(battle: MapBattleState, topN: number = 5): Promise<MoveDistribution> {
    if (!this.loaded) {
      return { moves: [], valueEstimate: 0 };
    }

    const encoded = this.encoder.encode(battle);
    const flatInput = this.encoder.flatten(encoded);
    const inputShape = [1, ...this.encoder.getInputShape()];

    const { policy, value } = await this.runtime.infer(flatInput, inputShape);
    const distribution = this.decoder.decode(policy, value, battle);

    // Sort by probability and take top N
    distribution.moves.sort((a, b) => b.probability - a.probability);
    distribution.moves = distribution.moves.slice(0, topN);
    distribution.valueEstimate = value;

    return distribution;
  }
}

/**
 * Hybrid policy that combines ML and heuristic approaches
 */
export class HybridPolicy implements Policy {
  readonly id = 'hybrid-policy';
  readonly displayName = 'Hybrid (ML + Heuristic)';

  private mlPolicy: MLPolicy;
  // Would import heuristic policy here

  constructor(mlConfig?: Partial<MLPolicyConfig>) {
    this.mlPolicy = new MLPolicy(mlConfig);
  }

  async initialize(): Promise<boolean> {
    return this.mlPolicy.initialize();
  }

  suggest(activeUnitId: string | null, battle: MapBattleState): SuggestedAction[] {
    // Get ML suggestions
    const mlSuggestions = this.mlPolicy.suggest(activeUnitId, battle);

    // Get heuristic suggestions (placeholder)
    // const heuristicSuggestions = HEURISTIC_POLICY.suggest(activeUnitId, battle);

    // Combine strategies:
    // 1. If ML has high confidence moves, use them
    // 2. Otherwise, blend ML and heuristic
    // 3. Add diversity by including some heuristic alternatives

    const highConfidenceMl = mlSuggestions.filter(s => s.confidence > 0.7);
    
    if (highConfidenceMl.length > 0) {
      return highConfidenceMl;
    }

    // Blend strategies (simplified example)
    return mlSuggestions;
  }
}

// Export instances for easy import
export const ML_POLICY = new MLPolicy();
export const HYBRID_POLICY = new HybridPolicy();
