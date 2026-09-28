import { listMeta } from "./api";

/**
 * Download a list in small pages so the first screen can render before the
 * rest of the history arrives. Hostinger drops one huge response.
 */
export async function loadInPages(fetchPage, { pageSize = 500, onUpdate, isCancelled } = {}) {
  const collected = [];
  let page = 1;
  let total = 0;

  while (page <= 200) {
    if (isCancelled?.()) return collected;
    const data = await fetchPage({ page, limit: pageSize });
    const meta = listMeta(data);
    total = meta.total;
    collected.push(...meta.items);
    const complete = meta.items.length === 0 || collected.length >= total;
    onUpdate?.(collected.slice(), { total, complete });
    if (complete) break;
    page += 1;
  }

  return collected;
}
