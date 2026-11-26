import { listMeta } from "./api";

/**
 * Download a list in small pages so the first screen can render before the
 * rest of the history arrives. Hostinger drops one huge response.
 * Optional mapPage runs once per page item (avoid remapping the whole list).
 */
export async function loadInPages(
  fetchPage,
  { pageSize = 500, onUpdate, isCancelled, mapPage } = {},
) {
  const collected = [];
  let page = 1;
  let total = 0;

  while (page <= 200) {
    if (isCancelled?.()) return collected;
    const data = await fetchPage({ page, limit: pageSize });
    const meta = listMeta(data);
    total = meta.total;
    const pageItems = mapPage ? meta.items.map(mapPage) : meta.items;
    collected.push(...pageItems);
    const complete = meta.items.length === 0 || collected.length >= total;
    onUpdate?.(collected.slice(), { total, complete });
    if (complete) break;
    page += 1;
  }

  return collected;
}
