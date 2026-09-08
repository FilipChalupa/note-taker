# GPU worker image - used by the root docker-compose.all.yml (requires NVIDIA Container Toolkit).
# For the primary deployment target (WSL2 bare metal) use setup-wsl.sh / run.sh instead.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv ffmpeg git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --upgrade pip \
 && pip3 install torch torchaudio --index-url https://download.pytorch.org/whl/cu124 \
 && pip3 install -r requirements.txt

COPY worker ./worker

ENV WORKER_DATA_DIR=/data WORKER_HOST=0.0.0.0 WORKER_PORT=8000
VOLUME ["/data", "/models"]
EXPOSE 8000

CMD ["uvicorn", "worker.main:app", "--host", "0.0.0.0", "--port", "8000"]
