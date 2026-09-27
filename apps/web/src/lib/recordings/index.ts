/**
 * Recording service: persistence, queries, search and orchestration with the worker. Server-side only.
 * Split into modules by concern; this file keeps the public surface in one place.
 */
export { getRecording, getRecordingRow, recordingHead, normalizeTags } from "./core";
export { listRecordings, pageRecordings, getLibraryStats, listTags } from "./queries";
export { indexRecording, searchRecordings } from "./search";
export { retryRecording, rediarizeRecording, dispatch, syncRecording, syncAll } from "./worker-sync";
export { createRecording, createRecordingFromPath, updateRecording, applySpeakerSuggestions, editSegments, editSegmentsPatch, splitSegment, splitSegmentPatch, mergeSpeakers, mergeSpeakersPatch, replaceTranscript, deleteRecording, bulkAction } from "./mutations";
export type { CreateRecordingInput } from "./mutations";
