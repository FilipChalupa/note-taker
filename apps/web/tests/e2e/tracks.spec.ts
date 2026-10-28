import { expect, test } from "@playwright/test";
import { isolate, obsFile, uploadRecording, waitForStatus } from "./helpers";

isolate();

test("multi-track: the mix is skipped, each track is transcribed on its own and can be named", async ({ page, request }) => {
  const rec = await waitForStatus(request, (await uploadRecording(request, "OBS meeting", {}, obsFile())).id, ["COMPLETED"]);
  expect(rec.tracks.map((t: { role: string; used: boolean }) => [t.role, t.used])).toEqual([
    ["mix", false],
    ["speech", true],
    ["speech", true],
  ]);
  // two speakers per track from the stub, numbered across tracks
  expect(rec.speakers).toEqual(["SPEAKER_00", "SPEAKER_01", "SPEAKER_02", "SPEAKER_03"]);
  expect(rec.segments.map((s: { track: number }) => s.track)).toEqual([1, 1, 2, 2]);

  await page.goto(`/recordings/${rec.id}`);
  const tracks = page.getByTestId("tracks");
  await expect(tracks.getByTestId("track-0")).toContainText("Mix of the other tracks");
  await expect(tracks.getByTestId("track-1")).toContainText("Speaker 1");

  // name the microphone track and say it has one person: speakers only, the transcript stays
  await tracks.getByTestId("edit-tracks").click();
  const mic = page.getByTestId("track-edit-2");
  await mic.getByLabel("Name").fill("Filip");
  await mic.getByLabel("Speakers").selectOption("1");
  await page.getByTestId("tracks-speakers-only").click();
  const after = await waitForStatus(request, rec.id, ["COMPLETED"]);
  expect(after.tracks[2]).toMatchObject({ name: "Filip", max_speakers: 1, speakers: ["SPEAKER_02"] });
  expect(after.speakerNames).toEqual({ SPEAKER_02: "Filip" });
  await page.reload();
  await expect(page.getByTestId("tracks").getByTestId("track-2")).toContainText("Filip");

  // choosing other streams needs a new transcript: speakers-only is disabled, reprocess uses the choice
  await page.getByTestId("edit-tracks").click();
  await page.getByTestId("track-edit-1").getByRole("checkbox").uncheck();
  await expect(page.getByTestId("tracks-speakers-only")).toBeDisabled();
  await page.getByTestId("tracks-submit").click();
  const again = await waitForStatus(request, rec.id, ["COMPLETED"], 30_000);
  expect(again.trackConfig.map((t: { index: number; use: boolean }) => [t.index, t.use])).toEqual([
    [0, false],
    [1, false],
    [2, true],
  ]);
  expect(again.tracks.filter((t: { used: boolean }) => t.used).map((t: { index: number }) => t.index)).toEqual([2]);
  expect(again.speakerNames).toEqual({ SPEAKER_00: "Filip" });
});

test("multi-track: the API takes the tracks with the upload", async ({ request }) => {
  const tracks = JSON.stringify([{ index: 1, name: "Online" }, { index: 2, name: "Filip", max_speakers: 1 }]);
  const rec = await waitForStatus(request, (await uploadRecording(request, "Chosen tracks", { tracks }, obsFile())).id, ["COMPLETED"]);
  expect(rec.tracks.map((t: { name: string | null; used: boolean }) => [t.name, t.used])).toEqual([
    [null, false],
    ["Online", true],
    ["Filip", true],
  ]);
  expect(rec.speakerNames).toEqual({ SPEAKER_02: "Filip" });
  const bad = await request.post("/api/recordings", {
    multipart: { file: { name: "x.mka", mimeType: "audio/x-matroska", buffer: Buffer.from("x") }, tracks: "[{\"index\": 0, \"use\": false}]" },
  });
  expect(bad.status()).toBe(400);
});
