/** 1 credit = $0.01 of recorded generation cost. */
export function creditsFromUsd(costUsd: number | null | undefined): number {
  if (costUsd == null || !Number.isFinite(costUsd) || costUsd <= 0) return 0;
  return Math.round(costUsd * 100);
}

export function usdFromCredits(credits: number): number {
  if (!Number.isFinite(credits)) return 0;
  return credits / 100;
}

export function formatUsd(credits: number): string {
  return usdFromCredits(credits).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
