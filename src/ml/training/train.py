"""
Training Pipeline for Tacticus ML Model

This script handles:
1. Loading replay data from JSONL files
2. Creating PyTorch datasets and dataloaders
3. Training loop with checkpointing
4. Model export to ONNX format
"""

import os
import json
import argparse
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from datetime import datetime

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import numpy as np
from tqdm import tqdm

from model import TacticusPolicyNetwork, TacticusTransformerPolicy, LossFunction


class TacticusDataset(Dataset):
    """PyTorch Dataset for Tacticus replay data"""
    
    def __init__(
        self,
        data_path: str,
        board_size: int = 7,
        input_channels: int = 38,
        max_samples: Optional[int] = None,
    ):
        """
        Args:
            data_path: Path to JSONL file with replay data
            board_size: Size of the board grid
            input_channels: Number of input feature channels
            max_samples: Maximum number of samples to load (for testing)
        """
        super().__init__()
        
        self.board_size = board_size
        self.input_channels = input_channels
        self.samples: List[Dict] = []
        
        # Load data
        print(f"Loading data from {data_path}...")
        with open(data_path, 'r') as f:
            for i, line in enumerate(f):
                if max_samples and i >= max_samples:
                    break
                    
                try:
                    replay = json.loads(line.strip())
                    self.samples.extend(self._replay_to_samples(replay))
                except json.JSONDecodeError:
                    continue
        
        print(f"Loaded {len(self.samples)} training samples")
    
    def _replay_to_samples(self, replay: Dict) -> List[Dict]:
        """Convert replay format to training samples"""
        samples = []
        
        frames = replay.get('frames', [])
        boss_id = replay.get('bossId', 'unknown')
        
        for i, frame in enumerate(frames):
            # Skip frames without actions (no learning signal)
            action = frame.get('action')
            if not action:
                continue
            
            sample = {
                'board_state': self._encode_frame(frame),
                'action': action,
                'damage_dealt': frame.get('damageThisTurn', 0),
                'cumulative_damage': frame.get('cumulativeDamage', 0),
                'boss_id': boss_id,
                'turn': frame.get('turn', 0),
            }
            samples.append(sample)
        
        return samples
    
    def _encode_frame(self, frame: Dict) -> np.ndarray:
        """
        Encode a single frame into feature tensor
        This is a simplified version - in production, use BoardEncoder
        """
        # Placeholder encoding - would integrate with TypeScript BoardEncoder
        # or reimplement encoding logic here
        features = np.zeros((self.input_channels, self.board_size, self.board_size), dtype=np.float32)
        
        # Encode unit positions (simplified)
        unit_states = frame.get('unitStates', [])
        for unit in unit_states:
            pos = unit.get('position')
            if pos:
                q = pos.get('q', 0) + self.board_size // 2
                r = pos.get('r', 0) + self.board_size // 2
                
                if 0 <= q < self.board_size and 0 <= r < self.board_size:
                    # Set unit presence channel
                    features[0, q, r] = 1.0
                    # Set HP channel
                    features[1, q, r] = unit.get('hp', 100) / 100.0
        
        # Encode boss position
        boss_hp = frame.get('bossHp', 0)
        boss_shields = frame.get('bossShields', 0)
        features[2, self.board_size // 2, self.board_size // 2] = boss_hp / 1000000.0
        features[3, self.board_size // 2, self.board_size // 2] = boss_shields / 100000.0
        
        # Add turn information
        turn = frame.get('turn', 0) / 20.0
        features[4, :, :] = turn
        
        return features
    
    def __len__(self) -> int:
        return len(self.samples)
    
    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        sample = self.samples[idx]
        
        # Input features
        x = torch.from_numpy(sample['board_state'])
        
        # Action target (simplified - would need proper action encoding)
        action_type = {'attack': 0, 'ability': 1, 'move': 2, 'wait': 3}.get(
            sample['action'].get('actionType', 'attack'), 0
        )
        y_policy = torch.tensor(action_type, dtype=torch.long)
        
        # Value target (damage dealt)
        y_value = torch.tensor(sample['damage_dealt'], dtype=torch.float32)
        
        return x, y_policy, y_value


class Trainer:
    """Main training loop orchestrator"""
    
    def __init__(
        self,
        model_type: str = 'cnn',
        input_channels: int = 38,
        board_size: int = 7,
        num_filters: int = 128,
        num_residual_blocks: int = 6,
        learning_rate: float = 1e-4,
        weight_decay: float = 1e-5,
        batch_size: int = 32,
        device: Optional[str] = None,
    ):
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"Using device: {self.device}")
        
        # Initialize model
        if model_type == 'cnn':
            self.model = TacticusPolicyNetwork(
                input_channels=input_channels,
                board_size=board_size,
                num_filters=num_filters,
                num_residual_blocks=num_residual_blocks,
            ).to(self.device)
        elif model_type == 'transformer':
            self.model = TacticusTransformerPolicy(
                input_channels=input_channels,
                board_size=board_size,
            ).to(self.device)
        else:
            raise ValueError(f"Unknown model type: {model_type}")
        
        # Loss and optimizer
        self.criterion = LossFunction()
        self.optimizer = optim.AdamW(
            self.model.parameters(),
            lr=learning_rate,
            weight_decay=weight_decay,
        )
        self.scheduler = optim.lr_scheduler.ReduceLROnPlateau(
            self.optimizer, mode='min', factor=0.5, patience=5
        )
        
        self.batch_size = batch_size
        self.best_loss = float('inf')
    
    def train_epoch(
        self,
        dataloader: DataLoader,
        epoch: int,
    ) -> Dict[str, float]:
        """Train for one epoch"""
        self.model.train()
        
        total_loss = 0.0
        policy_loss_sum = 0.0
        value_loss_sum = 0.0
        
        pbar = tqdm(dataloader, desc=f"Epoch {epoch}")
        
        for batch_idx, (x, y_policy, y_value) in enumerate(pbar):
            x = x.to(self.device)
            y_policy = y_policy.to(self.device)
            y_value = y_value.to(self.device)
            
            # Forward pass
            self.optimizer.zero_grad()
            policy_pred, value_pred = self.model(x)
            
            # Compute loss
            loss, losses = self.criterion(policy_pred, value_pred, y_policy, y_value)
            
            # Backward pass
            loss.backward()
            
            # Gradient clipping
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
            
            self.optimizer.step()
            
            # Update metrics
            total_loss += losses['total']
            policy_loss_sum += losses['policy']
            value_loss_sum += losses['value']
            
            pbar.set_postfix({
                'loss': f"{losses['total']:.4f}",
                'policy': f"{losses['policy']:.4f}",
                'value': f"{losses['value']:.4f}",
            })
        
        # Calculate averages
        num_batches = len(dataloader)
        avg_loss = total_loss / num_batches
        avg_policy_loss = policy_loss_sum / num_batches
        avg_value_loss = value_loss_sum / num_batches
        
        return {
            'loss': avg_loss,
            'policy_loss': avg_policy_loss,
            'value_loss': avg_value_loss,
        }
    
    def validate(
        self,
        dataloader: DataLoader,
    ) -> Dict[str, float]:
        """Validate on held-out data"""
        self.model.eval()
        
        total_loss = 0.0
        
        with torch.no_grad():
            for x, y_policy, y_value in dataloader:
                x = x.to(self.device)
                y_policy = y_policy.to(self.device)
                y_value = y_value.to(self.device)
                
                policy_pred, value_pred = self.model(x)
                loss, losses = self.criterion(policy_pred, value_pred, y_policy, y_value)
                
                total_loss += losses['total']
        
        avg_loss = total_loss / len(dataloader)
        return {'val_loss': avg_loss}
    
    def save_checkpoint(
        self,
        path: str,
        epoch: int,
        metrics: Dict[str, float],
    ):
        """Save model checkpoint"""
        checkpoint = {
            'epoch': epoch,
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'metrics': metrics,
            'best_loss': self.best_loss,
        }
        torch.save(checkpoint, path)
        print(f"Saved checkpoint to {path}")
    
    def load_checkpoint(self, path: str):
        """Load model checkpoint"""
        checkpoint = torch.load(path)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.best_loss = checkpoint.get('best_loss', float('inf'))
        print(f"Loaded checkpoint from {path}")
    
    def export_onnx(self, path: str, dummy_input: torch.Tensor):
        """Export model to ONNX format for browser deployment"""
        self.model.eval()
        
        dummy_input = dummy_input.to(self.device)
        
        torch.onnx.export(
            self.model,
            dummy_input,
            path,
            export_params=True,
            opset_version=14,
            do_constant_folding=True,
            input_names=['input'],
            output_names=['policy', 'value'],
            dynamic_axes={
                'input': {0: 'batch_size'},
                'policy': {0: 'batch_size'},
                'value': {0: 'batch_size'},
            },
        )
        print(f"Exported ONNX model to {path}")


def main():
    parser = argparse.ArgumentParser(description='Train Tacticus ML Model')
    parser.add_argument('--data', type=str, required=True, help='Path to training data JSONL')
    parser.add_argument('--output', type=str, default='models', help='Output directory')
    parser.add_argument('--epochs', type=int, default=50, help='Number of epochs')
    parser.add_argument('--batch-size', type=int, default=32, help='Batch size')
    parser.add_argument('--lr', type=float, default=1e-4, help='Learning rate')
    parser.add_argument('--model-type', type=str, default='cnn', choices=['cnn', 'transformer'])
    parser.add_argument('--device', type=str, default=None, help='Device (cuda/cpu)')
    parser.add_argument('--resume', type=str, default=None, help='Resume from checkpoint')
    parser.add_argument('--max-samples', type=int, default=None, help='Max samples for testing')
    
    args = parser.parse_args()
    
    # Create output directory
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Split data into train/val (80/20)
    # In production, use separate files or proper splitting
    dataset = TacticusDataset(args.data, max_samples=args.max_samples)
    
    train_size = int(0.8 * len(dataset))
    val_size = len(dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(
        dataset, [train_size, val_size]
    )
    
    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=4,
        pin_memory=True,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=4,
        pin_memory=True,
    )
    
    # Initialize trainer
    trainer = Trainer(
        model_type=args.model_type,
        learning_rate=args.lr,
        batch_size=args.batch_size,
        device=args.device,
    )
    
    # Resume from checkpoint if specified
    if args.resume:
        trainer.load_checkpoint(args.resume)
    
    # Training loop
    print(f"\nStarting training for {args.epochs} epochs...")
    print(f"Training samples: {len(train_dataset)}, Validation samples: {len(val_dataset)}\n")
    
    for epoch in range(1, args.epochs + 1):
        # Train
        train_metrics = trainer.train_epoch(train_loader, epoch)
        
        # Validate
        val_metrics = trainer.validate(val_loader)
        
        # Combined metrics
        metrics = {**train_metrics, **val_metrics}
        
        print(f"\nEpoch {epoch}/{args.epochs}")
        print(f"  Train Loss: {metrics['loss']:.4f}")
        print(f"  Val Loss: {metrics['val_loss']:.4f}")
        
        # Learning rate scheduling
        trainer.scheduler.step(metrics['val_loss'])
        
        # Save best model
        if metrics['val_loss'] < trainer.best_loss:
            trainer.best_loss = metrics['val_loss']
            trainer.save_checkpoint(
                output_dir / 'best_model.pth',
                epoch,
                metrics,
            )
        
        # Save regular checkpoint every 10 epochs
        if epoch % 10 == 0:
            trainer.save_checkpoint(
                output_dir / f'checkpoint_epoch_{epoch}.pth',
                epoch,
                metrics,
            )
    
    # Export final model to ONNX
    dummy_input = torch.randn(1, 38, 7, 7).to(trainer.device)
    trainer.export_onnx(output_dir / 'model.onnx', dummy_input)
    
    print("\n✓ Training complete!")
    print(f"Best model saved to: {output_dir / 'best_model.pth'}")
    print(f"ONNX model saved to: {output_dir / 'model.onnx'}")


if __name__ == '__main__':
    main()
