import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  getMaster,
  getInward,
  addInward,
  bulkInward,
  updateInward,
  deleteInward,
  getPendingInwardPOs,
  getPurchaseOrderByNumber,
  unwrapList,
} from "../api/api";
import { useAuth } from "../context/AuthContext";
import {
  formatNum,
  todayStr,
  readSheetFile,
  pickCol,
  parseExcelDate,
  exportXlsx,
  formatDateDMY,
} from "../utils/helpers";
import Pagination from "../components/Pagination";
import useClientPagination from "../hooks/useClientPagination";

const EMPTY = {
  date: todayStr(),
  invdate: "",
  challan: "",
  po: "",
  vendor: "",
  name: "",
  type: "",
  code: "",
  category: "",
  uom: "",
  qty: "",
  gin: "",
  by: "",
  location: "",
  remarks: "",
  price: "",
};

const emptyManualRow = () => ({
  _key: Math.random().toString(36).slice(2),
  name: "",
  type: "",
  code: "",
  category: "",
  uom: "",
  qty: "",
  gin: "",
  location: "",
  remarks: "",
});

/* ── Dropdown-with-Other pattern (same as Outward) ────────────────────── */
const RECEIVED_BY_OPTIONS = ["Tanmay Patil", "Krishna Vishwakarma"];
const OTHER_VALUE = "__other__";

function getSelectValue(value, options) {
  if (!value || value === OTHER_VALUE) return "Other";
  return options.includes(value) ? value : "Other";
}

/* ── Date + search helpers (same as Outward) ──────────────────────────── */
function parseDateValue(value) {
  if (!value && value !== 0) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoMatch) {
    const [year, month, day] = raw.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDateInRange(value, fromDate, toDate) {
  const current = parseDateValue(value);
  const start = parseDateValue(fromDate);
  const end = parseDateValue(toDate);

  if (!current) return true;
  if (start && current < start) return false;
  if (end && current > end) return false;
  return true;
}

function matchesSearchText(entry, query) {
  const text = (query || "").trim().toLowerCase();
  if (!text) return true;

 
  const haystack = [
    entry?.date,
    entry?.invdate,
    entry?.challan,
    entry?.po,
    entry?.vendor,
    entry?.name,
    entry?.type,
    entry?.code,
    entry?.category,
    entry?.uom,
    entry?.qty,
    entry?.gin,
    entry?.by,
    entry?.location,
    entry?.remarks,
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" ")
    .toLowerCase();

  return haystack.includes(text);
}

/* ── Inline Edit Modal ───────────────────────────────────────────────── */
function EditModal({ entry, master, canSeePrice, onSave, onClose }) {
  const [form, setForm] = useState({
    date: entry.date || "",
    invdate: entry.invdate || "",
    challan: entry.challan || "",
    po: entry.po || "",
    vendor: entry.vendor || "",
    name: entry.name || "",
    type: entry.type || "",
    code: entry.code || "",
    category: entry.category || "",
    uom: entry.uom || "",
    qty: entry.qty || "",
    gin: entry.gin || "",
    by: entry.by || "",
    location: entry.location || "",
    remarks: entry.remarks || "",
    price: entry.price || "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function autofill(name) {
    const m = master.find((x) => x.name === name);
    setForm((f) => ({
      ...f,
      name,
      type: m?.type || "",
      code: m?.code || "",
      category: m?.category || "",
      uom: m?.uom || "",
    }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setErr("");
    if (!form.name) {
      setErr("Please select a material.");
      return;
    }
    if (!form.po.trim()) {
      setErr("PO number is required.");
      return;
    }
    if (!form.qty || parseFloat(form.qty) <= 0) {
      setErr("Enter a valid quantity.");
      return;
    }
    if (!String(form.gin || "").trim()) {
      setErr("GIN is required.");
      return;
    }
    if (form.date && form.date > todayStr()) {
      setErr("Entry date cannot be a future date.");
      return;
    }
    setSaving(true);
    try {
      await onSave(entry._id, {
        ...form,
        qty: parseFloat(form.qty),
        gin: String(form.gin).trim(),
        price: parseFloat(form.price) || 0,
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  const dmyHint = {
    fontSize: 11,
    color: "var(--text-3, #8a8270)",
    marginTop: 2,
    display: "block",
  };

  const styles = {
    overlay: {
      position: "fixed",
      inset: 0,
      background: "rgba(28,26,22,0.55)",
      backdropFilter: "blur(3px)",
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      overflowY: "auto",
    },
    modal: {
      background: "var(--card)",
      border: "1px solid var(--line)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-lg)",
      width: "100%",
      maxWidth: "760px",
      height: "min(90vh,700px)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      flexShrink: 0,
    },
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "20px 28px",
      borderBottom: "1px solid var(--line)",
      flexShrink: 0,
    },
    body: { padding: "24px 28px", overflowY: "auto", flex: 1, minHeight: 0 },
    footer: {
      display: "flex",
      gap: 10,
      justifyContent: "flex-end",
      padding: "16px 28px",
      borderTop: "1px solid var(--line)",
      flexShrink: 0,
      background: "var(--paper-dim)",
    },
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--ink)",
              margin: 0,
            }}
          >
            Edit Inward Entry
          </h2>
          <button
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              color: "#8a8270",
              padding: "4px 8px",
              borderRadius: "4px",
              lineHeight: 1,
            }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <form
          onSubmit={handleSave}
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          <div style={styles.body}>
            <div className="formgrid">
              <div className="field">
                <label>Entry date</label>
                <input
                  type="date"
                  max={todayStr()}
                  value={form.date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, date: e.target.value }))
                  }
                />
                {form.date && (
                  <span style={dmyHint}>{formatDateDMY(form.date)}</span>
                )}
              </div>
              <div className="field">
                <label>Invoice date</label>
                <input
                  type="date"
                  value={form.invdate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, invdate: e.target.value }))
                  }
                />
                {form.invdate && (
                  <span style={dmyHint}>{formatDateDMY(form.invdate)}</span>
                )}
              </div>
              <div className="field">
                <label>Challan / Invoice no</label>
                <input
                  value={form.challan}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, challan: e.target.value }))
                  }
                  placeholder="e.g. INV-1023"
                />
              </div>
              <div className="field">
                <label>
                  PO no <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  value={form.po}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, po: e.target.value }))
                  }
                  placeholder="e.g. PO-4456"
                  style={{
                    borderColor: !form.po.trim() ? "var(--red)" : undefined,
                  }}
                />
              </div>
              <div className="field full">
                <label>Vendor name</label>
                <input
                  value={form.vendor}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, vendor: e.target.value }))
                  }
                  placeholder="e.g. ABC Vendors Pvt. Ltd."
                />
              </div>
              <div className="field full">
                <label>
                  Material description{" "}
                  <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <select
                  value={form.name}
                  onChange={(e) => autofill(e.target.value)}
                >
                  <option value="">— Select material —</option>
                  {master.map((m) => (
                    <option key={m._id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Material type</label>
                <input readOnly value={form.type} />
              </div>
              <div className="field">
                <label>Material code</label>
                <input readOnly value={form.code} />
              </div>
              <div className="field">
                <label>Category</label>
                <input readOnly value={form.category} />
              </div>
              <div className="field">
                <label>UOM</label>
                <input readOnly value={form.uom} />
              </div>
              <div className="field">
                <label>
                  Received qty <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.qty}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, qty: e.target.value }))
                  }
                  placeholder="0"
                />
              </div>
              <div className="field">
                <label>
                  GIN <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  value={form.gin}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, gin: e.target.value }))
                  }
                  placeholder="GIN number"
                />
              </div>
              <div className="field">
                <label>Received by</label>
                <select
                  value={getSelectValue(form.by, RECEIVED_BY_OPTIONS)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      by:
                        e.target.value === "Other"
                          ? OTHER_VALUE
                          : e.target.value,
                    }))
                  }
                >
                  <option value="">— Select received by —</option>
                  {RECEIVED_BY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  <option value="Other">Other</option>
                </select>
                {getSelectValue(form.by, RECEIVED_BY_OPTIONS) === "Other" && (
                  <input
                    value={form.by === OTHER_VALUE ? "" : form.by}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, by: e.target.value }))
                    }
                    placeholder="Enter name"
                    style={{ marginTop: 8 }}
                  />
                )}
              </div>
              <div className="field">
                <label>Storage location</label>
                <input
                  value={form.location}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, location: e.target.value }))
                  }
                  placeholder="e.g. Warehouse A / Rack 3"
                />
              </div>
              <div className="field">
                <label>Remarks</label>
                <input
                  value={form.remarks}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, remarks: e.target.value }))
                  }
                  placeholder="Optional notes"
                />
              </div>
              {canSeePrice && (
                <div
                  className="field full"
                  style={{
                    borderTop: "1px dashed var(--line)",
                    paddingTop: 14,
                    marginTop: 4,
                  }}
                >
                  <label>
                    Unit price{" "}
                    <span
                      style={{
                        fontWeight: 400,
                        color: "#8a8270",
                        marginLeft: 6,
                      }}
                    >
                      (purchase team only)
                    </span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.price}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, price: e.target.value }))
                    }
                    placeholder="0.00"
                  />
                </div>
              )}
            </div>
            {err && (
              <div className="alert err" style={{ marginTop: 14 }}>
                {err}
              </div>
            )}
          </div>
          <div style={styles.footer}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-in" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const tdS = { padding: "7px 10px", verticalAlign: "middle" };

