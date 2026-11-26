/**
 * Tiny in-memory TTL cache so navigating between pages does not refetch
 * master / stock summary on every mount.
 */

const store = new Map();

export function cachedFetch(key, fetcher, ttlMs = 60_000) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit?.data !== undefined && now - hit.at < ttlMs) {
    return Promise.resolve(hit.data);
  }
  if (hit?.pending) return hit.pending;

  const pending = Promise.resolve()
    .then(fetcher)
    .then((data) => {
      store.set(key, { at: Date.now(), data });
      return data;
    })
    .catch((err) => {
      store.delete(key);
      throw err;
    });

  store.set(key, { ...(hit || {}), at: hit?.at || 0, pending });
  return pending;
}

export function invalidateResourceCache(key) {
  if (!key) {
    store.clear();
    return;
  }
  store.delete(key);
}

export const CACHE_KEYS = {
  master: "master",
  stockSummary: "stockSummary",
};
