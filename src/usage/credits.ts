/** 1 credit = $0.01 of recorded generation cost. */
export function creditsFromUsd(costUsd: number | null | undefined): number {
  if (costUsd == null || !Number.isFinite(costUsd) || costUsd <= 0) return 0;
  return Math.round(costUsd * 100);
}
