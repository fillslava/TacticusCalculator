# Tacticus ML Training - Quick Start Guide

## Prerequisites

1. **Docker with GPU support** (NVIDIA Docker runtime)
2. **Telegram export** from your best runs channel
3. **Node.js** (for data parsing scripts)

## Step-by-Step Setup

### 1. Export Data from Telegram

Use Telegram's export feature or a bot to download channel data:
- Go to your guild boss best runs channel
- Export as JSON (Settings > Advanced > Export Telegram Data)
- Save as `telegram_export.json`

### 2. Prepare Training Data

```bash
# Parse Telegram export into training format
./scripts/prepare-data.sh telegram_export.json data/

# This will create:
# - data/replays.jsonl (training data in JSONL format)
```

### 3. Build Docker Image

```bash
cd docker
docker-compose build training
```

### 4. Train the Model

```bash
# Start training (uses GPU by default)
docker-compose up training

# Or run with custom parameters:
docker-compose run training python training/train.py \
  --data /app/data/replays.jsonl \
  --epochs 100 \
  --batch-size 64 \
  --lr 0.0001 \
  --model-type cnn
```

### 5. Monitor Training

Check training progress:
```bash
# View logs
docker-compose logs -f training

# Access TensorBoard (if added)
docker-compose up notebook
# Then open http://localhost:8888
```

### 6. Export and Use Model

After training completes, the model will be saved to:
- `models/best_model.pth` (PyTorch checkpoint)
- `models/model.onnx` (ONNX format for browser)

To use in the Tacticus app:

```typescript
import { ML_POLICY } from './src/ml/inference/mlPolicy';

// Initialize ML policy
await ML_POLICY.initialize();

// Get suggestions during battle
const suggestions = ML_POLICY.suggest(activeUnitId, battleState);
```

## Configuration Options

### Training Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--epochs` | 50 | Number of training epochs |
| `--batch-size` | 32 | Batch size for training |
| `--lr` | 1e-4 | Learning rate |
| `--model-type` | cnn | 'cnn' or 'transformer' |
| `--max-samples` | None | Limit samples for testing |

### Model Architecture

**CNN Model** (default):
- Faster inference (~10-50ms in browser)
- Good for position-based decisions
- Recommended for starting

**Transformer Model**:
- Better for sequence learning
- Slower inference (~50-200ms)
- Use when you have 1000+ replays

## Troubleshooting

### GPU Not Detected
```bash
# Check NVIDIA Docker
docker run --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi

# If fails, install NVIDIA Container Toolkit
```

### Out of Memory
```bash
# Reduce batch size
docker-compose run training python training/train.py --batch-size 16

# Or use gradient accumulation (modify train.py)
```

### Poor Model Performance
1. **More data**: Collect at least 100 high-quality replays
2. **Better data**: Ensure replays are from top-performing players
3. **Feature engineering**: Improve board encoder with game-specific features
4. **Hyperparameters**: Tune learning rate, model size

## Next Steps

### Phase 1: Initial Training (Current)
- [x] Basic pipeline setup
- [ ] Collect 100+ replays from Telegram
- [ ] Train first CNN model
- [ ] Integrate into app for testing

### Phase 2: Improvement
- [ ] Add more feature channels (buffs, cooldowns, terrain)
- [ ] Implement proper action encoding
- [ ] A/B test ML vs heuristic policy
- [ ] Collect user feedback

### Phase 3: Advanced
- [ ] Transformer model for sequence prediction
- [ ] Self-play reinforcement learning
- [ ] Boss-specific models
- [ ] Real-time adaptation during battles

## File Structure

```
workspace/
├── src/ml/
│   ├── data/              # Data parsing
│   │   └── telegramParser.ts
│   ├── features/          # Board encoding
│   │   └── boardEncoder.ts
│   ├── training/          # PyTorch training
│   │   ├── model.py
│   │   ├── train.py
│   │   └── requirements.txt
│   └── inference/         # Browser inference
│       └── mlPolicy.ts
├── docker/
│   ├── training.Dockerfile
│   └── docker-compose.yml
├── scripts/
│   └── prepare-data.sh
├── data/                  # Training data (gitignored)
├── models/                # Trained models (gitignored)
└── ML_ROADMAP.md          # Full roadmap
```

## Contributing

To add new features:
1. Update board encoder with new features
2. Modify model architecture if needed
3. Retrain with updated features
4. Test in app with A/B comparison

## Support

For issues or questions:
- Check `ML_ROADMAP.md` for architecture details
- Review code comments in each module
- Test with small dataset first (`--max-samples 100`)
