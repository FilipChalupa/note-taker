import { expect, test } from "@playwright/test";
import { completedRecording, uploadRecording } from "./helpers";

test("split a sentence at the cursor and edit its times", async ({ page, request }) => {
  const rec = await completedRecording(request, "Split test");
  expect(rec.segments).toHaveLength(3);
  await page.goto(`/recordings/${rec.id}`);

  // "Ahoj, jak se máš?" -> split after "Ahoj," (word timestamps exist, boundary comes from them)
  await page.locator("p span[title]").nth(0).dblclick();
  const editor = page.getByTestId("segment-editor");
  await expect(editor).toBeVisible();
  const ta = editor.locator("textarea");
  await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(5, 5));
  await ta.press("Control+Enter");
  await expect(page.locator("p span[title]")).toHaveCount(4);
  const after = await (await request.get(`/api/recordings/${rec.id}`)).json();
  expect(after.segments[0].text).toBe("Ahoj,");
  expect(after.segments[1].text).toBe("jak se máš?");
  expect(after.segments[0].end).toBeGreaterThan(0.5);
  expect(after.segments[0].end).toBeLessThan(0.6); // between "Ahoj," (0.5) and "jak" (0.6)
  expect(after.segments[1].start).toBe(after.segments[0].end);
  expect(after.segments[1].words[0].word).toBe("jak");

  // undo restores the original three segments
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(page.locator("p span[title]")).toHaveCount(3);

  // edit times through the editor fields; words get rescaled into the new range
  await page.locator("p span[title]").nth(1).dblclick();
  await page.getByLabel("Start").fill("0:02.0");
  await page.getByLabel("End").fill("0:06.0");
  await page.getByTestId("segment-editor").getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await (await request.get(`/api/recordings/${rec.id}`)).json()).segments[1].start).toBe(2);
  const edited = await (await request.get(`/api/recordings/${rec.id}`)).json();
  expect(edited.segments[1].end).toBe(6);
  expect(edited.segments[1].words[0].start).toBe(2);
  expect(edited.segments[1].words.at(-1).end).toBe(6);

  // API validation: end never before start
  const r = await request.patch(`/api/recordings/${rec.id}/segments`, { data: { edits: [{ index: 2, start: 7, end: 3 }] } });
  const fixed = (await r.json()).segments[2];
  expect(fixed.end).toBeGreaterThan(fixed.start);
});

test("keyboard navigation in the list drives selection and bulk actions", async ({ page, request }) => {
  for (const t of ["Key one", "Key two", "Key three"]) await uploadRecording(request, t);
  await page.goto("/?sort=title");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("tr[aria-current='true']")).toHaveCount(1);
  await page.keyboard.press("j");
  await page.keyboard.press(" ");
  await page.keyboard.press("j");
  await page.keyboard.press(" ");
  await expect(page.getByTestId("bulk-toolbar")).toContainText("2 selected");
  await page.keyboard.press("t");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("bulk-toolbar")).toHaveCount(0);
  await page.keyboard.press("Home");
  const first = (await page.locator("tr[aria-current='true'] a").first().getAttribute("href"))!;
  await page.keyboard.press("f");
  await expect(page.locator("tr[aria-current='true']").getByRole("button", { name: "Remove from favorites" })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.waitForURL(first);
});

test("print styles hide chrome and the print button calls window.print", async ({ page, request }) => {
  const rec = await completedRecording(request, "Print test");
  await request.patch(`/api/recordings/${rec.id}`, { data: { notes: "Bring the printed copy.", tags: "print" } });
  await page.addInitScript(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => {
      (window as unknown as { __printed: number }).__printed += 1;
    };
  });
  await page.goto(`/recordings/${rec.id}`);
  await page.getByRole("button", { name: /Export/ }).click();
  await page.getByTestId("print").click();
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);

  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header")).toBeHidden();
  await expect(page.getByRole("button", { name: /Play/ })).toBeHidden();
  await expect(page.getByText("Ahoj, jak se máš?")).toBeVisible();
  await expect(page.locator("p", { hasText: "Bring the printed copy." }).first()).toBeVisible();
  await expect(page.locator("[data-print='aside'] button").first()).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await expect(page.locator("header")).toBeVisible();
});
