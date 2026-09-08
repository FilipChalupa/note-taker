import type { ExportFormat, RecordingDetail } from "@note-taker/shared";
import { groupTurns, speakerLabel } from "./format";

function ts(sec: number, sep: "," | "."): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(r).padStart(3, "0")}`;
}

function clock(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function exportTranscript(rec: RecordingDetail, format: ExportFormat): { body: string; mime: string; ext: string } {
  const name = (id: string) => speakerLabel(id, rec.speakers, rec.speakerNames);
  const turns = groupTurns(rec.segments);

  switch (format) {
    case "txt": {
      const body = turns
        .map((t) => `[${clock(t.start)}] ${name(t.speaker)}: ${t.segments.map((s) => s.text).join(" ")}`)
        .join("\n\n");
      return { body: body + "\n", mime: "text/plain; charset=utf-8", ext: "txt" };
    }
    case "md": {
      const head = [
        `# ${rec.title}`,
        "",
        `- Datum: ${new Date(rec.createdAt).toLocaleString("cs-CZ")}`,
        `- Délka: ${clock(rec.durationSec ?? 0)}`,
        `- Mluvčí: ${rec.speakers.map(name).join(", ") || "–"}`,
        "",
        "---",
        "",
      ].join("\n");
      const body = turns
        .map((t) => `**${name(t.speaker)}** _(${clock(t.start)})_\n\n${t.segments.map((s) => s.text).join(" ")}`)
        .join("\n\n");
      return { body: head + body + "\n", mime: "text/markdown; charset=utf-8", ext: "md" };
    }
    case "srt": {
      const body = rec.segments
        .map((s, i) => `${i + 1}\n${ts(s.start, ",")} --> ${ts(s.end, ",")}\n${name(s.speaker)}: ${s.text}`)
        .join("\n\n");
      return { body: body + "\n", mime: "application/x-subrip; charset=utf-8", ext: "srt" };
    }
    case "vtt": {
      const body = rec.segments
        .map((s) => `${ts(s.start, ".")} --> ${ts(s.end, ".")}\n<v ${name(s.speaker)}>${s.text}`)
        .join("\n\n");
      return { body: `WEBVTT\n\n${body}\n`, mime: "text/vtt; charset=utf-8", ext: "vtt" };
    }
  }
}

export function safeFilename(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80) || "prepis";
}
