// Intake page: chunked resumable uploads and in-browser recording. Talks only to its own origin (/api/*).
import { recorderStore } from "./recorder-store.js";

const T = {
  cs: {
    gateTitle: "Přístupový kód",
    gateText: "Pro nahrávání zadejte kód, který jste dostali.",
    gateCode: "Kód",
    gateSubmit: "Pokračovat",
    gateWrong: "Kód není správný.",
    tooManyAttempts: "Příliš mnoho pokusů, zkuste to později.",
    heading: "Odeslat nahrávku",
    intro: "Nahrajte audio nebo video soubor, případně nahrávejte přímo zde. Nahrávka se předá k přepisu.",
    tabUpload: "Nahrát soubor",
    tabRecord: "Nahrávat",
    titleLabel: "Název schůzky (volitelné)",
    titlePlaceholder: "Např. Týdenní porada",
    languageLabel: "Jazyk",
    noteLabel: "Poznámka (volitelné)",
    notePlaceholder: "Kontext, účastníci, cokoli užitečného…",
    dropHere: "Přetáhněte soubory sem nebo klikněte pro výběr",
    dropAnywhere: "Pusťte soubor pro nahrání",
    formats: "MP3, M4A, WAV, AAC, OGG, FLAC, MKA, MP4/MOV/MKV (zvuková stopa)…",
    maxSize: "Max. {size} na soubor",
    source: "Zdroj zvuku",
    sourceMic: "Mikrofon",
    sourceDisplay: "Karta prohlížeče nebo obrazovka (online schůzka)",
    sourceBoth: "Mikrofon + karta/obrazovka",
    sourceDisplayHint: "V dialogu vyberte kartu se schůzkou a zaškrtněte „Sdílet zvuk“. Obraz se nenahrává.",
    mic: "Mikrofon",
    micDefault: "Výchozí",
    start: "● Začít nahrávat",
    pause: "❚❚ Pozastavit",
    resume: "▶ Pokračovat",
    stop: "■ Zastavit a odeslat",
    discard: "Zahodit",
    recording: "Nahrává se",
    paused: "Pozastaveno",
    micDenied: "Přístup k mikrofonu byl odepřen.",
    noDisplayAudio: "Sdílení neobsahuje zvuk. Zaškrtněte „Sdílet zvuk“.",
    unsupported: "Tento prohlížeč nahrávání nepodporuje.",
    autosave: "Průběžně se ukládá v prohlížeči, zavření karty nahrávku neztratí.",
    recoveryTitle: "Nalezena neodeslaná nahrávka",
    recoveryText: "Začátek {when}, přibližně {duration}.",
    recoverySend: "Odeslat",
    recoveryDiscard: "Zahodit",
    queue: "Odesílání",
    waiting: "Čeká na odeslání",
    preparing: "Připravuji…",
    uploading: "{done} z {total} · {speed}/s · zbývá ~{eta}",
    finishing: "Dokončuji…",
    retrying: "Spojení přerušeno, zkouším znovu za {s} s…",
    done: "✓ Odesláno ke zpracování · kód {ref}",
    failed: "Odeslání selhalo: {reason}",
    cancelled: "Zrušeno",
    cancel: "Zrušit",
    retry: "Zkusit znovu",
    leaveWarning: "Odesílání ještě probíhá. Opravdu odejít?",
    recordingName: "Nahrávka {when}",
    errors: {
      FILE_TOO_LARGE: "soubor je příliš velký",
      UNSUPPORTED_TYPE: "nepodporovaný typ souboru",
      STORAGE_FULL: "úložiště je plné, zkuste to později",
      RATE_LIMITED: "příliš mnoho nahrávek, zkuste to později",
      CODE_REQUIRED: "neplatný přístupový kód",
      NETWORK: "síťová chyba",
    },
  },
  en: {
    gateTitle: "Access code",
    gateText: "Enter the code you received to upload recordings.",
    gateCode: "Code",
    gateSubmit: "Continue",
    gateWrong: "The code is not correct.",
    tooManyAttempts: "Too many attempts, try again later.",
    heading: "Send a recording",
    intro: "Upload an audio or video file, or record right here. The recording is handed over for transcription.",
    tabUpload: "Upload file",
    tabRecord: "Record",
    titleLabel: "Meeting name (optional)",
    titlePlaceholder: "e.g. Weekly sync",
    languageLabel: "Language",
    noteLabel: "Note (optional)",
    notePlaceholder: "Context, participants, anything useful…",
    dropHere: "Drop files here or click to choose",
    dropAnywhere: "Drop to upload",
    formats: "MP3, M4A, WAV, AAC, OGG, FLAC, MKA, MP4/MOV/MKV (audio track)…",
    maxSize: "Max. {size} per file",
    source: "Audio source",
    sourceMic: "Microphone",
    sourceDisplay: "Browser tab or screen (online meeting)",
    sourceBoth: "Microphone + tab/screen",
    sourceDisplayHint: "In the dialog pick the meeting tab and tick “Share audio”. Video is not recorded.",
    mic: "Microphone",
    micDefault: "Default",
    start: "● Start recording",
    pause: "❚❚ Pause",
    resume: "▶ Resume",
    stop: "■ Stop and send",
    discard: "Discard",
    recording: "Recording",
    paused: "Paused",
    micDenied: "Microphone access was denied.",
    noDisplayAudio: "The shared source has no audio. Tick “Share audio”.",
    unsupported: "This browser cannot record audio.",
    autosave: "Saved continuously in this browser; a closed tab does not lose the recording.",
    recoveryTitle: "Unsent recording found",
    recoveryText: "Started {when}, about {duration}.",
    recoverySend: "Send",
    recoveryDiscard: "Discard",
    queue: "Uploads",
    waiting: "Waiting",
    preparing: "Preparing…",
    uploading: "{done} of {total} · {speed}/s · ~{eta} left",
    finishing: "Finishing…",
    retrying: "Connection lost, retrying in {s} s…",
    done: "✓ Sent for processing · code {ref}",
    failed: "Upload failed: {reason}",
    cancelled: "Cancelled",
    cancel: "Cancel",
    retry: "Retry",
    leaveWarning: "An upload is still running. Leave anyway?",
    recordingName: "Recording {when}",
    errors: {
      FILE_TOO_LARGE: "the file is too large",
      UNSUPPORTED_TYPE: "unsupported file type",
      STORAGE_FULL: "storage is full, try again later",
      RATE_LIMITED: "too many uploads, try again later",
      CODE_REQUIRED: "invalid access code",
      NETWORK: "network error",
    },
  },
};
const LANG_NAMES = {
  cs: { cs: "Čeština", sk: "Slovenština", en: "Angličtina", de: "Němčina", pl: "Polština", fr: "Francouzština", es: "Španělština", it: "Italština", uk: "Ukrajinština", ru: "Ruština", auto: "Rozpoznat automaticky" },
  en: { cs: "Czech", sk: "Slovak", en: "English", de: "German", pl: "Polish", fr: "French", es: "Spanish", it: "Italian", uk: "Ukrainian", ru: "Russian", auto: "Detect automatically" },
};

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

