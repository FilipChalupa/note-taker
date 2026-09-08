export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensurePollerStarted } = await import("@/lib/poller");
    ensurePollerStarted();
  }
}
