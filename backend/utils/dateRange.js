/**
 * Build a Mongo filter for string ISO dates (YYYY-MM-DD) stored on `date`.
 * Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
function isoDateOnly(value) {
  const s = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function dateRangeFilter(query = {}, field = 'date') {
  const from = isoDateOnly(query.from);
  const to = isoDateOnly(query.to);
  if (!from && !to) return {};

  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return { [field]: range };
}

module.exports = { dateRangeFilter, isoDateOnly };
