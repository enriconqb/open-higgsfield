/**
 * Next calls `register()` once per server instance, which is the only hook this
 * deployment has for "the process is up, start doing background work". The
 * settlement worker lives here so a studio generation keeps being followed
 * after the tab that started it is gone — see src/generation/settle.ts.
 *
 * Node runtime only: the worker talks to MySQL. The build phase is skipped too,
 * so `pnpm build` never opens a database connection.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { ensureSettlementWorker } = await import("./generation/worker");
  ensureSettlementWorker();
}
