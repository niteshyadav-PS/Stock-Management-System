/**
 * Parse page/limit from Express req.query with safe defaults and caps.
 * Returns null when the caller did not ask for pagination (backward compatible
 * full-list responses).
 */
function parsePagination(query = {}, { defaultLimit = 25, maxLimit = 200 } = {}) {
  const hasPage = query.page !== undefined && query.page !== "";
  const hasLimit = query.limit !== undefined && query.limit !== "";
  if (!hasPage && !hasLimit) return null;

  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

/**
 * Run a paginated Mongo find. When pagination is null, returns a plain array
 * (legacy callers). When set, returns { items, total, page, limit }.
 */
async function paginateQuery(Model, filter, { sort, pagination, lean = true } = {}) {
  if (!pagination) {
    let q = Model.find(filter || {});
    if (sort) q = q.sort(sort);
    if (lean) q = q.lean();
    return q;
  }

  const { page, limit, skip } = pagination;
  let q = Model.find(filter || {}).sort(sort || {}).skip(skip).limit(limit);
  if (lean) q = q.lean();

  const [items, total] = await Promise.all([
    q,
    Model.countDocuments(filter || {}),
  ]);

  return { items, total, page, limit };
}

module.exports = { parsePagination, paginateQuery };
