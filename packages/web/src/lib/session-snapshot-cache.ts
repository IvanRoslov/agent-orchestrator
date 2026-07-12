/** Default reuse window for a completed enrichment. */
export const SNAPSHOT_CACHE_TTL_MS = 2_000;

interface CacheEntry<T> {
  timestamp: number; // ms — when `value` was computed
  value?: T; // present once resolved
  promise?: Promise<T>; // present while an enrichment is in flight
}

const cache = new Map<string, CacheEntry<unknown>>();

/** Clear all cached snapshots. Test hook. */
export function resetSnapshotCache(): void {
  cache.clear();
}

/**
 * Run `compute` for `scopeKey`, coalescing concurrent callers onto one
 * in-flight promise (single-flight) and reusing a completed result for
 * `ttlMs`. Rejections are not cached — the next call retries.
 */
export function getEnrichedSnapshot<T>(
  scopeKey: string,
  compute: () => Promise<T>,
  now: () => number = Date.now,
  ttlMs: number = SNAPSHOT_CACHE_TTL_MS,
): Promise<T> {
  const existing = cache.get(scopeKey) as CacheEntry<T> | undefined;
  const startedAt = now();
  if (existing) {
    if (existing.promise) return existing.promise; // in flight → share it
    if (startedAt - existing.timestamp < ttlMs) {
      return Promise.resolve(existing.value as T); // fresh enough → reuse
    }
  }

  const promise = compute()
    .then((value) => {
      cache.set(scopeKey, { timestamp: now(), value });
      return value;
    })
    .catch((err) => {
      const current = cache.get(scopeKey);
      if (current?.promise === promise) cache.delete(scopeKey);
      throw err;
    });

  cache.set(scopeKey, { timestamp: startedAt, promise });
  return promise;
}
