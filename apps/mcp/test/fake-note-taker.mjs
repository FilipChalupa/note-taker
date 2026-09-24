/** Minimal stand-in for the Note Taker API so the MCP server can be tested without the real app. */
import http from "node:http";

export const TOKENS = {
  "nt_submit": { name: "submit token", scopes: ["submit"], tagFilter: null },
  "nt_read": { name: "read token", scopes: ["submit", "read"], tagFilter: null },
  "nt_write": { name: "write token", scopes: ["submit", "read", "write"], tagFilter: null },
  "nt_admin": { name: "admin token", scopes: ["admin"], tagFilter: null },
};

export async function startFakeNoteTaker() {
  const recordings = new Map();
  const calls = [];
  let counter = 0;

  const auth = (req) => {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") ? TOKENS[header.slice(7)] ?? null : null;
  };
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const readBody = async (req) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks);
  };

  const transcriptOf = (rec) => ({
    id: rec.id,
    language: "cs",
    durationSeconds: 12.5,
    speakers: [
      { id: "SPEAKER_00", name: rec.names.SPEAKER_00 ?? null },
      { id: "SPEAKER_01", name: rec.names.SPEAKER_01 ?? null },
    ],
    segments: [
      { index: 0, start: 0, end: 5, speaker: "SPEAKER_00", speakerName: rec.names.SPEAKER_00 ?? "Speaker 1", text: "Ahoj, jak se máš?" },
      { index: 1, start: 5.1, end: 12.5, speaker: "SPEAKER_01", speakerName: rec.names.SPEAKER_01 ?? "Speaker 2", text: "Dobře, díky." },
    ],
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fake");
    const token = auth(req);
    calls.push({ method: req.method, path: url.pathname, token: token?.name ?? null });
    if (!token) return json(res, 401, { error: { code: "UNAUTHORIZED" } });
    const can = (scope) => token.scopes.includes("admin") || token.scopes.includes(scope);

    if (url.pathname === "/api/v1/me") {
      return json(res, 200, { name: token.name, scopes: token.scopes, tagFilter: token.tagFilter, limits: { requestsPerHour: 600, submitsPerHour: 60, maxUploadBytes: 2 ** 31 }, defaultLanguage: "cs", version: "1" });
    }
    if (url.pathname === "/api/v1/recordings" && req.method === "POST") {
      const body = await readBody(req);
      const id = `rec-${++counter}`;
      const title = /name="title"\r\n\r\n([^\r]*)/.exec(body.toString("latin1"))?.[1] ?? "";
      const rec = { id, title: title || "Untitled", owner: token.name, status: counter === 1 ? "PROCESSING" : "COMPLETED", progress: 40, phase: "TRANSCRIBING", language: "cs", durationSeconds: 12.5, speakerCount: 2, tags: [], error: null, warning: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), names: {}, bytes: body.length };
      recordings.set(id, rec);
      return json(res, 201, rec);
    }
    if (url.pathname === "/api/v1/recordings" && req.method === "GET") {
      const items = [...recordings.values()].filter((r) => can("read") || r.owner === token.name);
      return json(res, 200, { items, total: items.length, page: 1, limit: 25 });
    }
    const m = /^\/api\/v1\/recordings\/([^/]+)(\/transcript|\/speakers|\/segments|\/audio)?$/.exec(url.pathname);
    if (m) {
      const [, id, sub] = m;
      const rec = recordings.get(id);
      if (!rec) return json(res, 404, { error: { code: "NOT_FOUND" } });
      if (!can("read") && rec.owner !== token.name) return json(res, 404, { error: { code: "NOT_FOUND" } });
      if (!sub && req.method === "GET") {
        // first poll reports processing, later polls report completion
        if (rec.status === "PROCESSING") rec.status = "COMPLETED";
        return json(res, 200, rec);
      }
      if (!sub && req.method === "PATCH") {
        if (!can("write")) return json(res, 403, { error: { code: "FORBIDDEN_SCOPE" } });
        Object.assign(rec, JSON.parse((await readBody(req)).toString() || "{}"));
        return json(res, 200, rec);
      }
      if (!sub && req.method === "DELETE") {
        if (!can("admin")) return json(res, 403, { error: { code: "FORBIDDEN_SCOPE" } });
        recordings.delete(id);
        res.writeHead(204).end();
        return;
      }
      if (sub === "/transcript") {
        if (rec.status !== "COMPLETED") return json(res, 409, { error: { code: "NOT_FINISHED" } });
        const format = url.searchParams.get("format") ?? "json";
        if (format === "json") return json(res, 200, transcriptOf(rec));
        const t = transcriptOf(rec);
        const content = format === "md" ? `# ${rec.title}\n\n` + t.segments.map((s) => `**${s.speakerName}**\n\n${s.text}`).join("\n\n") : t.segments.map((s) => `${s.speakerName}: ${s.text}`).join("\n");
        return json(res, 200, { id, format, content });
      }
      if (sub === "/speakers" && req.method === "GET") {
        return json(res, 200, { speakers: transcriptOf(rec).speakers.map((s) => ({ ...s, suggestion: null })), stats: [{ speaker: "SPEAKER_00", name: "Speaker 1", seconds: 5, share: 0.4, turns: 1, words: 4 }] });
      }
      if (sub === "/speakers" && req.method === "POST") {
        if (!can("write")) return json(res, 403, { error: { code: "FORBIDDEN_SCOPE" } });
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        Object.assign(rec.names, body.names ?? {});
        return json(res, 200, { speakers: transcriptOf(rec).speakers });
      }
      if (sub === "/segments" && req.method === "PATCH") {
        if (!can("write")) return json(res, 403, { error: { code: "FORBIDDEN_SCOPE" } });
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        return json(res, 200, { ok: true, segmentCount: body.edits.length });
      }
      if (sub === "/audio") return json(res, 200, { url: `/api/v1/recordings/${id}/audio?exp=1&sig=abc`, expiresInSeconds: 900 });
    }
    if (url.pathname === "/api/v1/search") {
      if (!can("read")) return json(res, 403, { error: { code: "FORBIDDEN_SCOPE" } });
      return json(res, 200, { query: url.searchParams.get("q"), hits: [...recordings.values()].map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt, durationSeconds: 12.5, snippet: "Ahoj, **jak** se máš?" })) });
    }
    if (url.pathname === "/api/v1/tags") return json(res, 200, { tags: [{ tag: "agent", count: 1 }] });
    if (url.pathname === "/api/v1/status") return json(res, 200, { transcriptionAvailable: true, acceleration: "gpu", queued: 0, library: { recordings: recordings.size, completed: 1, audioHours: 0.1 } });
    return json(res, 404, { error: { code: "NOT_FOUND" } });
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    recordings,
    calls,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
