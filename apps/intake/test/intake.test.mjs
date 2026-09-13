import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { loadConfig } from "../src/config.mjs";
import { RateLimiter, startIntake } from "../src/app.mjs";

const TOKEN = "collect-secret";
const CODE = "letmein";
const BELL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);

async function start(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "intake-test-"));
  const config = loadConfig({ PORT: "0", HOST: "127.0.0.1", DATA_DIR: dataDir, INTAKE_COLLECT_TOKEN: TOKEN, CHUNK_MB: "1", QUIET: "1", ...env });
  const intake = await startIntake(config);
  const base = `http://127.0.0.1:${intake.publicPort}`;
  const collectBase = intake.collectPort != null ? `http://127.0.0.1:${intake.collectPort}` : base;
  return {
    intake,
    config,
    dataDir,
    base,
    collectBase,
    stop: async () => {
      await intake.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const json = async (res) => ({ status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null), headers: res.headers });

function client(base, code) {
  const headers = code ? { "X-Upload-Code": code } : {};
  return {
    create: (body) => fetch(`${base}/api/uploads`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json),
    put: (id, offset, buf) => fetch(`${base}/api/uploads/${id}?offset=${offset}`, { method: "PUT", headers, body: buf }).then(json),
    get: (id) => fetch(`${base}/api/uploads/${id}`, { headers }).then(json),
    complete: (id) => fetch(`${base}/api/uploads/${id}/complete`, { method: "POST", headers }).then(json),
    cancel: (id) => fetch(`${base}/api/uploads/${id}`, { method: "DELETE", headers }).then(json),
  };
}
const collector = (base, token = TOKEN) => {
  const headers = { Authorization: `Bearer ${token}` };
  return {
    items: () => fetch(`${base}/collect/v1/items`, { headers }).then(json),
    file: (id) => fetch(`${base}/collect/v1/items/${id}/file`, { headers }),
    ack: (id) => fetch(`${base}/collect/v1/items/${id}`, { method: "DELETE", headers }).then(json),
    status: () => fetch(`${base}/collect/v1/status`, { headers }).then(json),
  };
};

/** Upload `buf` in chunks and complete it; returns the upload id and reference. */
async function uploadAll(c, buf, meta = {}) {
  const created = await c.create({ filename: "meeting.m4a", size: buf.length, mime: "audio/mp4", ...meta });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { id, chunkBytes } = created.body;
  let offset = 0;
  while (offset < buf.length) {
    const r = await c.put(id, offset, buf.subarray(offset, offset + chunkBytes));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    offset = r.body.received;
  }
  const done = await c.complete(id);
  assert.equal(done.status, 200);
  return { id, reference: done.body.reference };
}

describe("public upload API", () => {
  let s;
  before(async () => (s = await start()));
  after(async () => s.stop());

  test("config reveals only limits and nothing about stored items", async () => {
    const { status, body } = await json(await fetch(`${s.base}/api/config`));
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body).sort(), ["chunkBytes", "codeRequired", "defaultLanguage", "languages", "maxBytes", "title"]);
    assert.equal(body.codeRequired, false);
  });

  test("static page is served with strict security headers and nothing else is reachable", async () => {
    const res = await fetch(`${s.base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>/);
    assert.match(res.headers.get("content-security-policy"), /connect-src 'self'/);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    for (const p of ["/../package.json", "/src/app.mjs", "/server.mjs", "/data/", "/constructor", "/__proto__"]) {
      assert.equal((await fetch(`${s.base}${p}`)).status, 404, p);
    }
  });

  test("chunked upload, resume after offset mismatch, completion and collection with checksum", async () => {
    const c = client(s.base);
    const buf = Buffer.alloc(2.5 * 1024 * 1024, 7);
    buf.write("intake-test", 12345);
    const created = await c.create({
      filename: "Weekly sync.m4a",
      size: buf.length,
      mime: "audio/mp4",
      title: `Weekly${BELL}  sync`,
      note: `hello${NUL} world\nsecond line`,
      language: "en",
    });
    assert.equal(created.status, 201);
    const { id, chunkBytes } = created.body;
    assert.match(id, /^[a-f0-9]{32}$/);
    assert.equal(chunkBytes, 1024 * 1024);

    assert.equal((await c.put(id, 0, buf.subarray(0, chunkBytes))).body.received, chunkBytes);
    // a retried chunk with a stale offset is rejected and tells the client where to continue
    const stale = await c.put(id, 0, buf.subarray(0, chunkBytes));
    assert.equal(stale.status, 409);
    assert.equal(stale.body.received, chunkBytes);
    assert.equal((await c.get(id)).body.received, chunkBytes);
    // completion before all bytes arrived is refused
    assert.equal((await c.complete(id)).status, 409);

    let offset = chunkBytes;
    while (offset < buf.length) offset = (await c.put(id, offset, buf.subarray(offset, offset + chunkBytes))).body.received;
    const done = await c.complete(id);
    assert.equal(done.status, 200);
    assert.equal(done.body.reference, id.slice(0, 8).toUpperCase());
    // after completion the uploader cannot see the item any more
    assert.equal((await c.get(id)).status, 404);

    const col = collector(s.base);
    const item = (await col.items()).body.items.find((i) => i.id === id);
    assert.ok(item);
    assert.equal(item.title, "Weekly sync"); // control character removed, whitespace collapsed
    assert.equal(item.note, "hello world\nsecond line"); // control character removed, newline kept
    assert.equal(item.language, "en");
    assert.equal(item.size, buf.length);
    const file = await col.file(id);
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.ok(bytes.equals(buf));
    const sha = createHash("sha256").update(buf).digest("hex");
    assert.equal(file.headers.get("x-content-sha256"), sha);
    assert.equal(item.sha256, sha);
    assert.equal((await col.ack(id)).status, 204);
    assert.equal((await col.items()).body.items.some((i) => i.id === id), false);
    assert.equal(fs.existsSync(path.join(s.dataDir, "ready", id)), false);
  });

  test("validation: size, type, oversize chunk, bytes beyond declared size, bad ids", async () => {
    const c = client(s.base);
    assert.equal((await c.create({ filename: "a.m4a", size: 0 })).status, 400);
    assert.equal((await c.create({ filename: "a.m4a", size: s.config.maxUploadBytes + 1 })).status, 413);
    assert.equal((await c.create({ filename: "evil.exe", size: 10, mime: "application/x-msdownload" })).status, 415);
    assert.equal((await c.create({ filename: "voice", size: 10, mime: "audio/ogg" })).status, 201); // mime type is enough

    const { body } = await c.create({ filename: "b.wav", size: 100 });
    assert.equal((await c.put(body.id, 0, Buffer.alloc(101))).status, 413);
    assert.equal((await c.get(body.id)).body.received, 0); // rolled back
    const big = await c.create({ filename: "c.wav", size: 3 * 1024 * 1024 });
    assert.equal((await c.put(big.body.id, 0, Buffer.alloc(1024 * 1024 + 1))).status, 413);

    assert.equal((await c.get("..%2F..%2Fetc")).status, 404);
    assert.equal((await c.get("ZZZZ")).status, 404);
    assert.equal((await fetch(`${s.base}/api/uploads`, { method: "POST", body: "{nope" })).status, 400);
    assert.equal((await c.cancel(body.id)).status, 204);
    assert.equal((await c.get(body.id)).status, 404);
  });

  test("filenames cannot contain path separators and titles are trimmed", async () => {
    const c = client(s.base);
    const { id } = await uploadAll(c, Buffer.from("x".repeat(10)), { filename: "../../secret/../x.m4a", title: "  t  " });
    const item = (await collector(s.base).items()).body.items.find((i) => i.id === id);
    assert.equal(item.filename.includes("/"), false);
    assert.equal(item.title, "t");
    await collector(s.base).ack(id);
  });

  test("collector API requires the token", async () => {
    assert.equal((await collector(s.base, "wrong").items()).status, 401);
    assert.equal((await fetch(`${s.base}/collect/v1/items`)).status, 401);
    const st = await collector(s.base).status();
    assert.equal(st.status, 200);
    assert.ok("readyCount" in st.body);
  });
});

describe("access code", () => {
  let s;
  before(async () => (s = await start({ INTAKE_UPLOAD_CODE: CODE })));
  after(async () => s.stop());

  test("uploads require the code and wrong attempts are rate limited", async () => {
    assert.equal((await json(await fetch(`${s.base}/api/config`))).body.codeRequired, true);
    assert.equal((await client(s.base).create({ filename: "a.m4a", size: 5 })).status, 401);
    assert.equal((await client(s.base, "nope").create({ filename: "a.m4a", size: 5 })).status, 401);
    assert.equal((await fetch(`${s.base}/api/code`, { method: "POST", headers: { "X-Upload-Code": CODE } })).status, 204);
    const ok = await client(s.base, CODE).create({ filename: "a.m4a", size: 5 });
    assert.equal(ok.status, 201);
    // the upload id alone is not enough without the code
    assert.equal((await client(s.base).get(ok.body.id)).status, 401);
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await fetch(`${s.base}/api/code`, { method: "POST", headers: { "X-Upload-Code": "bad" } })).status;
    assert.equal(last, 429);
  });
});

describe("limits and housekeeping", () => {
  test("storage quota and per-IP rate limit", async () => {
    const s = await start({ MAX_PENDING_GB: String(3 / 1024), RATE_LIMIT_PER_HOUR: "3" }); // 3 MiB quota
    try {
      const c = client(s.base);
      assert.equal((await c.create({ filename: "a.m4a", size: 2 * 1024 * 1024 })).status, 201);
      assert.equal((await c.create({ filename: "b.m4a", size: 2 * 1024 * 1024 })).status, 507);
      assert.equal((await c.create({ filename: "c.m4a", size: 10 })).status, 201);
      assert.equal((await c.create({ filename: "d.m4a", size: 10 })).status, 201);
      assert.equal((await c.create({ filename: "e.m4a", size: 10 })).status, 429);
    } finally {
      await s.stop();
    }
  });

  test("sweep removes abandoned uploads and uncollected items", async () => {
    const s = await start({ UPLOAD_TTL_HOURS: "1", READY_TTL_DAYS: "1" });
    try {
      const c = client(s.base);
      const pending = await c.create({ filename: "a.m4a", size: 100 });
      const { id: ready } = await uploadAll(c, Buffer.from("hello"));
      assert.equal(await s.intake.sweep(Date.now()), 0);
      assert.equal(await s.intake.sweep(Date.now() + 2 * 3600e3), 1); // incomplete upload removed
      assert.equal((await c.get(pending.body.id)).status, 404);
      assert.equal((await collector(s.base).items()).body.items.length, 1);
      assert.equal(await s.intake.sweep(Date.now() + 2 * 86400e3), 1);
      assert.equal((await collector(s.base).items()).body.items.some((i) => i.id === ready), false);
    } finally {
      await s.stop();
    }
  });

  test("separate collect port: collector API is not reachable on the public port", async () => {
    const s = await start({ COLLECT_PORT: "0", COLLECT_HOST: "127.0.0.1" });
    try {
      assert.notEqual(s.collectBase, s.base);
      assert.equal((await collector(s.base).items()).status, 404);
      assert.equal((await collector(s.collectBase).items()).status, 200);
      // and the public API is not served on the collect port
      assert.equal((await fetch(`${s.collectBase}/api/config`)).status, 404);
    } finally {
      await s.stop();
    }
  });

  test("without a collect token the collector API does not exist", async () => {
    const s = await start({ INTAKE_COLLECT_TOKEN: "" });
    try {
      assert.equal((await collector(s.base, "").items()).status, 404);
    } finally {
      await s.stop();
    }
  });

  test("rate limiter window", () => {
    const rl = new RateLimiter(2, 1000);
    assert.equal(rl.take("a", 0), true);
    assert.equal(rl.take("a", 10), true);
    assert.equal(rl.take("a", 20), false);
    assert.equal(rl.take("a", 1500), true);
  });
});
