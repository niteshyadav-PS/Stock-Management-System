import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getEmbedMaster, getEmbedStockSummary } from "../api/api";
import { formatNum } from "../utils/helpers";
import { stockRowsFromSummary } from "../utils/stockMaps";

const REFRESH_MS = 60_000;

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

  const load = useCallback(async () => {
    try {
      setErr("");
      const [master, summary] = await Promise.all([
        getEmbedMaster(key || undefined),
        getEmbedStockSummary(key || undefined),
      ]);
      const list = Array.isArray(master) ? master : [];
      setRows(stockRowsFromSummary(list, summary));
      setTotals(summary?.totals || null);
      setUpdatedAt(new Date());
    } catch (e) {
      setErr(e.message || "Failed to load stock");
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (lowOnly && !(r.minStock > 0 && r.stock <= r.minStock)) return false;
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
    () => rows.filter((r) => r.minStock > 0 && r.stock <= r.minStock).length,
    [rows],
  );

  return (
    <div className="embed-stock">
      <header className="embed-stock-head">
        <div>
          <h1>Live Stock</h1>
          <p>
            {updatedAt
              ? `Updated ${updatedAt.toLocaleTimeString()}`
              : "Loading…"}
            {" · "}auto-refresh every 60s
          </p>
        </div>
        <div className="embed-stock-stats">
          <div className="embed-stat">
            <span>Materials</span>
            <strong>{rows.length}</strong>
          </div>
          <div className="embed-stat">
            <span>Low stock</span>
            <strong>{lowCount}</strong>
          </div>
          {totals && (
            <div className="embed-stat">
              <span>In qty</span>
              <strong>{formatNum(totals.inQty)}</strong>
            </div>
          )}
          {totals && (
            <div className="embed-stat">
              <span>Out qty</span>
              <strong>{formatNum(totals.outQty)}</strong>
            </div>
          )}
        </div>
      </header>

      <div className="embed-stock-toolbar">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search material, code, category…"
        />
        <label className="embed-check">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
          />
          Low stock only
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {err && <div className="alert err">{err}</div>}
      {loading && !rows.length && (
        <div className="empty" style={{ padding: 32 }}>
          Loading stock…
        </div>
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
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", opacity: 0.7 }}>
                    No materials to show.
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const low = r.minStock > 0 && r.stock <= r.minStock;
                return (
                  <tr
                    key={r._id || r.name}
                    className={low ? "embed-low" : undefined}
                  >
                    <td>
                      <strong>{r.name}</strong>
                      {r.code ? <div className="embed-code">{r.code}</div> : null}
                    </td>
                    <td>{r.category || "—"}</td>
                    <td>{r.uom || "—"}</td>
                    <td className="num">{formatNum(r.inQty)}</td>
                    <td className="num">{formatNum(r.outQty)}</td>
                    <td className="num">
                      <strong>{formatNum(r.stock)}</strong>
                    </td>
                    <td className="num">{formatNum(r.minStock)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
