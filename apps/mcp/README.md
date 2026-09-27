# apps/mcp – MCP server

Lets AI agents use Note Taker: submit a recording and get the transcript back, or read the whole archive with
speaker annotations. It is a thin client over the `/api/v1` REST API and holds no data of its own.

```
agent (Claude Code, Claude Desktop, …)
   │  stdio (default) or loopback HTTP
   ▼
note-taker-mcp ──Bearer token──▶ apps/web  ──▶ apps/worker (GPU)
```

## Two ways to use it

The tool surface follows the token's scopes, so an agent only sees what it may do.

| Scope | Tools |
| --- | --- |
| `submit` | `submit_recording`, `get_recording`, `get_transcript`, `list_recordings` (only its own uploads) |
| `read` | adds `search_transcripts`, `get_speakers`, `get_audio_url`, `list_tags`, `get_status`, the `note-taker://` resources and the `summarize_meeting` prompt |
| `write` | adds `update_recording`, `rename_speakers`, `merge_speakers`, `edit_segments` |
| `admin` | adds `delete_recording`, and only with `--allow-destructive` |

**Drop-off agent:** a `submit` token. It can upload audio and read back the transcripts of its own uploads, and it
cannot see that any other recording exists.

**Archivist agent:** a `read` token, optionally with `write`. It can search every transcript, read speaker names and
speaking time, and correct the result.

A token can also be limited to a single tag, so an agent sees only recordings marked for it.

## Run

Create a token in Note Taker under Settings, Agent access. Token management is unlocked with the web app's
`ADMIN_PASSWORD`. Then:

```bash
claude mcp add note-taker \
  --env NOTE_TAKER_URL=http://localhost:3000 \
  --env NOTE_TAKER_TOKEN=nt_... \
  -- node /path/to/note-taker/apps/mcp/dist/index.js
```

or in a client config file:

```json
{
  "mcpServers": {
    "note-taker": {
      "command": "node",
      "args": ["/path/to/note-taker/apps/mcp/dist/index.js"],
      "env": { "NOTE_TAKER_URL": "http://localhost:3000", "NOTE_TAKER_TOKEN": "nt_..." }
    }
  }
}
```

Build first with `pnpm --filter @note-taker/mcp build` (or `npm run build` in this folder).

### HTTP transport

For an agent on another machine inside the LAN or on a VPN:

```bash
node dist/index.js --http --port 7337 --host 127.0.0.1
```

The listener binds to loopback by default, requires `Authorization: Bearer <NOTE_TAKER_TOKEN>` and enables DNS
rebinding protection. Expose it further only through a VPN address, never to the internet.

## Safety notes

- **Least privilege:** give each agent its own token with the smallest scope, and revoke it in Settings when done.
  Every call is rate limited per token and written to the audit log, which Settings shows.
- **Prompt injection:** transcripts are text written by whoever was in the room. Every transcript, search result and
  resource is returned with a note that the content is data, never instructions. Agents should treat it that way.
- **Deleting** needs both the `admin` scope and `--allow-destructive`, so a stray tool call cannot erase a meeting.
- **Audio** is served through short-lived signed links, so a URL handed to another tool expires.

## Tests

```bash
npm test   # builds, then runs node:test against a fake Note Taker API
```
