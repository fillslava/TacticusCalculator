"""
PyTorch Model for Tacticus Guild Boss Move Prediction

This model uses a CNN + Transformer architecture to:
1. Encode board state from feature planes
2. Predict optimal moves (policy head)
3. Estimate expected damage (value head)

Architecture inspired by AlphaZero but adapted for Tacticus mechanics.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple, List, Optional


class ResidualBlock(nn.Module):
    """Residual convolutional block for board encoding"""
    
    def __init__(self, channels: int):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1)
        self.bn2 = nn.BatchNorm2d(channels)
        
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        identity = x
        
        out = F.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        
        out += identity
        return F.relu(out)


class TacticusPolicyNetwork(nn.Module):
    """
    Main policy network for move prediction
    
    Input: [batch, channels, height, width] feature planes
    Output: 
      - policy: probability distribution over moves
      - value: expected damage estimate
    """
    
    def __init__(
        self,
        input_channels: int = 38,  # From BoardEncoder
        board_size: int = 7,
        num_filters: int = 128,
        num_residual_blocks: int = 6,
        num_unit_types: int = 10,
        max_units: int = 6,
        num_actions: int = 5,  # attack, ability, move, wait, special
    ):
        super().__init__()
        
        self.board_size = board_size
        self.num_unit_types = num_unit_types
        self.max_units = max_units
        self.num_actions = num_actions
        
        # Initial convolution
        self.conv_input = nn.Conv2d(input_channels, num_filters, kernel_size=3, padding=1)
        self.bn_input = nn.BatchNorm2d(num_filters)
        
        # Residual tower
        self.residual_tower = nn.Sequential(
            *[ResidualBlock(num_filters) for _ in range(num_residual_blocks)]
        )
        
        # Policy head - outputs move probabilities
        # For each unit type, predict action + target
        self.policy_conv = nn.Conv2d(num_filters, num_filters, kernel_size=3, padding=1)
        self.policy_bn = nn.BatchNorm2d(num_filters)
        
        # Policy output: [unit_type, action_type, target_q, target_r]
        # Flattened for simplicity; could be structured output
        self.policy_head = nn.Linear(
            num_filters * board_size * board_size,
            num_unit_types * num_actions * (board_size * board_size + 1)  # +1 for no-target actions
        )
        
        # Value head - outputs expected damage
        self.value_conv = nn.Conv2d(num_filters, 1, kernel_size=1)
        self.value_bn = nn.BatchNorm2d(1)
        self.value_fc1 = nn.Linear(board_size * board_size, 128)
        self.value_fc2 = nn.Linear(128, 1)
        
        # Action type embedding for decoder
        self.action_embedding = nn.Embedding(num_actions, 32)
        
    def forward(
        self, 
        x: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass
        
        Args:
            x: Input tensor [batch, channels, height, width]
            
        Returns:
            policy: Move probabilities [batch, num_moves]
            value: Expected damage [batch, 1]
        """
        batch_size = x.shape[0]
        
        # Encode board
        x = F.relu(self.bn_input(self.conv_input(x)))
        x = self.residual_tower(x)
        
        # Policy head
        policy_out = F.relu(self.policy_bn(self.policy_conv(x)))
        policy_out = policy_out.view(batch_size, -1)
        policy = self.policy_head(policy_out)
        
        # Value head
        value_out = F.relu(self.value_bn(self.value_conv(x)))
        value_out = value_out.view(batch_size, -1)
        value_out = F.relu(self.value_fc1(value_out))
        value = torch.tanh(self.value_fc2(value_out))  # Normalize to [-1, 1]
        
        # Scale value to expected damage range (will be denormalized later)
        value = value * 500000  # Assume max 500k damage
        
        return policy, value


