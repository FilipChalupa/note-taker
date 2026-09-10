import { expect, test } from "@playwright/test";
import { completedRecording, uploadRecording } from "./helpers";

test("failed actions show a toast instead of silently doing nothing", async ({ page, request }) => {
  const rec = await completedRecording(request, "Toast test");
  await page.goto(`/recordings/${rec.id}`);
  await page.route(`**/api/recordings/${rec.id}?light=1`, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "BOOM" }) }));
  await page.getByRole("button", { name: "Favorite" }).click();
  await expect(page.getByTestId("toast-error")).toContainText("BOOM");
  await page.unroute(`**/api/recordings/${rec.id}?light=1`);
  await page.getByRole("button", { name: "Favorite" }).click();
  await expect(page.getByRole("button", { name: "Remove from favorites" })).toBeVisible();
});

test("edits use light responses and apply patches locally", async ({ page, request }) => {
  const rec = await completedRecording(request, "Light test");
  await page.goto(`/recordings/${rec.id}`);
  const sizes: number[] = [];
  page.on("response", async (res) => {
    if (res.url().includes("/segments?light=1")) sizes.push((await res.body()).length);
  });
  await page.locator("p span[title]").nth(0).dblclick();
  await page.locator("p textarea").fill("Ahoj, jak se máš, Karle?");
  await page.locator("p textarea").press("Enter");
  await expect(page.locator("p span[title]").nth(0)).toContainText("Karle");
  await expect.poll(() => sizes.length).toBeGreaterThan(0);
  const full = JSON.stringify(await (await request.get(`/api/recordings/${rec.id}`)).json()).length;
  expect(sizes[0]).toBeLessThan(full); // head + one segment, not the whole transcript
  // merge via light response keeps the transcript consistent
  page.once("dialog", (d) => d.accept());
  await page.locator("aside select").nth(1).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator("aside input.input")).toHaveCount(1);
  const after = await (await request.get(`/api/recordings/${rec.id}`)).json();
  expect(new Set(after.segments.map((s: { speaker: string }) => s.speaker)).size).toBe(1);
  await expect(page.locator("section span.font-semibold").first()).toHaveText(/Speaker 1/);
});

test("notes render as Markdown and switch to an editor on click", async ({ page, request }) => {
  const rec = await completedRecording(request, "Notes test");
  await request.patch(`/api/recordings/${rec.id}`, { data: { notes: "# Agenda\n\n- **Budget** review\n- [x] Send the deck\n\nSee [docs](https://example.com)." } });
  await page.goto(`/recordings/${rec.id}`);
  const preview = page.getByTestId("notes-preview");
  await expect(preview.getByRole("heading", { name: "Agenda" })).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("Budget");
  await expect(preview.getByRole("checkbox")).toBeChecked();
  await expect(preview.getByRole("link", { name: "docs" })).toHaveAttribute("href", "https://example.com");
  await preview.click();
  await expect(page.getByLabel("Notes")).toBeVisible();
});

test("voices are renamed and deleted through dialogs; single delete in the list asks first", async ({ page, request }) => {
  const rec = await completedRecording(request, "Voice dialog test");
  await request.patch(`/api/recordings/${rec.id}`, { data: { speakerNames: { SPEAKER_00: "Dialog Voice" } } });
  await page.goto("/settings");
  const row = page.getByTestId("voices").locator("li", { hasText: "Dialog Voice" });
  await row.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Renamed Voice");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("voices")).toContainText("Renamed Voice");
  await page.getByTestId("voices").locator("li", { hasText: "Renamed Voice" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toContainText("Renamed Voice");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("toast-success")).toBeVisible();
  expect(((await (await request.get("/api/voices")).json()) as { name: string }[]).some((v) => v.name === "Renamed Voice")).toBeFalsy();

  const other = await uploadRecording(request, "Single delete");
  await page.goto("/?sort=title");
  await page.locator("tr", { hasText: "Single delete" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toContainText("Single delete");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect.poll(async () => (await request.get(`/api/recordings/${other.id}`)).status()).toBe(404);
});

test("player controls and menus are labelled for assistive tech", async ({ page, request }) => {
  const rec = await completedRecording(request, "A11y test");
  await page.goto(`/recordings/${rec.id}`);
  await expect(page.getByRole("button", { name: "−5 s (←)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+5 s (→)" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Export/ })).toHaveAttribute("aria-haspopup", "menu");
  await expect(page.getByRole("slider")).toBeVisible();
});