let lang = store.get("intake.lang") || ((navigator.languages || [navigator.language]).some((l) => /^(cs|sk)/i.test(l)) ? "cs" : "en");
let config = null;
let code = new URLSearchParams(location.search).get("code") || store.get("intake.code") || "";

const t = (key, params = {}) => {
  let s = key.split(".").reduce((o, k) => o?.[k], T[lang]) ?? key;
  for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

function fmtBytes(b) {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} kB`;
  return `${b} B`;
}
function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
const fmtWhen = (d) => d.toLocaleString(lang === "cs" ? "cs-CZ" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

function applyI18n() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const b of document.querySelectorAll("[data-lang]")) b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
  if (config) {
    $("max-size").textContent = t("maxSize", { size: fmtBytes(config.maxBytes) });
    const sel = $("meta-language");
    const current = sel.value || store.get("intake.language") || config.defaultLanguage;
    sel.replaceChildren(...config.languages.map((code) => new Option(LANG_NAMES[lang][code] ?? code, code)));
    sel.value = current;
  }
  for (const item of queue) renderItem(item);
  renderRecorder();
}

// ------------------------------------------------------------------ API
class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body || {};
  }
}
async function api(path, init = {}) {
  let res;
  try {
    res = await fetch(path, { ...init, headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(code ? { "X-Upload-Code": code } : {}), ...init.headers } });
  } catch {
    throw new ApiError(0, { error: "NETWORK" });
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

function putChunk(id, offset, blob, onProgress, xhrRef) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PUT", `/api/uploads/${id}?offset=${offset}`);
    if (code) xhr.setRequestHeader("X-Upload-Code", code);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body));
    };
    xhr.onerror = () => reject(new ApiError(0, { error: "NETWORK" }));
    xhr.onabort = () => reject(new ApiError(-1, { error: "ABORTED" }));
    xhr.send(blob);
  });
}

// ---------------------------------------------------------------- queue
const queue = [];
let running = false;

function fingerprint(blob, name) {
  return `${name}|${blob.size}|${blob.lastModified ?? ""}`;
}
const resumeMap = () => JSON.parse(store.get("intake.resume") || "{}");
const saveResume = (fp, id) => {
  const map = resumeMap();
  if (id) map[fp] = id;
  else delete map[fp];
  store.set("intake.resume", JSON.stringify(map));
};

function enqueue(blob, name, { sessionId = null, title } = {}) {
  const item = {
    key: crypto.randomUUID(),
    blob,
    name,
    title: title ?? ($("meta-title").value.trim() || ""),
    note: $("meta-note").value.trim(),
    language: $("meta-language").value,
    sessionId,
    state: "waiting",
    sent: 0,
    speed: 0,
    reference: null,
    error: null,
    retryIn: 0,
    xhr: { current: null },
    cancelled: false,
  };
  queue.push(item);
  const li = document.createElement("li");
  li.dataset.key = item.key;
  li.innerHTML = `<div class="row between gap"><span class="name"></span><span class="actions"></span></div><div class="bar"><div></div></div><div class="state"></div>`;
  $("queue").prepend(li);
  $("queue-heading").hidden = false;
  renderItem(item);
  void pump();
  return item;
}

function renderItem(item) {
  const li = document.querySelector(`[data-key="${item.key}"]`);
  if (!li) return;
  li.className = item.state === "done" ? "done" : item.state === "error" || item.state === "cancelled" ? "error" : "";
  li.querySelector(".name").textContent = item.title ? `${item.title} · ${item.name}` : item.name;
  const size = item.blob.size;
  li.querySelector(".bar > div").style.width = `${size ? Math.min(100, (100 * item.sent) / size) : 0}%`;
  const eta = item.speed > 0 ? (size - item.sent) / item.speed : 0;
  const state = {
    waiting: t("waiting"),
    preparing: t("preparing"),
    uploading: t("uploading", { done: fmtBytes(item.sent), total: fmtBytes(size), speed: fmtBytes(item.speed), eta: fmtDuration(eta) }),
    retrying: t("retrying", { s: item.retryIn }),
    finishing: t("finishing"),
    done: t("done", { ref: item.reference }),
    error: t("failed", { reason: t(`errors.${item.error}`) === `errors.${item.error}` ? item.error : t(`errors.${item.error}`) }),
    cancelled: t("cancelled"),
  }[item.state];
  li.querySelector(".state").textContent = state;
  const actions = li.querySelector(".actions");
  actions.replaceChildren();
  if (["waiting", "preparing", "uploading", "retrying"].includes(item.state)) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "btn small", textContent: t("cancel") });
    b.onclick = () => cancelItem(item);
    actions.append(b);
  } else if (item.state === "error") {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "btn small", textContent: t("retry") });
    b.onclick = () => {
      item.state = "waiting";
      item.error = null;
      renderItem(item);
      void pump();
    };
    actions.append(b);
  }
}

async function cancelItem(item) {
  item.cancelled = true;
  item.xhr.current?.abort();
  if (item.id) await api(`/api/uploads/${item.id}`, { method: "DELETE" }).catch(() => {});
  saveResume(fingerprint(item.blob, item.name), null);
  item.state = "cancelled";
  renderItem(item);
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const item = queue.find((i) => i.state === "waiting");
      if (!item) break;
      await upload(item);
    }
  } finally {
    running = false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upload(item) {
  const { blob } = item;
  const fp = fingerprint(blob, item.name);
  item.state = "preparing";
  renderItem(item);
  try {
    // Resume a previous attempt of the same file (same name, size and modification time)
    item.id = resumeMap()[fp] || null;
    item.sent = 0;
    if (item.id) {
      try {
        item.sent = (await api(`/api/uploads/${item.id}`)).received;
      } catch {
        item.id = null;
      }
    }
    if (!item.id) {
      const created = await api("/api/uploads", {
        method: "POST",
        body: JSON.stringify({ filename: item.name, size: blob.size, mime: blob.type, title: item.title, note: item.note, language: item.language }),
      });
      item.id = created.id;
      saveResume(fp, item.id);
    }
    const chunk = config.chunkBytes;
    let failures = 0;
    let windowStart = performance.now();
    let windowBytes = item.sent;
    while (item.sent < blob.size) {
      if (item.cancelled) return;
      item.state = "uploading";
      const offset = item.sent;
      const part = blob.slice(offset, Math.min(blob.size, offset + chunk));
      try {
        const res = await putChunk(item.id, offset, part, (loaded) => {
          item.sent = offset + loaded;
          const dt = (performance.now() - windowStart) / 1000;
          if (dt > 1) {
            item.speed = (item.sent - windowBytes) / dt;
            windowStart = performance.now();
            windowBytes = item.sent;
          }
          renderItem(item);
        }, item.xhr);
        item.sent = res.received;
        failures = 0;
      } catch (err) {
        if (item.cancelled || err.status === -1) return;
        if (err.status === 409 && Number.isInteger(err.body.received)) {
          item.sent = err.body.received;
          continue;
        }
        if (err.status === 401 || err.status === 404 || err.status === 413 || err.status === 415) throw err;
        failures += 1;
        if (failures > 40) throw err;
        const wait = Math.min(30, 2 ** Math.min(failures, 5));
        item.state = "retrying";
        for (let s = wait; s > 0; s--) {
          item.retryIn = s;
          renderItem(item);
          await sleep(1000);
          if (item.cancelled) return;
        }
        try {
          item.sent = (await api(`/api/uploads/${item.id}`)).received;
        } catch {
          /* keep local offset, the server answers 409 if it differs */
        }
      }
      renderItem(item);
    }
    item.state = "finishing";
    renderItem(item);
    const done = await api(`/api/uploads/${item.id}/complete`, { method: "POST" });
    item.reference = done.reference;
    item.state = "done";
    saveResume(fp, null);
    if (item.sessionId) await recorderStore.deleteSession(item.sessionId).catch(() => {});
  } catch (err) {
    if (err.status === 404) saveResume(fp, null);
    if (err.status === 401) showGate(t("gateWrong"));
    item.state = "error";
    item.error = err.body?.error || err.message;
  } finally {
    renderItem(item);
  }
}

window.addEventListener("beforeunload", (e) => {
  if (queue.some((i) => ["waiting", "preparing", "uploading", "retrying", "finishing"].includes(i.state)) || rec.phase === "recording" || rec.phase === "paused") {
    e.preventDefault();
    e.returnValue = t("leaveWarning");
  }
});

// ----------------------------------------------------------- file input
function addFiles(files) {
  for (const f of files) enqueue(f, f.name);
}
$("file-input").addEventListener("change", (e) => {
  addFiles(e.target.files);
  e.target.value = "";
});
$("dropzone").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("file-input").click();
  }
});
let dragDepth = 0;
const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
document.addEventListener("dragenter", (e) => {
  if (!isFileDrag(e) || $("app").hidden) return;
  e.preventDefault();
  dragDepth++;
  $("drop-overlay").hidden = false;
});
document.addEventListener("dragover", (e) => isFileDrag(e) && e.preventDefault());
document.addEventListener("dragleave", (e) => {
  if (!isFileDrag(e)) return;
  if (--dragDepth <= 0) $("drop-overlay").hidden = true;
});
document.addEventListener("drop", (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $("drop-overlay").hidden = true;
  if (!$("app").hidden) addFiles(e.dataTransfer.files);
});

// ------------------------------------------------------------------ tabs
function selectTab(which) {
  $("tab-upload").setAttribute("aria-selected", String(which === "upload"));
  $("tab-record").setAttribute("aria-selected", String(which === "record"));
  $("panel-upload").hidden = which !== "upload";
  $("panel-record").hidden = which !== "record";
  if (which === "record") void refreshMics();
}
$("tab-upload").onclick = () => selectTab("upload");
$("tab-record").onclick = () => selectTab("record");

// -------------------------------------------------------------- recorder
const rec = { phase: "idle", recorder: null, streams: [], ctx: null, analyser: null, chunks: [], seq: 0, sessionId: null, startedAt: 0, pausedAt: 0, pausedTotal: 0, timer: null, wake: null, error: null };

function renderRecorder() {
  const p = rec.phase;
  $("rec-start").hidden = p !== "idle";
  $("rec-pause").hidden = p !== "recording";
  $("rec-resume").hidden = p !== "paused";
  $("rec-stop").hidden = p === "idle";
  $("rec-discard").hidden = p === "idle";
  $("rec-state").textContent = p === "recording" ? `● ${t("recording")}` : p === "paused" ? t("paused") : " ";
  $("rec-error").hidden = !rec.error;
  $("rec-error").textContent = rec.error || "";
  const source = document.querySelector("input[name=source]:checked")?.value || "mic";
  $("mic-field").hidden = source === "display";
  $("display-hint").hidden = source === "mic";
  for (const r of document.querySelectorAll("input[name=source]")) r.disabled = p !== "idle";
  $("mic").disabled = p !== "idle";
}
document.querySelectorAll("input[name=source]").forEach((r) => (r.onchange = renderRecorder));

async function refreshMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  const sel = $("mic");
  const current = sel.value;
  sel.replaceChildren(new Option(t("micDefault"), ""), ...devices.filter((d) => d.deviceId && d.deviceId !== "default").map((d) => new Option(d.label || d.deviceId.slice(0, 8), d.deviceId)));
  sel.value = current;
}

const pickMime = () => ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m)) || "";

function stopStreams() {
  for (const s of rec.streams) s.getTracks().forEach((tr) => tr.stop());
  rec.streams = [];
  rec.ctx?.close().catch(() => {});
  rec.ctx = null;
  rec.analyser = null;
  clearInterval(rec.timer);
  rec.wake?.release().catch(() => {});
  rec.wake = null;
}

async function startRecording() {
  rec.error = null;
  const source = document.querySelector("input[name=source]:checked")?.value || "mic";
  try {
    let mic = null;
    let display = null;
    if (source !== "display") {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: $("mic").value ? { exact: $("mic").value } : undefined, echoCancellation: source === "both", noiseSuppression: false } });
      void refreshMics();
    }
    if (source !== "mic") {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      display.getVideoTracks().forEach((tr) => tr.stop());
      if (!display.getAudioTracks().length) {
        display.getTracks().forEach((tr) => tr.stop());
        mic?.getTracks().forEach((tr) => tr.stop());
        rec.error = t("noDisplayAudio");
        return renderRecorder();
      }
      display.getAudioTracks()[0].onended = () => (source === "display" ? void stopRecording() : null);
    }
    rec.streams = [mic, display].filter(Boolean);
    rec.ctx = new AudioContext();
    const dest = rec.ctx.createMediaStreamDestination();
    rec.analyser = rec.ctx.createAnalyser();
    rec.analyser.fftSize = 1024;
    for (const s of rec.streams) {
      const node = rec.ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks()));
      node.connect(dest);
      node.connect(rec.analyser);
    }
    const mime = pickMime();
    const mr = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 96000 } : undefined);
    rec.recorder = mr;
    rec.chunks = [];
    rec.seq = 0;
    rec.sessionId = crypto.randomUUID();
    rec.startedAt = Date.now();
    rec.pausedTotal = 0;
    const session = { id: rec.sessionId, startedAt: new Date().toISOString(), title: $("meta-title").value.trim(), mime: mr.mimeType || mime || "audio/webm" };
    if (recorderStore.available()) await recorderStore.createSession(session).catch(() => {});
    mr.ondataavailable = (e) => {
      if (!e.data.size) return;
      rec.chunks.push(e.data);
      if (recorderStore.available()) void recorderStore.appendChunk(rec.sessionId, rec.seq++, e.data).catch(() => {});
    };
    mr.start(1000);
    rec.phase = "recording";
    rec.timer = setInterval(tick, 200);
    try {
      rec.wake = await navigator.wakeLock?.request("screen");
    } catch {
      /* optional */
    }
  } catch (err) {
    stopStreams();
    rec.error = err?.name === "NotAllowedError" ? t("micDenied") : err?.message || String(err);
  }
  renderRecorder();
}

function tick() {
  const elapsed = (Date.now() - rec.startedAt - rec.pausedTotal - (rec.phase === "paused" ? Date.now() - rec.pausedAt : 0)) / 1000;
  const h = Math.floor(elapsed / 3600);
  $("rec-timer").textContent = `${h}:${fmtDuration(elapsed % 3600).padStart(5, "0")}`;
  if (rec.analyser && rec.phase === "recording") {
    const buf = new Uint8Array(rec.analyser.fftSize);
    rec.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += (v - 128) ** 2;
    $("rec-level").style.width = `${Math.min(100, (Math.sqrt(sum / buf.length) / 40) * 100)}%`;
  }
}

function finishRecorder() {
  return new Promise((resolve) => {
    const mr = rec.recorder;
    if (!mr || mr.state === "inactive") return resolve(new Blob(rec.chunks, { type: mr?.mimeType || "audio/webm" }));
    mr.onstop = () => resolve(new Blob(rec.chunks, { type: mr.mimeType || "audio/webm" }));
    mr.stop();
  });
}

function recordingFilename(mime, when) {
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  const stamp = when.toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  return `recording_${stamp}.${ext}`;
}

async function stopRecording() {
  if (rec.phase === "idle") return;
  const started = new Date(rec.startedAt);
  const blob = await finishRecorder();
  stopStreams();
  const sessionId = rec.sessionId;
  rec.phase = "idle";
  rec.recorder = null;
  $("rec-level").style.width = "0";
  renderRecorder();
  if (blob.size) enqueue(blob, recordingFilename(blob.type, started), { sessionId, title: $("meta-title").value.trim() || t("recordingName", { when: fmtWhen(started) }) });
}

$("rec-start").onclick = () => void startRecording();
$("rec-pause").onclick = () => {
  rec.recorder?.pause();
  rec.pausedAt = Date.now();
  rec.phase = "paused";
  renderRecorder();
};
$("rec-resume").onclick = () => {
  rec.recorder?.resume();
  rec.pausedTotal += Date.now() - rec.pausedAt;
  rec.phase = "recording";
  renderRecorder();
};
$("rec-stop").onclick = () => void stopRecording();
$("rec-discard").onclick = async () => {
  await finishRecorder();
  stopStreams();
  if (rec.sessionId && recorderStore.available()) await recorderStore.deleteSession(rec.sessionId).catch(() => {});
  rec.phase = "idle";
  rec.recorder = null;
  $("rec-timer").textContent = "0:00:00";
  renderRecorder();
};

async function showRecoveries() {
  if (!recorderStore.available()) return;
  const sessions = await recorderStore.listSessions().catch(() => []);
  const box = $("recovery");
  box.replaceChildren();
  for (const s of sessions) {
    if (s.id === rec.sessionId) continue;
    const div = document.createElement("div");
    div.className = "recovery";
    div.dataset.testid = "recovery";
    const title = document.createElement("strong");
    title.textContent = t("recoveryTitle");
    const text = document.createElement("div");
    text.className = "small";
    text.textContent = `${t("recoveryText", { when: fmtWhen(new Date(s.startedAt)), duration: fmtDuration(s.chunks) })}${s.title ? ` · „${s.title}“` : ""}`;
    const send = Object.assign(document.createElement("button"), { type: "button", className: "btn primary small", textContent: t("recoverySend") });
    const drop = Object.assign(document.createElement("button"), { type: "button", className: "btn small", textContent: t("recoveryDiscard") });
    send.onclick = async () => {
      const loaded = await recorderStore.loadBlob(s.id);
      div.remove();
      if (loaded) enqueue(loaded.blob, recordingFilename(loaded.session.mime, new Date(s.startedAt)), { sessionId: s.id, title: s.title || t("recordingName", { when: fmtWhen(new Date(s.startedAt)) }) });
    };
    drop.onclick = async () => {
      await recorderStore.deleteSession(s.id);
      div.remove();
    };
    const row = document.createElement("div");
    row.className = "row gap";
    row.style.marginTop = ".5rem";
    row.append(send, drop);
    div.append(title, text, row);
    box.append(div);
  }
}

// ------------------------------------------------------------------ gate
function showGate(message) {
  $("gate").hidden = false;
  $("app").hidden = true;
  $("gate-error").hidden = !message;
  $("gate-error").textContent = message || "";
  $("gate-code").focus();
}
$("gate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  code = $("gate-code").value.trim();
  try {
    await api("/api/code", { method: "POST" });
    store.set("intake.code", code);
    showApp();
  } catch (err) {
    showGate(err.status === 429 ? t("tooManyAttempts") : t("gateWrong"));
  }
});

function showApp() {
  $("gate").hidden = true;
  $("app").hidden = false;
  void showRecoveries();
}

// ------------------------------------------------------------------ boot
for (const b of document.querySelectorAll("[data-lang]")) {
  b.onclick = () => {
    lang = b.dataset.lang;
    store.set("intake.lang", lang);
    applyI18n();
  };
}
$("meta-language").addEventListener("change", (e) => store.set("intake.language", e.target.value));

async function boot() {
  config = await api("/api/config");
  document.querySelectorAll("[data-bind=title]").forEach((el) => (el.textContent = config.title));
  document.title = config.title;
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
  $("tab-record").hidden = !canRecord;
  $("sources").hidden = typeof navigator.mediaDevices?.getDisplayMedia !== "function";
  applyI18n();
  // the code from a shared link is kept, the URL is cleaned so it does not end up in history or screenshots
  if (new URLSearchParams(location.search).has("code")) history.replaceState(null, "", location.pathname);
  if (!config.codeRequired) return showApp();
  if (!code) return showGate();
  try {
    await api("/api/code", { method: "POST" });
    store.set("intake.code", code);
    showApp();
  } catch {
    store.set("intake.code", null);
    code = "";
    showGate();
  }
}
boot().catch((err) => {
  document.querySelector("main").textContent = `Error: ${err.message}`;
});
