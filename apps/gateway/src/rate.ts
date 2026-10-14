export function rateLimitPerMinute(): number {
  const parsed = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

export function rateAllowed(recentCount: number, limit: number): boolean {
  return recentCount < limit;
}
