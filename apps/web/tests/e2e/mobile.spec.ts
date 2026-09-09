import { expect, test } from "@playwright/test";
import { completedRecording } from "./helpers";

test("no horizontal overflow and compact mini player on a phone", async ({ page, request }) => {
  const rec = await completedRecording(request, "Mobile test");
  for (const url of ["/", `/recordings/${rec.id}`, "/queue", "/upload", "/record", "/settings"]) {
    await page.goto(url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBeTruthy();
  }
  await page.goto(`/recordings/${rec.id}`);
  await page.getByRole("button", { name: /Play/ }).first().tap();
  await page.getByRole("link", { name: "Recordings" }).first().tap();
  await page.waitForURL("/");
  const bar = page.locator("div.fixed.inset-x-0.bottom-0");
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  expect(box!.height).toBeLessThan(130);
  await expect(bar.locator("select")).toBeVisible();
  const header = await page.locator("header").boundingBox();
  expect(header!.height).toBeLessThan(100);
});

test("recorder page works with the fake microphone", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  await page.goto("/record");
  await page.getByRole("button", { name: /Start recording/ }).tap();
  await page.waitForTimeout(2500);
  await expect(page.locator("div.font-mono").first()).not.toHaveText("0:00:00");
  await page.getByRole("button", { name: /Stop and upload/ }).tap();
  await page.waitForURL(/\/recordings\/[0-9a-f-]{36}$/, { timeout: 20_000 });
});
