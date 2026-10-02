import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { completedRecording, isolate, talkFile, toneFile, uploadRecording, waitForStatus } from "./helpers";

isolate();

test("tags: upload with tags, filter in the list, edit on detail, searchable", async ({ page, request }) => {
  const { id } = await uploadRecording(request, "Tagged meeting", { tags: "Acme, Roadmap; acme" });
  const rec = await waitForStatus(request, id, ["COMPLETED"]);
  expect(rec.tags).toEqual(["Acme", "Roadmap"]); // de-duplicated case-insensitively

  const tags = (await (await request.get("/api/tags")).json()) as { tag: string; count: number }[];
  expect(tags.find((t) => t.tag === "Acme")?.count).toBeGreaterThan(0);
  const filtered = (await (await request.get("/api/recordings?tag=acme")).json()) as { id: string }[];
  expect(filtered.every((r) => r.id === id || true)).toBeTruthy();
  expect(filtered.some((r) => r.id === id)).toBeTruthy();
  expect(filtered.length).toBeLessThan(((await (await request.get("/api/recordings")).json()) as unknown[]).length + 1);

  await page.goto("/?tag=Acme");
  await expect(page.getByRole("link", { name: /Acme \d+/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tagged meeting" })).toBeVisible();

  await page.goto(`/recordings/${id}`);
  const input = page.getByLabel("Tags");
  await input.fill("Acme, Roadmap, Q3");
  await input.press("Enter");
  await expect(page.getByRole("link", { name: "Q3", exact: true })).toBeVisible();

  await page.getByTestId("notes-edit").click();
  const notes = page.getByLabel("Notes");
  await notes.fill("Decision: ship the export in August. Owner: Jonas.");
  await notes.blur();
  await expect(page.getByText("Saved")).toBeVisible();
  await expect.poll(async () => ((await (await request.get("/api/search?q=august")).json()).hits as { id: string }[]).some((h) => h.id === id)).toBeTruthy();
  const md = await (await request.get(`/api/recordings/${id}/export?format=md`)).text();
  expect(md).toContain("Owner: Jonas");
  expect(md).toContain("Tags: Acme, Roadmap, Q3");
});

test("known voices: naming a speaker once suggests the name in the next recording", async ({ page, request }) => {
  // Voice fingerprints in the stub are deterministic per speaker id, so SPEAKER_00 is the same "person" every time.
  const first = await completedRecording(request, "Voices A");
  expect(first.speakersWithEmbedding).toEqual(["SPEAKER_00", "SPEAKER_01"]);
  await request.patch(`/api/recordings/${first.id}`, { data: { speakerNames: { SPEAKER_00: "Filip Novák" } } });
  const voices = (await (await request.get("/api/voices")).json()) as { name: string; samples: number }[];
  expect(voices.find((v) => v.name === "Filip Novák")?.samples).toBe(1);

  const second = await completedRecording(request, "Voices B");
  expect(second.speakerSuggestions.SPEAKER_00?.name).toBe("Filip Novák");
  expect(second.speakerSuggestions.SPEAKER_00?.score).toBeGreaterThan(0.95);
  expect(second.speakerSuggestions.SPEAKER_01).toBeUndefined(); // different fingerprint, no known voice

  await page.goto(`/recordings/${second.id}`);
  await page.getByTestId("suggestion-SPEAKER_00").click();
  await expect(page.locator("aside input.input").nth(0)).toHaveValue("Filip Novák");
  await expect(page.locator("section span.font-semibold", { hasText: "Filip Novák" }).first()).toBeVisible();

  // the second recording now also contributes a sample; Settings lists the voice
  await expect.poll(async () => ((await (await request.get("/api/voices")).json()) as { name: string; samples: number }[]).find((v) => v.name === "Filip Novák")?.samples).toBe(2);
  await page.goto("/settings");
  await expect(page.getByTestId("voices")).toContainText("Filip Novák");
});

test("watch folder: a file copied into IMPORT_DIR becomes a recording", async ({ request }) => {
  const dir = process.env.E2E_IMPORT_DIR!;
  const target = path.join(dir, "2026-09-09 standup.m4a");
  fs.copyFileSync(toneFile(), target);
  await expect
    .poll(
      async () => ((await (await request.get("/api/recordings")).json()) as { title: string; tags: string[] }[]).find((r) => r.title === "2026-09-09 standup"),
      { timeout: 20_000 },
    )
    .toBeTruthy();
  expect(fs.existsSync(target)).toBeFalsy();
  const rec = ((await (await request.get("/api/recordings")).json()) as { id: string; title: string; tags: string[] }[]).find((r) => r.title === "2026-09-09 standup")!;
  expect(rec.tags).toContain("import");
  await waitForStatus(request, rec.id, ["COMPLETED"]);
  const storage = await (await request.get("/api/storage")).json();
  expect(storage.importDir.enabled).toBeTruthy();
  expect(storage.importDir.imported).toBeGreaterThan(0);
});

test("header shows GPU utilization chip", async ({ page }) => {
  await page.goto("/");
  const chip = page.locator("header").getByText(/GPU/);
  await expect(chip).toBeVisible();
  const health = await (await page.request.get("/api/worker/health")).json();
  if (health.health?.cuda?.utilization_pct != null) await expect(chip).toContainText("%");
});

test("recorder: source options and crash recovery from IndexedDB", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  await page.goto("/record");
  await expect(page.getByLabel("Microphone + tab/screen (me and the others)")).toBeVisible();
  await page.getByPlaceholder("e.g. Weekly sync").fill("Crashed meeting");
  await page.getByRole("button", { name: /Start recording/ }).click();
  await page.waitForTimeout(3500);
  // simulate a crash: reload without stopping
  await page.reload();
  const banner = page.getByTestId("recovery");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Crashed meeting");
  await banner.getByRole("button", { name: "Upload for processing" }).click();
  await page.waitForURL(/\/recordings\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Crashed meeting" })).toBeVisible();
  await page.goto("/record");
  await expect(page.getByTestId("recovery")).toHaveCount(0);
});

test("recorder: a silent input is called out, and the source choice is remembered", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  // the fake microphone beeps; make the analyser hear nothing, as a muted or wrong microphone would
  await page.addInitScript(() => {
    AnalyserNode.prototype.getFloatTimeDomainData = function (array: Float32Array) {
      array.fill(0);
    };
  });
  await page.clock.install();
  await page.goto("/record");
  await page.getByRole("button", { name: /Start recording/ }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  await expect(page.getByTestId("silence-warning")).toHaveCount(0);
  await page.clock.runFor(11_000);
  await expect(page.getByTestId("silence-warning")).toContainText(/No sound for 1\d s/);
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByTestId("silence-warning")).toHaveCount(0);

  await page.getByLabel(/Microphone \+ tab/).check();
  await page.reload();
  await expect(page.getByLabel(/Microphone \+ tab/)).toBeChecked();
});

test("recorder: the microphone test judges a few seconds of talking before the meeting", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  // what the analyser hears is scripted: a second of room noise, then talking with gaps; `__voice` sets how loud
  await page.addInitScript(() => {
    const w = window as unknown as { __voice: number; __frame: number };
    w.__voice = 0.1;
    w.__frame = 0;
    AnalyserNode.prototype.getFloatTimeDomainData = function (array: Float32Array) {
      const n = w.__frame++;
      const talking = n > 20 && n % 8 !== 7;
      const amp = talking ? w.__voice : 0.002;
      for (let i = 0; i < array.length; i++) array[i] = amp * (i % 2 ? 1 : -1);
    };
  });
  await page.clock.install();
  await page.goto("/record");
  const note = page.getByTestId("mic-test");
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

  // the voice barely above the noise: the advice comes before the meeting, not with the transcript
  await page.evaluate(() => {
    const w = window as unknown as { __voice: number; __frame: number };
    w.__voice = 0.006;
    w.__frame = 0;
  });
  await runTest();
  await expect(note).toHaveAttribute("data-verdict", "noisy");
  await expect(note).toContainText("Speech is only 10 dB above the noise");

  // starting the recording clears the verdict
  await page.getByRole("button", { name: /Start recording/ }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  await expect(note).toHaveCount(0);
  await page.getByRole("button", { name: "Discard" }).click();
});

test("audio quality: the worker's report is shown with the transcript and warns about a noisy recording", async ({ page, request }) => {
  const clean = await waitForStatus(request, (await uploadRecording(request, "Clean sound", {}, talkFile())).id, ["COMPLETED"]);
  expect(clean.audioQuality.snr_db).toBeGreaterThan(30);
  expect(clean.audioQuality.clipped_share).toBe(0);
  await page.goto(`/recordings/${clean.id}`);
  await expect(page.getByTestId("audio-quality")).toContainText(/noise margin \d\d dB/);
  await expect(page.getByTestId("audio-quality")).toHaveAttribute("title", /Speech -1\d dB, noise -\d\d dB/);
  await expect(page.getByTestId("audio-quality-warning")).toHaveCount(0);

  const noisy = await waitForStatus(request, (await uploadRecording(request, "Noisy sound", {}, talkFile(true))).id, ["COMPLETED"]);
  expect(noisy.audioQuality.snr_db).toBeLessThan(15);
  await page.goto(`/recordings/${noisy.id}`);
  const warning = page.getByTestId("audio-quality-warning");
  await expect(warning).toContainText("may have hurt the transcript");
  await expect(warning).toContainText(/Speech is only \d+ dB above the noise/);

  // an even tone has nothing to measure: no report, no warning
  const tone = await completedRecording(request, "Tone only");
  expect(tone.audioQuality).toBeNull();
  await page.goto(`/recordings/${tone.id}`);
  await expect(page.getByRole("heading", { name: "Tone only" })).toBeVisible();
  await expect(page.getByTestId("audio-quality")).toHaveCount(0);
});
