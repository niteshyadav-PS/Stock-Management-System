/** Short TTL cache for GET /stock/summary (and embed). Invalidate on stock writes. */

const TTL_MS = 60_000;

let cached = null;
let cachedAt = 0;
let pending = null;

function getCachedStockSummary(builder) {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) {
    return Promise.resolve(cached);
  }
  if (pending) return pending;

  pending = Promise.resolve()
    .then(() => builder())
    .then((data) => {
      cached = data;
      cachedAt = Date.now();
      return data;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

function invalidateStockSummaryCache() {
  cached = null;
  cachedAt = 0;
  pending = null;
}

module.exports = {
  getCachedStockSummary,
  invalidateStockSummaryCache,
  STOCK_SUMMARY_TTL_MS: TTL_MS,
};
