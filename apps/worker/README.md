# apps/worker – GPU transcription service

FastAPI service that accepts audio, converts it with ffmpeg to 16 kHz mono, transcribes it with
[WhisperX](https://github.com/m-bain/whisperX) (faster-whisper / CTranslate2, `large-v3-turbo`,
`int8_float16`), aligns words in time and assigns speakers with pyannote. Tasks are processed
sequentially (one GPU job at a time) to avoid OOM on 12 GB of VRAM.

## Setup in WSL2

Prerequisites:

- Windows with a recent NVIDIA driver (`nvidia-smi` works inside WSL). Do **not** install a Linux GPU driver inside WSL.
- Ubuntu 22.04+ in WSL2, `ffmpeg` (`sudo apt install ffmpeg`).
- [`uv`](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`) **or** `python3-venv`.

```bash
cd apps/worker
bash setup-wsl.sh        # .venv + torch (cu124) + whisperx; verifies CUDA at the end
cp .env.example .env
bash run.sh              # or: pnpm dev:worker from the repo root
```

Swagger UI: `http://localhost:8000/docs`. The first run downloads the model (~1.6 GB for
`large-v3-turbo`, ~3 GB for `large-v3`) into `~/.cache/huggingface` (override with `HF_HOME`).

### Diarization (HF_TOKEN)

1. Create a read token at https://huggingface.co/settings/tokens.
2. Accept the terms of **pyannote/speaker-diarization-community-1** (recommended, best accuracy). If you only accept
   **pyannote/speaker-diarization-3.1** + **pyannote/segmentation-3.0**, the worker falls back to that pipeline.
3. Put the token into `.env` as `HF_TOKEN=hf_...`.

Without a token the worker still runs; every segment is labelled `SPEAKER_00` and `/health` reports `diarization_enabled: false`.
If diarization fails for another reason (gated model not accepted, network), the transcript is still delivered with a single
speaker, `/health` reports `diarization_error`, and the web UI shows a warning with a "Reprocess" button.

`DIARIZATION_MODEL` selects the pyannote pipeline (default `pyannote/speaker-diarization-community-1`, fallback
`pyannote/speaker-diarization-3.1`). Each is gated separately on Hugging Face.

### Reaching WSL2 from the homelab

WSL2 has its own virtual network. Options:

- **Tailscale / VPN** in WSL or on Windows – simplest; `WORKER_API_URL=http://<tailscale-ip>:8000`.
- **Mirrored networking** (Windows 11, `.wslconfig`: `[wsl2] networkingMode=mirrored`) – WSL shares the Windows IP.
- **Port forwarding** on Windows (PowerShell as admin):
  ```powershell
  netsh interface portproxy add v4tov4 listenport=8000 listenaddress=0.0.0.0 connectport=8000 connectaddress=$(wsl hostname -I).Trim()
  New-NetFirewallRule -DisplayName "note-taker worker" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
  ```

If the worker is exposed to the network, set `WORKER_API_KEY` (and the same value on the web side).

## Configuration (`.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `WHISPER_MODEL` | `large-v3-turbo` | `large-v3` = best quality (~10 GB VRAM), `large-v3-turbo` = ~4× faster (~6 GB) |
| `COMPUTE_TYPE` | `int8_float16` | `float16` for max accuracy, `int8` for minimum VRAM |
| `DEVICE` | `cuda` | `cpu` to run without a GPU (very slow) |
| `BATCH_SIZE` | `8` | lower it on OOM |
| `LOUDNESS_NORMALIZATION` | `dynaudnorm` | loudness filter during conversion: `dynaudnorm` (fast), `loudnorm` (EBU R128, slower), `off` |
| `DEFAULT_LANGUAGE` | `cs` | used when the request has no language; empty = auto-detect |
| `HF_TOKEN` | – | pyannote token |
| `DIARIZATION_ENABLED` | `1` | `0` disables diarization |
| `DIARIZATION_MODEL` | `pyannote/speaker-diarization-community-1` | pyannote pipeline id on Hugging Face (falls back to 3.1) |
| `WORKER_API_KEY` | – | optional shared secret (`X-API-Key`) |
| `WORKER_DATA_DIR` | `./data` | task storage (`data/tasks/<id>/{status.json,result.json,audio.mp3}`) |
| `TASK_TTL_HOURS` | `72` | finished tasks older than this are deleted on startup |

## Troubleshooting

- **`Could not load library libcudnn_ops...`** – `run.sh` adds the cuDNN libs from the pip `nvidia-*` packages to `LD_LIBRARY_PATH`. If you start uvicorn by hand, do the same or install cuDNN 9 system-wide.
- **GPU OOM** – lower `BATCH_SIZE`, use `large-v3-turbo` or `COMPUTE_TYPE=int8`.
- **Diarization returns `UNKNOWN`** – segments with no overlap with the diarization output; try passing `min_speakers`/`max_speakers`.
- **Slow start** – models stay loaded in VRAM between tasks; the first task after startup takes longer.
- **Restart during a task** – task state lives in `data/tasks/<id>/`; on startup unfinished tasks are re-queued from the
  upload or, once converted, from the normalized audio, so nothing is lost (the task simply starts over).
- **"Converting audio" barely uses CPU/GPU** – expected: this phase is ffmpeg audio decoding, single-threaded and CPU-only (≈ 1 core). The GPU is used from the transcription phase on.
- **ETA / speed estimates** – `/tasks/{id}/status` reports `eta_seconds`, `expected_finish_at` and `speed_rtf` based on a moving average of previous tasks (`data/stats.json`); the first tasks use conservative defaults.

## Docker (alternative)

The `Dockerfile` builds on `nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04` and needs the NVIDIA Container
Toolkit; it is used by the root `docker-compose.all.yml`. In WSL2 the bare-metal `run.sh` path is simpler and faster.
