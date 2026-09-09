import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { completedRecording, toneFile, uploadRecording } from "./helpers";

test("favorites and archive: views, star toggle, archive hides from the default list", async ({ page, request }) => {
  const rec = await completedRecording(request, "Organize me");
  await request.patch(`/api/recordings/${rec.id}`, { data: { favorite: true } });
  const favs = (await (await request.get("/api/recordings?view=favorites")).json()) as { id: string }[];
  expect(favs.some((r) => r.id === rec.id)).toBeTruthy();

  await page.goto("/");
  const row = page.locator("tr", { hasText: "Organize me" });
  await expect(row.getByRole("button", { name: "Remove from favorites" })).toBeVisible();
  await row.getByRole("button", { name: "Archive" }).click();
  await expect(page.locator("tr", { hasText: "Organize me" })).toHaveCount(0);
  const archived = (await (await request.get("/api/recordings?view=archived")).json()) as { id: string; archived: boolean }[];
  expect(archived.find((r) => r.id === rec.id)?.archived).toBeTruthy();
  const active = (await (await request.get("/api/recordings")).json()) as { id: string }[];
  expect(active.some((r) => r.id === rec.id)).toBeFalsy();

  await page.goto("/?view=archived");
  await expect(page.locator("tr", { hasText: "Organize me" })).toBeVisible();
  await page.goto(`/recordings/${rec.id}`);
  await page.getByRole("button", { name: "Restore from archive" }).click();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
});

test("sorting and pagination", async ({ page, request }) => {
  for (const t of ["Zeta", "Alpha", "Mid"]) await uploadRecording(request, `Sort ${t}`);
  const byTitle = (await (await request.get("/api/recordings?sort=title")).json()) as { title: string }[];
  const titles = byTitle.map((r) => r.title).filter((t) => t.startsWith("Sort "));
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, "cs", { sensitivity: "base" })));

  const p1 = await (await request.get("/api/recordings?page=1&pageSize=5")).json();
  expect(p1.items.length).toBeLessThanOrEqual(5);
  expect(p1.total).toBeGreaterThan(0);
  expect(p1.pageSize).toBe(5);
  if (p1.total > 5) {
    const p2 = await (await request.get("/api/recordings?page=2&pageSize=5")).json();
    expect(p2.page).toBe(2);
    expect(p2.items[0]?.id).not.toBe(p1.items[0]?.id);
  }

  await page.goto("/");
  await page.locator("select[aria-label='Sort']").selectOption("title");
  await page.waitForURL(/sort=title/);
  await expect(page.locator("select[aria-label='Sort']")).toHaveValue("title");
});

test("bulk actions: tag, archive and delete selected recordings", async ({ page, request }) => {
  const a = await uploadRecording(request, "Bulk one");
  const b = await uploadRecording(request, "Bulk two");
  await page.goto("/?sort=title");
  await page.getByRole("checkbox", { name: "Bulk one" }).check();
  await page.getByRole("checkbox", { name: "Bulk two" }).check();
  await expect(page.getByTestId("bulk-toolbar")).toContainText("2 selected");
  await page.getByRole("button", { name: /Add tag/ }).click();
  await page.getByPlaceholder("Tag name").fill("workshop");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect.poll(async () => (await (await request.get(`/api/recordings/${a.id}`)).json()).tags).toContain("workshop");
  expect((await (await request.get(`/api/recordings/${b.id}`)).json()).tags).toContain("workshop");

  const res = await request.post("/api/recordings/bulk", { data: { ids: [a.id, b.id], action: "archive" } });
  expect((await res.json()).affected).toBe(2);
  expect((await (await request.get(`/api/recordings/${a.id}`)).json()).archived).toBeTruthy();

  await page.goto("/?view=archived&sort=title");
  await page.getByRole("checkbox", { name: "Bulk one" }).check();
  await page.getByRole("checkbox", { name: "Bulk two" }).check();
  await page.getByRole("button", { name: /Delete \(2\)/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect.poll(async () => (await request.get(`/api/recordings/${a.id}`)).status()).toBe(404);
  expect((await request.get(`/api/recordings/${b.id}`)).status()).toBe(404);
});

test("web share target: shared file becomes a recording", async ({ request }) => {
  const res = await request.post("/share", {
    maxRedirects: 0,
    multipart: {
      media: { name: "voice-memo.m4a", mimeType: "audio/mp4", buffer: fs.readFileSync(toneFile()) },
      title: "Shared from phone",
      text: "Sent from the voice recorder app",
    },
  });
  expect(res.status()).toBe(303);
  const location = res.headers()["location"];
  expect(location).toMatch(/\/recordings\/[0-9a-f-]{36}$/);
  const id = location.split("/").pop()!;
  const rec = await (await request.get(`/api/recordings/${id}`)).json();
  expect(rec.title).toBe("Shared from phone");
  expect(rec.tags).toContain("shared");
  expect(rec.notes).toBe("Sent from the voice recorder app");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.share_target.action).toBe("/share");
});

test("speaker statistics on the detail page and in the Markdown export", async ({ page, request }) => {
  const rec = await completedRecording(request, "Stats test");
  await page.goto(`/recordings/${rec.id}`);
  const stats = page.getByTestId("speaker-stats");
  await expect(stats).toBeVisible();
  await expect(stats).toContainText("%");
  await expect(stats).toContainText("2 speaker changes");
  const md = await (await request.get(`/api/recordings/${rec.id}/export?format=md`)).text();
  expect(md).toMatch(/Speaker statistics: Speaker 1 \d+ %, Speaker 2 \d+ %/);
});

test("glossary learns from corrections", async ({ page, request }) => {
  await request.put("/api/settings", { data: { glossary: "" } });
  const rec = await completedRecording(request, "Glossary test");
  await page.goto(`/recordings/${rec.id}`);
  const seg = page.locator("p span[title]").nth(1); // "Dobře, díky."
  await seg.dblclick();
  await page.locator("p textarea").fill("Dobře, Karlova univerzita.");
  await page.locator("p textarea").press("Enter");
  const banner = page.getByTestId("glossary-suggest");
  await expect(banner).toContainText("Karlova");
  await expect(banner).toContainText("univerzita");
  await banner.getByRole("button", { name: "Add" }).click();
  await expect(banner).toContainText("Added to glossary");
  const glossary = ((await (await request.get("/api/settings")).json()) as { glossary: string }).glossary;
  expect(glossary).toContain("Karlova");
  expect(glossary).toContain("univerzita");
});
