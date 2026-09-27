/**
 * Accepted audio and video containers. The list lives in ../media-extensions.json; apps/intake keeps a copy so it can
 * be deployed on its own, and its tests fail when the copy drifts from this one.
 */
import extensions from "../media-extensions.json";

export const MEDIA_EXTENSIONS: readonly string[] = extensions;

/** Matches a filename with a supported extension. */
export const SUPPORTED_MEDIA = new RegExp(`\\.(${MEDIA_EXTENSIONS.join("|")})$`, "i");

/** Value for an <input type="file" accept>. */
export const MEDIA_ACCEPT = [...MEDIA_EXTENSIONS.map((e) => `.${e}`), "audio/*", "video/*"].join(",");
