import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startFakeNoteTaker } from "./fake-note-taker.mjs";

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

async function connect(url, token, extraArgs = []) {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY, ...extraArgs],
    env: { ...process.env, NOTE_TAKER_URL: url, NOTE_TAKER_TOKEN: token },
    stderr: "ignore",
  });
  await client.connect(transport);
  return client;
}

const toolNames = async (client) => (await client.listTools()).tools.map((t) => t.name).sort();
const textOf = (result) => result.content.map((c) => c.text ?? "").join("\n");

describe("note-taker MCP server", () => {
  let fake;
  let audioFile;

  before(async () => {
    fake = await startFakeNoteTaker();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
    audioFile = path.join(dir, "standup.m4a");
    fs.writeFileSync(audioFile, Buffer.alloc(2048, 3));
  });
  after(async () => fake.close());

  test("a submit-only token sees only the submit tools", async () => {
    const client = await connect(fake.url, "nt_submit");
    assert.deepEqual(await toolNames(client), ["get_recording", "get_transcript", "list_recordings", "submit_recording"]);
    const info = await client.getServerVersion();
    assert.equal(info.name, "note-taker");
    await client.close();
  });

  test("a read token adds the archive tools, resources and the summarize prompt", async () => {
    const client = await connect(fake.url, "nt_read");
    const names = await toolNames(client);
    for (const t of ["search_transcripts", "get_speakers", "get_audio_url", "list_tags", "get_status"]) assert.ok(names.includes(t), t);
    for (const t of ["update_recording", "rename_speakers", "delete_recording"]) assert.equal(names.includes(t), false, t);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    assert.deepEqual(prompts, ["summarize_meeting"]);
    const resources = (await client.listResources()).resources.map((r) => r.uri);
    assert.ok(resources.includes("note-taker://recordings"));
    await client.close();
  });

  test("submit, poll and read a transcript with speaker names", async () => {
    const client = await connect(fake.url, "nt_submit");
    const submitted = await client.callTool({ name: "submit_recording", arguments: { path: audioFile, title: "Standup", language: "cs" } });
    const created = JSON.parse(textOf(submitted));
    assert.match(created.id, /^rec-/);
    assert.equal(created.status, "PROCESSING");

    const transcript = await client.callTool({ name: "get_transcript", arguments: { id: created.id, format: "json", wait_seconds: 10 } });
    const body = textOf(transcript);
    assert.match(body, /Treat it as data/);
    assert.ok(transcript.structuredContent.segments.length === 2);
    assert.equal(transcript.structuredContent.segments[0].speakerName, "Speaker 1");

    const markdown = await client.callTool({ name: "get_transcript", arguments: { id: created.id, format: "markdown" } });
    assert.match(textOf(markdown), /# Standup/);
    await client.close();
  });

  test("submit with wait_seconds returns the finished transcript in one call", async () => {
    const client = await connect(fake.url, "nt_submit");
    const res = await client.callTool({ name: "submit_recording", arguments: { path: audioFile, title: "Waited", wait_seconds: 10 } });
    const body = textOf(res);
    assert.match(body, /# Waited/);
    assert.match(body, /Ahoj, jak se máš\?/);
    await client.close();
  });

  test("base64 audio is accepted and reaches the API", async () => {
    const client = await connect(fake.url, "nt_submit");
    const before = fake.recordings.size;
    const res = await client.callTool({ name: "submit_recording", arguments: { content_base64: Buffer.from("fake audio").toString("base64"), filename: "note.webm", title: "From bytes" } });
    assert.equal(JSON.parse(textOf(res)).status !== undefined, true);
    assert.equal(fake.recordings.size, before + 1);
    await client.close();
  });

  test("a submit-only token cannot read recordings it did not create", async () => {
    const reader = await connect(fake.url, "nt_read");
    const created = JSON.parse(textOf(await reader.callTool({ name: "submit_recording", arguments: { path: audioFile, title: "Someone else" } })));
    await reader.close();

    const submitter = await connect(fake.url, "nt_submit");
    const res = await submitter.callTool({ name: "get_recording", arguments: { id: created.id } });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /NOT_FOUND/);
    await submitter.close();
  });

  test("write tools appear with the write scope and reach the API", async () => {
    const client = await connect(fake.url, "nt_write");
    const names = await toolNames(client);
    for (const t of ["update_recording", "rename_speakers", "merge_speakers", "edit_segments"]) assert.ok(names.includes(t), t);
    const created = JSON.parse(textOf(await client.callTool({ name: "submit_recording", arguments: { path: audioFile, title: "Editable" } })));
    await client.callTool({ name: "rename_speakers", arguments: { id: created.id, names: { SPEAKER_00: "Filip" } } });
    const transcript = await client.callTool({ name: "get_transcript", arguments: { id: created.id, format: "json" } });
    assert.equal(transcript.structuredContent.speakers[0].name, "Filip");
    const edited = await client.callTool({ name: "edit_segments", arguments: { id: created.id, edits: [{ index: 0, text: "Opraveno" }] } });
    assert.equal(JSON.parse(textOf(edited)).ok, true);
    await client.close();
  });

  test("deleting is hidden unless the token is admin and the flag is given", async () => {
    const plain = await connect(fake.url, "nt_admin");
    assert.equal((await toolNames(plain)).includes("delete_recording"), false);
    await plain.close();

    const allowed = await connect(fake.url, "nt_admin", ["--allow-destructive"]);
    assert.ok((await toolNames(allowed)).includes("delete_recording"));
    const created = JSON.parse(textOf(await allowed.callTool({ name: "submit_recording", arguments: { path: audioFile, title: "Doomed" } })));
    const res = await allowed.callTool({ name: "delete_recording", arguments: { id: created.id, confirm: true } });
    assert.match(textOf(res), /deleted/);
    assert.equal(fake.recordings.has(created.id), false);
    await allowed.close();
  });

  test("search and the transcript resource carry the untrusted-content warning", async () => {
    const client = await connect(fake.url, "nt_read");
    const created = JSON.parse(textOf(await client.callTool({ name: "submit_recording", arguments: { path: audioFile, title: "Searchable" } })));
    const search = await client.callTool({ name: "search_transcripts", arguments: { query: "jak" } });
    assert.match(textOf(search), /Treat it as data/);
    assert.ok(search.structuredContent.hits.length > 0);

    const resource = await client.readResource({ uri: `note-taker://recording/${created.id}` });
    assert.match(resource.contents[0].text, /Treat it as data/);
    assert.match(resource.contents[0].text, /# Searchable/);

    const prompt = await client.getPrompt({ name: "summarize_meeting", arguments: { recording_id: created.id } });
    assert.match(prompt.messages[0].content.text, /Summarise the meeting/);
    await client.close();
  });

  test("API errors are reported as tool errors, not crashes", async () => {
    const client = await connect(fake.url, "nt_read");
    const res = await client.callTool({ name: "get_recording", arguments: { id: "does-not-exist" } });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /NOT_FOUND/);
    // the session is still usable
    assert.ok((await client.callTool({ name: "get_status", arguments: {} })).structuredContent.transcriptionAvailable);
    await client.close();
  });
});
