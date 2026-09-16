import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { getMaster, getInward, getOutward, unwrapList } from "../api/api";
import { useAuth } from "../context/AuthContext";
import { formatNum, formatINR, exportXlsx, todayStr, toDDMMYYYY } from "../utils/helpers";
import Pagination from "../components/Pagination";
import useClientPagination from "../hooks/useClientPagination";

// ── Excel-style dropdown filter — portal-based, with Apply button ────────────
function ColFilter({ values, selected, onChange, formatLabel }) {
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

  const unique = [...new Set(values.filter(Boolean))];
  const toNum = (v) => {
    const c = String(v).replace(/[^0-9.\-]/g, "");
    return c === "" || c === "-" ? NaN : parseFloat(c);
  };
  const isNum = unique.every((v) => !isNaN(toNum(v)));
  unique.sort((a, b) =>
    isNum ? toNum(a) - toNum(b) : String(a).localeCompare(String(b)),
  );

  const filtered = unique.filter((v) =>
    String(v).toLowerCase().includes(search.toLowerCase()),
  );
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
    setOpen(false);
  }

  const hasChanges =
    JSON.stringify(pending.slice().sort()) !==
    JSON.stringify(selected.slice().sort());

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
          background: selected.length > 0 ? "var(--teal)" : "none",
          border: selected.length > 0 ? "none" : "1px solid transparent",
          cursor: "pointer",
          padding: "2px 6px",
          borderRadius: 4,
          fontSize: 10,
          color: selected.length > 0 ? "#fff" : "#8a8270",
          lineHeight: 1,
          transition: "background 150ms",
        }}
        title={
          selected.length > 0 ? `${selected.length} filter(s) active` : "Filter"
        }
      >
        ▼
      </button>
      {open && createPortal(panel, document.body)}
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Reports() {
  const { user } = useAuth();
  const canSeePrice = user?.role === "admin" || user?.role === "purchase";

  const [master, setMaster] = useState([]);
  const [inward, setInward] = useState([]);
  const [outward, setOutward] = useState([]);

  const [repType, setRepType] = useState("inward");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
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
    project: [],
    remarks: [],
  });

  const load = useCallback(async () => {
    const [m, i, o] = await Promise.all([
      getMaster(),
      getInward(),
      getOutward(),
    ]);
    setMaster(unwrapList(m));
    setInward(unwrapList(i));
    setOutward(unwrapList(o));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // ── Helpers for Required Qty / Remaining Qty (outward entries only) ───────
  function hasReqty(r) {
    return r.reqty !== undefined && r.reqty !== null && r.reqty !== "";
  }
  function remainingQty(r) {
    return hasReqty(r) ? Number(r.reqty) - Number(r.qty) : null;
  }

  const categories = [
    ...new Set(master.map((m) => m.category).filter(Boolean)),
  ].sort();
  const vendors = [
    ...new Set(inward.map((e) => e.vendor).filter(Boolean)),
  ].sort();
  const materials = [
    ...new Set(master.map((m) => m.name).filter(Boolean)),
  ].sort();
  const projects = [
    ...new Set(outward.map((e) => e.project).filter(Boolean)),
  ].sort();

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
    project: [],
    remarks: [],
  };

  function filterEntries(entries) {
    return entries.filter((e) => {
      if (dateFrom && e.date < dateFrom) return false;
      if (dateTo && e.date > dateTo) return false;
      if (category && e.category !== category) return false;
      if (vendor && e.vendor !== vendor) return false;
      if (material && e.name !== material) return false;
      if (project && e.project !== project) return false;
      return true;
    });
  }

  function runReport() {
    setCfBoth(emptyCfBoth);
    setCfTxn(emptyCfTxn);
    if (repType === "both") {
      const filteredIn = filterEntries(inward);
      const filteredOut = filterEntries(outward);

      const inQtyMap = {},
        inValMap = {},
        outQtyMap = {};
      filteredIn.forEach((e) => {
        inQtyMap[e.name] = (inQtyMap[e.name] || 0) + (parseFloat(e.qty) || 0);
        inValMap[e.name] =
          (inValMap[e.name] || 0) +
          (parseFloat(e.qty) || 0) * (parseFloat(e.price) || 0);
      });
      filteredOut.forEach((e) => {
        outQtyMap[e.name] = (outQtyMap[e.name] || 0) + (parseFloat(e.qty) || 0);
      });

      const names = [
        ...new Set([
          ...filteredIn.map((e) => e.name),
          ...filteredOut.map((e) => e.name),
        ]),
      ];

      const result = names
        .map((name) => {
          const mat = master.find((m) => m.name === name) || {};
          const inQty = inQtyMap[name] || 0;
          const outQty = outQtyMap[name] || 0;
          const balance = inQty - outQty;
          const minStock = parseFloat(mat.minStock) || 0;
          const avgPrice = inQty > 0 ? (inValMap[name] || 0) / inQty : 0;
          const stockVal = avgPrice * Math.max(balance, 0);
          return {
            name,
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

      setRows(result);
      setRepMsg(
        result.length
          ? `${result.length} material(s) found.`
          : "No records match the selected filters.",
      );
    } else {
      const src = repType === "inward" ? inward : outward;
      const result = filterEntries(src).sort((a, b) =>
        (b.date || "").localeCompare(a.date || ""),
      );
      setRows(result);
      setRepMsg(
        result.length
          ? `${result.length} record(s) found.`
          : "No records match the selected filters.",
      );
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
      const dataRows = filteredRows.map((r) => {
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
      if (repType !== "outward") headers.push("Vendor");
      if (repType !== "outward" && canSeePrice) headers.push("Price", "Value");
      if (repType !== "inward") headers.push("Project");
      headers.push("Remarks");
      const dataRows = filteredRows.map((r) => {
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

  // ── Apply column filters ───────────────────────────────────────────────────
  const filteredRows = (rows || []).filter((r) => {
    if (repType === "both") {
      return (
        (!cfBoth.name.length || cfBoth.name.includes(r.name)) &&
        (!cfBoth.type.length || cfBoth.type.includes(r.type)) &&
        (!cfBoth.category.length || cfBoth.category.includes(r.category)) &&
        (!cfBoth.code.length || cfBoth.code.includes(r.code)) &&
        (!cfBoth.uom.length || cfBoth.uom.includes(r.uom)) &&
        (!cfBoth.inQty.length ||
          cfBoth.inQty.includes(String(formatNum(r.inQty)))) &&
        (!cfBoth.outQty.length ||
          cfBoth.outQty.includes(String(formatNum(r.outQty)))) &&
        (!cfBoth.balance.length ||
          cfBoth.balance.includes(String(formatNum(r.balance)))) &&
        (!cfBoth.minStock.length ||
          cfBoth.minStock.includes(String(formatNum(r.minStock)))) &&
        (!cfBoth.avgPrice.length ||
          cfBoth.avgPrice.includes(String(formatINR(r.avgPrice)))) &&
        (!cfBoth.stockVal.length ||
          cfBoth.stockVal.includes(String(formatINR(r.stockVal))))
      );
    } else {
      const value = (parseFloat(r.qty) || 0) * (parseFloat(r.price) || 0);
      return (
        (!cfTxn.date.length || cfTxn.date.includes(r.date)) &&
        (!cfTxn.name.length || cfTxn.name.includes(r.name)) &&
        (!cfTxn.category.length || cfTxn.category.includes(r.category)) &&
        (!cfTxn.code.length || cfTxn.code.includes(r.code)) &&
        (!cfTxn.uom.length || cfTxn.uom.includes(r.uom)) &&
        (!cfTxn.qty.length || cfTxn.qty.includes(String(formatNum(r.qty)))) &&
        (!cfTxn.reqty.length ||
          cfTxn.reqty.includes(
            hasReqty(r) ? String(formatNum(r.reqty)) : "—",
          )) &&
        (!cfTxn.remaining.length ||
          cfTxn.remaining.includes(
            hasReqty(r) ? String(formatNum(remainingQty(r))) : "—",
          )) &&
        (!cfTxn.vendor.length || cfTxn.vendor.includes(r.vendor || "—")) &&
        (!cfTxn.price.length ||
          cfTxn.price.includes(String(formatINR(r.price)))) &&
        (!cfTxn.value.length ||
          cfTxn.value.includes(String(formatINR(value)))) &&
        (!cfTxn.project.length || cfTxn.project.includes(r.project || "—")) &&
        (!cfTxn.remarks.length || cfTxn.remarks.includes(r.remarks || "—"))
      );
    }
  });

  const { pageItems, page, pageSize, total, setPage, setPageSize } =
    useClientPagination(filteredRows || [], 25);

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
      ? filteredRows?.reduce((s, r) => s + r.stockVal, 0) || 0
      : 0;

  const inwardVal =
    repType === "inward"
      ? filteredRows?.reduce(
          (s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.price) || 0),
          0,
        ) || 0
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
              <select
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
              >
                <option value="">All materials</option>
                {materials.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {repType !== "inward" && (
              <div className="field">
                <label>Project</label>
                <select
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                >
                  <option value="">All projects</option>
                  {projects.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="actionrow" style={{ marginTop: 20 }}>
            <button className="btn btn-in" onClick={runReport}>
              Generate report
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
                        Total stock value (avg price × balance qty)
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
                            values={(rows || []).map((r) => r.name)}
                            selected={cfBoth.name}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, name: v }))
                            }
                          />
                        </th>
                        <th>
                          Type{" "}
                          <ColFilter
                            values={(rows || []).map((r) => r.type)}
                            selected={cfBoth.type}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, type: v }))
                            }
                          />
                        </th>
                        <th>
                          Category{" "}
                          <ColFilter
                            values={(rows || []).map((r) => r.category)}
                            selected={cfBoth.category}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, category: v }))
                            }
                          />
                        </th>
                        <th>
                          Code{" "}
                          <ColFilter
                            values={(rows || []).map((r) => r.code)}
                            selected={cfBoth.code}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, code: v }))
                            }
                          />
                        </th>
                        <th>
                          UOM{" "}
                          <ColFilter
                            values={(rows || []).map((r) => r.uom)}
                            selected={cfBoth.uom}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, uom: v }))
                            }
                          />
                        </th>
                        <th className="num" style={{ color: "var(--green)" }}>
                          IN{" "}
                          <ColFilter
                            values={(rows || []).map((r) => formatNum(r.inQty))}
                            selected={cfBoth.inQty}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, inQty: v }))
                            }
                          />
                        </th>
                        <th className="num" style={{ color: "var(--red)" }}>
                          Out{" "}
                          <ColFilter
                            values={(rows || []).map((r) =>
                              formatNum(r.outQty),
                            )}
                            selected={cfBoth.outQty}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, outQty: v }))
                            }
                          />
                        </th>
                        <th className="num" style={{ color: "var(--amber)" }}>
                          Bal.{" "}
                          <ColFilter
                            values={(rows || []).map((r) =>
                              formatNum(r.balance),
                            )}
                            selected={cfBoth.balance}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, balance: v }))
                            }
                          />
                        </th>
                        <th className="num">
                          Min. Stock{" "}
                          <ColFilter
                            values={(rows || []).map((r) =>
                              formatNum(r.minStock),
                            )}
                            selected={cfBoth.minStock}
                            onChange={(v) =>
                              setCfBoth((f) => ({ ...f, minStock: v }))
                            }
                          />
                        </th>
                        {canSeePrice && (
                          <>
                            <th className="num">
                              Avg price{" "}
                              <ColFilter
                                values={(rows || []).map((r) =>
                                  formatINR(r.avgPrice),
                                )}
                                selected={cfBoth.avgPrice}
                                onChange={(v) =>
                                  setCfBoth((f) => ({ ...f, avgPrice: v }))
                                }
                              />
                            </th>
                            <th className="num">
                              Stock value{" "}
                              <ColFilter
                                values={(rows || []).map((r) =>
                                  formatINR(r.stockVal),
                                )}
                                selected={cfBoth.stockVal}
                                onChange={(v) =>
                                  setCfBoth((f) => ({ ...f, stockVal: v }))
                                }
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
                            values={(rows || []).map((r) => r.date)}
                            selected={cfTxn.date}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, date: v }))
                            }
                            formatLabel={toDDMMYYYY}
                          />
                        </th>
                        <th>
                          Material{" "}
                          <ColFilter
                            values={(rows || []).map((r) => r.name)}
                            selected={cfTxn.name}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, name: v }))
                            }
                          />
                        </th>
                        <th>
                          Category{" "}
                          <ColFilter
                            values={(rows || []).map((r) => r.category)}
                            selected={cfTxn.category}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, category: v }))
                            }
                          />
                        </th>
                        <th>
                          Code{" "}
                          <ColFilter
                            values={(rows || []).map((r) => r.code)}
                            selected={cfTxn.code}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, code: v }))
                            }
                          />
                        </th>
                        <th>
                          UOM{" "}
                          <ColFilter
                            values={(rows || []).map((r) => r.uom)}
                            selected={cfTxn.uom}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, uom: v }))
                            }
                          />
                        </th>
                        <th className="num">
                          Qty{" "}
                          <ColFilter
                            values={(rows || []).map((r) => formatNum(r.qty))}
                            selected={cfTxn.qty}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, qty: v }))
                            }
                          />
                        </th>
                        {repType === "outward" && (
                          <>
                            <th className="num">
                              Req. Qty{" "}
                              <ColFilter
                                values={(rows || []).map((r) =>
                                  hasReqty(r) ? formatNum(r.reqty) : "—",
                                )}
                                selected={cfTxn.reqty}
                                onChange={(v) =>
                                  setCfTxn((f) => ({ ...f, reqty: v }))
                                }
                              />
                            </th>
                            <th className="num">
                              Rem. Qty{" "}
                              <ColFilter
                                values={(rows || []).map((r) =>
                                  hasReqty(r)
                                    ? formatNum(remainingQty(r))
                                    : "—",
                                )}
                                selected={cfTxn.remaining}
                                onChange={(v) =>
                                  setCfTxn((f) => ({ ...f, remaining: v }))
                                }
                              />
                            </th>
                          </>
                        )}
                        {repType !== "outward" && (
                          <th>
                            Vendor{" "}
                            <ColFilter
                              values={(rows || []).map((r) => r.vendor || "—")}
                              selected={cfTxn.vendor}
                              onChange={(v) =>
                                setCfTxn((f) => ({ ...f, vendor: v }))
                              }
                            />
                          </th>
                        )}
                        {repType !== "outward" && canSeePrice && (
                          <>
                            <th className="num">
                              Price{" "}
                              <ColFilter
                                values={(rows || []).map((r) =>
                                  formatINR(r.price),
                                )}
                                selected={cfTxn.price}
                                onChange={(v) =>
                                  setCfTxn((f) => ({ ...f, price: v }))
                                }
                              />
                            </th>
                            <th className="num">
                              Value{" "}
                              <ColFilter
                                values={(rows || []).map((r) =>
                                  formatINR(
                                    (parseFloat(r.qty) || 0) *
                                      (parseFloat(r.price) || 0),
                                  ),
                                )}
                                selected={cfTxn.value}
                                onChange={(v) =>
                                  setCfTxn((f) => ({ ...f, value: v }))
                                }
                              />
                            </th>
                          </>
                        )}
                        {repType !== "inward" && (
                          <th>
                            Project{" "}
                            <ColFilter
                              values={(rows || []).map((r) => r.project || "—")}
                              selected={cfTxn.project}
                              onChange={(v) =>
                                setCfTxn((f) => ({ ...f, project: v }))
                              }
                            />
                          </th>
                        )}
                        <th className="col-remarks">
                          Remarks{" "}
                          <ColFilter
                            values={(rows || []).map((r) => r.remarks || "—")}
                            selected={cfTxn.remarks}
                            onChange={(v) =>
                              setCfTxn((f) => ({ ...f, remarks: v }))
                            }
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