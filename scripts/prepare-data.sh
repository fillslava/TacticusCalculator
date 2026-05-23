#!/bin/bash
# Script to parse Telegram data and prepare for training

set -e

echo "=== Tacticus ML Data Preparation ==="

# Check if input file is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <telegram_export.json> [output_dir]"
    exit 1
fi

INPUT_FILE="$1"
OUTPUT_DIR="${2:-data}"

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "Input: $INPUT_FILE"
echo "Output directory: $OUTPUT_DIR"

# Run TypeScript parser
echo "Parsing Telegram export..."
npx ts-node src/ml/data/telegramParser.ts "$INPUT_FILE" "$OUTPUT_DIR/replays.jsonl"

# Show statistics
echo ""
echo "=== Data Statistics ==="
if [ -f "$OUTPUT_DIR/replays.jsonl" ]; then
    LINE_COUNT=$(wc -l < "$OUTPUT_DIR/replays.jsonl")
    echo "Total replays: $LINE_COUNT"
    
    # Show boss distribution
    echo ""
    echo "Boss distribution:"
    cat "$OUTPUT_DIR/replays.jsonl" | jq -r '.bossId' | sort | uniq -c | sort -rn
else
    echo "Error: Output file not created"
    exit 1
fi

echo ""
echo "✓ Data preparation complete!"
echo "Next step: Run training with:"
echo "  docker-compose up training"
echo "  or"
echo "  python src/ml/training/train.py --data $OUTPUT_DIR/replays.jsonl"