/* ── Main component ──────────────────────────────────────────────────── */
export default function InwardEntry() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const canSeePrice = user?.role === "admin" || user?.role === "purchase";
  const canEditDelete = user?.role === "admin"|| user?.role === "store" || user?.role === "store_manager";

  const [master, setMaster] = useState([]);
  const [entries, setEntries] = useState([]);
  const [poList, setPoList] = useState([]);
  const [poSearch, setPoSearch] = useState("");
  const [poDropdownOpen, setPoDropdownOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState({ text: "", ok: true });
  const [bulkMsg, setBulkMsg] = useState({ text: "", ok: true });
  const [skippedRows, setSkippedRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [poManual, setPoManual] = useState(false);
  const [poRows, setPoRows] = useState([]);
  const [poLoading, setPoLoading] = useState(false);
  const [manualRows, setManualRows] = useState([emptyManualRow()]);

  // ── PR → Inward hand-off ───────────────────────────────────────────────
  // The Purchase Request page's "Pending Inward Entry" button navigates here with
  // `state: { presetPo, prNumber, prPoNumbers }`. We wait until poList has
  // loaded (so the preset PO actually exists as a searchable option), apply
  // it once, show a small banner, then clear the navigation state.
  const prefillAppliedRef = useRef(false);
  const [prBanner, setPrBanner] = useState(null); // { prNumber, poNumbers }

  // ── Entries table filters ─────────────────────────────────────────────
  const [searchText, setSearchText] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // ── Staged upload (waits for confirmation) ────────────────────────────
  const [pending, setPending] = useState(null);
  const [uploading, setUploading] = useState(false);

  // ── Duplicate detection state — DISABLED ──────────────────────────────
  // const [dupMode, setDupMode] = useState(false);
  // const [dupGroups, setDupGroups] = useState([]);
  // const [dupLoading, setDupLoading] = useState(false);
  // const [dupMsg, setDupMsg] = useState("");
  // const [selectedDups, setSelectedDups] = useState(new Set());
  // const [dupFrom, setDupFrom] = useState("");
  // const [dupTo, setDupTo] = useState("");

  const load = useCallback(async () => {
    const [m, e, pos] = await Promise.all([
      getMaster(),
      getInward(),
      getPendingInwardPOs(),
    ]);
    setMaster(unwrapList(m));
    setEntries(unwrapList(e));
    setPoList(pos);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Consume the PR hand-off once the PO dropdown data is available.
  useEffect(() => {
    const st = location.state;
    if (!st || (!st.presetPo && !st.prNumber) || prefillAppliedRef.current) return;
    if (st.presetPo && !poList.length) return; // wait for PO dropdown data to load

    prefillAppliedRef.current = true;

    if (st.presetPo) {
      handlePoSelect(st.presetPo);
    }
    if (st.prNumber) {
      setPrBanner({ prNumber: st.prNumber, poNumbers: st.prPoNumbers || [] });
    }

    // Clear the router state so it isn't reapplied on refresh/back-nav.
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, poList, navigate, location.pathname]);

  const filteredEntries = entries.filter((entry) => {
    return (
      isDateInRange(entry.date, fromDate, toDate) &&
      matchesSearchText(entry, searchText)
    );
  });
  const { pageItems, page, pageSize, total, setPage, setPageSize } =
    useClientPagination(filteredEntries, 25);

  // ── PO search/filter for the searchable PO Number field ───────────────
  const filteredPoList = poList.filter((po) => {
    const q = poSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      po.poNumber?.toLowerCase().includes(q) ||
      po.vendorName?.toLowerCase().includes(q)
    );
  });

  /* ── Duplicate detection logic — DISABLED ─────────────────────────────
  function findDuplicates(fromArg, toArg) {
    const from = fromArg !== undefined ? fromArg : dupFrom;
    const to = toArg !== undefined ? toArg : dupTo;

    setDupLoading(true);
    setDupMsg("");
    setSelectedDups(new Set());

    const scope = entries.filter((e) => isDateInRange(e.date, from, to));

    // Group by name + vendor + date + qty
    const map = {};
    scope.forEach((e) => {
      const key = [
        (e.name || "").trim().toLowerCase(),
        (e.vendor || "").trim().toLowerCase(),
        (e.date || "").trim(),
        String(parseFloat(e.qty) || 0),
      ].join("|||");
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });

    // Group by challan + name
    const challanMap = {};
    scope.forEach((e) => {
      if (!e.challan || !e.challan.trim()) return;
      const key = [
        (e.challan || "").trim().toLowerCase(),
        (e.name || "").trim().toLowerCase(),
      ].join("|||");
      if (!challanMap[key]) challanMap[key] = [];
      challanMap[key].push(e);
    });

    const groups = [];
    const seen = new Set();

    Object.values(map).forEach((group) => {
      if (group.length < 2) return;
      const ids = group.map((e) => e._id).sort().join(",");
      if (seen.has(ids)) return;
      seen.add(ids);
      groups.push({
        reason: "Same material, vendor, date & qty",
        entries: group,
      });
    });

    Object.values(challanMap).forEach((group) => {
      if (group.length < 2) return;
      const ids = group.map((e) => e._id).sort().join(",");
      if (seen.has(ids)) return;
      seen.add(ids);
      groups.push({
        reason: "Same challan / invoice no & material",
        entries: group,
      });
    });

    setDupGroups(groups);
    setDupLoading(false);

    const rangeNote =
      from || to
        ? ` (${from ? formatDateDMY(from) : "start"} -> ${to ? formatDateDMY(to) : "today"}, ${scope.length} entries scanned)`
        : ` (all ${scope.length} entries scanned)`;

    if (!groups.length) {
      setDupMsg(`No duplicates found${rangeNote}.`);
    } else {
      const extraCount = groups.reduce((s, g) => s + g.entries.length - 1, 0);
      setDupMsg(
        `Found ${groups.length} duplicate group(s) — ${extraCount} extra entr${extraCount === 1 ? "y" : "ies"} can be removed${rangeNote}.`,
      );
    }
  }

  function toggleDupSelect(id) {
    setSelectedDups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllDuplicates() {
    const toSelect = new Set();
    dupGroups.forEach((g) => {
      g.entries.slice(1).forEach((e) => toSelect.add(e._id));
    });
    setSelectedDups(toSelect);
  }

  function clearDupMode() {
    setDupMode(false);
    setDupGroups([]);
    setDupMsg("");
    setSelectedDups(new Set());
  }

  async function deleteSelectedDuplicates() {
    if (!selectedDups.size) return;

    const toDelete = entries.filter((e) => selectedDups.has(e._id));
    const preview = toDelete
      .map(
        (e) =>
          `- ${e.name}  |  ${e.vendor || "-"}  |  ${formatDateDMY(e.date)}  |  Qty: ${e.qty}  |  Challan: ${e.challan || "-"}`,
      )
      .join("\n");

    const confirmed = window.confirm(
      `You are about to permanently DELETE ${selectedDups.size} inward entr${selectedDups.size === 1 ? "y" : "ies"}:\n\n${preview}\n\nThis will affect your stock balances. This action cannot be undone.\n\nAre you sure you want to proceed?`,
    );
    if (!confirmed) return;

    let deleted = 0,
      failed = 0;
    for (const id of selectedDups) {
      try {
        await deleteInward(id);
        deleted++;
      } catch {
        failed++;
      }
    }

    setDupMsg(
      `Deleted ${deleted} entr${deleted === 1 ? "y" : "ies"} successfully.${failed ? ` ${failed} failed — please try again.` : ""}`,
    );
    setSelectedDups(new Set());
    await load();
    setDupGroups([]);
    setTimeout(() => findDuplicates(), 300);
  }
  ──────────────────────────────────────────────────────────────────────── */

  // ── PO logic ──────────────────────────────────────────────────────────
  async function handlePoSelect(poNumber) {
    setForm((f) => ({ ...f, po: poNumber, vendor: "" }));
    setPoSearch(poNumber);
    setPoRows([]);
    setPoManual(false);
    if (!poNumber) return;
    setPoLoading(true);
    try {
      const po = await getPurchaseOrderByNumber(poNumber);
      setForm((f) => ({ ...f, vendor: po.vendorName || "" }));
      const rows = (po.items || []).map((it) => {
        const mat = master.find((m) => m.name === it.name || m.code === it.code);
        return {
          _key: Math.random().toString(36).slice(2),
          name: it.name,
          type: mat?.type || "",
          code: it.code || mat?.code || "",
          category: it.category || mat?.category || "",
          uom: it.uom || mat?.uom || "",
          poQty: it.orderedQty,
          qty: String(it.orderedQty),
          gin: "",
          location: "",
          remarks: "",
        };
      });
      setPoRows(rows);
    } catch {
      setPoRows([]);
    } finally {
      setPoLoading(false);
    }
  }

  function updatePoRow(key, patch) {
    setPoRows((list) =>
      list.map((r) => (r._key === key ? { ...r, ...patch } : r)),
    );
  }

  function updateManualRow(key, patch) {
    setManualRows((list) =>
      list.map((r) => (r._key === key ? { ...r, ...patch } : r)),
    );
  }

  function autofillManualRow(key, name) {
    const m = master.find((x) => x.name === name);
    updateManualRow(key, {
      name,
      type: m?.type || "",
      code: m?.code || "",
      category: m?.category || "",
      uom: m?.uom || "",
    });
  }

  function addManualRow() {
    setManualRows((list) => [...list, emptyManualRow()]);
  }

  function removeManualRow(key) {
    setManualRows((list) =>
      list.length > 1 ? list.filter((r) => r._key !== key) : list,
    );
  }

  /* ── Submit ─── */
  async function handleSubmit(e) {
    e.preventDefault();
    setMsg({ text: "", ok: true });

    const receivedBy = form.by === OTHER_VALUE ? "" : form.by;

    if (!form.date.trim()) {
      setMsg({ text: "Please enter the entry date.", ok: false });
      return;
    }
    if (form.date > todayStr()) {
      setMsg({
        text: "Entry date cannot be a future date.",
        ok: false,
      });
      return;
    }
    if (!form.vendor.trim()) {
      setMsg({ text: "Please enter the vendor name.", ok: false });
      return;
    }
    if (!receivedBy.trim()) {
      setMsg({ text: "Please enter who received the material.", ok: false });
      return;
    }
    if (!form.po.trim()) {
      setMsg({
        text: "Please select or enter a PO number.",
        ok: false,
      });
      return;
    }

    if (form.po && poRows.length > 0) {
      const invalidQty = poRows.find((r) => !r.qty || parseFloat(r.qty) <= 0);
      if (invalidQty) {
        setMsg({
          text: `"${invalidQty.name}": enter a valid received qty.`,
          ok: false,
        });
        return;
      }
      const invalidGin = poRows.find((r) => !String(r.gin || "").trim());
      if (invalidGin) {
        setMsg({
          text: `"${invalidGin.name}": enter GIN.`,
          ok: false,
        });
        return;
      }
      const invalidLoc = poRows.find((r) => !r.location.trim());
      if (invalidLoc) {
        setMsg({
          text: `"${invalidLoc.name}": enter a storage location.`,
          ok: false,
        });
        return;
      }
      setLoading(true);
      try {
        const batch = poRows.map((r) => ({
          date: form.date,
          invdate: form.invdate,
          challan: form.challan,
          po: form.po,
          vendor: form.vendor,
          name: r.name,
          type: r.type,
          code: r.code,
          category: r.category,
          uom: r.uom,
          qty: parseFloat(r.qty),
          gin: String(r.gin).trim(),
          by: receivedBy,
          location: r.location,
          remarks: r.remarks,
          price: 0,
        }));
        await bulkInward(batch);
        setMsg({
          text: `✓ ${batch.length} inward entr${batch.length === 1 ? "y" : "ies"} saved from ${form.po}.`,
          ok: true,
        });
        setForm({ ...EMPTY, date: form.date });
        setPoRows([]);
        load();
        setTimeout(() => setMsg({ text: "", ok: true }), 5000);
      } catch (err) {
        setMsg({ text: "Error: " + err.message, ok: false });
      } finally {
        setLoading(false);
      }
    } else {
      const validRows = manualRows.filter(
        (r) => r.name && parseFloat(r.qty) > 0,
      );
      if (!validRows.length) {
        setMsg({
          text: "Add at least one item with a material and quantity.",
          ok: false,
        });
        return;
      }
      const missingGin = validRows.find((r) => !String(r.gin || "").trim());
      if (missingGin) {
        setMsg({
          text: `"${missingGin.name}": enter GIN.`,
          ok: false,
        });
        return;
      }
      const missingLoc = validRows.find((r) => !r.location.trim());
      if (missingLoc) {
        setMsg({
          text: `"${missingLoc.name}": enter a storage location.`,
          ok: false,
        });
        return;
      }
      setLoading(true);
      try {
        const batch = validRows.map((r) => ({
          date: form.date,
          invdate: form.invdate,
          challan: form.challan,
          po: form.po,
          vendor: form.vendor,
          by: receivedBy,
          name: r.name,
          type: r.type,
          code: r.code,
          category: r.category,
          uom: r.uom,
          qty: parseFloat(r.qty),
          gin: String(r.gin).trim(),
          location: r.location,
          remarks: r.remarks,
          price: 0,
        }));
        if (batch.length === 1) await addInward(batch[0]);
        else await bulkInward(batch);

        setMsg({
          text: `✓ ${validRows.length} inward entr${validRows.length === 1 ? "y" : "ies"} saved.`,
          ok: true,
        });
        setForm({ ...EMPTY, date: todayStr() });
        setManualRows([emptyManualRow()]);
        load();
        setTimeout(() => setMsg({ text: "", ok: true }), 4000);
      } catch (err) {
        setMsg({ text: "Error: " + err.message, ok: false });
      } finally {
        setLoading(false);
      }
    }
  }

  async function handleEditSave(id, data) {
    await updateInward(id, {
      ...data,
      by: data.by === OTHER_VALUE ? "" : data.by,
    });
    setEditEntry(null);
    load();
  }

  async function handleDelete(e) {
    if (
      !window.confirm(
        `Delete this inward entry for "${e.name}" (Qty: ${e.qty})?\n\nThis will affect the stock balance.`,
      )
    )
      return;
    try {
      await deleteInward(e._id);
      load();
    } catch (err) {
      alert("Error: " + err.message);
    }
  }

  /* ── STEP 1: read + validate the file. Nothing is saved yet. ────────── */
  async function handleBulkFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBulkMsg({ text: "Reading file…", ok: true });
    setSkippedRows([]);
    setPending(null);
    try {
      const rows = await readSheetFile(file);
      if (!rows.length) {
        setBulkMsg({ text: "Sheet is empty.", ok: false });
        e.target.value = "";
        return;
      }
      const today = todayStr();

      // Match key: Material + Vendor + Date + Challan/PO no + Qty
      const keyOf = (o) =>
        [
          (o.name || "").trim().toLowerCase(),
          (o.vendor || "").trim().toLowerCase(),
          (o.date || "").trim(),
          (o.challan || "").trim().toLowerCase(),
          (o.po || "").trim().toLowerCase(),
          String(parseFloat(o.qty) || 0),
        ].join("|||");

      const existingByKey = {};
      entries.forEach((en) => {
        existingByKey[keyOf(en)] = en;
      });

      const batch = [];
      const toDelete = new Set();
      const skips = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const excelRow = i + 2; // header is row 1

        const matName = pickCol(row, [
          "materialname",
          "material",
          "name",
          "materialdescription",
          "description",
        ]);
        const qtyRaw = pickCol(row, [
          "qty",
          "quantity",
          "receivedqty",
          "receivedquantity",
        ]);
        const qty = parseFloat(qtyRaw);
        const gin = pickCol(row, ["gin", "ginno", "ginnumber"]);
        const vendor = pickCol(row, ["vendorname", "vendor", "supplier"]);
        const by = pickCol(row, ["receivedby", "by"]);
        const location = pickCol(row, ["location", "rack", "warehouse"]);
        const po = pickCol(row, ["pono", "po"]);
        const challan = pickCol(row, [
          "challanno",
          "invoiceno",
          "challan",
          "invoice",
        ]);

        const skipInfo = {
          row: excelRow,
          material: matName || "(blank)",
          vendor: vendor || "—",
          qty: qtyRaw || "—",
          gin: gin || "—",
          po: po || "—",
          challan: challan || "—",
        };

        if (!matName) {
          skips.push({ ...skipInfo, reason: "Material name is blank" });
          continue;
        }
        const m = master.find(
          (x) => x.name.toLowerCase() === matName.toLowerCase(),
        );
        if (!m) {
          skips.push({
            ...skipInfo,
            reason: `"${matName}" not found in master list`,
          });
          continue;
        }
        if (!qty || qty <= 0) {
          skips.push({
            ...skipInfo,
            reason: "Qty is missing or not a valid number",
          });
          continue;
        }
        if (!gin) {
          skips.push({ ...skipInfo, reason: "GIN is blank (GIN is compulsory)" });
          continue;
        }
        if (!vendor) {
          skips.push({ ...skipInfo, reason: "Vendor name is blank" });
          continue;
        }
        if (!by) {
          skips.push({ ...skipInfo, reason: "Received By is blank" });
          continue;
        }
        if (!location) {
          skips.push({ ...skipInfo, reason: "Location is blank" });
          continue;
        }
        if (!po) {
          skips.push({
            ...skipInfo,
            reason: "PO No is blank (PO No is compulsory)",
          });
          continue;
        }

        const date =
          parseExcelDate(pickCol(row, ["date", "entrydate"])) || today;
        if (date > today) {
          skips.push({
            ...skipInfo,
            reason: "Entry date is in the future",
          });
          continue;
        }
        const newEntry = {
          date,
          invdate: parseExcelDate(pickCol(row, ["invoicedate", "invdate"])),
          challan,
          po,
          vendor,
          name: m.name,
          type: m.type,
          code: m.code,
          category: m.category,
          uom: m.uom,
          qty,
          gin: String(gin).trim(),
          by,
          location,
          remarks: pickCol(row, ["remarks", "notes"]),
          price: 0,
        };

        const key = keyOf(newEntry);
        const match = existingByKey[key];
        if (match) {
          toDelete.add(match._id);
          delete existingByKey[key];
        }

        newEntry._excelRow = excelRow;
        newEntry._isReplace = !!match;
        batch.push(newEntry);
      }

      setSkippedRows(skips);

      if (!batch.length) {
        setBulkMsg({
          text: `No valid rows found in "${file.name}". ${skips.length} row(s) skipped — see details below.`,
          ok: false,
        });
        e.target.value = "";
        return;
      }

      setPending({
        fileName: file.name,
        batch,
        toDelete: Array.from(toDelete),
      });
      setBulkMsg({
        text: `Ready to upload "${file.name}" — review below, then press Confirm & Upload. Nothing has been saved yet.`,
        ok: true,
      });
    } catch (err) {
      setBulkMsg({ text: "Error: " + err.message, ok: false });
    }
    e.target.value = "";
  }

  /* ── STEP 2: user confirmed — delete matches, then insert ───────────── */
  async function confirmUpload() {
    if (!pending) return;
    setUploading(true);
    setBulkMsg({ text: "Uploading…", ok: true });
    try {
      for (const id of pending.toDelete) {
        try {
          await deleteInward(id);
        } catch {
          /* continue */
        }
      }
      const clean = pending.batch.map(
        ({ _excelRow, _isReplace, ...rest }) => rest,
      );
      const res = await bulkInward(clean);

      const parts = [
        `✓ ${res.inserted} entr${res.inserted === 1 ? "y" : "ies"} imported.`,
      ];
      if (pending.toDelete.length)
        parts.push(
          `${pending.toDelete.length} existing entr${pending.toDelete.length === 1 ? "y" : "ies"} replaced.`,
        );
      if (skippedRows.length)
        parts.push(`${skippedRows.length} skipped — see details below.`);
      setBulkMsg({ text: parts.join(" "), ok: true });
      setPending(null);
      load();
    } catch (err) {
      setBulkMsg({ text: "Error: " + err.message, ok: false });
    } finally {
      setUploading(false);
    }
  }

  function cancelUpload() {
    setPending(null);
    setSkippedRows([]);
    setBulkMsg({ text: "Upload cancelled — nothing was saved.", ok: true });
  }

  function downloadSkippedRows() {
    exportXlsx(
      [
        "Row #",
        "Material",
        "Vendor",
        "Qty",
        "GIN",
        "PO No",
        "Challan No",
        "Reason skipped",
      ],
      skippedRows.map((s) => [
        s.row,
        s.material,
        s.vendor,
        s.qty,
        s.gin,
        s.po,
        s.challan,
        s.reason,
      ]),
      "Skipped Rows",
      "Skipped_Inward_Rows.xlsx",
    );
  }

  function downloadTemplate() {
    exportXlsx(
      [
        "Date",
        "Invoice Date",
        "Challan No",
        "PO No",
        "Vendor Name",
        "Material Name",
        "Qty",
        "GIN",
        "Received By",
        "Location",
        "Remarks",
      ],
      [
        [
          formatDateDMY(todayStr()),
          "",
          "INV-1001",
          "PO-2001",
          "ABC Suppliers",
          "[Material Name from master]",
          "10",
          "GIN-001",
          "Store Keeper",
          "Rack A",
          "",
        ],
      ],
      "Inward Template",
      "Stockyard_Inward_Template.xlsx",
    );
  }

  const validManualCount = manualRows.filter(
    (r) => r.name && parseFloat(r.qty) > 0,
  ).length;

  const filterInputStyle = {
    border: "1.5px solid var(--line)",
    borderRadius: "var(--radius)",
    padding: "10px 14px",
    height: "var(--input-h)",
    fontSize: "13.5px",
    fontFamily: "'Inter', 'Poppins', sans-serif",
    background: "#fff",
    color: "var(--ink)",
    width: "100%",
    transition: "border-color var(--transition), box-shadow var(--transition)",
  };
  const filterFocus = (e) => {
    e.target.style.borderColor = "var(--teal)";
    e.target.style.boxShadow = "0 0 0 3px rgba(31,92,82,.1)";
  };
  const filterBlur = (e) => {
    e.target.style.borderColor = "var(--line)";
    e.target.style.boxShadow = "none";
  };
  const filterLabelStyle = {
    fontSize: 12,
    color: "#5a5444",
    fontWeight: 600,
    letterSpacing: "0.1px",
  };
  const dmyHint = {
    fontSize: 11,
    color: "var(--text-3, #8a8270)",
    marginTop: 2,
    display: "block",
  };

  return (
    <>
      {editEntry && (
        <EditModal
          entry={editEntry}
          master={master}
          canSeePrice={canSeePrice}
          onSave={handleEditSave}
          onClose={() => setEditEntry(null)}
        />
      )}

      <style>{`
        .compact-form .formgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px,1fr)); gap:14px 16px; }
        .compact-form .field.full { grid-column: 1/-1; }
        .compact-form .field label { font-size:12px; font-weight:600; margin-bottom:5px; display:block; color:var(--ink); }
        .compact-form .field input, .compact-form .field select { padding:8px 10px; font-size:13.5px; height:36px; border-radius:8px; border:1px solid var(--line); }
        .compact-form .field input:focus, .compact-form .field select:focus { outline:none; border-color:#1f5c46; box-shadow:0 0 0 3px rgba(31,92,70,.14); }
        .compact-form .section-label { display:flex; align-items:center; gap:10px; margin:22px 0 12px; font-size:11px; font-weight:700; letter-spacing:0.07em; text-transform:uppercase; color:var(--text-3); }
        .compact-form .section-label::after { content:''; flex:1; height:1px; background:var(--line); }
        .compact-form .actionrow { margin-top:20px; padding-top:16px; border-top:1px solid var(--line); align-items:center; }
       .compact-form .doc-row { display:grid; grid-template-columns:repeat(5,1fr); gap:14px 16px; margin-bottom:14px; align-items: start; }

        .pr-inward-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          background: var(--teal-light);
          color: var(--teal-dark);
          border-radius: 8px;
          padding: 9px 14px;
          font-size: 12.5px;
          margin-bottom: 14px;
        }
        .pr-inward-banner button {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--teal-dark);
          font-size: 13px;
          line-height: 1;
          flex-shrink: 0;
        }

        .stage-box { border:1.5px solid var(--line); border-radius:10px; overflow:hidden; margin-top:14px; text-align:left; }
        .stage-head { background:var(--paper-dim); padding:12px 16px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; border-bottom:1px solid var(--line); }
        .stage-stat { display:inline-flex; flex-direction:column; gap:2px; margin-right:18px; }
        .stage-stat b { font-size:18px; line-height:1; color:var(--ink); }
        .stage-stat span { font-size:11px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em; }

        /* Recent inward entries — taller rows, taller section */
        .entries-section .tablewrap { max-height: 82vh !important; overflow-x:auto; -webkit-overflow-scrolling: touch; }
        .entries-section table td, .entries-section table th { padding: 10px 8px; }
        .entries-section table { width: 100%; }
        .filterbar { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; margin-bottom:12px; }

        /* ── Searchable PO dropdown ── */
    .po-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin: 0;
  background: #fff;
  border: 1px solid var(--line);
  border-top: none;
  border-radius: 0 0 8px 8px;
  max-height: 240px;
  overflow-y: auto;
  z-index: 50;
  box-shadow: var(--shadow-lg, 0 4px 14px rgba(0,0,0,0.12));
}
        .po-dropdown-item {
          padding: 9px 12px;
          font-size: 13px;
          cursor: pointer;
          border-bottom: 1px solid var(--line);
        }
        .po-dropdown-item:last-child { border-bottom: none; }
        .po-dropdown-item:hover { background: var(--paper-dim); }
        .po-dropdown-empty {
          padding: 8px 12px;
          font-size: 12.5px;
          color: var(--text-3);
        }
        .po-dropdown-manual {
          color: var(--teal-dark);
          font-weight: 600;
        }

        /* ---------- Responsive breakpoints ---------- */
        @media (max-width:1100px) { .compact-form .doc-row { grid-template-columns:repeat(4,1fr); } }
        @media (max-width:900px) {
          .compact-form .doc-row { grid-template-columns:repeat(3,1fr); }
          .compact-form .formgrid { grid-template-columns:repeat(2,1fr); }
        }
        @media (max-width:600px) {
          .pagehead { flex-direction:column; align-items:flex-start; gap:8px; }
          .card { padding:12px; }
          .compact-form .doc-row { grid-template-columns:1fr; }
          .compact-form .formgrid { grid-template-columns:1fr; }
          .actionrow { flex-direction:column; align-items:stretch; }
          .actionrow .btn { width:100%; }
          .entries-section table { min-width:900px; }
          .uploadbox { flex-direction:column; align-items:flex-start; }
          .filterbar > label, .filterbar > button { width:100%; }
        }
        @media (max-width:420px) {
          .compact-form h3, .card h3 { font-size:15px; }
          .pagehead-text h2 { font-size:18px; }
        }
      `}</style>

      <div className="pagehead">
        <div className="pagehead-text">
          <h2>Inward Entry</h2>
          <p>
            Record materials received into stock. Details auto-fill from the
            master list.
          </p>
        </div>
      </div>

      {/* ── Bulk upload ── */}
      <div className="card">
        <h3>Bulk upload</h3>
        <div className="uploadbox">
          <label htmlFor="inward-bulk">
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
            Choose sheet (.xlsx, .xls, .csv)
          </label>
          <input
            type="file"
            id="inward-bulk"
            accept=".xlsx,.xls,.csv"
            onChange={handleBulkFile}
          />
          <div className="hint">
            Required:{" "}
            <strong>
              Material Name, Qty, GIN, Vendor Name, Received By, Location, PO No
            </strong>
            &nbsp;(Challan No is optional).
            <br />
            Date format dd/mm/yyyy. The file is checked first — nothing is saved
            until you confirm.{" "}
            <button onClick={downloadTemplate}>Download template</button>
          </div>

          {bulkMsg.text && (
            <div
              className={`alert ${bulkMsg.ok ? "ok" : "err"}`}
              style={{ marginTop: 14, textAlign: "left" }}
            >
              {bulkMsg.text}
            </div>
          )}

          {/* ── Staged upload preview + confirm ── */}
          {pending && (
            <div className="stage-box">
              <div className="stage-head">
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                  <span className="stage-stat">
                    <b>{pending.batch.length}</b>
                    <span>rows to save</span>
                  </span>
                  <span className="stage-stat">
                    <b style={{ color: "var(--rust-dark)" }}>
                      {pending.toDelete.length}
                    </b>
                    <span>will replace existing</span>
                  </span>
                  <span className="stage-stat">
                    <b style={{ color: "var(--red)" }}>{skippedRows.length}</b>
                    <span>skipped</span>
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn btn-ghost"
                    onClick={cancelUpload}
                    disabled={uploading}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-in"
                    onClick={confirmUpload}
                    disabled={uploading}
                  >
                    {uploading
                      ? "Uploading…"
                      : `✓ Confirm & Upload ${pending.batch.length} row${pending.batch.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </div>

              {pending.toDelete.length > 0 && (
                <div
                  className="alert err"
                  style={{ margin: 12, textAlign: "left" }}
                >
                  ⚠ {pending.toDelete.length} existing entr
                  {pending.toDelete.length === 1 ? "y" : "ies"} will be deleted
                  and replaced by the uploaded data. This affects stock balances
                  and cannot be undone.
                </div>
              )}

              <div
                className="tablewrap"
                style={{ margin: 0, maxHeight: 320, overflowY: "auto" }}
              >
                <table style={{ minWidth: 1100 }}>
                  <thead>
                    <tr>
                      <th>Row #</th>
                      <th>Date</th>
                      <th>Material</th>
                      <th>Vendor</th>
                      <th>Challan</th>
                      <th>PO</th>
                      <th className="num">Qty</th>
                      <th>GIN</th>
                      <th>Location</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.batch.map((r, i) => (
                      <tr
                        key={i}
                        style={{
                          background: r._isReplace ? "#fff8f4" : undefined,
                        }}
                      >
                        <td className="mono">{r._excelRow}</td>
                        <td className="nowrap">{formatDateDMY(r.date)}</td>
                        <td style={{ fontWeight: 500 }}>{r.name}</td>
                        <td>{r.vendor || "—"}</td>
                        <td className="mono">{r.challan || "—"}</td>
                        <td className="mono">{r.po || "—"}</td>
                        <td className="num">{formatNum(r.qty)}</td>
                        <td className="mono">{r.gin || "—"}</td>
                        <td>{r.location || "—"}</td>
                        <td>
                          {r._isReplace ? (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: "var(--rust-dark)",
                                background: "#f8ede7",
                                padding: "2px 8px",
                                borderRadius: 10,
                                whiteSpace: "nowrap",
                              }}
                            >
                              REPLACES EXISTING
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: "var(--teal-dark)",
                                background: "var(--teal-light)",
                                padding: "2px 8px",
                                borderRadius: 10,
                                whiteSpace: "nowrap",
                              }}
                            >
                              NEW
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Skipped rows ── */}
          {skippedRows.length > 0 && (
            <div style={{ marginTop: 14, textAlign: "left" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--text-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Skipped rows ({skippedRows.length})
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={downloadSkippedRows}
                >
                  Download skipped rows
                </button>
              </div>
              <div
                className="tablewrap"
                style={{ maxHeight: 280, overflowY: "auto" }}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Row #</th>
                      <th>Material</th>
                      <th>Vendor</th>
                      <th className="num">Qty</th>
                      <th>GIN</th>
                      <th>PO No</th>
                      <th>Challan No</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skippedRows.map((s, i) => (
                      <tr key={i}>
                        <td className="mono">{s.row}</td>
                        <td>{s.material}</td>
                        <td>{s.vendor}</td>
                        <td className="num">{s.qty}</td>
                        <td className="mono">{s.gin || "—"}</td>
                        <td className="mono">{s.po}</td>
                        <td className="mono">{s.challan}</td>
                        <td style={{ color: "var(--rust-dark)" }}>
                          {s.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Find & Remove Duplicates — DISABLED ──────────────────────────
      <div className="card">
        ... duplicate finder card was here; re-enable by uncommenting this
        block together with the duplicate state and the five functions above.
      </div>
      ────────────────────────────────────────────────────────────────── */}

      {/* ── New entry form ── */}
      <div className="card compact-form">
        <h3>New inward entry</h3>
        <p
          style={{ fontSize: 12, color: "var(--text-3)", margin: "-6px 0 12px" }}
        >
          <span style={{ color: "var(--red)" }}>*</span> required
        </p>

        {prBanner && (
          <div className="pr-inward-banner">
            <span>
              Receiving against <strong>{prBanner.prNumber}</strong>
              {prBanner.poNumbers.length > 1
                ? ` — select the PO to receive: ${prBanner.poNumbers.join(", ")}`
                : prBanner.poNumbers.length === 1
                  ? ` — PO ${prBanner.poNumbers[0]} selected below`
                  : ""}
            </span>
            <button type="button" onClick={() => setPrBanner(null)} title="Dismiss">
              ✕
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="section-label">Document details</div>
          <div className="doc-row">
            <div className="field">
              <label>
                Entry date <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <input
                required
                type="date"
                max={todayStr()}
                value={form.date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date: e.target.value }))
                }
              />
              {form.date && (
                <span style={dmyHint}>{formatDateDMY(form.date)}</span>
              )}
            </div>
            <div className="field">
              <label>Invoice date</label>
              <input
                type="date"
                value={form.invdate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, invdate: e.target.value }))
                }
              />
              {form.invdate && (
                <span style={dmyHint}>{formatDateDMY(form.invdate)}</span>
              )}
            </div>
            <div className="field">
              <label>Challan / Invoice no</label>
              <input
                value={form.challan}
                onChange={(e) =>
                  setForm((f) => ({ ...f, challan: e.target.value }))
                }
                placeholder="e.g. INV-1023 (optional)"
              />
            </div>

            {/* ── Searchable PO Number field ── */}
            <div className="field" style={{ position: "relative" }}>
              <label>
                PO Number <span style={{ color: "var(--red)" }}>*</span>
              </label>
              {poManual ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    required
                    value={form.po}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, po: e.target.value }))
                    }
                    placeholder="Enter PO number manually"
                    autoFocus
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ whiteSpace: "nowrap" }}
                    onClick={() => {
                      setPoManual(false);
                      setPoSearch("");
                      setForm((f) => ({ ...f, po: "" }));
                      setPoRows([]);
                    }}
                  >
                    ← Back
                  </button>
                </div>
              ) : (
                <>
                  <input
                    required
                    value={poSearch}
                    onChange={(e) => {
                      setPoSearch(e.target.value);
                      setPoDropdownOpen(true);
                      if (form.po) {
                        setForm((f) => ({ ...f, po: "" }));
                        setPoRows([]);
                      }
                    }}
                    onFocus={() => setPoDropdownOpen(true)}
                    onBlur={() =>
                      setTimeout(() => setPoDropdownOpen(false), 150)
                    }
                    placeholder="— Select PO — (type to search)"
                    autoComplete="off"
                  />
                  {poDropdownOpen && (
                    <div className="po-dropdown">
                      <div
                        className="po-dropdown-item"
                        onMouseDown={() => {
                          handlePoSelect("");
                          setPoSearch("");
                          setPoDropdownOpen(false);
                        }}
                        style={{ fontWeight: 600, color: "var(--text-3)" }}
                      >
                        — Select PO —
                      </div>
                      {filteredPoList.length === 0 && (
                        <div className="po-dropdown-empty">
                          No matching POs
                        </div>
                      )}
                      {filteredPoList.map((po) => (
                        <div
                          key={po._id}
                          className="po-dropdown-item"
                          onMouseDown={() => {
                            setPoDropdownOpen(false);
                            handlePoSelect(po.poNumber);
                          }}
                        >
                          {po.poNumber} — {po.vendorName} (
                          {po.remainingItems ?? po.items?.length ?? 0} items
                          pending)
                        </div>
                      ))}
                      <div
                        className="po-dropdown-item po-dropdown-manual"
                        onMouseDown={() => {
                          setPoManual(true);
                          setPoSearch("");
                          setForm((f) => ({ ...f, po: "" }));
                          setPoRows([]);
                          setPoDropdownOpen(false);
                        }}
                      >
                        ✎ Enter PO number manually…
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="field">
              <label>
                Received by <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <select
                required
                value={getSelectValue(form.by, RECEIVED_BY_OPTIONS)}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    by:
                      e.target.value === "Other" ? OTHER_VALUE : e.target.value,
                  }))
                }
              >
                <option value="">— Select received by —</option>
                {RECEIVED_BY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
                <option value="Other">Other</option>
              </select>
              {getSelectValue(form.by, RECEIVED_BY_OPTIONS) === "Other" && (
                <input
                  required
                  value={form.by === OTHER_VALUE ? "" : form.by}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, by: e.target.value }))
                  }
                  placeholder="Enter name"
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
          </div>

          <div className="formgrid">
            <div className="field full">
              <label>
                Vendor name <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <input
                required
                value={form.vendor}
                onChange={(e) =>
                  setForm((f) => ({ ...f, vendor: e.target.value }))
                }
                placeholder="Auto-filled from PO, or enter manually"
              />
            </div>
          </div>

          {poLoading && (
            <p style={{ fontSize: 13, color: "var(--text-3)", margin: "12px 0" }}>
              Loading PO items…
            </p>
          )}

          {/* PO Mode */}
          {form.po && poRows.length > 0 && (
            <div>
              <div className="section-label">Materials from {form.po}</div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-3)",
                  marginBottom: 8,
                  marginTop: -6,
                }}
              >
                Edit received qty, GIN, location and remarks per item
              </div>
              <div className="tablewrap">
                <table style={{ minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Code</th>
                      <th>Category</th>
                      <th>UOM</th>
                      <th className="num">PO Qty</th>
                      <th className="num" style={{ minWidth: 90 }}>
                        Recv Qty *
                      </th>
                      <th style={{ minWidth: 110 }}>GIN *</th>
                      <th style={{ minWidth: 130 }}>Location *</th>
                      <th style={{ minWidth: 130 }}>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poRows.map((r) => (
                      <tr key={r._key}>
                        <td style={{ fontWeight: 500 }}>{r.name}</td>
                        <td className="mono">{r.code || "—"}</td>
                        <td>{r.category || "—"}</td>
                        <td>{r.uom || "—"}</td>
                        <td className="num" style={{ color: "var(--text-3)" }}>
                          {r.poQty}
                        </td>
                        <td style={tdS}>
                          <input
                            type="number"
                            min="0.0001"
                            step="any"
                            value={r.qty}
                            onChange={(e) =>
                              updatePoRow(r._key, { qty: e.target.value })
                            }
                            style={{ width: 80, textAlign: "right" }}
                          />
                        </td>
                        <td style={tdS}>
                          <input
                            value={r.gin}
                            onChange={(e) =>
                              updatePoRow(r._key, { gin: e.target.value })
                            }
                            placeholder="GIN"
                            style={{ width: "100%" }}
                          />
                        </td>
                        <td style={tdS}>
                          <input
                            value={r.location}
                            onChange={(e) =>
                              updatePoRow(r._key, { location: e.target.value })
                            }
                            placeholder="e.g. Rack A"
                            style={{ width: "100%" }}
                          />
                        </td>
                        <td style={tdS}>
                          <input
                            value={r.remarks}
                            onChange={(e) =>
                              updatePoRow(r._key, { remarks: e.target.value })
                            }
                            placeholder="Optional"
                            style={{ width: "100%" }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Manual Mode */}
          {(!form.po || poManual || (!poLoading && poRows.length === 0)) && (
            <>
              <div className="section-label">Material &amp; quantity</div>
              <div className="tablewrap" style={{ marginBottom: 8 }}>
                <table style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 220 }}>Material *</th>
                      <th style={{ minWidth: 100 }}>Type</th>
                      <th style={{ minWidth: 120 }}>Code</th>
                      <th style={{ minWidth: 120 }}>Category</th>
                      <th style={{ minWidth: 70 }}>UOM</th>
                      <th style={{ minWidth: 90 }}>Qty *</th>
                      <th style={{ minWidth: 110 }}>GIN *</th>
                      <th style={{ minWidth: 140 }}>Location *</th>
                      <th style={{ minWidth: 130 }}>Remarks</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualRows.map((r) => (
                      <tr key={r._key}>
                        <td>
                          <select
                            value={r.name}
                            onChange={(e) =>
                              autofillManualRow(r._key, e.target.value)
                            }
                            style={{
                              width: "100%",
                              fontSize: 13,
                              padding: "6px 8px",
                              border: "1px solid var(--line)",
                              borderRadius: 6,
                            }}
                          >
                            <option value="">— Select material —</option>
                            {master.map((m) => (
                              <option key={m._id} value={m.name}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            readOnly
                            value={r.type}
                            placeholder="—"
                            style={{
                              width: "100%",
                              background: "var(--paper-dim)",
                              fontSize: 13,
                              padding: "6px 8px",
                              border: "1px solid var(--line)",
                              borderRadius: 6,
                            }}
                          />
                        </td>
                        <td>
                          <input
                            readOnly
                            value={r.code}
                            placeholder="—"
                            style={{
                              width: "100%",
                              background: "var(--paper-dim)",
                              fontSize: 13,
                              padding: "6px 8px",
                              border: "1px solid var(--line)",
                              borderRadius: 6,
                            }}
                          />
                        </td>
                        <td>
                          <input
                            readOnly
                            value={r.category}
                            placeholder="—"
                            style={{
                              width: "100%",
                              background: "var(--paper-dim)",
                              fontSize: 13,
                              padding: "6px 8px",
                              border: "1px solid var(--line)",
                              borderRadius: 6,
                            }}
                          />
                        </td>
                        <td>
                          <input
                            readOnly
                            value={r.uom}
                            placeholder="—"
                            style={{
                              width: 60,
                              background: "var(--paper-dim)",
                              fontSize: 13,
                              padding: "6px 8px",
                              border: "1px solid var(--line)",
                              borderRadius: 6,
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={r.qty}
                            onChange={(e) =>
                              updateManualRow(r._key, { qty: e.target.value })
                            }
                            placeholder="0"
                            style={{
                              width: 80,
                              textAlign: "right",
                              fontSize: 13,
                              padding: "6px 8px",
                              border: "1px solid var(--line)",
                              borderRadius: 6,
                            }}
                          />
                        </td>
                        <td>
                          <input
                            value={r.gin}
                            onChange={(e) =>
                              updateManualRow(r._key, { gin: e.target.value })
                            }
                            placeholder="GIN"
                            style={{
                              width: "100%",
                              fontSize: 13,
                              padding: "6px 8px",
                              border: "1px solid var(--line)",
                              borderRadius: 6,
                            }}
                          />
                        </td>
                        <td>
                          <input
                            value={r.location}
                            onChange={(e) =>
                              updateManualRow(r._key, {
                                location: e.target.value,
                              })
                            }
                            placeholder="e.g. Rack 3"
                            style={{
                              width: "100%",
                              fontSize: 13,
                              padding: "6px 8px",
                              border: "1px solid var(--line)",
                              borderRadius: 6,
                            }}
                          />
                        </td>
                        <td>
                          <input
                            value={r.remarks}
                            onChange={(e) =>
                              updateManualRow(r._key, {
                                remarks: e.target.value,
                              })
                            }
                            placeholder="Optional"
                            style={{
                              width: "100%",
                              fontSize: 13,
                              padding: "6px 8px",
                              border: "1px solid var(--line)",
                              borderRadius: 6,
                            }}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-del btn-sm"
                            onClick={() => removeManualRow(r._key)}
                            disabled={manualRows.length === 1}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={addManualRow}
                style={{ marginBottom: 8 }}
              >
                + Add item
              </button>
            </>
          )}

          <div className="actionrow" style={{ marginTop: 16 }}>
            <button
              className="btn btn-in"
              type="submit"
              disabled={loading || poLoading}
            >
              {!loading && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
              )}
              {loading
                ? "Saving…"
                : form.po && poRows.length > 0
                  ? `Save ${poRows.length} inward entr${poRows.length === 1 ? "y" : "ies"}`
                  : `Save ${validManualCount > 0 ? validManualCount : ""} inward entr${validManualCount === 1 ? "y" : "ies"}`}
            </button>
            {form.po && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  handlePoSelect("");
                  setPoSearch("");
                }}
              >
                Clear PO
              </button>
            )}
            {msg.text && (
              <span className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</span>
            )}
          </div>
        </form>
      </div>

      {/* ── All entries table ── */}
      <div className="card card-wide entries-section">
        <div className="filterbar">
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: 240,
              gap: "6px",
            }}
          >
            <span style={filterLabelStyle}>Search</span>
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Material / vendor / challan / PO / location"
              style={filterInputStyle}
              onFocus={filterFocus}
              onBlur={filterBlur}
            />
          </label>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: 170,
              gap: "6px",
            }}
          >
            <span style={filterLabelStyle}>From date</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={filterInputStyle}
              onFocus={filterFocus}
              onBlur={filterBlur}
            />
          </label>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: 170,
              gap: "6px",
            }}
          >
            <span style={filterLabelStyle}>To date</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={filterInputStyle}
              onFocus={filterFocus}
              onBlur={filterBlur}
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{
              height: "var(--input-h)",
              padding: "10px 14px",
              fontSize: "13.5px",
              fontFamily: "'Inter', 'Poppins', sans-serif",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onClick={() => {
              setSearchText("");
              setFromDate("");
              setToDate("");
            }}
          >
            Clear
          </button>
        </div>

        <h3>
          All inward entries{" "}
          <span className="pill-count">{filteredEntries.length || 0}</span>
        </h3>
        <div
          className="tablewrap"
          style={{
            overflowX: "auto",
            overflowY: "auto",
            maxHeight: "82vh",
          }}
        >
          <table>
            <thead
              style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                background: "var(--paper-dim)",
              }}
            >
              <tr>
                <th>Date</th>
                <th>Inv date</th>
                <th>Challan / Inv no</th>
                <th>PO no</th>
                <th>Vendor</th>
                <th>Material</th>
                <th>Type</th>
                <th>Code</th>
                <th>Category</th>
                <th>UOM</th>
                <th className="num">Qty</th>
                <th>GIN</th>
                <th>Rec. By</th>
                <th>Location</th>
                <th>Remarks</th>
                {canSeePrice && <th className="num">Price</th>}
                {canEditDelete && <th style={{ minWidth: 110 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pageItems.map((e) => (
                <tr key={e._id}>
                  <td className="nowrap">{formatDateDMY(e.date)}</td>
                  <td className="nowrap">
                    {e.invdate ? formatDateDMY(e.invdate) : "—"}
                  </td>
                  <td>{e.challan || "—"}</td>
                  <td>{e.po || "—"}</td>
                  <td>{e.vendor || "—"}</td>
                  <td style={{ fontWeight: 500 }}>{e.name}</td>
                  <td>{e.type}</td>
                  <td className="mono">{e.code}</td>
                  <td>{e.category}</td>
                  <td>{e.uom}</td>
                  <td className="num">{formatNum(e.qty)}</td>
                  <td className="mono">{e.gin || "—"}</td>
                  <td>{e.by || "—"}</td>
                  <td>{e.location || "—"}</td>
                  <td>{e.remarks || "—"}</td>
                  {canSeePrice && <td className="num">{formatNum(e.price)}</td>}
                  {canEditDelete && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditEntry(e)}
                          title="Edit"
                        >
                          ✏ Edit
                        </button>
                        <button
                          className="btn-del btn-sm"
                          onClick={() => handleDelete(e)}
                          title="Delete"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
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
            No inward entries yet.
            <p>Use the form above to record your first receipt.</p>
          </div>
        )}
        {entries.length > 0 && !filteredEntries.length && (
          <div className="empty">
            No inward entries match the current filters.
          </div>
        )}
      </div>
    </>
  );
}