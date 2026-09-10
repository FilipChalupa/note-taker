import { expect, test } from "@playwright/test";
import { completedRecording } from "./helpers";

test("dates follow the browser time zone, also in the server-rendered HTML", async ({ browser, request }) => {
  const rec = await completedRecording(request, "Timezone test");
  const expectedTokyo = new Date(rec.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });
  const expectedUtc = new Date(rec.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  expect(expectedTokyo).not.toBe(expectedUtc);

  // with the cookie the server already renders the visitor's zone
  const html = await (await request.get("/", { headers: { Cookie: "tz=Asia/Tokyo", "Accept-Language": "en" } })).text();
  expect(html).toContain(expectedTokyo);

  // a fresh browser in Tokyo: after mount the zone is applied and remembered in a cookie
  const ctx = await browser.newContext({ timezoneId: "Asia/Tokyo", extraHTTPHeaders: { "Accept-Language": "en" } });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("tr", { hasText: "Timezone test" }).first()).toContainText(expectedTokyo);
  const cookies = await ctx.cookies();
  expect(cookies.find((c) => c.name === "tz")?.value).toBe("Asia/Tokyo");
  await ctx.close();
});

test("long transcripts render a window of turns and searches still scroll to matches", async ({ page, request }) => {
  const rec = await completedRecording(request, "Long test");
  const segments = Array.from({ length: 1200 }, (_, i) => ({
    start: i * 3,
    end: i * 3 + 2.5,
    speaker: i % 2 ? "SPEAKER_01" : "SPEAKER_00",
    text: `Sentence number ${i} of the long meeting transcript.`,
  }));
  await request.put(`/api/recordings/${rec.id}/transcript`, { data: { segments, speakers: ["SPEAKER_00", "SPEAKER_01"], speakerNames: {} } });
  await page.goto(`/recordings/${rec.id}`);
  const turns = page.getByTestId("turns");
  await expect(turns).toHaveAttribute("data-virtual", "1");
  const rendered = await page.locator(".turn").count();
  expect(rendered).toBeGreaterThan(5);
  expect(rendered).toBeLessThan(200);

  // in-transcript search jumps far down the list
  await expect(page.getByTestId("transcript-search")).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+f");
  await expect(page.getByTestId("transcript-search")).toBeFocused();
  await page.keyboard.type("Sentence number 1150 ");
  await expect(page.getByTestId("match-count")).toHaveText(/^1 matches/);
  await expect(page.locator("p mark").first()).toBeInViewport();
  await expect(page.getByText("Sentence number 1150 of the long meeting transcript.")).toBeVisible();

  // scrolling to the end renders the last turn
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await expect(page.getByText("Sentence number 1199 of the long meeting transcript.")).toBeVisible();
  expect(await page.locator(".turn").count()).toBeLessThan(200);

  // Enter cycles matches; Esc clears
  await page.getByTestId("transcript-search").fill("Sentence number 2");
  await expect(page.getByTestId("match-count")).toContainText("matches");
  await page.getByTestId("transcript-search").press("Enter");
  await page.getByTestId("transcript-search").press("Escape");
  await expect(page.getByTestId("match-count")).toHaveCount(0);
});

test("processing metrics are shown in Settings", async ({ page, request }) => {
  await completedRecording(request, "Metrics test");
  const m = await (await request.get("/api/worker/metrics")).json();
  expect(m.reachable).toBeTruthy();
  expect(m.worker.totals.completed).toBeGreaterThan(0);
  expect(m.library.recordings).toBeGreaterThan(0);
  await page.goto("/settings");
  const box = page.getByTestId("metrics");
  await expect(box).toContainText("Audio transcribed");
  await expect(box).toContainText("× real time");
  await expect(box).toContainText(/\d+ tasks done/);
});
