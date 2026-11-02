/**
 * Read-only Live Stock embed.
 * EMBED_STOCK_TOKEN empty → public (no key).
 * EMBED_STOCK_TOKEN set → require ?key= or X-Embed-Token.
 */
function requireEmbedToken(req, res, next) {
  const expected = String(process.env.EMBED_STOCK_TOKEN || '').trim();
  if (!expected) return next();

  const got = String(
    req.headers['x-embed-token'] ||
      req.query.key ||
      req.query.embedToken ||
      '',
  ).trim();
  if (!got || got !== expected) {
    return res.status(401).json({ error: 'Invalid or missing embed key.' });
  }
  return next();
}

module.exports = { requireEmbedToken };
