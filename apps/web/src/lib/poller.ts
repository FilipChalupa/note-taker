/**
 * Background poller: periodically syncs in-flight recordings with the worker.
 * Started once per Node process from instrumentation.ts; guarded on globalThis
 * so Next.js dev HMR does not start duplicates.
 */
import { config } from "@/lib/config";

type PollerState = { timer: NodeJS.Timeout; running: boolean };
const g = globalThis as unknown as { __noteTakerPoller?: PollerState };

export function ensurePollerStarted(): void {
  if (g.__noteTakerPoller) return;
  const state: PollerState = { running: false, timer: undefined as unknown as NodeJS.Timeout };
  g.__noteTakerPoller = state;

  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      const { syncAll } = await import("@/lib/recordings");
      const { scanImportDir } = await import("@/lib/importer");
      scanImportDir();
      await syncAll();
    } catch (err) {
      console.error("[poller] tick failed:", (err as Error).message);
    } finally {
      state.running = false;
    }
  };

  state.timer = setInterval(tick, config.pollIntervalMs);
  state.timer.unref?.();
  void tick();
  console.log(`[poller] started (every ${config.pollIntervalMs} ms, worker=${config.workerApiUrl}${config.importDir ? `, import=${config.importDir}` : ""})`);
}
