import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { getInward, updatePrice, unwrapList } from "../api/api";
import { formatNum, exportXlsx } from "../utils/helpers";
// NOTE: adjust this import path if your AuthContext file lives elsewhere.
import { useAuth } from "../context/AuthContext";
import Pagination from "../components/Pagination";
import useClientPagination from "../hooks/useClientPagination";
import { sortNewestFirst } from "../utils/stockMaps";

// Display dates as dd-mm-yyyy regardless of the underlying stored format.
function toDDMMYYYY(dateStr) {
  if (!dateStr) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// Sortable "YYYY-MM" key used internally for the month filter.
function toMonthKey(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Human label for a "YYYY-MM" key, e.g. "Jul 2026".
function monthKeyToLabel(key) {
  if (!key) return key;
  const [yyyy, mm] = key.split("-");
  const d = new Date(Number(yyyy), Number(mm) - 1, 1);
  if (isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

// Normalize a header/key for loose matching against Excel column names,
// e.g. "Unit Price", "unit_price" and "UnitPrice" all become "unitprice".
function normKey(k) {
  return String(k ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pickField(rowNormMap, candidates) {
  for (const c of candidates) {
    if (rowNormMap[c] !== undefined && rowNormMap[c] !== "")
      return rowNormMap[c];
  }
  return undefined;
}

function ColFilter({ values, selected, onChange, formatLabel }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState([]);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef();
  const panelRef = useRef();

  useEffect(() => {
    if (open) setPending(selected);
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

  function handleOpen() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const panelH = Math.min(360, window.innerHeight - 24);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceRight = window.innerWidth - rect.left;
      const top =
        spaceBelow < panelH
          ? Math.max(12, rect.top - panelH - 6)
          : rect.bottom + 6;
      const left = Math.min(rect.left, Math.max(12, window.innerWidth - 280));
      setPos({ top, left });
    }
    setOpen((v) => !v);
  }

  const unique = [...new Set(values.filter(Boolean))];
  const toNum = (v) => {
    const cleaned = String(v).replace(/[^0-9.\-]/g, "");
    return cleaned === "" || cleaned === "-" ? NaN : parseFloat(cleaned);
  };
  const isNumericCol = unique.every((v) => !isNaN(toNum(v)));

  unique.sort((a, b) =>
    isNumericCol ? toNum(a) - toNum(b) : String(a).localeCompare(String(b)),
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

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={{
          background: selected.length > 0 ? "var(--teal)" : "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 6px",
          borderRadius: 4,
          fontSize: 10,
          color: selected.length > 0 ? "#fff" : "#8a8270",
          lineHeight: 1,
        }}
        title={
          selected.length > 0 ? `${selected.length} filter(s) active` : "Filter"
        }
      >
        ▼
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "absolute",
              top: pos.top,
              left: pos.left,
              zIndex: 99999,
              background: "#fff",
              border: "1px solid var(--line)",
              borderRadius: 10,
              boxShadow: "0 8px 32px rgba(0,0,0,.18)",
              minWidth: 240,
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
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "none")
                }
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
                    background: pending.includes(v)
                      ? "var(--teal-light)"
                      : undefined,
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
          </div>,
          document.body,
        )}
    </>
  );
}

const itemStyle = {
  display: "flex",
  alignItems: "center",
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
  userSelect: "none",
  transition: "background .1s",
};

export default function PriceEntry() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState("");
  const [prices, setPrices] = useState({});
  const [saved, setSaved] = useState({});
  const [recentPrices, setRecentPrices] = useState([]);
  const [syncSameName, setSyncSameName] = useState(false);

  const [excelPreview, setExcelPreview] = useState(null); // { matched, unmatched, fileName }
  const [excelBusy, setExcelBusy] = useState(false);
  const fileInputRef = useRef();

  const [cf, setCf] = useState({
    date: [],
    month: [],
    vendor: [],
    name: [],
    code: [],
    category: [],
    qty: [],
    uom: [],
    price: [],
  });

  const load = useCallback(async () => {
    const data = unwrapList(await getInward());
    setEntries(data);
    const init = {};
    data.forEach((e) => {
      init[e._id] = e.price ?? 0;
    });
    setPrices(init);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // A row can be edited by Purchase only while its price is still 0 (first
  // entry). Once a price exists, only Admin may change it.
  function canEditEntry(entry) {
    if (isAdmin) return true;
    return (entry?.price ?? 0) === 0;
  }

  const filtered = useMemo(
    () =>
      entries
        .filter(
          (e) =>
            !search ||
            e.name.toLowerCase().includes(search.toLowerCase()) ||
            (e.code || "").toLowerCase().includes(search.toLowerCase()),
        )
        .filter(
          (e) =>
            (!cf.date.length || cf.date.includes(e.date)) &&
            (!cf.month.length || cf.month.includes(toMonthKey(e.date))) &&
            (!cf.vendor.length || cf.vendor.includes(e.vendor)) &&
            (!cf.name.length || cf.name.includes(e.name)) &&
            (!cf.code.length || cf.code.includes(e.code)) &&
            (!cf.category.length || cf.category.includes(e.category)) &&
            (!cf.qty.length || cf.qty.includes(String(e.qty))) &&
            (!cf.uom.length || cf.uom.includes(e.uom)) &&
            (!cf.price.length || cf.price.includes(String(e.price ?? 0))),
        )
        .slice()
        .sort((a, b) => {
          const aZero = (a.price ?? 0) === 0 ? 0 : 1;
          const bZero = (b.price ?? 0) === 0 ? 0 : 1;
          if (aZero !== bZero) return aZero - bZero;
          return sortNewestFirst(a, b);
        }),
    [entries, search, cf],
  );
  const { pageItems, page, pageSize, total, setPage, setPageSize } =
    useClientPagination(filtered, 25);

  function handleFocus(id) {
    // If the current value is 0, clear it so user can type a fresh number
    if (prices[id] === 0 || prices[id] === "0") {
      setPrices((p) => ({ ...p, [id]: "" }));
    }
  }

  async function handleSave(id) {
    const entry = entries.find((e) => e._id === id);
    if (!canEditEntry(entry)) return; // defense in depth — UI already blocks this
    try {
      const priceValue = prices[id] === "" ? 0 : (prices[id] ?? 0);

      // Only when the "sync same name" toggle is on do we also update every
      // other entry that shares the same material name (case/whitespace
      // insensitive). Otherwise, just this single row is saved.
      // Non-admins can only sweep in other rows that are still unpriced —
      // an already-priced row stays admin-only even under "Bulk Update".
      const normName = (entry?.name || "").trim().toLowerCase();
      const matchingIds =
        syncSameName && normName
          ? entries
              .filter(
                (e) =>
                  (e.name || "").trim().toLowerCase() === normName &&
                  canEditEntry(e),
              )
              .map((e) => e._id)
          : [id];

      await Promise.all(matchingIds.map((mid) => updatePrice(mid, priceValue)));

      setRecentPrices((prev) =>
        [
          {
            _id: id,
            name: entry?.name || "",
            code: entry?.code || "",
            price: priceValue,
            updatedAt: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 6),
      );

      setPrices((p) => {
        const next = { ...p };
        matchingIds.forEach((mid) => (next[mid] = priceValue));
        return next;
      });

      setSaved((s) => {
        const next = { ...s };
        matchingIds.forEach((mid) => (next[mid] = true));
        return next;
      });

      await load();

      setTimeout(() => {
        setSaved((s) => {
          const next = { ...s };
          matchingIds.forEach((mid) => (next[mid] = false));
          return next;
        });
      }, 1800);
    } catch (err) {
      alert(err.message);
    }
  }

  // --- Excel upload: read a workbook, loosely match each row's Code/Material
  // Name to inward entries, and build a preview before touching any prices. ---
  function handleExcelFile(file) {
    if (!file) return;
    setExcelBusy(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        const matched = [];
        const unmatched = [];

        rows.forEach((row, idx) => {
          const normMap = {};
          Object.entries(row).forEach(([k, v]) => {
            normMap[normKey(k)] = v;
          });

          const codeVal = pickField(normMap, [
            "code",
            "itemcode",
            "materialcode",
            "productcode",
            "sku",
          ]);
          const nameVal = pickField(normMap, [
            "name",
            "material",
            "materialname",
            "itemname",
            "item",
            "product",
          ]);
          const vendorVal = pickField(normMap, [
            "vendor",
            "vendorname",
            "supplier",
            "suppliername",
          ]);
          const categoryVal = pickField(normMap, [
            "category",
            "categoryname",
            "itemcategory",
            "type",
          ]);
          const priceValRaw = pickField(normMap, [
            "price",
            "unitprice",
            "rate",
            "cost",
            "unitrate",
          ]);
          const priceVal =
            priceValRaw === undefined
              ? NaN
              : parseFloat(String(priceValRaw).replace(/[^0-9.\-]/g, ""));

          if ((!codeVal && !nameVal) || isNaN(priceVal)) {
            unmatched.push({
              row: idx + 2, // +2 to account for header row + 1-index
              reason:
                !codeVal && !nameVal
                  ? "No Code or Material Name column found"
                  : "No valid Price found",
              raw: row,
            });
            return;
          }

          // Match every entry sharing this code (preferred) or, failing
          // that, this material name — mirrors the "Bulk Update" behaviour
          // already used when saving a single row.
          let ids = [];
          if (codeVal) {
            const norm = String(codeVal).trim().toLowerCase();
            ids = entries
              .filter((e) => (e.code || "").trim().toLowerCase() === norm)
              .map((e) => e._id);
          }
          if (!ids.length && nameVal) {
            const norm = String(nameVal).trim().toLowerCase();
            ids = entries
              .filter((e) => (e.name || "").trim().toLowerCase() === norm)
              .map((e) => e._id);
          }

          // If a Vendor column was provided, use it to narrow the match —
          // useful when the same code/name was received from more than one
          // vendor and each vendor's price needs to be set separately.
          // Falls back to the unfiltered set if the vendor doesn't narrow
          // anything down, so sheets without a Vendor column keep working.
          if (ids.length && vendorVal) {
            const vnorm = String(vendorVal).trim().toLowerCase();
            const byVendor = entries
              .filter(
                (e) =>
                  ids.includes(e._id) &&
                  (e.vendor || "").trim().toLowerCase() === vnorm,
              )
              .map((e) => e._id);
            if (byVendor.length) ids = byVendor;
          }

          // If a Category column was provided, further narrow the match —
          // useful when the same code/name exists under more than one
          // category. Falls back to the unfiltered set if it doesn't
          // narrow anything down, so sheets without a Category column
          // keep working.
          if (ids.length && categoryVal) {
            const cnorm = String(categoryVal).trim().toLowerCase();
            const byCategory = entries
              .filter(
                (e) =>
                  ids.includes(e._id) &&
                  (e.category || "").trim().toLowerCase() === cnorm,
              )
              .map((e) => e._id);
            if (byCategory.length) ids = byCategory;
          }

          if (!ids.length) {
            unmatched.push({
              row: idx + 2,
              reason: `No inward entry found for "${codeVal || nameVal}"`,
              raw: row,
            });
            return;
          }

          // Role gate: a non-admin uploader can only set prices that are
          // still 0. Any already-priced entries in this match are dropped
          // here rather than silently overwritten.
          if (!isAdmin) {
            const priced = ids.filter((id) => {
              const en = entries.find((e) => e._id === id);
              return (en?.price ?? 0) !== 0;
            });
            ids = ids.filter((id) => {
              const en = entries.find((e) => e._id === id);
              return (en?.price ?? 0) === 0;
            });
            if (!ids.length) {
              unmatched.push({
                row: idx + 2,
                reason: `Already priced — admin only ("${codeVal || nameVal}")`,
                raw: row,
              });
              return;
            }
            if (priced.length) {
              // Some entries under this code/name were skipped, but others
              // (still unpriced) will go through — note it against the row.
              unmatched.push({
                row: idx + 2,
                reason: `${priced.length} of ${priced.length + ids.length} matching entries already priced — admin only ("${codeVal || nameVal}")`,
                raw: row,
              });
            }
          }

          matched.push({
            row: idx + 2,
            code: codeVal || "",
            name: nameVal || "",
            vendor: vendorVal || "",
            category: categoryVal || "",
            price: priceVal,
            ids,
          });
        });

        setExcelPreview({ matched, unmatched, fileName: file.name });
      } catch (err) {
        alert("Could not read that file: " + err.message);
      } finally {
        setExcelBusy(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.onerror = () => {
      setExcelBusy(false);
      alert("Could not read that file.");
    };
    reader.readAsArrayBuffer(file);
  }

  async function applyExcelPreview() {
    if (!excelPreview || !excelPreview.matched.length) return;
    setExcelBusy(true);
    try {
      const updates = [];
      excelPreview.matched.forEach((m) => {
        m.ids.forEach((id) =>
          updates.push({ id, price: m.price, name: m.name, code: m.code }),
        );
      });

      await Promise.all(updates.map((u) => updatePrice(u.id, u.price)));

      setRecentPrices((prev) =>
        [
          ...excelPreview.matched.map((m) => ({
            _id: m.ids[0],
            name:
              m.name || (entries.find((e) => e._id === m.ids[0])?.name ?? ""),
            code:
              m.code || (entries.find((e) => e._id === m.ids[0])?.code ?? ""),
            price: m.price,
            updatedAt: new Date().toISOString(),
          })),
          ...prev,
        ].slice(0, 6),
      );

      await load();
      setExcelPreview(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setExcelBusy(false);
    }
  }

  // Downloadable template — built from this module's own data (current
  // inward entries + their existing prices) rather than generic placeholder
  // text, so the sheet the user gets back is immediately usable: they can
  // just edit the Price column and re-upload.
  function downloadTemplate() {
    const headers = ["Code", "Material Name", "Vendor", "Category", "Price"];

    // De-duplicate by code/name + vendor, so a material received from more
    // than one vendor still gets a row per vendor (since Vendor narrows the
    // match on upload), while true duplicates collapse to one row.
    const seen = new Set();
    const rows = [];
    entries.forEach((e) => {
      const base = (e.code || e.name || "").trim().toLowerCase();
      const vendorKey = (e.vendor || "").trim().toLowerCase();
      const key = `${base}|${vendorKey}`;
      if (!base || seen.has(key)) return;
      seen.add(key);
      rows.push([
        e.code || "",
        e.name || "",
        e.vendor || "",
        e.category || "",
        e.price ?? 0,
      ]);
    });

    // If there's no data yet (e.g. fresh install), fall back to one sample row.
    if (!rows.length) {
      rows.push([
        "[Item code]",
        "[Material Name — used if Code is blank]",
        "[Vendor — optional, narrows the match]",
        "[Category — optional, narrows the match]",
        0,
      ]);
    }

    exportXlsx(
      headers,
      rows,
      "Price Template",
      "Stockyard_Price_Template.xlsx",
    );
  }

  // Export currently filtered/searched table rows (not the full unfiltered list).
  function exportFilteredToExcel() {
    if (!filtered.length) return;

    const headers = [
      "Date",
      "Month",
      "Vendor",
      "Material",
      "Code",
      "Category",
      "Qty",
      "UOM",
      "Unit Price",
    ];
    const rows = filtered.map((e) => [
      toDDMMYYYY(e.date) || "",
      monthKeyToLabel(toMonthKey(e.date)) || "",
      e.vendor || "",
      e.name || "",
      e.code || "",
      e.category || "",
      e.qty ?? "",
      e.uom || "",
      prices[e._id] === "" || prices[e._id] === undefined
        ? (e.price ?? 0)
        : prices[e._id],
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    exportXlsx(
      headers,
      rows,
      "Price Entry",
      `price-entry-${dateStr}.xlsx`,
    );
  }

  return (
    <>
      <div className="pagehead">
        <div className="pagehead-text">
          <h2>Price Entry</h2>
          <p>
            Enter or update unit prices for inward entries. Visible to Admin and
            Purchase team only.
            {!isAdmin && (
              <>
                {" "}
                Purchase can set a price once; editing an existing price
                requires Admin.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="card card-wide">
        <h3>
          Inward entries{" "}
          <span className="pill-count">{filtered.length || 0}</span>
        </h3>
        {/* Bulk price upload via Excel — same visual treatment as Inward Entry's bulk upload.
            Placed first so it's visible immediately, above the search/filter row. */}
        <div className="uploadbox">
          <label htmlFor="price-bulk">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {excelBusy ? "Reading…" : "Choose sheet (.xlsx, .xls, .csv)"}
          </label>
          <input
            ref={fileInputRef}
            type="file"
            id="price-bulk"
            accept=".xlsx,.xls,.csv"
            disabled={excelBusy}
            onChange={(e) => handleExcelFile(e.target.files?.[0])}
          />
          <div className="hint">
            Match by <strong>Code</strong> (preferred) or{" "}
            <strong>Material Name</strong>, plus a <strong>Price</strong> column
            — column names are matched loosely (e.g. "Unit Price", "Rate",
            "Cost" all work). Add a <strong>Vendor</strong> and/or{" "}
            <strong>Category</strong> column to narrow the match when the same
            material was received from more than one vendor or exists under more
            than one category.
            {!isAdmin && (
              <>
                {" "}
                Rows that already have a price will be skipped — only Admin can
                overwrite an existing price.
              </>
            )}
            <br />
            <button onClick={downloadTemplate}>Download template</button>
          </div>
        </div>

        <div
          className="searchbar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            marginTop: 16,
          }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by material name or code…"
          />
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              color: "var(--text-3)",
              cursor: "pointer",
              userSelect: "none",
              whiteSpace: "nowrap",
            }}
            title="When on, saving a price also applies it to every other entry with the same material name"
          >
            <input
              type="checkbox"
              checked={syncSameName}
              onChange={(e) => setSyncSameName(e.target.checked)}
              style={{
                cursor: "pointer",
                accentColor: "var(--teal)",
                width: 14,
                height: 14,
              }}
            />
            Bulk Update
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={exportFilteredToExcel}
            disabled={!filtered.length}
            title="Export the currently filtered/searched results to Excel"
            style={{
              marginLeft: "auto",
              whiteSpace: "nowrap",
              opacity: filtered.length ? 1 : 0.5,
              cursor: filtered.length ? "pointer" : "not-allowed",
            }}
          >
            ⬇ Export Excel ({filtered.length})
          </button>
        </div>

        {excelPreview && (
          <div
            style={{
              margin: "16px 0",
              border: "1px solid var(--line)",
              borderRadius: 10,
              overflow: "hidden",
              background: "var(--paper-dim)",
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <strong style={{ fontSize: 13 }}>
                Preview: {excelPreview.fileName}
              </strong>
              <span
                style={{
                  fontSize: 12,
                  background: "var(--teal)",
                  color: "#fff",
                  borderRadius: 10,
                  padding: "1px 8px",
                  fontWeight: 600,
                }}
              >
                {excelPreview.matched.reduce((n, m) => n + m.ids.length, 0)}{" "}
                row(s) will update
              </span>
              {excelPreview.unmatched.length > 0 && (
                <span
                  style={{
                    fontSize: 12,
                    background: "var(--amber)",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "1px 8px",
                    fontWeight: 600,
                  }}
                >
                  {excelPreview.unmatched.length} row(s) skipped
                </span>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setExcelPreview(null)}
                  disabled={excelBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-in"
                  onClick={applyExcelPreview}
                  disabled={excelBusy || !excelPreview.matched.length}
                >
                  {excelBusy ? "Applying…" : "Apply prices"}
                </button>
              </div>
            </div>

            {excelPreview.matched.length > 0 && (
              <div style={{ maxHeight: 180, overflowY: "auto" }}>
                <table style={{ width: "100%", fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "6px 14px" }}>
                        Row
                      </th>
                      <th style={{ textAlign: "left", padding: "6px 14px" }}>
                        Code
                      </th>
                      <th style={{ textAlign: "left", padding: "6px 14px" }}>
                        Name
                      </th>
                      <th style={{ textAlign: "left", padding: "6px 14px" }}>
                        Vendor
                      </th>
                      <th style={{ textAlign: "left", padding: "6px 14px" }}>
                        Category
                      </th>
                      <th style={{ textAlign: "right", padding: "6px 14px" }}>
                        New price
                      </th>
                      <th style={{ textAlign: "right", padding: "6px 14px" }}>
                        Entries affected
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {excelPreview.matched.map((m) => (
                      <tr key={m.row}>
                        <td style={{ padding: "5px 14px" }}>{m.row}</td>
                        <td className="mono" style={{ padding: "5px 14px" }}>
                          {m.code || "—"}
                        </td>
                        <td style={{ padding: "5px 14px" }}>{m.name || "—"}</td>
                        <td style={{ padding: "5px 14px" }}>
                          {m.vendor || "—"}
                        </td>
                        <td style={{ padding: "5px 14px" }}>
                          {m.category || "—"}
                        </td>
                        <td className="num" style={{ padding: "5px 14px" }}>
                          {formatNum(m.price)}
                        </td>
                        <td className="num" style={{ padding: "5px 14px" }}>
                          {m.ids.length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {excelPreview.unmatched.length > 0 && (
              <details style={{ padding: "8px 14px", fontSize: 12 }}>
                <summary style={{ cursor: "pointer", color: "var(--text-3)" }}>
                  Show skipped rows
                </summary>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {excelPreview.unmatched.map((u) => (
                    <li key={u.row} style={{ color: "var(--text-3)" }}>
                      Row {u.row}: {u.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <div
          className="tablewrap"
          style={{
            overflowX: "auto",
            overflowY: "auto",
            maxHeight: "70vh",
          }}
        >
          <table>
            <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
              <tr style={{ background: "var(--paper-dim)" }}>
                <th>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Date{" "}
                    <ColFilter
                      values={entries.map((e) => e.date)}
                      selected={cf.date}
                      onChange={(v) => setCf((f) => ({ ...f, date: v }))}
                      formatLabel={toDDMMYYYY}
                    />
                  </span>
                </th>
                <th>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Month{" "}
                    <ColFilter
                      values={entries.map((e) => toMonthKey(e.date))}
                      selected={cf.month}
                      onChange={(v) => setCf((f) => ({ ...f, month: v }))}
                      formatLabel={monthKeyToLabel}
                    />
                  </span>
                </th>
                <th>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Vendor{" "}
                    <ColFilter
                      values={entries.map((e) => e.vendor)}
                      selected={cf.vendor}
                      onChange={(v) => setCf((f) => ({ ...f, vendor: v }))}
                    />
                  </span>
                </th>
                <th>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Material{" "}
                    <ColFilter
                      values={entries.map((e) => e.name)}
                      selected={cf.name}
                      onChange={(v) => setCf((f) => ({ ...f, name: v }))}
                    />
                  </span>
                </th>
                <th>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Code{" "}
                    <ColFilter
                      values={entries.map((e) => e.code)}
                      selected={cf.code}
                      onChange={(v) => setCf((f) => ({ ...f, code: v }))}
                    />
                  </span>
                </th>
                <th>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Category{" "}
                    <ColFilter
                      values={entries.map((e) => e.category)}
                      selected={cf.category}
                      onChange={(v) => setCf((f) => ({ ...f, category: v }))}
                    />
                  </span>
                </th>
                <th className="num">
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Qty{" "}
                    <ColFilter
                      values={entries.map((e) => String(e.qty))}
                      selected={cf.qty}
                      onChange={(v) => setCf((f) => ({ ...f, qty: v }))}
                    />
                  </span>
                </th>
                <th>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    UOM{" "}
                    <ColFilter
                      values={entries.map((e) => e.uom)}
                      selected={cf.uom}
                      onChange={(v) => setCf((f) => ({ ...f, uom: v }))}
                    />
                  </span>
                </th>
                <th className="num">
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Unit price{" "}
                    <ColFilter
                      values={entries.map((e) => String(e.price ?? 0))}
                      selected={cf.price}
                      onChange={(v) => setCf((f) => ({ ...f, price: v }))}
                    />
                  </span>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((e) => {
                const isZero = (e.price ?? 0) === 0;
                const canEdit = canEditEntry(e);
                return (
                  <tr
                    key={e._id}
                    style={
                      isZero ? { background: "var(--red-light)" } : undefined
                    }
                  >
                    <td className="nowrap">{toDDMMYYYY(e.date)}</td>
                    <td className="nowrap">
                      {monthKeyToLabel(toMonthKey(e.date))}
                    </td>
                    <td>
                      {e.vendor || (
                        <span style={{ color: "var(--text-3)" }}>—</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 500 }}>{e.name}</td>
                    <td className="mono">{e.code}</td>
                    <td>
                      {e.category || (
                        <span style={{ color: "var(--text-3)" }}>—</span>
                      )}
                    </td>
                    <td className="num">{formatNum(e.qty)}</td>
                    <td>{e.uom}</td>
                    <td className="num pricecell">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={prices[e._id] ?? 0}
                        onFocus={() => handleFocus(e._id)}
                        onChange={(ev) =>
                          setPrices((p) => ({
                            ...p,
                            [e._id]:
                              ev.target.value === ""
                                ? ""
                                : parseFloat(ev.target.value),
                          }))
                        }
                        placeholder="0.00"
                        readOnly={
                          user?.role !== "admin" && Number(e.price) !== 0
                        }
                        style={{
                          background:
                            user?.role !== "admin" && Number(e.price) !== 0
                              ? "var(--paper-dim)"
                              : "#fff",
                          cursor:
                            user?.role !== "admin" && Number(e.price) !== 0
                              ? "not-allowed"
                              : "text",
                        }}
                      />
                    </td>
                    <td>
                      {canEdit ? (
                        user?.role === "admin" || Number(e.price) === 0 ? (
                          <button
                            className={`btn btn-sm ${saved[e._id] ? "btn-ghost" : "btn-in"}`}
                            onClick={() => handleSave(e._id)}
                          >
                            {saved[e._id] ? "✓ Saved" : "Save"}
                          </button>
                        ) : (
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--text-3)",
                              padding: "4px 8px",
                            }}
                          >
                            View only
                          </span>
                        )
                      ) : (
                        <span
                          style={{ fontSize: 11.5, color: "var(--text-3)" }}
                          title="Only Admin can edit a price that's already set"
                        >
                          🔒 Admin only
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
        {!entries.length && (
          <div className="empty">
            No inward entries yet.<p>Add inward entries first to set prices.</p>
          </div>
        )}
        {entries.length > 0 && !filtered.length && (
          <div className="empty">No entries match your filter.</div>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>Recently updated prices</h3>
        {recentPrices.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {recentPrices.map((item) => (
              <div
                key={item._id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  background: "var(--paper-dim)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: "var(--ink)" }}>
                    {item.name || "Unnamed item"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                    {item.code || "—"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, color: "var(--teal)" }}>
                    {formatNum(item.price)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {new Date(item.updatedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            No recent price updates yet. Save a price to see it here.
          </div>
        )}
      </div>
    </>
  );
}
