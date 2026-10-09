import { deleteExpiredSessions } from "./db.js";
import { listAggregatedTools } from "./tools.js";

export async function pollOnce(): Promise<void> {
  try {
    await listAggregatedTools();
    await deleteExpiredSessions();
  } catch (error) {
    console.error("poll failed", error instanceof Error ? error.message : error);
  }
}

export function startPoller(): void {
  const interval = Number(process.env.POLL_INTERVAL_MS ?? 10000);
  setInterval(() => {
    void pollOnce();
  }, interval).unref();
}
