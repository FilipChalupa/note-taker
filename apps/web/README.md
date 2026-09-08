# apps/web – web UI and application server

Next.js 16 (App Router) application that:

- accepts recordings (drag & drop; MP3, M4A, WAV, AAC, OGG, FLAC, MP4/MOV…),
- stores metadata in SQLite (Drizzle ORM, `better-sqlite3`) and files on disk (`DATA_DIR`),
- hands tasks to the GPU worker and polls their state in the background (`src/instrumentation.ts` → `src/lib/poller.ts`),
- shows the transcript with color-coded speakers, a player (1×–2×, ±5 s, click a sentence to seek),
  speaker renaming and export to Markdown / TXT / SRT / VTT,
- is available in English and Czech; the language follows the browser's `Accept-Language`
  (Slovak maps to Czech, anything else to English) and can be overridden with the CS/EN switcher (cookie).

## Homelab deployment (Docker)

```bash
cd apps/web
cp .env.example .env
#   WORKER_API_URL=http://192.168.1.50:8000   (address of the worker PC)
#   WORKER_API_KEY=...                        (if set on the worker)
docker compose up -d --build
```

- UI: `http://<homelab>:3000` (change the port with `WEB_PORT` in the compose environment).
- Persistent data: `./data` → `/data` in the container (`db.sqlite` + `recordings/<id>/`).
- The build context is the monorepo root (because of `packages/shared`), see `docker-compose.yml`.

## Development

```bash
pnpm install                # in the repo root
cd apps/web && cp .env.example .env
pnpm dev                    # http://localhost:3000
pnpm typecheck
pnpm db:studio              # Drizzle Studio over data/db.sqlite
```

The DB schema is created automatically on startup (`src/lib/db/index.ts`, `CREATE TABLE IF NOT EXISTS`).

## Configuration (`.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `WORKER_API_URL` | `http://localhost:8000` | worker base URL |
| `WORKER_API_KEY` | – | `X-API-Key` header for the worker |
| `DATA_DIR` | `./data` | SQLite + audio files |
| `WORKER_POLL_INTERVAL_MS` | `3000` | task status polling interval |
| `DEFAULT_LANGUAGE` | `cs` | preselected language in the upload form |
| `MAX_UPLOAD_MB` | `2048` | upload size limit |

## API (internal, used by the UI)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/recordings` | list recordings |
| `POST` | `/api/recordings` | multipart: `file`, `title`, `language`, `minSpeakers`, `maxSpeakers` |
| `GET` / `PATCH` / `DELETE` | `/api/recordings/:id` | detail (segments, speakers) / rename (`title`, `speakerNames`) / delete |
| `POST` | `/api/recordings/:id/retry` | resubmit to the worker |
| `GET` | `/api/recordings/:id/audio` | audio with `Range` support |
| `GET` | `/api/recordings/:id/export?format=md\|txt\|srt\|vtt` | transcript export |
| `GET` | `/api/worker/health` | worker reachability + GPU info |

## Behaviour when the worker is down

The recording stays *Queued* ("waiting for the worker") and the poller resubmits it with exponential
backoff (max 2 min) once the worker responds. If the worker loses the task (restart, TTL), the web app
resubmits it from the original file.
