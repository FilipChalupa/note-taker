import { expect, test } from "@playwright/test";
import fs from "node:fs";
import type { APIRequestContext } from "@playwright/test";
import { isolate, toneFile, waitForStatus } from "./helpers";

isolate();

async function createToken(request: APIRequestContext, name: string, scopes: string[], extra: Record<string, unknown> = {}) {
  const res = await request.post("/api/tokens", { data: { name, scopes, ...extra } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { token: { id: string; prefix: string }; secret: string };
}
const auth = (secret: string) => ({ Authorization: `Bearer ${secret}` });

test("tokens are required, scoped and rate limited", async ({ request }) => {
  expect((await request.get("/api/v1/me")).status()).toBe(401);
  expect((await request.get("/api/v1/me", { headers: auth("nt_nonsense") })).status()).toBe(401);

  const { secret } = await createToken(request, "e2e submit", ["submit"]);
  const me = await (await request.get("/api/v1/me", { headers: auth(secret) })).json();
  expect(me.scopes).toEqual(["submit"]);
  expect(me.limits.requestsPerHour).toBeGreaterThan(0);

  // a submit token may not search or delete
  expect((await request.get("/api/v1/search?q=x", { headers: auth(secret) })).status()).toBe(403);
  expect((await request.delete("/api/v1/recordings/whatever", { headers: auth(secret) })).status()).toBe(403);

  // revoking takes effect immediately
  const { token, secret: revoked } = await createToken(request, "e2e revoked", ["read"]);
  expect((await request.get("/api/v1/me", { headers: auth(revoked) })).status()).toBe(200);
  await request.post(`/api/tokens/${token.id}`);
  expect((await request.get("/api/v1/me", { headers: auth(revoked) })).status()).toBe(401);
});

test("submit token uploads, reads back its own transcript and sees nothing else", async ({ request }) => {
  const { secret } = await createToken(request, "e2e agent", ["submit"]);
  const uploaded = await request.post("/api/v1/recordings", {
    headers: auth(secret),
    multipart: {
      file: { name: "agent-upload.m4a", mimeType: "audio/mp4", buffer: fs.readFileSync(toneFile()) },
      title: "Agent upload",
      language: "cs",
      tags: "agent",
      notes: "submitted over the API",
    },
  });
  expect(uploaded.status()).toBe(201);
  const rec = await uploaded.json();
  expect(rec.title).toBe("Agent upload");
  expect(rec.status).toBe("QUEUED");
  expect(rec).not.toHaveProperty("originalPath");

  await waitForStatus(request, rec.id, ["COMPLETED"]);
  const transcript = await (await request.get(`/api/v1/recordings/${rec.id}/transcript?format=json&words=true`, { headers: auth(secret) })).json();
  expect(transcript.segments).toHaveLength(3);
  expect(transcript.segments[0].speakerName).toBe("Speaker 1");
  expect(transcript.segments[0].words.length).toBeGreaterThan(0);
  const markdown = await (await request.get(`/api/v1/recordings/${rec.id}/transcript?format=md`, { headers: auth(secret) })).json();
  expect(markdown.content).toContain("# Agent upload");

  // its own listing holds exactly this recording
  const list = await (await request.get("/api/v1/recordings", { headers: auth(secret) })).json();
  expect(list.items.map((r: { id: string }) => r.id)).toEqual([rec.id]);

  // a recording created in the UI is invisible to it
  const other = await (await request.post("/api/recordings", {
    multipart: { file: { name: "ui.m4a", mimeType: "audio/mp4", buffer: fs.readFileSync(toneFile()) }, title: "UI upload", language: "cs" },
  })).json();
  expect((await request.get(`/api/v1/recordings/${other.id}`, { headers: auth(secret) })).status()).toBe(404);
  expect((await request.get(`/api/v1/recordings/${other.id}/transcript`, { headers: auth(secret) })).status()).toBe(404);
});

test("read and write scopes cover the archive, tag filters narrow it", async ({ request }) => {
  const { secret: reader } = await createToken(request, "e2e reader", ["read"]);
  const { secret: writer } = await createToken(request, "e2e writer", ["read", "write"]);

  const rec = await (await request.post("/api/v1/recordings", {
    headers: auth(writer),
    multipart: { file: { name: "archive.m4a", mimeType: "audio/mp4", buffer: fs.readFileSync(toneFile()) }, title: "Archive item", tags: "board" },
  })).json();
  await waitForStatus(request, rec.id, ["COMPLETED"]);

  // read scope sees other people's recordings
  expect((await request.get(`/api/v1/recordings/${rec.id}`, { headers: auth(reader) })).status()).toBe(200);
  const search = await (await request.get("/api/v1/search?q=Ahoj", { headers: auth(reader) })).json();
  expect(search.hits.length).toBeGreaterThan(0);
  const status = await (await request.get("/api/v1/status", { headers: auth(reader) })).json();
  expect(status.library.recordings).toBeGreaterThan(0);

  // read scope cannot write
  expect((await request.patch(`/api/v1/recordings/${rec.id}`, { headers: auth(reader), data: { title: "nope" } })).status()).toBe(403);

  // write scope renames speakers and edits segments
  const named = await request.post(`/api/v1/recordings/${rec.id}/speakers`, { headers: auth(writer), data: { names: { SPEAKER_00: "Filip" } } });
  expect(named.status()).toBe(200);
  const speakers = await (await request.get(`/api/v1/recordings/${rec.id}/speakers`, { headers: auth(writer) })).json();
  expect(speakers.speakers.find((s: { id: string }) => s.id === "SPEAKER_00").name).toBe("Filip");
  expect(speakers.stats[0].share).toBeGreaterThan(0);
  const edited = await request.patch(`/api/v1/recordings/${rec.id}/segments`, { headers: auth(writer), data: { edits: [{ index: 0, text: "Opraveno agentem" }] } });
  expect(edited.status()).toBe(200);
  const after = await (await request.get(`/api/v1/recordings/${rec.id}/transcript?format=json`, { headers: auth(writer) })).json();
  expect(after.segments[0].text).toBe("Opraveno agentem");
  expect(after.segments[0].speakerName).toBe("Filip");

  // a tag-filtered token only sees matching recordings
  const { secret: limited } = await createToken(request, "e2e limited", ["read"], { tagFilter: "board" });
  expect((await request.get(`/api/v1/recordings/${rec.id}`, { headers: auth(limited) })).status()).toBe(200);
  const otherRec = await (await request.post("/api/recordings", {
    multipart: { file: { name: "other.m4a", mimeType: "audio/mp4", buffer: fs.readFileSync(toneFile()) }, title: "Not for the agent", language: "cs" },
  })).json();
  expect((await request.get(`/api/v1/recordings/${otherRec.id}`, { headers: auth(limited) })).status()).toBe(404);

  // audio link is signed and works without the token
  const signed = await (await request.get(`/api/v1/recordings/${rec.id}/audio?sign=true&ttl=60`, { headers: auth(writer) })).json();
  expect(signed.url).toContain("sig=");
  expect((await request.get(signed.url)).status()).toBe(200);
  expect((await request.get(signed.url.replace(/sig=[^&]+/, "sig=forged"))).status()).toBe(401);
});

test("the audit log records agent calls and Settings manages tokens", async ({ page, request }) => {
  const { secret } = await createToken(request, "e2e audited", ["read"]);
  await request.get("/api/v1/status", { headers: auth(secret) });
  const audit = (await (await request.get("/api/audit?limit=50")).json()) as Array<{ tokenName: string; action: string; status: number }>;
  expect(audit.some((a) => a.tokenName === "e2e audited" && a.action === "status" && a.status === 200)).toBeTruthy();

  await page.goto("/settings");
  const box = page.getByTestId("tokens");
  await expect(box).toContainText("e2e audited");
  await box.getByRole("button", { name: "+ Create token" }).click();
  await page.getByRole("dialog").getByPlaceholder("e.g. Claude on the laptop").fill("from the UI");
  await page.getByRole("dialog").getByRole("button", { name: "Create token" }).click();
  await expect(page.getByTestId("token-secret")).toContainText(/^nt_/);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("token-list")).toContainText("from the UI");
});