class TacticusTransformerPolicy(nn.Module):
    """
    Alternative transformer-based policy network
    Better for capturing long-range dependencies and sequences
    """
    
    def __init__(
        self,
        input_channels: int = 38,
        board_size: int = 7,
        embed_dim: int = 256,
        num_heads: int = 8,
        num_layers: int = 4,
        ff_dim: int = 512,
        max_units: int = 6,
        num_actions: int = 5,
    ):
        super().__init__()
        
        self.board_size = board_size
        self.embed_dim = embed_dim
        self.max_units = max_units
        self.num_actions = num_actions
        
        # Input projection
        self.input_proj = nn.Linear(input_channels, embed_dim)
        
        # Positional encoding for hex grid
        self.pos_encoding = self._create_hex_positional_encoding(board_size, embed_dim)
        
        # Transformer encoder
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=embed_dim,
            nhead=num_heads,
            dim_feedforward=ff_dim,
            dropout=0.1,
            activation='gelu',
            batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        
        # Policy head
        self.policy_head = nn.Sequential(
            nn.Linear(embed_dim, embed_dim // 2),
            nn.ReLU(),
            nn.Linear(embed_dim // 2, num_actions * (board_size * board_size + 1)),
        )
        
        # Value head
        self.value_head = nn.Sequential(
            nn.Linear(embed_dim, 128),
            nn.ReLU(),
            nn.Linear(128, 1),
        )
        
    def _create_hex_positional_encoding(
        self, 
        board_size: int, 
        embed_dim: int
    ) -> torch.Tensor:
        """Create positional encodings for hex grid positions"""
        positions = []
        for q in range(board_size):
            for r in range(board_size):
                positions.append([q, r])
        
        positions = torch.tensor(positions, dtype=torch.float32)
        
        # Sinusoidal encoding
        pe = torch.zeros(len(positions), embed_dim)
        position = positions.sum(dim=1, keepdim=True)
        
        div_term = torch.exp(torch.arange(0, embed_dim, 2) * -(torch.log(torch.tensor(10000.0)) / embed_dim))
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        
        return pe.unsqueeze(0)  # [1, num_positions, embed_dim]
        
    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass
        
        Args:
            x: Input tensor [batch, channels, height, width]
            
        Returns:
            policy: Move probabilities [batch, num_positions, num_actions]
            value: Expected damage [batch, 1]
        """
        batch_size = x.shape[0]
        
        # Rearrange to [batch, height*width, channels]
        x = x.permute(0, 2, 3, 1)  # [batch, H, W, C]
        x = x.reshape(batch_size, -1, x.shape[-1])  # [batch, H*W, C]
        
        # Project to embedding dimension
        x = self.input_proj(x)
        
        # Add positional encoding
        pos_enc = self.pos_encoding.to(x.device)
        x = x + pos_enc.expand(batch_size, -1, -1)
        
        # Transformer encoding
        x = self.transformer(x)
        
        # Policy output
        policy = self.policy_head(x)  # [batch, H*W, num_actions * targets]
        
        # Value output (global pooling)
        x_pooled = x.mean(dim=1)  # [batch, embed_dim]
        value = self.value_head(x_pooled)  # [batch, 1]
        value = torch.tanh(value) * 500000
        
        return policy, value


class LossFunction(nn.Module):
    """Combined policy + value loss with optional entropy regularization"""
    
    def __init__(
        self,
        policy_weight: float = 1.0,
        value_weight: float = 0.5,
        entropy_weight: float = 0.01,
    ):
        super().__init__()
        self.policy_weight = policy_weight
        self.value_weight = value_weight
        self.entropy_weight = entropy_weight
        
    def forward(
        self,
        policy_pred: torch.Tensor,
        value_pred: torch.Tensor,
        policy_target: torch.Tensor,
        value_target: torch.Tensor,
    ) -> Tuple[torch.Tensor, dict]:
        """
        Compute combined loss
        
        Args:
            policy_pred: Predicted policy logits
            value_pred: Predicted values
            policy_target: Target policy (from expert data or MCTS)
            value_target: Target values (actual damage dealt)
            
        Returns:
            total_loss: Combined loss
            losses: Dict of individual losses
        """
        # Policy loss (cross-entropy)
        policy_loss = F.cross_entropy(policy_pred, policy_target)
        
        # Value loss (MSE)
        value_loss = F.mse_loss(value_pred.squeeze(), value_target)
        
        # Entropy regularization (encourages exploration)
        policy_probs = F.softmax(policy_pred, dim=-1)
        entropy = -(policy_probs * torch.log(policy_probs + 1e-10)).sum(dim=-1).mean()
        
        # Total loss
        total_loss = (
            self.policy_weight * policy_loss +
            self.value_weight * value_loss -
            self.entropy_weight * entropy
        )
        
        losses = {
            'total': total_loss.item(),
            'policy': policy_loss.item(),
            'value': value_loss.item(),
            'entropy': entropy.item(),
        }
        
        return total_loss, losses


# Example usage and testing
if __name__ == '__main__':
    # Test CNN model
    print("Testing CNN Policy Network...")
    cnn_model = TacticusPolicyNetwork(
        input_channels=38,
        board_size=7,
        num_filters=64,
        num_residual_blocks=4,
    )
    
    # Dummy input [batch, channels, height, width]
    dummy_input = torch.randn(2, 38, 7, 7)
    policy, value = cnn_model(dummy_input)
    
    print(f"CNN Policy output shape: {policy.shape}")
    print(f"CNN Value output shape: {value.shape}")
    
    # Test Transformer model
    print("\nTesting Transformer Policy Network...")
    transformer_model = TacticusTransformerPolicy(
        input_channels=38,
        board_size=7,
        embed_dim=128,
        num_heads=4,
        num_layers=2,
    )
    
    policy_t, value_t = transformer_model(dummy_input)
    print(f"Transformer Policy output shape: {policy_t.shape}")
    print(f"Transformer Value output shape: {value_t.shape}")
    
    # Test loss function
    print("\nTesting Loss Function...")
    loss_fn = LossFunction()
    
    policy_target = torch.randint(0, 100, (2,))  # Dummy targets
    value_target = torch.randn(2) * 100000
    
    total_loss, losses = loss_fn(policy, value, policy_target, value_target)
    print(f"Total Loss: {total_loss:.4f}")
    print(f"Individual losses: {losses}")
    
    print("\n✓ All tests passed!")
