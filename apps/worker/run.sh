#!/usr/bin/env bash
# Start the worker (WSL2 / bare metal). Creates the venv via setup-wsl.sh if missing.
# Config comes from apps/worker/.env (loaded by the app) - real environment variables take precedence.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "No .venv found - running setup-wsl.sh first"
  bash setup-wsl.sh
fi
PY=.venv/bin/python

# Read a key from .env only if it is not already set in the environment
env_or_dotenv() {
  local key="$1" fallback="$2" val
  val="${!key:-}"
  if [ -z "$val" ] && [ -f .env ]; then
    val=$(grep -E "^${key}=" .env | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  fi
  echo "${val:-$fallback}"
}

# Make the cuDNN / cuBLAS wheels bundled with torch visible to CTranslate2
NVIDIA_LIBS=$("$PY" - <<'PYEOF'
import os, glob, site
paths = []
for sp in site.getsitepackages():
    paths += glob.glob(os.path.join(sp, "nvidia", "*", "lib"))
print(":".join(paths))
PYEOF
)
export LD_LIBRARY_PATH="${NVIDIA_LIBS}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

HOST=$(env_or_dotenv WORKER_HOST 0.0.0.0)
PORT=$(env_or_dotenv WORKER_PORT 8000)
echo "Starting worker on http://${HOST}:${PORT}  (model=$(env_or_dotenv WHISPER_MODEL large-v3-turbo), compute=$(env_or_dotenv COMPUTE_TYPE int8_float16))"
exec "$PY" -m uvicorn worker.main:app --host "$HOST" --port "$PORT" --workers 1 "$@"
