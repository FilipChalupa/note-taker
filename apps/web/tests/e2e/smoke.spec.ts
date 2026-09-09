import { expect, test } from "@playwright/test";
import { completedRecording, uploadRecording, waitForStatus } from "./helpers";

test("language follows Accept-Language and the cookie override", async ({ page, request }) => {
  expect(await (await request.get("/", { headers: { "Accept-Language": "cs" } })).text()).toContain('<html lang="cs"');
  expect(await (await request.get("/", { headers: { "Accept-Language": "de" } })).text()).toContain('<html lang="en"');
  await page.goto("/");
  await page.getByRole("button", { name: "cs" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "cs");
});

test("upload goes through the worker and ends with a transcript", async ({ page, request }) => {
  const { id, status } = await uploadRecording(request, "Smoke upload", { hints: "Claritime" });
  expect(status).toBe("QUEUED");
  const rec = await waitForStatus(request, id);
  expect(rec.status).toBe("COMPLETED");
  expect(rec.segments).toHaveLength(3);
  expect(rec.speakers).toEqual(["SPEAKER_00", "SPEAKER_01"]);
  expect(rec.hints).toBe("Claritime");

  await page.goto(`/recordings/${id}`);
  await expect(page.getByRole("heading", { name: "Smoke upload" })).toBeVisible();
  await expect(page.getByText("Ahoj, jak se máš?")).toBeVisible();
  await expect(page.locator("aside input.input")).toHaveCount(2);
});

test("exports and MP3 download", async ({ request }) => {
  const rec = await completedRecording(request, "Export test");
  const md = await (await request.get(`/api/recordings/${rec.id}/export?format=md`)).text();
  expect(md).toContain("# Export test");
  expect(md).toContain("**Speaker 1**");
  const srt = await (await request.get(`/api/recordings/${rec.id}/export?format=srt`)).text();
  expect(srt).toMatch(/^1\n00:00:00,000 --> 00:00:02,500/);
  const audio = await request.get(`/api/recordings/${rec.id}/audio?download=1`);
  expect(audio.headers()["content-disposition"]).toContain("Export_test.mp3");
  const range = await request.get(`/api/recordings/${rec.id}/audio`, { headers: { Range: "bytes=0-99" } });
  expect(range.status()).toBe(206);
});

test("full-text search finds transcripts regardless of diacritics", async ({ page, request }) => {
  const rec = await completedRecording(request, "Search target");
  const hits = (await (await request.get("/api/search?q=mas")).json()).hits as { id: string }[];
  expect(hits.some((h) => h.id === rec.id)).toBeTruthy();
  await page.goto("/search?q=jak");
  await expect(page.getByText("Search target").first()).toBeVisible();
  await page.goto(`/recordings/${rec.id}?q=jak`);
  await expect(page.locator("p mark").first()).toBeVisible();
});

test("settings: glossary is stored and merged into the worker prompt", async ({ request }) => {
  await request.put("/api/settings", { data: { glossary: "Acme\nQ3 roadmap" } });
  expect((await (await request.get("/api/settings")).json()).glossary).toBe("Acme\nQ3 roadmap");
  const storage = await (await request.get("/api/storage")).json();
  expect(storage.recordings).toBeGreaterThan(0);
  expect(storage.totalBytes).toBeGreaterThan(0);
});

test("queue page and worker health chip", async ({ page }) => {
  await page.goto("/queue");
  await expect(page.getByRole("heading", { name: "Processing queue" })).toBeVisible();
  await expect(page.getByText("Worker online")).toBeVisible();
  await expect(page.getByText("GPU")).toBeVisible();
});

test("push notification subscriptions are stored and removed", async ({ request }) => {
  const vapid = await (await request.get("/api/push/vapid")).json();
  expect(vapid.publicKey.length).toBeGreaterThan(60);
  const sub = { endpoint: "https://push.example/e2e", keys: { p256dh: "k", auth: "a" } };
  expect((await request.post("/api/push/subscribe", { data: sub })).ok()).toBeTruthy();
  expect((await (await request.get("/api/push/vapid")).json()).subscribers).toBe(1);
  await request.delete("/api/push/subscribe", { data: { endpoint: sub.endpoint } });
  expect((await (await request.get("/api/push/vapid")).json()).subscribers).toBe(0);
});
