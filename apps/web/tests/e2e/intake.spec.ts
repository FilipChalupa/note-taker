import { expect, test } from "@playwright/test";
import { INTAKE_CODE, INTAKE_TOKEN, INTAKE_URL } from "./constants";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isolate } from "./helpers";

isolate();

const INTAKE = INTAKE_URL;
const CODE = INTAKE_CODE;

/** 2.5 MB of audio so the upload spans several 1 MB chunks. */
function mediumAudio(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "intake-audio-"));
  const file = path.join(dir, "board-meeting.wav");
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=80", "-ac", "1", "-ar", "16000", file]);
  return file;
}

test.describe("public intake", () => {
  test("access code gate, chunked upload with progress, collected into the web app", async ({ page, request }) => {
    const origins = new Set<string>();
    page.on("request", (r) => origins.add(new URL(r.url()).origin));

    await page.goto(INTAKE);
    await expect(page.getByRole("heading", { name: "Access code" })).toBeVisible();
    await page.getByLabel("Code").fill("wrong");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText("not correct");
    await page.getByLabel("Code").fill(CODE);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Send a recording" })).toBeVisible();

    await page.getByPlaceholder("e.g. Weekly sync").fill("Board meeting from intake");
    await page.getByPlaceholder("Context, participants, anything useful…").fill("Sent by the assistant");
    await page.locator("#file-input").setInputFiles(mediumAudio());
    const item = page.locator("#queue li").first();
    await expect(item).toContainText("board-meeting.wav");
    await expect(item).toContainText(/Sent for processing · code [0-9A-F]{8}/, { timeout: 30_000 });
    const reference = (await item.textContent())!.match(/code ([0-9A-F]{8})/)![1];

    // The intake page talked to nobody but itself
    expect([...origins]).toEqual([INTAKE]);

    // The web app pulls it (INTAKE_POLL_SECONDS=1) and the intake forgets it
    await expect
      .poll(async () => ((await (await request.get("/api/recordings?view=all")).json()) as { title: string }[]).some((r) => r.title === "Board meeting from intake"), { timeout: 30_000 })
      .toBeTruthy();
    const rec = ((await (await request.get("/api/recordings?view=all")).json()) as { id: string; title: string; tags: string[] }[]).find((r) => r.title === "Board meeting from intake")!;
    expect(rec.tags).toContain("intake");
    const detail = await (await request.get(`/api/recordings/${rec.id}`)).json();
    expect(detail.notes).toContain("Sent by the assistant");
    expect(detail.notes).toContain(`Intake ${reference}`);
    expect(detail.originalFilename).toBe("board-meeting.wav");
    await expect.poll(async () => (await (await request.get("/api/intake")).json()).pending, { timeout: 15_000 }).toBe(0);
    const collectorView = await fetch(`${INTAKE}/collect/v1/items`, { headers: { Authorization: `Bearer ${INTAKE_TOKEN}` } });
    expect(((await collectorView.json()) as { items: unknown[] }).items).toHaveLength(0);

    // Settings shows the intake status
    await page.goto("/settings");
    await expect(page.getByTestId("intake")).toContainText("Public recording intake");
    await expect(page.getByTestId("intake")).toContainText("127.0.0.1:8090");
  });

  test("record in the browser and send; the page never reveals anything about the system", async ({ page, context }) => {
    await context.grantPermissions(["microphone"], { origin: INTAKE });
    await page.goto(`${INTAKE}/?code=${CODE}`);
    await expect(page.getByRole("heading", { name: "Send a recording" })).toBeVisible();
    expect(new URL(page.url()).search).toBe(""); // the code is removed from the address bar

    const pageText = (await page.locator("body").innerText()).toLowerCase();
    for (const word of ["gpu", "cuda", "worker", "speaker", "recordings in", "vram"]) expect(pageText).not.toContain(word);
    const config = await (await fetch(`${INTAKE}/api/config`)).json();
    expect(Object.keys(config).sort()).toEqual(["accept", "chunkBytes", "codeRequired", "defaultLanguage", "languages", "maxBytes", "title"]);

    await page.getByRole("tab", { name: "Record" }).click();
    await page.getByRole("button", { name: /Start recording/ }).click();
    await page.waitForTimeout(2500);
    await expect(page.locator("#rec-timer")).not.toHaveText("0:00:00");
    await page.getByRole("button", { name: /Stop and send/ }).click();
    await expect(page.locator("#queue li").first()).toContainText(/Sent for processing/, { timeout: 20_000 });
  });

  test("the microphone test judges a few seconds of talking, noise suppression is remembered", async ({ page, context }) => {
    await context.grantPermissions(["microphone"], { origin: INTAKE });
    await page.addInitScript(() => {
      const w = window as unknown as { __voice: number; __frame: number; __constraints: unknown };
      w.__voice = 0.1;
      w.__frame = 0;
      const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) => {
        w.__constraints = c;
        return open(c);
      };
      AnalyserNode.prototype.getFloatTimeDomainData = function (array: Float32Array) {
        const n = w.__frame++;
        const talking = n > 20 && n % 8 !== 7;
        const amp = talking ? w.__voice : 0.002;
        for (let i = 0; i < array.length; i++) array[i] = amp * (i % 2 ? 1 : -1);
      };
    });
    await page.clock.install();
    await page.goto(`${INTAKE}/?code=${CODE}`);
    await page.getByRole("tab", { name: "Record" }).click();
    const note = page.locator("#mic-test");
    const runTest = async () => {
      await page.getByRole("button", { name: "Test the microphone" }).click();
      await expect(note).toContainText("Stay quiet for a moment");
      await expect(page.getByRole("button", { name: /Start recording/ })).toBeDisabled();
      await expect(async () => {
        await page.clock.runFor(2_000);
        await expect(note).toHaveAttribute("data-verdict", /.+/, { timeout: 500 });
      }).toPass({ timeout: 20_000 });
    };
    await runTest();
    await expect(note).toHaveAttribute("data-verdict", "ok");
    await expect(note).toContainText("The microphone is fine: speech -20 dB, noise margin 34 dB.");
    expect(await page.evaluate(() => (window as unknown as { __constraints: { audio: { noiseSuppression: boolean } } }).__constraints.audio.noiseSuppression)).toBe(false);

    await page.getByLabel(/Suppress noise/).check();
    await page.reload();
    await page.getByRole("tab", { name: "Record" }).click();
    await expect(page.getByLabel(/Suppress noise/)).toBeChecked();
    // the voice barely above the noise (set after the reload: the init script starts from a clear voice)
    await page.evaluate(() => {
      const w = window as unknown as { __voice: number; __frame: number };
      w.__voice = 0.006;
      w.__frame = 0;
    });
    await runTest();
    await expect(note).toHaveAttribute("data-verdict", "noisy");
    await expect(note).toContainText("Speech is only 10 dB above the noise");
    expect(await page.evaluate(() => (window as unknown as { __constraints: { audio: { noiseSuppression: boolean } } }).__constraints.audio.noiseSuppression)).toBe(true);
  });

  test("an interrupted recording is offered for sending after a reload", async ({ page, context }) => {
    await context.grantPermissions(["microphone"], { origin: INTAKE });
    await page.goto(`${INTAKE}/?code=${CODE}`);
    await page.getByPlaceholder("e.g. Weekly sync").fill("Crashed intake recording");
    await page.getByRole("tab", { name: "Record" }).click();
    await page.getByRole("button", { name: /Start recording/ }).click();
    await page.waitForTimeout(3000);
    page.on("dialog", (d) => d.accept());
    await page.reload();
    const banner = page.locator("[data-testid=recovery]");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Crashed intake recording");
    await banner.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("#queue li").first()).toContainText(/Sent for processing/, { timeout: 20_000 });
  });

  test("Czech UI and phone layout", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "cs-CZ", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`${INTAKE}/?code=${CODE}`);
    await expect(page.getByRole("heading", { name: "Odeslat nahrávku" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await ctx.close();
  });
});
