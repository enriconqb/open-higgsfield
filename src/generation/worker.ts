import { settleOutstandingJobs } from "./settle";

/* The tick that keeps a studio generation moving when nobody is watching.
   
   Next has no scheduler and this deployment has no queue: the interval below
   lives inside the `next start` process, started once from instrumentation.ts.
   Jobs live in `api_jobs`, so a restart (or a reboot — pm2-root is enabled)
   simply resumes the same rows on the next tick; nothing is held in memory that
   a crash would lose. */

const DEFAULT_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function ensureSettlementWorker(): void {
  if (timer !== null) return;
  if (settlementDisabled()) {
    console.info("[settle] worker disabled by STUDIO_SETTLE_DISABLED");
    return;
  }
  const interval = envNumber("STUDIO_SETTLE_INTERVAL_MS", DEFAULT_INTERVAL_MS);
  console.info("[settle] worker started", { intervalMs: interval });
  timer = setInterval(() => void tick(), interval);
  /* Do not hold the process open on the worker's account: `next start` already
     keeps it alive, and a script that only imports this must still exit. */
  timer.unref?.();
  void tick();
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const summary = await settleOutstandingJobs();
    if (summary.checked > 0) console.info("[settle] tick", summary);
  } catch (caught) {
    /* A database or network hiccup is not fatal: the next tick retries the same
       rows, which stay pending in the table. */
    console.error("[settle] tick failed", caught instanceof Error ? caught.message : caught);
  } finally {
    running = false;
  }
}

function settlementDisabled(): boolean {
  const raw = (process.env.STUDIO_SETTLE_DISABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
