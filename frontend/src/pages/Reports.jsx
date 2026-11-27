import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  startTransition,
} from "react";
import { createPortal } from "react-dom";
import { getMaster, getInward, getOutward, getStockSummary, unwrapList } from "../api/api";
import { loadInPages } from "../api/paged";
import { useAuth } from "../context/AuthContext";
import {
  formatNum,
  formatINR,
  exportXlsx,
  todayStr,
  daysAgoStr,
  toDDMMYYYY,
} from "../utils/helpers";
import Pagination from "../components/Pagination";
import useClientPagination from "../hooks/useClientPagination";
import { sortByColumn } from "../components/NumSort";
import { stockRowsFromSummary, summaryToMaps } from "../utils/stockMaps";

// ── Excel-style dropdown filter — portal-based, with Apply button ────────────
function ColFilter({
  values,
  selected,
  onChange,
  formatLabel,
  column,
  sortKind = "text",
  sort,
  onSort,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState([]);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef();
  const panelRef = useRef();

  useEffect(() => {
    if (open) setPending(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    function handler(e) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        btnRef.current &&
        !btnRef.current.contains(e.target)
      )
        setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onScroll(e) {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      setOpen(false);
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  function handleOpen() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const panelW = 280;
      const panelH = 360;
      const spaceBelow = window.innerHeight - rect.bottom;
      let top = spaceBelow < panelH ? rect.top - panelH - 4 : rect.bottom + 4;
      let left = rect.left;
      // Clamp fully within the viewport so opening it can never force the
      // page itself to scroll (which used to happen with the last column).
      left = Math.min(left, window.innerWidth - panelW - 12);
      left = Math.max(left, 12);
      top = Math.min(top, window.innerHeight - panelH - 12);
      top = Math.max(top, 12);
      setPos({ top, left });
    }
    setOpen((v) => !v);
  }

  // Only build/sort unique lists while open — doing this on every render for
  // thousands of rows (× many columns) freezes the page after Generate.
  const unique = useMemo(() => {
    if (!open) return [];
    const list = [...new Set((values || []).filter(Boolean))];
    const toNum = (v) => {
      const c = String(v).replace(/[^0-9.\-]/g, "");
      return c === "" || c === "-" ? NaN : parseFloat(c);
    };
    const isNum = list.length > 0 && list.every((v) => !isNaN(toNum(v)));
    list.sort((a, b) =>
      isNum ? toNum(a) - toNum(b) : String(a).localeCompare(String(b)),
    );
    return list;
  }, [open, values]);

  const filtered = useMemo(() => {
    if (!open) return [];
    const q = search.toLowerCase();
    if (!q) return unique;
    return unique.filter((v) => String(v).toLowerCase().includes(q));
  }, [open, unique, search]);

  const allSelected = pending.length === unique.length && unique.length > 0;
  const someSelected = pending.length > 0 && pending.length < unique.length;

  function toggle(val) {
    setPending((prev) =>
      prev.includes(val) ? prev.filter((s) => s !== val) : [...prev, val],
    );
  }
  function toggleAll() {
    if (pending.length === unique.length) setPending([]);
    else setPending(unique);
  }
  function handleApply() {
    onChange(pending);
    setOpen(false);
  }
  function handleClear() {
    setPending([]);
    onChange([]);
    if (onSort && column && sort?.key === column) onSort(null);
    setOpen(false);
  }

  const hasChanges =
    JSON.stringify(pending.slice().sort()) !==
    JSON.stringify(selected.slice().sort());

  const filterOn = Array.isArray(selected) && selected.length > 0;
  const sortOn = Boolean(column && sort?.key === column);

  const panel = (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 99999,
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        width: 280,
        maxWidth: 320,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <input
          autoFocus
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            padding: "7px 10px",
            fontSize: 13,
            border: "1.5px solid var(--line)",
            borderRadius: 6,
            fontFamily: "Inter, Poppins, sans-serif",
            outline: "none",
            background: "#fafaf8",
            color: "var(--ink)",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--teal)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--line)")}
        />
        <button
          onClick={() => setOpen(false)}
          title="Close"
          aria-label="Close filter"
          style={{
            flexShrink: 0,
            width: 26,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 15,
            lineHeight: 1,
            color: "#8a8270",
            borderRadius: 5,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--paper-dim)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          ✕
        </button>
      </div>
      {onSort && column && (
        <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--line)" }}>
          {[
            ["asc", "Sort ascending"],
            ["desc", "Sort descending"],
          ].map(([dir, label]) => {
            const kind = sortKind === "number" ? "number" : "text";
            const on =
              sort?.key === column &&
              (sort.type || "number") === kind &&
              sort.dir === dir;
            return (
              <button
                key={dir}
                type="button"
                onClick={() => {
                  onSort(on ? null : { key: column, dir, type: kind });
                  setOpen(false);
                }}
                style={{
                  flex: 1,
                  fontSize: 12,
                  padding: "6px 4px",
                  border: "1.5px solid var(--line)",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: on ? "var(--teal)" : "#fff",
                  color: on ? "#fff" : "var(--ink)",
                  fontFamily: "Inter, Poppins, sans-serif",
                  fontWeight: 600,
                }}
              >
                {dir === "asc" ? "▲" : "▼"} {label}
              </button>
            );
          })}
        </div>
      )}
      <div
        onClick={toggleAll}
        style={{
          padding: "8px 14px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          background: someSelected
            ? "#fffbf0"
            : allSelected
              ? "var(--teal-light)"
              : undefined,
        }}
      >
        <input
          type="checkbox"
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          checked={allSelected}
          onChange={toggleAll}
          style={{
            cursor: "pointer",
            accentColor: "var(--teal)",
            width: 14,
            height: 14,
          }}
          onClick={(e) => e.stopPropagation()}
        />
        <span
          style={{
            fontSize: 12.5,
            fontStyle: "italic",
            color: "var(--text-3)",
            fontFamily: "Inter, Poppins, sans-serif",
          }}
        >
          {someSelected
            ? `${pending.length} of ${unique.length} selected`
            : allSelected
              ? "All selected"
              : "(Select all)"}
        </span>
        {pending.length > 0 && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              background: someSelected ? "var(--amber)" : "var(--teal)",
              color: "#fff",
              borderRadius: 10,
              padding: "1px 7px",
              fontWeight: 600,
            }}
          >
            {pending.length}
          </span>
        )}
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {filtered.map((v) => (
          <div
            key={v}
            onClick={() => toggle(v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 14px",
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "Inter, Poppins, sans-serif",
              background: pending.includes(v) ? "var(--teal-light)" : undefined,
              transition: "background 100ms",
            }}
          >
            <input
              type="checkbox"
              checked={pending.includes(v)}
              onChange={() => toggle(v)}
              style={{
                cursor: "pointer",
                accentColor: "var(--teal)",
                width: 14,
                height: 14,
                flexShrink: 0,
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {formatLabel ? formatLabel(v) : v}
            </span>
          </div>
        ))}
        {!filtered.length && (
          <div
            style={{
              padding: "12px 14px",
              fontSize: 12.5,
              color: "var(--text-3)",
              textAlign: "center",
            }}
          >
            No results
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "10px 12px",
          borderTop: "1px solid var(--line)",
          background: "var(--paper-dim)",
        }}
      >
        <button
          onClick={handleClear}
          style={{
            flex: 1,
            fontSize: 12.5,
            padding: "7px 0",
            border: "1.5px solid var(--line)",
            borderRadius: 6,
            cursor: "pointer",
            background: "#fff",
            fontFamily: "Inter, Poppins, sans-serif",
            color: "var(--ink)",
          }}
        >
          Clear
        </button>
        <button
          onClick={handleApply}
          style={{
            flex: 2,
            fontSize: 12.5,
            padding: "7px 0",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            background: hasChanges ? "var(--teal)" : "var(--paper-dim)",
            color: hasChanges ? "#fff" : "var(--text-3)",
            fontFamily: "Inter, Poppins, sans-serif",
            fontWeight: 600,
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={{
          backgroundColor: filterOn || sortOn ? "#1f5c52" : "transparent",
          border: "none",
          cursor: "pointer",
          padding: "2px 6px",
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 700,
          color: filterOn || sortOn ? "#fff" : "#8a8270",
          lineHeight: 1,
          verticalAlign: "middle",
        }}
        title={
          filterOn
            ? `${selected.length} filter(s) active`
            : sortOn
              ? sort.dir === "desc"
                ? "Sorted descending"
                : "Sorted ascending"
              : "Filter"
        }
      >
        {sortOn ? (sort.dir === "desc" ? "▼" : "▲") : "▼"}
      </button>
      {open && createPortal(panel, document.body)}
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Reports() {
  const { user } = useAuth();
  const canSeePrice = user?.role === "admin" || user?.role === "purchase" || user?.role === "accounts";

  const [master, setMaster] = useState([]);
  const [summary, setSummary] = useState(null);
  const [inward, setInward] = useState([]);
  const [outward, setOutward] = useState([]);

  const [repType, setRepType] = useState("inward");
  const [numSort, setNumSort] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => todayStr());
  const [dateTo, setDateTo] = useState(() => todayStr());
  const [category, setCategory] = useState("");
  const [vendor, setVendor] = useState("");
  const [material, setMaterial] = useState("");
  const [project, setProject] = useState("");
  const [rows, setRows] = useState(null);
  const [repMsg, setRepMsg] = useState("");

  const [cfBoth, setCfBoth] = useState({
    name: [],
    type: [],
    category: [],
    code: [],
    uom: [],
    inQty: [],
    outQty: [],
    balance: [],
    minStock: [],
    avgPrice: [],
    stockVal: [],
  });
  const [cfTxn, setCfTxn] = useState({
    date: [],
    name: [],
    category: [],
    code: [],
    uom: [],
    qty: [],
    reqty: [],
    remaining: [],
    vendor: [],
    price: [],
    value: [],
    avgPrice: [],
    evaluation: [],
    project: [],
    remarks: [],
  });

  const [listNote, setListNote] = useState("");
  const [generating, setGenerating] = useState(false);
  const loadGen = useRef(0);

  // Meta only on open — transaction history loads when Generate is clicked.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, s] = await Promise.all([getMaster(), getStockSummary()]);
        if (cancelled) return;
        setMaster(unwrapList(m));
        setSummary(s);
      } catch (e) {
        if (!cancelled) setListNote(e.message || "Could not load master/summary");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setNumSort(null);
  }, [repType]);

  // Filters/dates only apply on the next Generate — clear stale results.
  useEffect(() => {
    setRows(null);
    setRepMsg("");
  }, [dateFrom, dateTo, category, vendor, material, project]);

  // ── Helpers for Required Qty / Remaining Qty (outward entries only) ───────
  function hasReqty(r) {
    return r.reqty !== undefined && r.reqty !== null && r.reqty !== "";
  }
  function remainingQty(r) {
    return hasReqty(r) ? Number(r.reqty) - Number(r.qty) : null;
  }

  // Top filters use master (and small unique sets) — never rebuild huge
  // <select> option lists from thousands of generated report rows.
  const uniqueSorted = (values, current) => {
    const list = [...new Set((values || []).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { sensitivity: "base" }),
    );
    if (current && !list.includes(current)) return [current, ...list];
    return list;
  };

  const categories = useMemo(
    () => uniqueSorted(master.map((m) => m.category), category),
    [master, category],
  );

  const vendors = useMemo(() => {
    if (repType === "outward") return [];
    return uniqueSorted(
      inward.map((e) => e.vendor).filter(Boolean).slice(0, 500),
      vendor,
    );
  }, [repType, inward, vendor]);

  // Cap select options — rendering 1k+ <option> nodes freezes the browser.
  const materials = useMemo(() => {
    const all = uniqueSorted(
      master.map((m) => m.name),
      material,
    );
    return all.length > 250 ? all.slice(0, 250) : all;
  }, [master, material]);

  const projects = useMemo(() => {
    if (repType === "inward") return [];
    return uniqueSorted(
      outward.map((e) => e.project).filter(Boolean).slice(0, 200),
      project,
    );
  }, [repType, outward, project]);

  // Weighted average unit price per material from inward receipts
  // (inward amount ÷ priced inward qty), same figure as Live Stock.
  const inwardAvgByName = useMemo(() => {
    const { valueMap, pricedQtyMap } = summaryToMaps(summary);
    const avg = new Map();
    for (const [key, pricedQty] of pricedQtyMap) {
      avg.set(key, pricedQty > 0 ? (valueMap.get(key) || 0) / pricedQty : 0);
    }
    return avg;
  }, [summary]);

  function avgPriceFor(name) {
    return (
      inwardAvgByName.get(String(name || "").trim().toLowerCase()) || 0
    );
  }
  function evaluationFor(row) {
    return (parseFloat(row.qty) || 0) * avgPriceFor(row.name);
  }

  const emptyCfBoth = {
    name: [],
    type: [],
    category: [],
    code: [],
    uom: [],
    inQty: [],
    outQty: [],
    balance: [],
    minStock: [],
    avgPrice: [],
    stockVal: [],
  };
  const emptyCfTxn = {
    date: [],
    name: [],
    category: [],
    code: [],
    uom: [],
    qty: [],
    reqty: [],
    remaining: [],
    vendor: [],
    price: [],
    value: [],
    avgPrice: [],
    evaluation: [],
    project: [],
    remarks: [],
  };

  function filterEntries(entries, from, to) {
    const matQ = String(material || "").trim().toLowerCase();
    const projQ = String(project || "").trim().toLowerCase();
    return entries.filter((e) => {
      if (from && e.date < from) return false;
      if (to && e.date > to) return false;
      if (category && e.category !== category) return false;
      if (vendor && e.vendor !== vendor) return false;
      if (matQ && !String(e.name || "").toLowerCase().includes(matQ))
        return false;
      if (projQ && !String(e.project || "").toLowerCase().includes(projQ))
        return false;
      return true;
    });
  }

  async function fetchTxnPages(fetcher, dateParams, label) {
    const gen = loadGen.current;
    let collected = [];
    await loadInPages((params) => fetcher({ ...params, ...dateParams }), {
      isCancelled: () => gen !== loadGen.current,
      onUpdate: (rows, info) => {
        if (gen !== loadGen.current) return;
        collected = rows;
        if (!info.complete) {
          setListNote(`Loading ${label}… ${rows.length} of ${info.total}`);
        }
      },
    });
    return collected;
  }

  async function runReport() {
    if (generating) return;
    let from = dateFrom;
    let to = dateTo;
    if (!from && !to) {
      from = todayStr();
      to = todayStr();
      window.alert(
        "A date range is required for Reports. Using today’s date — pick From/To for a wider range (or Last 30 days).",
      );
      // Set dates before generating so the clear-rows effect runs first.
      setDateFrom(from);
      setDateTo(to);
    }

    const gen = ++loadGen.current;
    setGenerating(true);
    setCfBoth(emptyCfBoth);
    setCfTxn(emptyCfTxn);
    setRows(null);
    setRepMsg("");
    setListNote("Generating report…");

    const dateParams = {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };

    try {
      let result = [];

      if (repType === "both") {
        const hasEntryFilter = Boolean(
          from || to || category || vendor || material || project,
        );
        if (!hasEntryFilter) {
          result = stockRowsFromSummary(master, summary).sort((a, b) =>
            String(a.name || "").localeCompare(String(b.name || "")),
          );
        } else {
          setListNote("Loading inward + outward for combined report…");
          const [inRows, outRows] = await Promise.all([
            fetchTxnPages(getInward, dateParams, "inward"),
            fetchTxnPages(getOutward, dateParams, "outward"),
          ]);
          if (gen !== loadGen.current) return;

          const filteredIn = filterEntries(inRows, from, to);
          const filteredOut = filterEntries(outRows, from, to);
          const keyOf = (name) => String(name || "").trim().toLowerCase();
          const inQtyMap = {};
          const inValMap = {};
          const inPricedQtyMap = {};
          const outQtyMap = {};
          const labelByKey = {};
          const masterByKey = new Map(
            master.map((m) => [keyOf(m.name), m]),
          );
          filteredIn.forEach((e) => {
            const key = keyOf(e.name);
            if (!key) return;
            if (!labelByKey[key]) labelByKey[key] = e.name;
            const qty = parseFloat(e.qty) || 0;
            const price = parseFloat(e.price);
            inQtyMap[key] = (inQtyMap[key] || 0) + qty;
            if (Number.isFinite(price) && price > 0) {
              inValMap[key] = (inValMap[key] || 0) + qty * price;
              inPricedQtyMap[key] = (inPricedQtyMap[key] || 0) + qty;
            }
          });
          filteredOut.forEach((e) => {
            const key = keyOf(e.name);
            if (!key) return;
            if (!labelByKey[key]) labelByKey[key] = e.name;
            outQtyMap[key] = (outQtyMap[key] || 0) + (parseFloat(e.qty) || 0);
          });

          result = Object.keys({ ...inQtyMap, ...outQtyMap })
            .map((key) => {
              const mat = masterByKey.get(key) || {};
              const inQty = inQtyMap[key] || 0;
              const outQty = outQtyMap[key] || 0;
              const balance = inQty - outQty;
              const minStock = parseFloat(mat.minStock) || 0;
              const pricedQty = inPricedQtyMap[key] || 0;
              const avgPrice =
                pricedQty > 0 ? (inValMap[key] || 0) / pricedQty : 0;
              const stockVal = avgPrice * Math.max(pricedQty - outQty, 0);
              return {
                name: mat.name || labelByKey[key] || key,
                type: mat.type || "",
                category: mat.category || "",
                code: mat.code || "",
                uom: mat.uom || "",
                inQty,
                outQty,
                balance,
                minStock,
                avgPrice,
                stockVal,
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
        }
      } else if (repType === "inward") {
        const inRows = await fetchTxnPages(getInward, dateParams, "inward");
        if (gen !== loadGen.current) return;
        result = filterEntries(inRows, from, to).sort((a, b) =>
          (b.date || "").localeCompare(a.date || ""),
        );
        // Keep a small sample for vendor suggestions only.
        setInward(inRows.slice(0, 500));
      } else {
        const outRows = await fetchTxnPages(getOutward, dateParams, "outward");
        if (gen !== loadGen.current) return;
        result = filterEntries(outRows, from, to).sort((a, b) =>
          (b.date || "").localeCompare(a.date || ""),
        );
        setOutward(outRows.slice(0, 500));
      }

      if (gen !== loadGen.current) return;

      const msg =
        repType === "both"
          ? result.length
            ? `${result.length} material(s) found.`
            : "No records match the selected filters."
          : result.length
            ? `${result.length} record(s) found.`
            : "No records match the selected filters.";

      // Let the "Generating…" paint finish before mounting the table.
      await new Promise((r) => setTimeout(r, 0));
      if (gen !== loadGen.current) return;

      startTransition(() => {
        setRows(result);
        setRepMsg(msg);
        setListNote("");
      });
    } catch (e) {
      if (gen === loadGen.current) {
        setRepMsg(e.message || "Could not generate report");
        setListNote("");
        setRows([]);
      }
    } finally {
      if (gen === loadGen.current) setGenerating(false);
    }
  }

  function exportReport() {
    if (!filteredRows?.length) return;
    if (repType === "both") {
      const headers = [
        "Material Name",
        "Type",
        "Category",
        "Code",
        "UOM",
        "Inward Qty",
        "Outward Qty",
        "Balance",
        "Minimum Stock",
      ];
      if (canSeePrice) headers.push("Avg Price", "Stock Value");
      const dataRows = sortedRows.map((r) => {
        const row = [
          r.name,
          r.type,
          r.category,
          r.code,
          r.uom,
          r.inQty,
          r.outQty,
          r.balance,
          r.minStock,
        ];
        if (canSeePrice) row.push(r.avgPrice, r.stockVal);
        return row;
      });
      exportXlsx(
        headers,
        dataRows,
        "Stock Summary",
        `Stockyard_Combined_Report_${todayStr()}.xlsx`,
      );
    } else {
      const headers = [
        "Date",
        "Material Name",
        "Category",
        "Type",
        "Code",
        "UOM",
        "Qty",
      ];
      if (repType === "outward") headers.push("Required Qty", "Remaining Qty");
      if (repType === "outward" && canSeePrice) {
        headers.push("Avg Price", "Evaluation");
      }
      if (repType !== "outward") headers.push("Vendor");
      if (repType !== "outward" && canSeePrice) headers.push("Price", "Value");
      if (repType !== "inward") headers.push("Project");
      headers.push("Remarks");
      const dataRows = sortedRows.map((r) => {
        const row = [
          toDDMMYYYY(r.date),
          r.name,
          r.category,
          r.type,
          r.code,
          r.uom,
          parseFloat(r.qty) || 0,
        ];
        if (repType === "outward") {
          row.push(
            hasReqty(r) ? parseFloat(r.reqty) : "",
            hasReqty(r) ? remainingQty(r) : "",
          );
          if (canSeePrice) row.push(avgPriceFor(r.name), evaluationFor(r));
        }
        if (repType !== "outward") row.push(r.vendor || "");
        if (repType !== "outward" && canSeePrice) {
          const v = (parseFloat(r.qty) || 0) * (parseFloat(r.price) || 0);
          row.push(parseFloat(r.price) || 0, v);
        }
        if (repType !== "inward") row.push(r.project || "");
        row.push(r.remarks || "");
        return row;
      });
      const label = repType.charAt(0).toUpperCase() + repType.slice(1);
      exportXlsx(
        headers,
        dataRows,
        label,
        `Stockyard_${label}_Report_${todayStr()}.xlsx`,
      );
    }
  }

  // Cheap unique lists for column filters (no cascading / formatINR over
  // every row). Cascading was freezing Generate on large outward reports.
  const cheapColOpts = useCallback((list, getters) => {
    const out = {};
    const src = list || [];
    for (const [key, get] of Object.entries(getters)) {
      // Cap per-column option source size; ColFilter dedupes when opened.
      const capped = src.length > 1500 ? src.slice(0, 1500) : src;
      out[key] = capped.map(get);
    }
    return out;
  }, []);

  const colOptsBoth = useMemo(
    () =>
      cheapColOpts(rows, {
        name: (r) => r.name,
        type: (r) => r.type,
        category: (r) => r.category,
        code: (r) => r.code,
        uom: (r) => r.uom,
        inQty: (r) => String(r.inQty ?? ""),
        outQty: (r) => String(r.outQty ?? ""),
        balance: (r) => String(r.balance ?? ""),
        minStock: (r) => String(r.minStock ?? ""),
        avgPrice: (r) => String(r.avgPrice ?? ""),
        stockVal: (r) => String(r.stockVal ?? ""),
      }),
    [rows, cheapColOpts],
  );

  const colOptsTxn = useMemo(() => {
    // Identity columns only — skip price/remarks lists (high cardinality / expensive).
    const opts = cheapColOpts(rows, {
      date: (r) => r.date,
      name: (r) => r.name,
      category: (r) => r.category,
      code: (r) => r.code,
      uom: (r) => r.uom,
      qty: (r) => String(r.qty ?? ""),
      reqty: (r) => (hasReqty(r) ? String(r.reqty) : "—"),
      remaining: (r) => (hasReqty(r) ? String(remainingQty(r)) : "—"),
      vendor: (r) => r.vendor || "—",
      project: (r) => r.project || "—",
    });
    return {
      ...opts,
      price: [],
      value: [],
      avgPrice: [],
      evaluation: [],
      remarks: [],
    };
  }, [rows, cheapColOpts]);

  // ── Apply column filters ───────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const cf = repType === "both" ? cfBoth : cfTxn;
    const anyColFilter = Object.values(cf).some((v) => v?.length);
    if (!anyColFilter) return rows;

    return rows.filter((r) => {
      if (repType === "both") {
        return (
          (!cfBoth.name.length || cfBoth.name.includes(r.name)) &&
          (!cfBoth.type.length || cfBoth.type.includes(r.type)) &&
          (!cfBoth.category.length || cfBoth.category.includes(r.category)) &&
          (!cfBoth.code.length || cfBoth.code.includes(r.code)) &&
          (!cfBoth.uom.length || cfBoth.uom.includes(r.uom)) &&
          (!cfBoth.inQty.length ||
            cfBoth.inQty.includes(String(r.inQty ?? ""))) &&
          (!cfBoth.outQty.length ||
            cfBoth.outQty.includes(String(r.outQty ?? ""))) &&
          (!cfBoth.balance.length ||
            cfBoth.balance.includes(String(r.balance ?? ""))) &&
          (!cfBoth.minStock.length ||
            cfBoth.minStock.includes(String(r.minStock ?? ""))) &&
          (!cfBoth.avgPrice.length ||
            cfBoth.avgPrice.includes(String(r.avgPrice ?? ""))) &&
          (!cfBoth.stockVal.length ||
            cfBoth.stockVal.includes(String(r.stockVal ?? "")))
        );
      }
      const value = (parseFloat(r.qty) || 0) * (parseFloat(r.price) || 0);
      return (
        (!cfTxn.date.length || cfTxn.date.includes(r.date)) &&
        (!cfTxn.name.length || cfTxn.name.includes(r.name)) &&
        (!cfTxn.category.length || cfTxn.category.includes(r.category)) &&
        (!cfTxn.code.length || cfTxn.code.includes(r.code)) &&
        (!cfTxn.uom.length || cfTxn.uom.includes(r.uom)) &&
        (!cfTxn.qty.length || cfTxn.qty.includes(String(r.qty ?? ""))) &&
        (!cfTxn.reqty.length ||
          cfTxn.reqty.includes(hasReqty(r) ? String(r.reqty) : "—")) &&
        (!cfTxn.remaining.length ||
          cfTxn.remaining.includes(
            hasReqty(r) ? String(remainingQty(r)) : "—",
          )) &&
        (!cfTxn.vendor.length || cfTxn.vendor.includes(r.vendor || "—")) &&
        (!cfTxn.price.length || cfTxn.price.includes(String(r.price ?? ""))) &&
        (!cfTxn.value.length || cfTxn.value.includes(String(value))) &&
        (!cfTxn.avgPrice.length ||
          cfTxn.avgPrice.includes(String(avgPriceFor(r.name) || 0))) &&
        (!cfTxn.evaluation.length ||
          cfTxn.evaluation.includes(String(evaluationFor(r) || 0))) &&
        (!cfTxn.project.length || cfTxn.project.includes(r.project || "—")) &&
        (!cfTxn.remarks.length || cfTxn.remarks.includes(r.remarks || "—"))
      );
    });
  }, [rows, repType, cfBoth, cfTxn, inwardAvgByName]);

  const sortedRows = useMemo(
    () =>
      sortByColumn(filteredRows, numSort, (row, key) => {
        if (key === "qty") return parseFloat(row.qty);
        if (key === "reqty") return hasReqty(row) ? Number(row.reqty) : null;
        if (key === "remaining") return hasReqty(row) ? remainingQty(row) : null;
        if (key === "price") return parseFloat(row.price);
        if (key === "value") {
          return (parseFloat(row.qty) || 0) * (parseFloat(row.price) || 0);
        }
        if (key === "avgPrice") return avgPriceFor(row.name);
        if (key === "evaluation") return evaluationFor(row);
        return row[key];
      }),
    [filteredRows, numSort, inwardAvgByName],
  );

  const { pageItems, page, pageSize, total, setPage, setPageSize } =
    useClientPagination(sortedRows || [], 25);

  function changeNumSort(next) {
    setNumSort(next);
    setPage(1);
  }

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalIn =
    repType === "both"
      ? filteredRows?.reduce((s, r) => s + r.inQty, 0) || 0
      : filteredRows?.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0) || 0;

  const totalOut =
    repType === "both"
      ? filteredRows?.reduce((s, r) => s + r.outQty, 0) || 0
      : filteredRows?.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0) || 0;

  const totalStockVal =
    repType === "both"
      ? rows?.reduce((s, r) => s + (r.stockVal || 0), 0) || 0
      : 0;

  const inwardVal =
    repType === "inward"
      ? filteredRows?.reduce(
          (s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.price) || 0),
          0,
        ) || 0
      : 0;

  const outwardEval =
    repType === "outward"
      ? filteredRows?.reduce((s, r) => s + evaluationFor(r), 0) || 0
      : 0;

  const uniqueMats =
    repType === "both"
      ? filteredRows?.length || 0
      : filteredRows
        ? [...new Set(filteredRows.map((r) => r.name))].length
        : 0;

  return (
    <>
      <style>{`
        /* Prevent the wide report table from ever forcing the whole
           document to scroll horizontally — scrolling stays inside .tablewrap */
        .reports-page-guard { overflow-x: hidden; }

        /* Wrap long values so every column fits without side-scrolling.
           Headings stay on one line. */
        .reports-section table th { white-space: nowrap; }
        .reports-section table td {
          max-width: 240px;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .reports-section table td.nowrap {
          white-space: nowrap;
          overflow-wrap: normal;
          word-break: normal;
        }
        .reports-section table td.col-remarks {
          max-width: 180px;
          white-space: normal;
          overflow-wrap: anywhere;
        }
      `}</style>
      <div className="reports-page-guard">
        <div className="pagehead">
          <div className="pagehead-text">
            <h2>Reports</h2>
            <p>
              Filter and export records. "Both (combined)" shows a
              stock-overview style balance per material.
            </p>
            {listNote && (
              <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>
                {listNote}
              </p>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="card">
          <h3>Filters</h3>
          <div className="formgrid">
            <div className="field">
              <label>Report type</label>
              <select
                value={repType}
                onChange={(e) => {
                  setRepType(e.target.value);
                  setRows(null);
                  setCfBoth(emptyCfBoth);
                  setCfTxn(emptyCfTxn);
                  setProject("");
                }}
              >
                <option value="inward">Inward entries</option>
                <option value="outward">Outward entries</option>
                <option value="both">Both (combined) — stock summary</option>
              </select>
            </div>
            <div className="field">
              <label>Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Date from</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                onClick={(e) => e.target.showPicker && e.target.showPicker()}
                style={{ cursor: "pointer" }}
              />
            </div>
            <div className="field">
              <label>Date to</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                onClick={(e) => e.target.showPicker && e.target.showPicker()}
                style={{ cursor: "pointer" }}
              />
            </div>
            <div className="field" style={{ alignSelf: "end" }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setDateFrom(daysAgoStr(30));
                  setDateTo(todayStr());
                }}
                title="Set date range to the last 30 days"
              >
                Last 30 days
              </button>
            </div>
            {repType !== "outward" && (
              <div className="field">
                <label>Vendor</label>
                <select
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                >
                  <option value="">All vendors</option>
                  {vendors.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Material</label>
              <input
                type="text"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="All materials (type to filter)"
                list="report-material-suggestions"
              />
              <datalist id="report-material-suggestions">
                {materials.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            {repType !== "inward" && (
              <div className="field">
                <label>Project</label>
                <input
                  type="text"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  placeholder="All projects (type to filter)"
                  list="report-project-suggestions"
                />
                <datalist id="report-project-suggestions">
                  {projects.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
            )}
          </div>
          <div className="actionrow" style={{ marginTop: 20 }}>
            <button
              className="btn btn-in"
              onClick={runReport}
              disabled={generating}
            >
              {generating ? "Generating…" : "Generate report"}
            </button>
            {filteredRows?.length > 0 && (
              <button className="btn btn-out" onClick={exportReport}>
                Export to Excel
              </button>
            )}
            {repMsg && (
              <span className={`msg ${rows?.length ? "ok" : "err"}`}>
                {repMsg}
              </span>
            )}
          </div>
        </div>

        {/* Summary stats */}
        {rows !== null && rows.length > 0 && (
          <>
            {repType === "both" ? (
              <>
                <div className="statrow">
                  <div className="stat">
                    <div className="label">Materials tracked</div>
                    <div className="value">{uniqueMats}</div>
                  </div>
                  <div className="stat teal">
                    <div className="label">Total inward qty</div>
                    <div className="value">
                      {formatNum(Math.round(totalIn))}
                    </div>
                  </div>
                  <div className="stat rust">
                    <div className="label">Total outward qty</div>
                    <div className="value">
                      {formatNum(Math.round(totalOut))}
                    </div>
                  </div>
                  <div className="stat teal">
                    <div className="label">Total balance stock</div>
                    <div
                      className="value"
                      style={{
                        color:
                          totalIn - totalOut <= 0
                            ? "var(--red)"
                            : "var(--teal-dark)",
                      }}
                    >
                      {formatNum(Math.round(totalIn - totalOut))}
                    </div>
                  </div>
                </div>
                {canSeePrice && (
                  <div
                    className="statrow"
                    style={{ gridTemplateColumns: "1fr", marginBottom: 20 }}
                  >
                    <div className="stat teal">
                      <div className="label">
                        Total stock value (avg price × remaining priced qty)
                      </div>
                      <div className="value">
                        {formatINR(Math.round(totalStockVal))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="statrow">
                <div className="stat">
                  <div className="label">Records</div>
                  <div className="value">{filteredRows.length}</div>
                </div>
                <div className="stat">
                  <div className="label">Unique materials</div>
                  <div className="value">{uniqueMats}</div>
                </div>
                {repType === "inward" && (
                  <div className="stat teal">
                    <div className="label">Total inward qty</div>
                    <div className="value">{formatNum(totalIn)}</div>
                  </div>
                )}
                {repType === "outward" && (
                  <div className="stat rust">
                    <div className="label">Total outward qty</div>
                    <div className="value">{formatNum(totalOut)}</div>
                  </div>
                )}
                {canSeePrice && repType === "outward" && (
                  <div className="stat rust">
                    <div className="label">
                      Total evaluation (outward qty × inward avg price)
                    </div>
                    <div className="value">{formatINR(outwardEval)}</div>
                  </div>
                )}
                {canSeePrice && repType === "inward" && (
                  <div className="stat teal">
                    <div className="label">Total inward value</div>
                    <div className="value">{formatINR(inwardVal)}</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Results table */}
        {rows !== null && (
          <div className="card card-wide reports-section">
            <h3>
              {repType === "both"
                ? "Stock balance by material"
                : repType === "inward"
                  ? "Inward entries"
                  : "Outward entries"}
              <span className="pill-count">{filteredRows.length || 0}</span>
            </h3>
            <div
              className="tablewrap"
              style={{
                overflowX: "auto",
                overflowY: "auto",
                maxHeight: "60vh",
              }}
            >
              <table>
                {repType === "both" ? (
                  <>
                    <thead
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 2,
                        background: "var(--paper-dim)",
                      }}
                    >
                      <tr>
                        <th>
                          Material name{" "}
                          <ColFilter
                            values={colOptsBoth.name}
                            selected={cfBoth.name}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, name: v }))
                            }
                            column="name"
                            sortKind="text"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th>
                          Type{" "}
                          <ColFilter
                            values={colOptsBoth.type}
                            selected={cfBoth.type}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, type: v }))
                            }
                            column="type"
                            sortKind="text"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th>
                          Category{" "}
                          <ColFilter
                            values={colOptsBoth.category}
                            selected={cfBoth.category}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, category: v }))
                            }
                            column="category"
                            sortKind="text"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th>
                          Code{" "}
                          <ColFilter
                            values={colOptsBoth.code}
                            selected={cfBoth.code}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, code: v }))
                            }
                            column="code"
                            sortKind="text"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th>
                          UOM{" "}
                          <ColFilter
                            values={colOptsBoth.uom}
                            selected={cfBoth.uom}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, uom: v }))
                            }
                            column="uom"
                            sortKind="text"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th className="num" style={{ color: "var(--green)" }}>
                          IN{" "}
                          <ColFilter
                            values={colOptsBoth.inQty}
                            selected={cfBoth.inQty}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, inQty: v }))
                            }
                            column="inQty"
                            sortKind="number"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th className="num" style={{ color: "var(--red)" }}>
                          Out{" "}
                          <ColFilter
                            values={colOptsBoth.outQty}
                            selected={cfBoth.outQty}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, outQty: v }))
                            }
                            column="outQty"
                            sortKind="number"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th className="num" style={{ color: "var(--amber)" }}>
                          Bal.{" "}
                          <ColFilter
                            values={colOptsBoth.balance}
                            selected={cfBoth.balance}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, balance: v }))
                            }
                            column="balance"
                            sortKind="number"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th className="num">
                          Min. Stock{" "}
                          <ColFilter
                            values={colOptsBoth.minStock}
                            selected={cfBoth.minStock}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, minStock: v }))
                            }
                            column="minStock"
                            sortKind="number"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        {canSeePrice && (
                          <>
                            <th className="num">
                              Avg price{" "}
                              <ColFilter
                                values={colOptsBoth.avgPrice}
                                selected={cfBoth.avgPrice}
                                onChange={(v) =>
                                  setCfBoth((f) => ({ ...f, avgPrice: v }))
                                }
                                column="avgPrice"
                                sortKind="number"
                                sort={numSort}
                                onSort={changeNumSort}
                              />
                            </th>
                            <th className="num">
                              Stock value{" "}
                              <ColFilter
                                values={colOptsBoth.stockVal}
                                selected={cfBoth.stockVal}
                                onChange={(v) =>
                                  setCfBoth((f) => ({ ...f, stockVal: v }))
                                }
                                column="stockVal"
                                sortKind="number"
                                sort={numSort}
                                onSort={changeNumSort}
                              />
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((r, i) => (
                        <tr key={i}>
                          <td className="wrap-cell" style={{ fontWeight: 500 }}>
                            {r.name}
                          </td>
                          <td>{r.type}</td>
                          <td>{r.category}</td>
                          <td className="mono">{r.code}</td>
                          <td>{r.uom}</td>
                          <td className="num">{formatNum(r.inQty)}</td>
                          <td className="num">{formatNum(r.outQty)}</td>
                          <td className="num">{formatNum(r.balance)}</td>
                          <td className="num">{formatNum(r.minStock)}</td>
                          {canSeePrice && (
                            <>
                              <td className="num">{formatINR(r.avgPrice)}</td>
                              <td className="num">{formatINR(r.stockVal)}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 2,
                        background: "var(--paper-dim)",
                      }}
                    >
                      <tr>
                        <th>
                          Date{" "}
                          <ColFilter
                            values={colOptsTxn.date}
                            selected={cfTxn.date}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, date: v }))
                            }
                            formatLabel={toDDMMYYYY}
                            column="date"
                            sortKind="text"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th>
                          Material{" "}
                          <ColFilter
                            values={colOptsTxn.name}
                            selected={cfTxn.name}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, name: v }))
                            }
                            column="name"
                            sortKind="text"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th>
                          Category{" "}
                          <ColFilter
                            values={colOptsTxn.category}
                            selected={cfTxn.category}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, category: v }))
                            }
                            column="category"
                            sortKind="text"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th>
                          Code{" "}
                          <ColFilter
                            values={colOptsTxn.code}
                            selected={cfTxn.code}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, code: v }))
                            }
                            column="code"
                            sortKind="text"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th>
                          UOM{" "}
                          <ColFilter
                            values={colOptsTxn.uom}
                            selected={cfTxn.uom}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, uom: v }))
                            }
                            column="uom"
                            sortKind="text"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        <th className="num">
                          Qty{" "}
                          <ColFilter
                            values={colOptsTxn.qty}
                            selected={cfTxn.qty}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, qty: v }))
                            }
                            column="qty"
                            sortKind="number"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                        {repType === "outward" && (
                          <>
                            <th className="num">
                              Req. Qty{" "}
                              <ColFilter
                                values={colOptsTxn.reqty}
                                selected={cfTxn.reqty}
                                onChange={(v) =>
                                  setCfTxn((f) => ({ ...f, reqty: v }))
                                }
                                column="reqty"
                                sortKind="number"
                                sort={numSort}
                                onSort={changeNumSort}
                              />
                            </th>
                            <th className="num">
                              Rem. Qty{" "}
                              <ColFilter
                                values={colOptsTxn.remaining}
                                selected={cfTxn.remaining}
                                onChange={(v) =>
                                  setCfTxn((f) => ({ ...f, remaining: v }))
                                }
                                column="remaining"
                                sortKind="number"
                                sort={numSort}
                                onSort={changeNumSort}
                              />
                            </th>
                          </>
                        )}
                        {repType === "outward" && canSeePrice && (
                          <>
                            <th className="num">
                              Avg price{" "}
                              <ColFilter
                                values={colOptsTxn.avgPrice}
                                selected={cfTxn.avgPrice}
                                onChange={(v) =>
                                  setCfTxn((f) => ({ ...f, avgPrice: v }))
                                }
                                column="avgPrice"
                                sortKind="number"
                                sort={numSort}
                                onSort={changeNumSort}
                              />
                            </th>
                            <th className="num">
                              Evaluation{" "}
                              <ColFilter
                                values={colOptsTxn.evaluation}
                                selected={cfTxn.evaluation}
                                onChange={(v) =>
                                  setCfTxn((f) => ({ ...f, evaluation: v }))
                                }
                                column="evaluation"
                                sortKind="number"
                                sort={numSort}
                                onSort={changeNumSort}
                              />
                            </th>
                          </>
                        )}
                        {repType !== "outward" && (
                          <th>
                            Vendor{" "}
                            <ColFilter
                              values={colOptsTxn.vendor}
                              selected={cfTxn.vendor}
                              onChange={(v) =>
                                setCfTxn((f) => ({ ...f, vendor: v }))
                              }
                              column="vendor"
                              sortKind="text"
                              sort={numSort}
                              onSort={changeNumSort}
                            />
                          </th>
                        )}
                        {repType !== "outward" && canSeePrice && (
                          <>
                            <th className="num">
                              Price{" "}
                              <ColFilter
                                values={colOptsTxn.price}
                                selected={cfTxn.price}
                                onChange={(v) =>
                                  setCfTxn((f) => ({ ...f, price: v }))
                                }
                                column="price"
                                sortKind="number"
                                sort={numSort}
                                onSort={changeNumSort}
                              />
                            </th>
                            <th className="num">
                              Value{" "}
                              <ColFilter
                                values={colOptsTxn.value}
                                selected={cfTxn.value}
                                onChange={(v) =>
                                  setCfTxn((f) => ({ ...f, value: v }))
                                }
                                column="value"
                                sortKind="number"
                                sort={numSort}
                                onSort={changeNumSort}
                              />
                            </th>
                          </>
                        )}
                        {repType !== "inward" && (
                          <th>
                            Project{" "}
                            <ColFilter
                              values={colOptsTxn.project}
                              selected={cfTxn.project}
                              onChange={(v) =>
                                setCfTxn((f) => ({ ...f, project: v }))
                              }
                              column="project"
                              sortKind="text"
                              sort={numSort}
                              onSort={changeNumSort}
                            />
                          </th>
                        )}
                        <th className="col-remarks">
                          Remarks{" "}
                          <ColFilter
                            values={colOptsTxn.remarks}
                            selected={cfTxn.remarks}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, remarks: v }))
                            }
                            column="remarks"
                            sortKind="text"
                            sort={numSort}
                            onSort={changeNumSort}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((r, i) => (
                        <tr key={i}>
                          <td className="nowrap">{toDDMMYYYY(r.date)}</td>
                          <td className="wrap-cell" style={{ fontWeight: 500 }}>
                            {r.name}
                          </td>
                          <td>{r.category}</td>
                          <td className="mono">{r.code}</td>
                          <td>{r.uom}</td>
                          <td className="num">{formatNum(r.qty)}</td>
                          {repType === "outward" && (
                            <>
                              <td className="num">
                                {hasReqty(r) ? formatNum(r.reqty) : "—"}
                              </td>
                              <td className="num">
                                {hasReqty(r) ? (
                                  <strong
                                    style={{
                                      color:
                                        remainingQty(r) <= 0
                                          ? "var(--red)"
                                          : "inherit",
                                    }}
                                  >
                                    {formatNum(remainingQty(r))}
                                  </strong>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </>
                          )}
                          {repType === "outward" && canSeePrice && (
                            <>
                              <td className="num">
                                {formatINR(avgPriceFor(r.name))}
                              </td>
                              <td className="num">
                                {formatINR(evaluationFor(r))}
                              </td>
                            </>
                          )}
                          {repType !== "outward" && <td>{r.vendor || "—"}</td>}
                          {repType !== "outward" && canSeePrice && (
                            <>
                              <td className="num">{formatINR(r.price)}</td>
                              <td className="num">
                                {formatINR(
                                  (parseFloat(r.qty) || 0) *
                                    (parseFloat(r.price) || 0),
                                )}
                              </td>
                            </>
                          )}
                          {repType !== "inward" && <td>{r.project || "—"}</td>}
                          <td className="col-remarks" title={r.remarks || ""}>
                            {r.remarks || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
            {!filteredRows.length && (
              <div className="empty">
                No records match the selected filters.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}