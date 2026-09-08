#!/usr/bin/env bash
# One-time setup of the worker inside WSL2 (Ubuntu 22.04+ recommended).
#
# Prerequisites on the Windows host:
#   - Recent NVIDIA driver (the WSL2 CUDA driver is included; do NOT install a Linux GPU driver inside WSL)
#   - `nvidia-smi` works inside WSL
# Inside WSL:
#   - ffmpeg            (sudo apt install ffmpeg)
#   - EITHER `uv`       (curl -LsSf https://astral.sh/uv/install.sh | sh)   <- recommended, no python3-venv needed
#     OR python3-venv   (sudo apt install python3.10-venv)
#
# Usage:  bash setup-wsl.sh
# Env:    PYTHON_VERSION=3.11 (uv only), TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124
set -euo pipefail
cd "$(dirname "$0")"

CUDA_INDEX="${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cu124}"
PYTHON_VERSION="${PYTHON_VERSION:-3.10}"

echo "==> Checking system dependencies"
if ! command -v ffmpeg >/dev/null; then
  echo "ffmpeg missing -> installing (sudo apt-get install -y ffmpeg)"
  sudo apt-get update && sudo apt-get install -y ffmpeg
fi
if command -v nvidia-smi >/dev/null; then
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
else
  echo "WARNING: nvidia-smi not found - GPU will not be available (set DEVICE=cpu in .env)"
fi

echo "==> Creating virtualenv (.venv)"
if command -v uv >/dev/null; then
  uv venv --python "$PYTHON_VERSION" .venv
  PIP=(uv pip install --python .venv/bin/python)
else
  if ! python3 -c "import ensurepip" 2>/dev/null; then
    echo "ERROR: python3-venv is not installed and 'uv' was not found."
    echo "  Install uv:  curl -LsSf https://astral.sh/uv/install.sh | sh     (then re-open the shell)"
    echo "  or:          sudo apt install python3-venv"
    exit 1
  fi
  python3 -m venv .venv
  .venv/bin/python -m pip install --upgrade pip wheel
  PIP=(.venv/bin/python -m pip install)
fi

echo "==> Installing PyTorch with CUDA (${CUDA_INDEX})"
"${PIP[@]}" torch torchaudio --index-url "$CUDA_INDEX"

echo "==> Installing worker requirements"
"${PIP[@]}" -r requirements.txt

if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Created .env from .env.example - set HF_TOKEN for diarization"
fi

echo "==> Verifying CUDA"
.venv/bin/python - <<'PYEOF'
import torch
print("torch", torch.__version__, "| cuda available:", torch.cuda.is_available())
if torch.cuda.is_available():
    free, total = torch.cuda.mem_get_info()
    print("device:", torch.cuda.get_device_name(0), f"| VRAM {total // 2**20} MB")
PYEOF

echo
echo "Done. Start the worker with:  bash run.sh"
