"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

interface DropApi {
  /** File dropped anywhere in the app, waiting for the upload form to consume it. */
  takePendingFile: () => File | null;
}

const Ctx = createContext<DropApi>({ takePendingFile: () => null });

function isFileDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Whole-window drag & drop: dropping a media file on any page stores it and
 * navigates to /upload, where UploadForm picks it up via takePendingFile().
 */
export function DropProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { m } = useI18n();
  const pending = useRef<File | null>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      pending.current = file;
      if (pathname === "/upload") {
        // Same page: let the form pick it up without a navigation
        window.dispatchEvent(new CustomEvent("note-taker:file-dropped"));
      } else {
        router.push("/upload");
      }
    };
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [router, pathname]);

  const takePendingFile = useCallback(() => {
    const f = pending.current;
    pending.current = null;
    return f;
  }, []);

  return (
    <Ctx.Provider value={{ takePendingFile }}>
      {children}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blue-600/10 backdrop-blur-[2px]">
          <div className="rounded-xl border-4 border-dashed border-blue-500 bg-white/90 px-10 py-8 text-center shadow-lg dark:bg-zinc-900/90">
            <div className="text-4xl">🎧</div>
            <div className="mt-2 text-lg font-semibold">{m.upload.dropAnywhere}</div>
            <div className="mt-1 text-sm text-zinc-500">{m.upload.formats}</div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useDroppedFile(): DropApi {
  return useContext(Ctx);
}
