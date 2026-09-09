import { expect, test } from "@playwright/test";
import { completedRecording, waitForStatus } from "./helpers";

test("player keeps playing across navigation, word highlight and 3x speed", async ({ page, request }) => {
  const rec = await completedRecording(request, "Player test");
  await page.goto(`/recordings/${rec.id}`);
  await page.getByRole("button", { name: /Play/ }).first().click();
  await page.waitForTimeout(1500);
  await expect(page.locator("span.bg-yellow-300")).toHaveCount(1); // current word
  await page.getByRole("button", { name: "3×" }).first().click();
  expect(await page.evaluate(() => document.querySelector("audio")!.playbackRate)).toBe(3);
  await page.getByRole("link", { name: "Recordings" }).first().click();
  await page.waitForURL("/");
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => !document.querySelector("audio")!.paused)).toBeTruthy();
  await expect(page.getByText("Now playing")).toBeVisible();
});

test("edit text, reassign, merge, undo and rename speakers", async ({ page, request }) => {
  const rec = await completedRecording(request, "Edit test");
  await page.goto(`/recordings/${rec.id}`);

  const first = page.locator("p span[title]").nth(0);
  await first.dblclick();
  await page.locator("p textarea").fill("Ahoj, jak se máš dnes?");
  await page.locator("p textarea").press("Enter");
  await expect(page.locator("p span[title]").nth(0)).toContainText("dnes");

  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(page.locator("p span[title]").nth(0)).toContainText("Ahoj, jak se máš?");

  // turn 0 is SPEAKER_00, who also has turn 2, so a new speaker appears (3 in total)
  await page.locator("select[aria-label='Assign speaker']").nth(0).selectOption("__new__");
  await expect(page.locator("aside input.input")).toHaveCount(3);

  page.once("dialog", (d) => d.accept());
  await page.locator("aside select").nth(2).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator("aside input.input")).toHaveCount(2);

  await page.keyboard.press("Control+z");
  await expect(page.locator("aside input.input")).toHaveCount(3);

  await page.locator("aside input.input").nth(0).fill("Alice");
  await page.locator("aside input.input").nth(0).blur();
  await expect(page.locator("section span.font-semibold", { hasText: "Alice" }).first()).toBeVisible();
  const md = await (await request.get(`/api/recordings/${rec.id}/export?format=md`)).text();
  expect(md).toContain("**Alice**");
});

test("recompute speakers goes through the queue", async ({ page, request }) => {
  const rec = await completedRecording(request, "Rediarize test");
  await page.goto(`/recordings/${rec.id}`);
  await page.getByRole("button", { name: /Recompute speakers/ }).click();
  await page.getByRole("dialog").getByText("Exact count").click();
  await page.getByRole("dialog").locator("input[type=number]").nth(0).fill("3");
  await page.getByRole("dialog").getByRole("button", { name: "Start" }).click();
  const after = await waitForStatus(request, rec.id, ["COMPLETED"]);
  expect(after.speakers).toEqual(["SPEAKER_00", "SPEAKER_01", "SPEAKER_02"]);
  expect(after.segments.map((s: { text: string }) => s.text)).toEqual(rec.segments.map((s: { text: string }) => s.text));
});

test("keyboard shortcuts and copy to clipboard", async ({ page, request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const rec = await completedRecording(request, "Keys test");
  await page.goto(`/recordings/${rec.id}`);
  await page.keyboard.press("j");
  await page.waitForTimeout(300);
  const t1 = await page.evaluate(() => document.querySelector("audio")!.currentTime);
  await page.keyboard.press("j");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.querySelector("audio")!.currentTime)).toBeGreaterThan(t1);
  await page.keyboard.press("Shift+?");
  await expect(page.getByRole("dialog").getByText("Keyboard shortcuts")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Copy/ }).click();
  await page.getByRole("button", { name: "As Markdown" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("# Keys test");
});

test("delete asks for confirmation", async ({ page, request }) => {
  const rec = await completedRecording(request, "Delete test");
  await page.goto(`/recordings/${rec.id}`);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await page.waitForURL("/");
  expect((await request.get(`/api/recordings/${rec.id}`)).status()).toBe(404);
});
