import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getJobOrders, getJobOrderVendors, unwrapList } from "../api/api";
import { exportXlsx, todayStr } from "../utils/helpers";
import Pagination from "../components/Pagination";
import useClientPagination from "../hooks/useClientPagination";
import { setJobOrderVendorsCache } from "../utils/jobOrderVendors";
import {
  CATEGORY_OPTIONS,
  PIPELINE_STATUSES,
  REPORT_VIEW_MODES,
  collectFilterOptions,
  filterItemRows,
  flattenJobOrdersToItemRows,
  formatReportDate,
  formatReportQty,
  groupItemRows,
  sumItemRows,
} from "../utils/jobOrderReport";

const EMPTY_FILTERS = {
  jobType: "all",
  vendor: "all",
  project: "all",
  item: "",
  category: "all",
  pipeline: "all",
  dateFrom: "",
  dateTo: "",
};

export default function JobOrderReport() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [viewMode, setViewMode] = useState("challan");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [expandedItems, setExpandedItems] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      try {
        const vendors = unwrapList(
          await getJobOrderVendors({ active: "true" }),
        );
        setJobOrderVendorsCache(vendors);
      } catch {
        /* category falls back to name matchers */
      }
      const list = unwrapList(await getJobOrders({}));
      setOrders(list);
    } catch (e) {
      setErr(e.message || "Could not load job orders");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const allRows = useMemo(
    () => flattenJobOrdersToItemRows(orders),
    [orders],
  );

  const filterOptions = useMemo(
    () => collectFilterOptions(allRows),
    [allRows],
  );

  const filteredRows = useMemo(
    () => filterItemRows(allRows, filters),
    [allRows, filters],
  );

  const grouped = useMemo(
    () => groupItemRows(filteredRows, viewMode),
    [filteredRows, viewMode],
  );

  const totals = useMemo(() => sumItemRows(filteredRows), [filteredRows]);

  const challanPage = useClientPagination(
    grouped.mode === "challan" ? grouped.rows || [] : [],
    50,
  );
  const groupPage = useClientPagination(
    grouped.mode !== "challan" ? grouped.groups || [] : [],
    50,
  );

  useEffect(() => {
    challanPage.setPage(1);
    groupPage.setPage(1);
    setExpandedItems(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when filters/view change
  }, [filters, viewMode]);

  function patchFilter(patch) {
    setFilters((f) => ({ ...f, ...patch }));
  }

  function toggleExpand(key) {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exportReport() {
    if (grouped.mode === "challan") {
      exportXlsx(
        [
          "Challan",
          "Date",
          "Type",
          "Vendor",
          "Category",
          "Projects",
          "Items",
          "Lines",
          "Order qty",
          "Ready",
          "Dispatch",
          "Received",
          "Balance",
          "Status",
        ],
        (grouped.rows || []).map((r) => [
          r.srNo,
          formatReportDate(r.date),
          r.jobTypeLabel,
          r.vendorName,
          r.categoryLabel,
          r.projectLabel,
          r.itemLabel,
          r.lineCount,
          r.orderQty,
          r.ready,
          r.dispatch,
          r.received,
          r.balance,
          r.pipeline,
        ]),
        "By Challan",
        `job-order-report-challans-${todayStr()}.xlsx`,
      );
      return;
    }

    const headers = [
      grouped.mode === "item"
        ? "Item"
        : grouped.mode === "vendor"
          ? "Vendor"
          : grouped.mode === "project"
            ? "Project"
            : "Category",
      "Challans",
      "Lines",
      "Order qty",
      "Ready",
      "Dispatch",
      "Received",
      "Balance",
      "Status",
      "Status mix",
    ];
    const sheetRows = [];
    for (const g of grouped.groups || []) {
      sheetRows.push([
        g.label,
        g.challanCount,
        g.lineCount,
        g.orderQty,
        g.ready,
        g.dispatch,
        g.received,
        g.balance,
        g.pipeline,
        g.statusMix,
      ]);
      if (grouped.mode === "item" && g.vendors?.length) {
        for (const v of g.vendors) {
          sheetRows.push([
            `  ↳ ${v.vendorName}`,
            v.challanCount,
            v.lineCount,
            v.orderQty,
            v.ready,
            v.dispatch,
            v.received,
            v.balance,
            v.pipeline,
            v.statusMix,
          ]);
        }
      }
    }
    exportXlsx(
      headers,
      sheetRows,
      `By ${grouped.mode}`,
      `job-order-report-${grouped.mode}-${todayStr()}.xlsx`,
    );
  }

  return (
    <div className="jor-page">
      <div className="pagehead">
        <div className="pagehead-text">
          <h2>Job Order Report</h2>
          <p>
            Track items across vendors, projects, and categories — qty and
            status on every line.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-in btn-sm"
            onClick={exportReport}
            disabled={loading || !filteredRows.length}
          >
            Export Excel
          </button>
        </div>
      </div>

      <div className="card">
        <h3>View</h3>
        <div className="jor-view-tabs">
          {REPORT_VIEW_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={
                viewMode === m.id ? "jor-tab jor-tab-active" : "jor-tab"
              }
              onClick={() => setViewMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <h3 style={{ marginTop: 20 }}>Filters</h3>
        <div className="formgrid jor-filters">
          <div className="field">
            <label>From date</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => patchFilter({ dateFrom: e.target.value })}
            />
          </div>
          <div className="field">
            <label>To date</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => patchFilter({ dateTo: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Job type</label>
            <select
              value={filters.jobType}
              onChange={(e) => patchFilter({ jobType: e.target.value })}
            >
              <option value="all">All</option>
              <option value="powder_coating">Powder Coating</option>
              <option value="fabrication">Fabrication</option>
            </select>
          </div>
          <div className="field">
            <label>Vendor</label>
            <select
              value={filters.vendor}
              onChange={(e) => patchFilter({ vendor: e.target.value })}
            >
              <option value="all">All vendors</option>
              {filterOptions.vendors.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Project</label>
            <select
              value={filters.project}
              onChange={(e) => patchFilter({ project: e.target.value })}
            >
              <option value="all">All projects</option>
              {filterOptions.projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Category</label>
            <select
              value={filters.category}
              onChange={(e) => patchFilter({ category: e.target.value })}
            >
              <option value="all">All categories</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Status</label>
            <select
              value={filters.pipeline}
              onChange={(e) => patchFilter({ pipeline: e.target.value })}
            >
              <option value="all">All statuses</option>
              {PIPELINE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Item search</label>
            <input
              value={filters.item}
              onChange={(e) => patchFilter({ item: e.target.value })}
              placeholder="Description contains…"
            />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Clear filters
          </button>
        </div>
      </div>

      <div className="card card-wide">
        <div className="jor-summary">
          <h3 style={{ margin: 0 }}>
            {REPORT_VIEW_MODES.find((m) => m.id === viewMode)?.label || "Report"}
            <span className="pill-count">
              {viewMode === "challan"
                ? (grouped.rows || []).length
                : (grouped.groups || []).length}
            </span>
          </h3>
          <div className="jor-totals">
            <span>
              Order <strong>{formatReportQty(totals.orderQty)}</strong>
            </span>
            <span>
              Ready <strong>{formatReportQty(totals.ready)}</strong>
            </span>
            <span>
              Dispatch <strong>{formatReportQty(totals.dispatch)}</strong>
            </span>
            <span>
              Received <strong>{formatReportQty(totals.received)}</strong>
            </span>
            <span>
              Balance <strong>{formatReportQty(totals.balance)}</strong>
            </span>
          </div>
        </div>

        {err && (
          <div className="alert err" style={{ marginBottom: 12 }}>
            {err}
          </div>
        )}
        {loading && (
          <div className="empty" style={{ padding: 24 }}>
            Loading…
          </div>
        )}

        {!loading && grouped.mode === "challan" && (
          <>
            <div className="tablewrap jor-tablewrap">
              <table className="jor-table">
                <thead>
                  <tr>
                    <th>Challan</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Vendor</th>
                    <th>Category</th>
                    <th>Projects</th>
                    <th>Items</th>
                    <th className="num">Lines</th>
                    <th className="num">Order</th>
                    <th className="num">Ready</th>
                    <th className="num">Dispatch</th>
                    <th className="num">Received</th>
                    <th className="num">Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {challanPage.pageItems.length === 0 && (
                    <tr>
                      <td colSpan={14} style={{ textAlign: "center", opacity: 0.7 }}>
                        No challans match these filters.
                      </td>
                    </tr>
                  )}
                  {challanPage.pageItems.map((r) => (
                    <tr key={r.key}>
                      <td className="nowrap">{r.srNo || "—"}</td>
                      <td className="nowrap">{formatReportDate(r.date)}</td>
                      <td className="nowrap">{r.jobTypeLabel}</td>
                      <td>{r.vendorName}</td>
                      <td className="nowrap">{r.categoryLabel}</td>
                      <td title={r.projectLabel}>{r.projectLabel}</td>
                      <td title={r.itemLabel}>{r.itemLabel}</td>
                      <td className="num">{r.lineCount}</td>
                      <td className="num">{formatReportQty(r.orderQty)}</td>
                      <td className="num">{formatReportQty(r.ready)}</td>
                      <td className="num">{formatReportQty(r.dispatch)}</td>
                      <td className="num">{formatReportQty(r.received)}</td>
                      <td className="num">{formatReportQty(r.balance)}</td>
                      <td className="nowrap">{r.pipeline}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={challanPage.page}
              pageSize={challanPage.pageSize}
              total={challanPage.total}
              onPageChange={challanPage.setPage}
              onPageSizeChange={challanPage.setPageSize}
            />
          </>
        )}

        {!loading && grouped.mode !== "challan" && (
          <>
            <div className="tablewrap jor-tablewrap">
              <table className="jor-table">
                <thead>
                  <tr>
                    <th>
                      {grouped.mode === "item"
                        ? "Item"
                        : grouped.mode === "vendor"
                          ? "Vendor"
                          : grouped.mode === "project"
                            ? "Project"
                            : "Category"}
                    </th>
                    <th className="num">Challans</th>
                    <th className="num">Lines</th>
                    <th className="num">Order</th>
                    <th className="num">Ready</th>
                    <th className="num">Dispatch</th>
                    <th className="num">Received</th>
                    <th className="num">Balance</th>
                    <th>Status</th>
                    {grouped.mode === "item" && <th style={{ width: 90 }} />}
                  </tr>
                </thead>
                <tbody>
                  {(groupPage.pageItems || []).length === 0 && (
                    <tr>
                      <td
                        colSpan={grouped.mode === "item" ? 10 : 9}
                        style={{ textAlign: "center", opacity: 0.7 }}
                      >
                        No rows match these filters.
                      </td>
                    </tr>
                  )}
                  {(groupPage.pageItems || []).map((g) => (
                    <React.Fragment key={g.key}>
                      <tr>
                        <td>
                          <strong>{g.label}</strong>
                        </td>
                        <td className="num">{g.challanCount}</td>
                        <td className="num">{g.lineCount}</td>
                        <td className="num">{formatReportQty(g.orderQty)}</td>
                        <td className="num">{formatReportQty(g.ready)}</td>
                        <td className="num">{formatReportQty(g.dispatch)}</td>
                        <td className="num">{formatReportQty(g.received)}</td>
                        <td className="num">{formatReportQty(g.balance)}</td>
                        <td title={g.statusMix}>{g.pipeline}</td>
                        {grouped.mode === "item" && (
                          <td>
                            {g.vendors?.length > 0 && (
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                onClick={() => toggleExpand(g.key)}
                              >
                                {expandedItems.has(g.key)
                                  ? "Hide vendors"
                                  : `Vendors (${g.vendors.length})`}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                      {grouped.mode === "item" &&
                        expandedItems.has(g.key) &&
                        (g.vendors || []).map((v) => (
                          <tr key={`${g.key}-${v.key}`} className="jor-child-row">
                            <td style={{ paddingLeft: 28 }}>
                              ↳ {v.vendorName}
                              <span className="jor-child-meta">
                                {" "}
                                · {v.categoryLabel}
                              </span>
                            </td>
                            <td className="num">{v.challanCount}</td>
                            <td className="num">{v.lineCount}</td>
                            <td className="num">{formatReportQty(v.orderQty)}</td>
                            <td className="num">{formatReportQty(v.ready)}</td>
                            <td className="num">{formatReportQty(v.dispatch)}</td>
                            <td className="num">{formatReportQty(v.received)}</td>
                            <td className="num">{formatReportQty(v.balance)}</td>
                            <td title={v.statusMix}>{v.pipeline}</td>
                            <td />
                          </tr>
                        ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={groupPage.page}
              pageSize={groupPage.pageSize}
              total={groupPage.total}
              onPageChange={groupPage.setPage}
              onPageSizeChange={groupPage.setPageSize}
            />
          </>
        )}
      </div>
    </div>
  );
}
