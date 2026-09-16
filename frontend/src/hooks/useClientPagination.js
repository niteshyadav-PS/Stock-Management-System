import { useMemo, useState, useEffect, useRef } from "react";

/**
 * Client-side pagination over an already-loaded/filtered array.
 * Resets to page 1 when the filtered list length or page size changes.
 */
export default function useClientPagination(items, initialPageSize = 25) {
  const list = Array.isArray(items) ? items : [];
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const prevTotal = useRef(list.length);

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

  useEffect(() => {
    if (prevTotal.current !== total) {
      prevTotal.current = total;
      setPage(1);
      return;
    }
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [total, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }, [list, page, pageSize]);

  return {
    page,
    pageSize,
    total,
    totalPages,
    pageItems,
    setPage,
    setPageSize: (size) => {
      setPageSize(Number(size) || initialPageSize);
    },
  };
}
