export type BaseLayerCacheRecord = {
  dataUrl?: string | null;
  cacheExpiresAt?: Date | string | null;
  downloadStatus: "pending" | "downloading" | "completed" | "failed";
  refreshFailureCount?: number | null;
  retryAfter?: Date | string | null;
  lastRefreshAttemptAt?: Date | string | null;
  errorMessage?: string | null;
};

export type BaseLayerCacheState = "missing" | "fresh" | "stale" | "refreshing" | "backoff" | "failed";

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function computeRetryAfter(failureCount: number, now = new Date()) {
  const safeFailureCount = Math.max(1, Math.min(16, Math.floor(failureCount)));
  const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (safeFailureCount - 1));
  return new Date(now.getTime() + delay);
}

export function isBackoffActive(record: BaseLayerCacheRecord, now = new Date()) {
  const retryAfter = asDate(record.retryAfter);
  return Boolean(retryAfter && retryAfter.getTime() > now.getTime());
}

export function classifyBaseLayerCache(record: BaseLayerCacheRecord, now = new Date()): BaseLayerCacheState {
  if (record.downloadStatus === "downloading") return "refreshing";
  if (record.downloadStatus === "failed" && isBackoffActive(record, now)) return "backoff";
  if (record.downloadStatus === "failed") return record.dataUrl ? "stale" : "failed";
  if (!record.dataUrl) return "missing";
  const expiresAt = asDate(record.cacheExpiresAt);
  return expiresAt && expiresAt.getTime() > now.getTime() ? "fresh" : "stale";
}

export function canRefreshBaseLayer(record: BaseLayerCacheRecord | undefined, forceUpdate: boolean, now = new Date()) {
  if (!record) return { allowed: true as const, reason: null };
  if (forceUpdate) return { allowed: true as const, reason: null };
  if (isBackoffActive(record, now)) {
    const retryAfter = asDate(record.retryAfter)!;
    return { allowed: false as const, reason: `Atualização adiada por backoff até ${retryAfter.toISOString()}`, retryAfter };
  }
  return { allowed: true as const, reason: null };
}
