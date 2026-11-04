import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getEmbedMaster, getEmbedStockSummary } from "../api/api";
import { formatNum } from "../utils/helpers";
import { stockRowsFromSummary } from "../utils/stockMaps";

const REFRESH_MS = 60_000;

function stockStatus(row) {
  const stock = Number(row.stock) || 0;
  const min = Number(row.minStock) || 0;
  if (stock < 0) return { id: "negative", label: "Negative" };
  if (min > 0 && stock <= min) return { id: "low", label: "Low" };
  if (stock === 0) return { id: "empty", label: "Empty" };
  return { id: "ok", label: "OK" };
}

export default function EmbedLiveStock() {
  const [params] = useSearchParams();
  const key = String(params.get("key") || "").trim();
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setErr("");
      else setRefreshing(true);
      const [master, summary] = await Promise.all([
        getEmbedMaster(key || undefined),
        getEmbedStockSummary(key || undefined),
      ]);
      const list = Array.isArray(master) ? master : [];
      setRows(stockRowsFromSummary(list, summary));
      setTotals(summary?.totals || null);
      setUpdatedAt(new Date());
      setErr("");
    } catch (e) {
      setErr(e.message || "Failed to load stock");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [key]);

  useEffect(() => {
    load(false);
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        const status = stockStatus(r);
        if (lowOnly && status.id !== "low" && status.id !== "negative" && status.id !== "empty") {
          return false;
        }
        if (!q) return true;
        return (
          String(r.name || "")
            .toLowerCase()
            .includes(q) ||
          String(r.category || "")
            .toLowerCase()
            .includes(q) ||
          String(r.code || "")
            .toLowerCase()
            .includes(q)
        );
      })
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), undefined, {
          sensitivity: "base",
        }),
      );
  }, [rows, search, lowOnly]);

  const lowCount = useMemo(
    () =>
      rows.filter((r) => {
        const s = stockStatus(r);
        return s.id === "low" || s.id === "negative" || s.id === "empty";
      }).length,
    [rows],
  );

  return (
    <div className="embed-stock">
      <div className="embed-stock-shell">
        <header className="embed-stock-head">
          <div className="embed-stock-brand">
            <div className="embed-stock-title-row">
              <h1>Live Stock</h1>
              <span className={`embed-live-pill${refreshing ? " is-busy" : ""}`}>
                <span className="embed-live-dot" aria-hidden />
                Live
              </span>
            </div>
            <p>
              {updatedAt
                ? `Last updated ${updatedAt.toLocaleTimeString()}`
                : "Connecting…"}
              <span className="embed-sep">·</span>
              Auto-refresh every 60s
            </p>
          </div>

          <div className="embed-stock-stats">
            <div className="embed-stat">
              <span>Materials</span>
              <strong>{rows.length.toLocaleString("en-IN")}</strong>
            </div>
            <div className={`embed-stat${lowCount ? " embed-stat-warn" : ""}`}>
              <span>Attention</span>
              <strong>{lowCount.toLocaleString("en-IN")}</strong>
            </div>
            {totals && (
              <div className="embed-stat embed-stat-teal">
                <span>Total In</span>
                <strong>{formatNum(totals.inQty)}</strong>
              </div>
            )}
            {totals && (
              <div className="embed-stat">
                <span>Total Out</span>
                <strong>{formatNum(totals.outQty)}</strong>
              </div>
            )}
          </div>
        </header>

        <div className="embed-stock-toolbar">
          <div className="embed-search-wrap">
            <svg
              className="embed-search-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search material, code, or category…"
              aria-label="Search stock"
            />
          </div>
          <label className="embed-check">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(e) => setLowOnly(e.target.checked)}
            />
            Low / attention only
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm embed-refresh-btn"
            onClick={() => load(true)}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {err && <div className="alert err">{err}</div>}
        {loading && !rows.length && (
          <div className="embed-loading">Loading stock data…</div>
        )}

        {!loading && !err && (
          <div className="tablewrap embed-stock-table">
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Category</th>
                  <th>UOM</th>
                  <th className="num">In</th>
                  <th className="num">Out</th>
                  <th className="num">Stock</th>
                  <th className="num">Min</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="embed-empty-cell">
                      No materials match the current filters.
                    </td>
                  </tr>
                )}
                {filtered.map((r) => {
                  const status = stockStatus(r);
                  return (
                    <tr
                      key={r._id || r.name}
                      className={
                        status.id !== "ok" ? `embed-row-${status.id}` : undefined
                      }
                    >
                      <td>
                        <div className="embed-mat-name">{r.name}</div>
                        {r.code ? (
                          <div className="embed-code">{r.code}</div>
                        ) : null}
                      </td>
                      <td>
                        {r.category ? (
                          <span className="embed-cat">{r.category}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="nowrap">{r.uom || "—"}</td>
                      <td className="num">{formatNum(r.inQty)}</td>
                      <td className="num">{formatNum(r.outQty)}</td>
                      <td className="num embed-stock-qty">
                        {formatNum(r.stock)}
                      </td>
                      <td className="num">{formatNum(r.minStock)}</td>
                      <td>
                        <span className={`embed-badge embed-badge-${status.id}`}>
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !err && (
          <footer className="embed-stock-foot">
            Showing {filtered.length.toLocaleString("en-IN")} of{" "}
            {rows.length.toLocaleString("en-IN")} materials
          </footer>
        )}
      </div>
    </div>
  );
}
