import type { MetadataRoute } from "next";
import { getLocale } from "@/lib/i18n/server";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = await getLocale();
  return {
    name: "Note Taker",
    short_name: "Note Taker",
    description:
      locale === "cs"
        ? "Přepis nahrávek schůzek s rozpoznáním mluvčích"
        : "Meeting transcription with speaker diarization",
    lang: locale,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fafafa",
    theme_color: "#2563eb",
    categories: ["productivity", "utilities"],
    // Installed PWA shows up in the phone's Share sheet for audio/video files (POST -> /share)
    share_target: {
      action: "/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", files: [{ name: "media", accept: ["audio/*", "video/*"] }] },
    },
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      {
        name: locale === "cs" ? "Nahrávat" : "Record",
        url: "/record",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: locale === "cs" ? "Nahrát schůzku" : "Upload meeting",
        url: "/upload",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: locale === "cs" ? "Fronta" : "Queue",
        url: "/queue",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
