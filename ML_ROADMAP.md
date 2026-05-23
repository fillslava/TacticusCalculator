# Tacticus ML Training Pipeline - Roadmap & Setup

## Overview
This document outlines the roadmap for building an ML system that learns from guild boss runs to predict optimal move sequences.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Telegram Data  │────▶│  Python Trainer  │────▶│  ONNX Model     │
│  (Best Runs)    │     │  (Docker + GPU)  │     │  (Browser)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │                        │
                                ▼                        ▼
                        ┌──────────────────┐     ┌─────────────────┐
                        │  Feature Store   │     │  Tacticus App   │
                        │  (JSONL)         │     │  (Inference)    │
                        └──────────────────┘     └─────────────────┘
```

## Phase 1: Data Collection (CURRENT)
- [x] Create directory structure
- [ ] Build Telegram data parser
- [ ] Define replay data schema
- [ ] Create feature extraction pipeline

## Phase 2: Model Training
- [ ] Set up Docker training environment
- [ ] Implement board state encoder
- [ ] Build policy network (Transformer/LSTM)
- [ ] Train on collected data

## Phase 3: Browser Integration
- [ ] Export model to ONNX format
- [ ] Integrate ONNX Runtime Web
- [ ] Create ML policy interface
- [ ] A/B test against heuristic policy

## Phase 4: Continuous Learning
- [ ] Collect user feedback
- [ ] Retrain with new data
- [ ] Version models

## Directory Structure
```
src/ml/
├── data/           # Data parsing and preprocessing
│   ├── telegramParser.ts
│   ├── replaySchema.ts
│   └── featureExtractor.ts
├── features/       # Board state encoding
│   ├── boardEncoder.ts
│   └── featureTypes.ts
├── models/         # Model definitions and loading
│   ├── modelConfig.ts
│   └── onnxLoader.ts
├── training/       # Training utilities (Python)
│   ├── train.py
│   ├── dataset.py
│   └── model.py
└── inference/      # Browser inference
    ├── mlPolicy.ts
    └── predictionEngine.ts

scripts/
├── parse-telegram.ts
├── export-training-data.py
└── train-model.sh

docker/
├── training.Dockerfile
└── docker-compose.yml
```

## Data Schema (Replay Format)
```typescript
interface ReplayFrame {
  turn: number;
  bossId: string;
  bossHp: number;
  bossShields: number;
  bossBuffs: Buff[];
  units: UnitState[];
  action: ActionTaken;
  damageDealt: number;
  mapState: HexGridState;
}

interface ActionTaken {
  unitId: string;
  actionType: 'attack' | 'ability' | 'move';
  targetHex: HexCoord;
  abilityId?: string;
  rotationIndex?: number;
}
```

## Training Environment Requirements
- Docker with NVIDIA GPU support
- TensorFlow 2.x or PyTorch
- CUDA 11.8+
- 16GB+ VRAM recommended for transformer models

## Next Steps
1. Parse Telegram channel data into structured format
2. Define feature encoding for board states
3. Build initial CNN+LSTM model
4. Train on historical best runs
5. Export to ONNX and integrate into app
