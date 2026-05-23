# Docker Training Environment for Tacticus ML

FROM pytorch/pytorch:2.1.0-cuda11.8-cudnn8-runtime

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    vim \
    htop \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy training code
COPY src/ml/training/ /app/training/

# Create output directory
RUN mkdir -p /app/models /app/data

# Default command
CMD ["python", "training/train.py", "--help"]
