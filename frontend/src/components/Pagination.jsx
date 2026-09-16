import React from "react";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * Shared pager for list tables.
 * Props:
 *  - page (1-based), pageSize, total
 *  - onPageChange(page), onPageSizeChange(size)
 */
export default function Pagination({
  page = 1,
  pageSize = 25,
  total = 0,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}) {
  const totalPages = Math.max(1, Math.ceil((Number(total) || 0) / (Number(pageSize) || 25)));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  if (total === 0) {
    return (
      <div className="pagination-bar">
        <span className="pagination-info">No records</span>
      </div>
    );
  }

  return (
    <div className="pagination-bar">
      <span className="pagination-info">
        Showing <strong>{from}</strong>–<strong>{to}</strong> of{" "}
        <strong>{total}</strong>
      </span>

      <div className="pagination-controls">
        {typeof onPageSizeChange === "function" && (
          <label className="pagination-size">
            Rows
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={safePage <= 1}
          onClick={() => onPageChange(1)}
          title="First page"
        >
          «
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          title="Previous"
        >
          ‹ Prev
        </button>
        <span className="pagination-page">
          Page {safePage} / {totalPages}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          title="Next"
        >
          Next ›
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(totalPages)}
          title="Last page"
        >
          »
        </button>
      </div>
    </div>
  );
}
