export type Locale = "cs" | "en";
export const LOCALES: Locale[] = ["cs", "en"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";

/** Replace `{name}` placeholders. */
export function fmt(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

const cs = {
  appName: "Note Taker",
  nav: { recordings: "Nahrávky", upload: "Nahrát" },
  worker: {
    loading: "Worker: …",
    offline: "Worker offline",
    online: "Worker online",
    inQueue: "{n} ve frontě",
    cpu: "CPU (CUDA nedostupná)",
    model: "Model",
    diarization: "Diarizace",
    on: "zapnuta",
    off: "vypnuta",
  },
  status: { QUEUED: "Ve frontě", PROCESSING: "Zpracovává se", COMPLETED: "Hotovo", FAILED: "Chyba" },
  phase: {
    QUEUED: "Ve frontě",
    WORKER_QUEUE: "Ve frontě workeru ({n}.)",
    WAITING_FOR_WORKER: "Čeká na dostupnost workeru",
    WORKER_UNREACHABLE: "Worker nedostupný, čekám…",
    CONVERTING: "Konverze audia",
    TRANSCRIBING: "Přepis",
    DIARIZING: "Rozpoznávání mluvčích",
    COMPLETED: "Hotovo",
    FAILED: "Chyba",
  },
  errors: {
    ORIGINAL_FILE_MISSING: "Původní soubor už není k dispozici",
    WORKER_UNKNOWN_ERROR: "Neznámá chyba workeru",
    INVALID_FORM: "Neplatný formulář",
    MISSING_FILE: "Chybí audio soubor",
    FILE_TOO_LARGE: "Soubor je příliš velký (max {mb} MB)",
    UNSUPPORTED_TYPE: "Nepodporovaný typ souboru",
    SPEAKER_RANGE: "Minimální počet mluvčích nesmí být větší než maximální",
    NOT_FOUND: "Nenalezeno",
    INVALID_JSON: "Neplatné JSON",
    UNKNOWN_FORMAT: "Neznámý formát",
    NOT_FINISHED: "Přepis ještě není hotový",
    NETWORK: "Nahrávání selhalo (síťová chyba)",
    HTTP: "Chyba {status}",
    LIST_FAILED: "Nepodařilo se načíst seznam: {msg}",
  },
  list: {
    title: "Nahrávky",
    upload: "+ Nahrát schůzku",
    empty: "Zatím žádné nahrávky.",
    emptyCta: "Nahrajte první schůzku",
    name: "Název",
    date: "Datum",
    duration: "Délka",
    speakers: "Mluvčí",
    state: "Stav",
    retry: "Zkusit znovu",
    delete: "Smazat",
    confirmDelete: "Smazat nahrávku „{title}“ včetně přepisu?",
  },
  upload: {
    title: "Nahrát novou schůzku",
    dropHere: "Přetáhněte sem audio nebo klikněte pro výběr",
    formats: "MP3, M4A, WAV, AAC, OGG, FLAC, MP4/MOV (zvuková stopa)…",
    clickToChange: "klikněte pro změnu",
    name: "Název schůzky",
    namePlaceholder: "Např. Týdenní sync 8. 9.",
    language: "Jazyk",
    minSpeakers: "Min. mluvčích",
    maxSpeakers: "Max. mluvčích",
    optional: "volitelné",
    speakersHint: "Odhad počtu mluvčích zpřesní diarizaci. Pokud znáte přesný počet, zadejte stejné číslo do obou polí.",
    selectFile: "Vyberte audio soubor",
    uploading: "Nahrávám na server…",
    handingOver: "Předávám workeru…",
    submit: "Nahrát a přepsat",
    submitting: "Nahrávám…",
  },
  detail: {
    back: "← Nahrávky",
    renameHint: "Kliknutím přejmenujete",
    speakersCount: "{n} mluvčí",
    export: "Export:",
    retry: "Zkusit znovu",
    delete: "Smazat",
    processing: "Zpracovává se…",
    autoRefresh: "Stránka se aktualizuje automaticky. Přepis se zobrazí po dokončení; mezitím si můžete nahrávku poslechnout.",
    failed: "Zpracování selhalo",
    play: "▶ Přehrát",
    pause: "⏸ Pauza",
    playPauseHint: "Přehrát / pauza (mezerník)",
    back5: "−5 s (←)",
    fwd5: "+5 s (→)",
    transcript: "Přepis",
    follow: "Sledovat přehrávání",
    noSpeech: "V nahrávce nebyla rozpoznána žádná řeč.",
    speakers: "Mluvčí",
    noSpeakers: "Bez rozpoznaných mluvčích.",
    saving: "Ukládám…",
    renameNote: "Přejmenování se promítne v přepisu i exportech.",
    exportFormats: { md: "Markdown", txt: "Čistý text", srt: "SRT", vtt: "VTT" },
  },
  speaker: { default: "Mluvčí {n}", unknown: "Neznámý" },
  languages: {
    cs: "Čeština",
    sk: "Slovenština",
    en: "Angličtina",
    de: "Němčina",
    pl: "Polština",
    fr: "Francouzština",
    es: "Španělština",
    it: "Italština",
    uk: "Ukrajinština",
    ru: "Ruština",
    auto: "Automaticky rozpoznat",
  },
  export: { date: "Datum", duration: "Délka", speakers: "Mluvčí" },
  notFound: { title: "Nenalezeno", text: "Tato nahrávka neexistuje nebo byla smazána.", back: "Zpět na přehled" },
  units: { h: "h", min: "min", s: "s" },
};

export type Messages = typeof cs;

const en: Messages = {
  appName: "Note Taker",
  nav: { recordings: "Recordings", upload: "Upload" },
  worker: {
    loading: "Worker: …",
    offline: "Worker offline",
    online: "Worker online",
    inQueue: "{n} queued",
    cpu: "CPU (CUDA unavailable)",
    model: "Model",
    diarization: "Diarization",
    on: "enabled",
    off: "disabled",
  },
  status: { QUEUED: "Queued", PROCESSING: "Processing", COMPLETED: "Done", FAILED: "Failed" },
  phase: {
    QUEUED: "Queued",
    WORKER_QUEUE: "In worker queue (position {n})",
    WAITING_FOR_WORKER: "Waiting for the worker to become available",
    WORKER_UNREACHABLE: "Worker unreachable, waiting…",
    CONVERTING: "Converting audio",
    TRANSCRIBING: "Transcribing",
    DIARIZING: "Identifying speakers",
    COMPLETED: "Done",
    FAILED: "Failed",
  },
  errors: {
    ORIGINAL_FILE_MISSING: "The original file is no longer available",
    WORKER_UNKNOWN_ERROR: "Unknown worker error",
    INVALID_FORM: "Invalid form data",
    MISSING_FILE: "Audio file is missing",
    FILE_TOO_LARGE: "File is too large (max {mb} MB)",
    UNSUPPORTED_TYPE: "Unsupported file type",
    SPEAKER_RANGE: "Minimum number of speakers cannot exceed the maximum",
    NOT_FOUND: "Not found",
    INVALID_JSON: "Invalid JSON",
    UNKNOWN_FORMAT: "Unknown format",
    NOT_FINISHED: "The transcript is not finished yet",
    NETWORK: "Upload failed (network error)",
    HTTP: "Error {status}",
    LIST_FAILED: "Could not load the list: {msg}",
  },
  list: {
    title: "Recordings",
    upload: "+ Upload meeting",
    empty: "No recordings yet.",
    emptyCta: "Upload your first meeting",
    name: "Name",
    date: "Date",
    duration: "Duration",
    speakers: "Speakers",
    state: "Status",
    retry: "Retry",
    delete: "Delete",
    confirmDelete: "Delete recording “{title}” including its transcript?",
  },
  upload: {
    title: "Upload a new meeting",
    dropHere: "Drop an audio file here or click to choose",
    formats: "MP3, M4A, WAV, AAC, OGG, FLAC, MP4/MOV (audio track)…",
    clickToChange: "click to change",
    name: "Meeting name",
    namePlaceholder: "e.g. Weekly sync, Sep 8",
    language: "Language",
    minSpeakers: "Min. speakers",
    maxSpeakers: "Max. speakers",
    optional: "optional",
    speakersHint: "An estimate of the speaker count improves diarization. If you know the exact number, enter it in both fields.",
    selectFile: "Choose an audio file",
    uploading: "Uploading to server…",
    handingOver: "Handing over to worker…",
    submit: "Upload and transcribe",
    submitting: "Uploading…",
  },
  detail: {
    back: "← Recordings",
    renameHint: "Click to rename",
    speakersCount: "{n} speakers",
    export: "Export:",
    retry: "Retry",
    delete: "Delete",
    processing: "Processing…",
    autoRefresh: "This page refreshes automatically. The transcript appears when processing finishes; you can listen to the recording in the meantime.",
    failed: "Processing failed",
    play: "▶ Play",
    pause: "⏸ Pause",
    playPauseHint: "Play / pause (space)",
    back5: "−5 s (←)",
    fwd5: "+5 s (→)",
    transcript: "Transcript",
    follow: "Follow playback",
    noSpeech: "No speech was detected in the recording.",
    speakers: "Speakers",
    noSpeakers: "No speakers detected.",
    saving: "Saving…",
    renameNote: "Renaming is reflected in the transcript and exports.",
    exportFormats: { md: "Markdown", txt: "Plain text", srt: "SRT", vtt: "VTT" },
  },
  speaker: { default: "Speaker {n}", unknown: "Unknown" },
  languages: {
    cs: "Czech",
    sk: "Slovak",
    en: "English",
    de: "German",
    pl: "Polish",
    fr: "French",
    es: "Spanish",
    it: "Italian",
    uk: "Ukrainian",
    ru: "Russian",
    auto: "Detect automatically",
  },
  export: { date: "Date", duration: "Duration", speakers: "Speakers" },
  notFound: { title: "Not found", text: "This recording does not exist or has been deleted.", back: "Back to overview" },
  units: { h: "h", min: "min", s: "s" },
};

export const messages: Record<Locale, Messages> = { cs, en };

/** Parse an Accept-Language header and pick the best supported locale. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^q=([\d.]+)$/.exec(p.trim())).find(Boolean);
      return { tag: tag.toLowerCase(), q: q ? Number(q[1]) : 1, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (base === "cs" || base === "sk") return "cs";
    if (base === "en") return "en";
  }
  return DEFAULT_LOCALE;
}
