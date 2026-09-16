import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import {
  getMaster,
  getPurchaseRequests,
  createPurchaseRequest,
  updatePurchaseRequest,
  deletePurchaseRequest,
  setPurchaseRequestStatus,
  getPurchaseOrdersByPR,
  getInward,
  getOutward,
  unwrapList,
} from "../api/api";
import { useAuth } from "../context/AuthContext";
import { formatNum, todayStr } from "../utils/helpers";
import Pagination from "../components/Pagination";
import useClientPagination from "../hooks/useClientPagination";

const CREATOR_ROLES  = ["admin", "store", "store_manager",  "viewer"];
const APPROVER_ROLES = ["admin", "store_manager"];

const STATUS_LABEL = {
  pending: "Pending",
  approved: "Approved",
  partial: "Partially Ordered",
  rejected: "Rejected",
  ordered: "Ordered",
  received: "Received",
};
const STATUS_TABS = [
  "all", "pending", "approved", "partial", "ordered", "received", "rejected",
];

const emptyItem = () => ({
  _key: Math.random().toString(36).slice(2),
  name: "", type: "", code: "", category: "", uom: "", qty: "",
  expectedDeliveryDate: "", projectName: "", remarks: "",
});

// ── Date helper: "YYYY-MM-DD" -> "DD/MM/YYYY" ──────────────────────────────
function formatDDMMYYYY(dateStr) {
  if (!dateStr) return "";
  const parts = String(dateStr).split("-");
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  if (!y || !m || !d) return dateStr;
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
}

// ── Full timestamp helper: JS Date -> "DD/MM/YYYY, hh:mm AM/PM" ────────────
function formatDateTimeDMY(input) {
  const dt = input instanceof Date ? input : new Date(input);
  if (isNaN(dt.getTime())) return "";
  const d = String(dt.getDate()).padStart(2, "0");
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const y = dt.getFullYear();
  let hours = dt.getHours();
  const minutes = String(dt.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${d}/${m}/${y}, ${hours}:${minutes} ${ampm}`;
}

const EMPTY_COL_FILTERS = {
  prNumber: [],
  date: [],
  projectName: [],
  requestFrom: [],
  requestedBy: [],
  items: [],
  status: [],
};

// ── Excel-style dropdown filter (same pattern as Live Stock / Job Order) ─────
function ColFilter({ values, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState([]);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef();
  const panelRef = useRef();

  useEffect(() => {
    if (open) setPending(selected);
  }, [open]); // eslint-disable-line

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
      const panelW = Math.min(320, window.innerWidth - 16);
      const panelH = 360;
      const spaceBelow = window.innerHeight - rect.bottom;
      let top = spaceBelow < panelH ? rect.top - panelH - 4 : rect.bottom + 4;
      let left = rect.left;
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
        width: "min(320px, calc(100vw - 16px))",
        maxWidth: 320,
        overflow: "hidden",
        boxSizing: "border-box",
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
            minWidth: 0,
            padding: "7px 10px",
            fontSize: 13,
            border: "1.5px solid var(--line)",
            borderRadius: 6,
            fontFamily: "Inter, Poppins, sans-serif",
            outline: "none",
            background: "#fafaf8",
            color: "var(--ink)",
            boxSizing: "border-box",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--teal)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--line)")}
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
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
            color: "#8a8270",
            borderRadius: 5,
          }}
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
            flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        />
        <span
          style={{
            fontSize: 12.5,
            fontStyle: "italic",
            color: "var(--text-3)",
            fontFamily: "Inter, Poppins, sans-serif",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
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
              flexShrink: 0,
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
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {v}
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
          type="button"
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
          type="button"
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
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleOpen();
        }}
        style={{
          background: selected.length > 0 ? "var(--teal)" : "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 6px",
          borderRadius: 4,
          fontSize: 10,
          color: selected.length > 0 ? "#fff" : "#8a8270",
          lineHeight: 1,
          flexShrink: 0,
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

function ThFilter({ label, values, selected, onChange }) {
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
      onClick={(e) => e.stopPropagation()}
    >
      {label}{" "}
      <ColFilter values={values} selected={selected} onChange={onChange} />
    </span>
  );
}

// ── Searchable select component (portal-based, never clipped) ─────────────────
function SearchSelect({ options, value, onChange, placeholder }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef();
  const panelRef = useRef();

  useEffect(() => {
    function handler(e) {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        inputRef.current && !inputRef.current.contains(e.target)
      ) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < 220 ? rect.top - 220 : rect.bottom + 2;
      setPos({ top, left: rect.left, width: rect.width });
    }
  }, [open]);

  const filtered = options.filter(o =>
    o.toLowerCase().includes(search.toLowerCase())
  );

  function select(val) {
    onChange(val);
    setSearch('');
    setOpen(false);
  }

  return (
    <>
      <input
        ref={inputRef}
        value={open ? search : (value || '')}
        onFocus={() => { setOpen(true); setSearch(''); }}
        onChange={e => { setSearch(e.target.value); setOpen(true); }}
        placeholder={placeholder || '— Search —'}
        autoComplete="off"
        style={{
          width: '100%', padding: '6px 10px', fontSize: 13,
          border: '1.5px solid var(--line)', borderRadius: 'var(--radius)',
          fontFamily: 'Poppins, sans-serif', background: '#fff', color: 'var(--ink)',
        }}
      />
      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: pos.top, left: pos.left, width: pos.width,
            zIndex: 99999,
            background: '#fff', border: '1px solid var(--line)',
            borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.15)',
            maxHeight: 220, overflowY: 'auto',
          }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: 12, color: '#8a8270' }}>No results</div>
          )}
          {filtered.map(o => (
            <div
              key={o}
              onMouseDown={() => select(o)}
              style={{
                padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                background: o === value ? 'var(--teal-light)' : '#fff',
                color: o === value ? 'var(--teal-dark)' : 'var(--ink)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--paper-dim)'}
              onMouseLeave={e => e.currentTarget.style.background = o === value ? 'var(--teal-light)' : '#fff'}
            >
              {o}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

export default function PurchaseRequest() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const canCreate = CREATOR_ROLES.includes(user?.role);
  const canReview = APPROVER_ROLES.includes(user?.role);
  // Create PO: purchase/admin only — not store team
  const canPendingCreatePO = ["admin", "purchase"].includes(user?.role);
  // Inward: store team (+ admin)
  const canPendingInward = ["admin", "store_manager", "store"].includes(
    user?.role,
  );

  const [master, setMaster] = useState([]);
  const [requests, setRequests] = useState([]);

  const [date, setDate] = useState(todayStr());
  const [requestFrom, setRequestFrom] = useState("");
  const [projectName, setProjectName] = useState("");
  const [items, setItems] = useState([emptyItem()]);
  const [editingId, setEditingId] = useState(null);

  const [msg, setMsg] = useState({ text: "", ok: true });
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [colFilters, setColFilters] = useState(EMPTY_COL_FILTERS);
  const [materialSearch, setMaterialSearch] = useState("");

  const [stockMap, setStockMap] = useState({});

  // Raw inward entries — kept around (not just folded into stockMap) so we
  // can work out, per PR, how much of each item has actually been received
  // against the PO(s) tied to that PR.
  const [inwardEntries, setInwardEntries] = useState([]);

  // Banner shown when this page was opened with items handed off from
  // Live Stock's "Create PR" flow (single item or several selected together).
  const [prefillBanner, setPrefillBanner] = useState(false);
  const prefillAppliedRef = useRef(false);

  // PO data (ordered qty + PO expected delivery date) per PR, keyed by pr._id
  // shape: { [prId]: { byName: { [materialName]: { orderedQty, expectedDates: string[], poNumbers: string[] } } } }
  const [poDataByPr, setPoDataByPr] = useState({});
  const [poDataLoading, setPoDataLoading] = useState({});

  // Guards against re-firing the auto "mark as received" status update
  // while a previous call for the same PR is still in flight.
  const receivedFlipInFlight = useRef(new Set());

  const load = useCallback(async () => {
    const [m, r, inw, out] = await Promise.all([
      getMaster(), getPurchaseRequests(), getInward(), getOutward(),
    ]);
    const masterList = unwrapList(m);
    setMaster(masterList);
    setRequests(unwrapList(r));
    // Build balance map: inward - outward per material
    const inwardArr = unwrapList(inw);
    setInwardEntries(inwardArr);
    const inTotals = {}, outTotals = {};
    inwardArr.forEach(e => {
      inTotals[e.name] = (inTotals[e.name] || 0) + (parseFloat(e.qty) || 0);
    });
    unwrapList(out).forEach(e => {
      outTotals[e.name] = (outTotals[e.name] || 0) + (parseFloat(e.qty) || 0);
    });
    const map = {};
    masterList.forEach(mat => { map[mat.name] = (inTotals[mat.name] || 0) - (outTotals[mat.name] || 0); });
    setStockMap(map);
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Prefill from Live Stock's "Create PR" hand-off ─────────────────────────
  // Live Stock navigates here with `state: { prefillItems: [...] }` — one
  // item (single row button) or several (bulk selection). We wait until
  // master has loaded so each item's Type can be looked up, apply it once,
  // then clear the navigation state so a later refresh/back doesn't redo it.
  useEffect(() => {
    const prefillItems = location.state?.prefillItems;
    if (!prefillItems || !prefillItems.length || prefillAppliedRef.current) return;
    if (!master.length) return;

    const mapped = prefillItems.map((pi) => {
      const m =
        (pi.code && master.find((x) => x.code === pi.code)) ||
        master.find((x) => x.name === pi.name);
      return {
        _key: Math.random().toString(36).slice(2),
        name: pi.name || m?.name || "",
        type: m?.type || "",
        code: pi.code || m?.code || "",
        category: pi.category || m?.category || "",
        uom: pi.uom || m?.uom || "",
        qty: pi.qty != null && pi.qty !== "" ? String(pi.qty) : "",
        expectedDeliveryDate: "",
        projectName: "",
        remarks: "",
      };
    });

    setItems(mapped);
    setPrefillBanner(true);
    prefillAppliedRef.current = true;
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Clear the router state so it isn't reapplied on refresh/back-nav,
    // without otherwise touching the URL.
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, master, navigate]);

  const uniqueTypes = [...new Set(master.map(m => m.type).filter(Boolean))].sort();
  const uniqueCodes = [...new Set(master.map(m => m.code).filter(Boolean))].sort();
  const uniqueCategories = [...new Set(master.map(m => m.category).filter(Boolean))].sort();

  function resetForm() {
    setDate(todayStr());
    setRequestFrom("");
    setProjectName("");
    setItems([emptyItem()]);
    setEditingId(null);
    setPrefillBanner(false);
  }

  function updateItem(key, patch) {
    setItems((list) => list.map((it) => (it._key === key ? { ...it, ...patch } : it)));
  }

  function autofillItem(key, name) {
    const m = master.find((x) => x.name === name);
    updateItem(key, {
      name,
      type: m?.type || "",
      code: m?.code || "",
      category: m?.category || "",
      uom: m?.uom || "",
    });
  }

  function autofillFromType(key, type) {
    updateItem(key, { type, name: '', code: '', category: '', uom: '' });
  }

  function autofillFromCode(key, code) {
    const m = master.find(x => x.code === code);
    updateItem(key, { code, ...(m ? { name: m.name, type: m.type, category: m.category, uom: m.uom } : {}) });
  }

  function autofillFromCategory(key, category) {
    updateItem(key, { category, name: '', code: '', uom: '' });
  }

  function addItemRow() {
    setItems((list) => [...list, emptyItem()]);
  }

  function removeItemRow(key) {
    setItems((list) => list.length > 1 ? list.filter((it) => it._key !== key) : list);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg({ text: "", ok: true });
    const valid = items.filter((it) => it.name && parseFloat(it.qty) > 0);
    if (!valid.length) {
      setMsg({ text: "Add at least one item with a material and quantity.", ok: false });
      return;
    }
    setLoading(true);
    try {
      const uniqueProjectNames = [...new Set(valid.map((it) => it.projectName).filter(Boolean))];
      const payload = {
        date, requestFrom,
        projectName: projectName || uniqueProjectNames.join(", "),
        items: valid.map((it) => ({ ...it, qty: parseFloat(it.qty) })),
      };
      if (editingId) {
        await updatePurchaseRequest(editingId, payload);
        setMsg({ text: "Purchase request updated.", ok: true });
      } else {
        await createPurchaseRequest(payload);
        setMsg({ text: "Purchase request submitted.", ok: true });
      }
      resetForm();
      load();
      setTimeout(() => setMsg({ text: "", ok: true }), 4000);
    } catch (err) {
      setMsg({ text: "Error: " + err.message, ok: false });
    } finally {
      setLoading(false);
    }
  }

  function startEdit(pr) {
    setEditingId(pr._id);
    setDate(pr.date);
    setRequestFrom(pr.requestFrom || "");
    setProjectName(pr.projectName || "");
    setItems(
      pr.items.map((it) => ({
        ...it,
        _key: Math.random().toString(36).slice(2),
        qty: String(it.qty),
        expectedDeliveryDate: it.expectedDeliveryDate || "",
        projectName: it.projectName || pr.projectName || "",
      }))
    );
    setPrefillBanner(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleCancel(pr) {
    if (!window.confirm(`Cancel request ${pr.prNumber}? This cannot be undone.`)) return;
    try {
      await deletePurchaseRequest(pr._id);
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleApprove(pr) {
    try {
      await setPurchaseRequestStatus(pr._id, { status: "approved" });
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleReject(pr) {
    const note = window.prompt("Reason for rejecting this request (optional):", "");
    if (note === null) return;
    try {
      await setPurchaseRequestStatus(pr._id, { status: "rejected", note });
      load();
    } catch (err) { alert(err.message); }
  }

  // ── Receive flow ────────────────────────────────────────────────────────
  // "Mark received" no longer flips the status directly. Instead it sends
  // the user to the Inward page with the relevant PO preselected (when the
  // PR maps to exactly one PO). Status only flips to "received" once every
  // item on the PR has been fully covered by actual inward entries — see
  // the isFullyReceived()/auto-flip effect below.
  async function goToInward(pr) {
    try {
      const pos = await getPurchaseOrdersByPR(pr._id);
      const poNumbers = [...new Set((pos || []).map((po) => po.poNumber).filter(Boolean))];
      navigate("/inward", {
        state: {
          presetPo: poNumbers.length === 1 ? poNumbers[0] : undefined,
          prNumber: pr.prNumber,
          prPoNumbers: poNumbers,
        },
      });
    } catch (err) {
      alert("Could not load PO info for this request: " + err.message);
    }
  }

  async function loadPoDataForPr(pr) {
    setPoDataLoading((prev) => ({ ...prev, [pr._id]: true }));
    try {
      const pos = await getPurchaseOrdersByPR(pr._id);
      const byName = {};
      for (const po of pos || []) {
        for (const it of po.items || []) {
          const key = `${String(it.name || "").trim()}||${String(it.projectName || po.projectName || "").trim()}`;
          if (!byName[key]) byName[key] = { orderedQty: 0, expectedDates: [], poNumbers: [] };
          byName[key].orderedQty += parseFloat(it.orderedQty) || 0;
          if (po.poExpectedDate && !byName[key].expectedDates.includes(po.poExpectedDate)) {
            byName[key].expectedDates.push(po.poExpectedDate);
          }
          if (po.poNumber && !byName[key].poNumbers.includes(po.poNumber)) {
            byName[key].poNumbers.push(po.poNumber);
          }
        }
      }
      setPoDataByPr((prev) => ({ ...prev, [pr._id]: { byName } }));
    } catch (err) {
      console.error("Failed to load PO data for PR:", err.message);
    } finally {
      setPoDataLoading((prev) => ({ ...prev, [pr._id]: false }));
    }
  }

  // Auto-load PO data for ordered / approved / partial so remaining & buttons stay accurate
  useEffect(() => {
    requests
      .filter(
        (pr) =>
          ["ordered", "approved", "partial"].includes(pr.status) &&
          !poDataByPr[pr._id] &&
          !poDataLoading[pr._id],
      )
      .forEach((pr) => loadPoDataForPr(pr));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests]);

  function prNeedsCreatePO(pr) {
    if (!["approved", "partial"].includes(pr.status)) return false;
    const data = poDataByPr[pr._id];
    if (!data) return true; // still loading — keep button until we know
    const byName = data.byName || {};
    return (pr.items || []).some((it) => {
      const key = `${String(it.name || "").trim()}||${String(it.projectName || pr.projectName || "").trim()}`;
      const ordered = byName[key]?.orderedQty || 0;
      return (parseFloat(it.qty) || 0) - ordered > 0.00001;
    });
  }

  // Given a PR, sum actual inward entries per material name, restricted to
  // the PO number(s) linked to that PR (via poDataByPr), so inward entries
  // for the same material against unrelated POs are never counted.
  function getReceivedByName(pr) {
    const poInfo = poDataByPr[pr._id];
    if (!poInfo) return {};
    const poNumbers = new Set();
    Object.values(poInfo.byName).forEach((v) => (v.poNumbers || []).forEach((n) => poNumbers.add(n)));
    const received = {};
    inwardEntries.forEach((e) => {
      if (!poNumbers.has(e.po)) return;
      received[e.name] = (received[e.name] || 0) + (parseFloat(e.qty) || 0);
    });
    return received;
  }

  function isFullyReceived(pr) {
    if (!poDataByPr[pr._id]) return false; // PO data not loaded yet — don't assume
    const received = getReceivedByName(pr);
    return pr.items.every((it) => (received[it.name] || 0) >= (parseFloat(it.qty) || 0));
  }

  // Once every item on an "ordered" PR has been fully inward-received,
  // auto-flip its status to "received" — this is what makes the
  // "Pending Inward Entry" button disappear on its own.
  useEffect(() => {
    requests
      .filter((pr) => pr.status === "ordered")
      .forEach((pr) => {
        if (receivedFlipInFlight.current.has(pr._id)) return;
        if (isFullyReceived(pr)) {
          receivedFlipInFlight.current.add(pr._id);
          setPurchaseRequestStatus(pr._id, { status: "received" })
            .then(load)
            .catch(() => {})
            .finally(() => receivedFlipInFlight.current.delete(pr._id));
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poDataByPr, inwardEntries, requests]);

  function toggleExpanded(pr) {
    const next = expanded === pr._id ? null : pr._id;
    setExpanded(next);
    const needsPoData = ["partial", "ordered", "received"].includes(pr.status);
    if (next && needsPoData && !poDataByPr[pr._id] && !poDataLoading[pr._id]) {
      loadPoDataForPr(pr);
    }
  }

  function prHasMaterial(pr, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    return (pr.items || []).some((it) =>
      String(it.name || "")
        .toLowerCase()
        .includes(q),
    );
  }

  function matchingMaterialItems(pr, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    return (pr.items || []).filter((it) =>
      String(it.name || "")
        .toLowerCase()
        .includes(q),
    );
  }

  // For a PR + material search: Ordered / Partial / Not ordered / Rejected / …
  function getMaterialOrderLabel(pr, query) {
    const items = matchingMaterialItems(pr, query);
    if (!items.length) return "—";
    if (pr.status === "rejected") return "Rejected";
    if (pr.status === "pending" || pr.status === "approved") return "Not ordered";
    if (pr.status === "received") return "Ordered";

    // partial / ordered — need PO line qty when available
    if (!poDataByPr[pr._id]) {
      if (poDataLoading[pr._id]) return "…";
      if (pr.status === "ordered") return "Ordered";
      if (pr.status === "partial") return "Partial";
      return "Not ordered";
    }

    const byName = poDataByPr[pr._id].byName || {};
    let anyOrdered = false;
    let allCovered = true;
    for (const it of items) {
      const key = `${String(it.name || "").trim()}||${String(it.projectName || pr.projectName || "").trim()}`;
      const ordered =
        byName[key]?.orderedQty ||
        byName[it.name]?.orderedQty ||
        0;
      const qty = parseFloat(it.qty) || 0;
      if (ordered > 0.00001) anyOrdered = true;
      if (ordered < qty - 0.00001) allCovered = false;
    }
    if (!anyOrdered) return "Not ordered";
    if (allCovered) return "Ordered";
    return "Partial";
  }

  const statusScoped =
    statusFilter === "all"
      ? requests
      : requests.filter((r) => r.status === statusFilter);

  const materialQ = materialSearch.trim();

  const visible = statusScoped.filter((pr) => {
    if (materialQ && !prHasMaterial(pr, materialQ)) return false;
    if (
      colFilters.prNumber.length &&
      !colFilters.prNumber.includes(pr.prNumber)
    )
      return false;
    if (
      colFilters.date.length &&
      !colFilters.date.includes(formatDDMMYYYY(pr.date))
    )
      return false;
    if (
      colFilters.projectName.length &&
      !colFilters.projectName.includes(pr.projectName || "—")
    )
      return false;
    if (
      colFilters.requestFrom.length &&
      !colFilters.requestFrom.includes(pr.requestFrom || "—")
    )
      return false;
    if (
      colFilters.requestedBy.length &&
      !colFilters.requestedBy.includes(pr.requestedByName)
    )
      return false;
    if (
      colFilters.items.length &&
      !colFilters.items.includes(String((pr.items || []).length))
    )
      return false;
    if (
      colFilters.status.length &&
      !colFilters.status.includes(STATUS_LABEL[pr.status] || pr.status)
    )
      return false;
    return true;
  });

  const { pageItems, page, pageSize, total, setPage, setPageSize } =
    useClientPagination(visible, 25);

  const hasColFilters = Object.values(colFilters).some((v) => v.length > 0);
  const hasListFilters = hasColFilters || !!materialQ;

  function clearListFilters() {
    setColFilters(EMPTY_COL_FILTERS);
    setMaterialSearch("");
  }

  // When searching a material, preload PO data so "Ordered / Not ordered" is accurate.
  useEffect(() => {
    if (!materialQ) return;
    const ids = visible
      .filter((pr) =>
        ["partial", "ordered", "received"].includes(pr.status),
      )
      .map((pr) => pr._id);
    ids.forEach((id) => {
      const pr = requests.find((r) => r._id === id);
      if (pr && !poDataByPr[id] && !poDataLoading[id]) {
        loadPoDataForPr(pr);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialQ, visible.length, statusFilter]);

  return (
    <>
      {/* Responsive layout overrides — scoped to this page */}
      <style>{`
        .pr-formgrid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px 14px;
        }
        .pr-formgrid .field { min-width: 0; }
        .pr-formgrid .field input,
        .pr-formgrid .field select {
          width: 100%;
          box-sizing: border-box;
        }

        .tablewrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }

        .actionrow { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }

        .partial-badge {
          display: inline-block;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 7px;
          border-radius: 999px;
          background: var(--amber, #fef3c7);
          color: #92400e;
          margin-left: 6px;
          white-space: nowrap;
        }

        .prefill-banner {
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
        .prefill-banner button {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--teal-dark);
          font-size: 13px;
          line-height: 1;
          flex-shrink: 0;
        }

        @media (max-width: 900px) {
          .pr-formgrid { grid-template-columns: 1fr 1fr; }
        }

        @media (max-width: 600px) {
          .pagehead { flex-direction: column; align-items: flex-start; gap: 8px; }
          .card { padding: 12px; }
          .itemtable table { min-width: 1150px; }
          .actionrow { flex-direction: column; align-items: stretch; }
          .actionrow .btn { width: 100%; }
          .pr-formgrid { grid-template-columns: 1fr; }
        }

        @media (max-width: 420px) {
          .card h3 { font-size: 15px; }
          .pagehead-text h2 { font-size: 18px; }
        }
      `}</style>

      <div className="pagehead">
        <div className="pagehead-text">
          <h2>PR Requests</h2>
          <p>
            {canReview
              ? "Review requests raised by the store team and move them through to receiving."
              : "Raise a request for materials that need to be purchased."}
          </p>
        </div>
      </div>

      {canCreate && (
        <div className="card">
          <h3>{editingId ? "Edit request" : "New purchase request"}</h3>

          {prefillBanner && (
            <div className="prefill-banner">
              <span>
                {items.length} item{items.length > 1 ? "s" : ""} added from Live Stock —
                review the quantities below and submit.
              </span>
              <button
                type="button"
                onClick={() => setPrefillBanner(false)}
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="pr-formgrid">
              <div className="field">
                <label>Date</label>
                <input type="date" value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="field">
                <label>Request From</label>
                <input
                  type="text" value={requestFrom}
                  onChange={(e) => setRequestFrom(e.target.value)}
                  placeholder="e.g. Civil Dept, Mr. Sharma"
                />
              </div>
              <div className="field">
                <label>Project Name</label>
                <input
                  type="text" value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. Thailand - Damac & Stock"
                />
              </div>
            </div>

            <div className="tablewrap itemtable" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ minWidth: 220 }}>Material</th>
                    <th style={{ minWidth: 160 }}>Type</th>
                    <th style={{ minWidth: 180 }}>Code</th>
                    <th style={{ minWidth: 180 }}>Category</th>
                    <th style={{ width: 100 }}>Qty</th>
                    <th>UOM</th>
                    <th style={{ minWidth: 160 }}>Expected Delivery Date</th>
                    <th style={{ minWidth: 160 }}>Project Name</th>
                    <th style={{ minWidth: 160 }}>Item remarks</th>
                    <th style={{ minWidth: 100 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    // For each field, filter master by ALL OTHER selected fields
                    const byAll = master
                      .filter(m => (!it.type || m.type === it.type))
                      .filter(m => (!it.category || m.category === it.category))
                      .filter(m => (!it.code || m.code === it.code))
                      .filter(m => (!it.name || m.name === it.name));

                    // Name options — filter by type + category + code
                    const nameOptions = [...new Set(
                      master
                        .filter(m => (!it.type || m.type === it.type))
                        .filter(m => (!it.category || m.category === it.category))
                        .filter(m => (!it.code || m.code === it.code))
                        .map(m => m.name).filter(Boolean)
                    )].sort();

                    // Type options — filter by name + category + code
                    const typeOptions = [...new Set(
                      master
                        .filter(m => (!it.name || m.name === it.name))
                        .filter(m => (!it.category || m.category === it.category))
                        .filter(m => (!it.code || m.code === it.code))
                        .map(m => m.type).filter(Boolean)
                    )].sort();

                    // Category options — filter by name + type + code
                    const categoryOptions = [...new Set(
                      master
                        .filter(m => (!it.name || m.name === it.name))
                        .filter(m => (!it.type || m.type === it.type))
                        .filter(m => (!it.code || m.code === it.code))
                        .map(m => m.category).filter(Boolean)
                    )].sort();

                    // Code options — filter by name + type + category
                    const codeOptions = [...new Set(
                      master
                        .filter(m => (!it.name || m.name === it.name))
                        .filter(m => (!it.type || m.type === it.type))
                        .filter(m => (!it.category || m.category === it.category))
                        .map(m => m.code).filter(Boolean)
                    )].sort();

                    return (
                      <tr key={it._key}>
                        <td>
                          <SearchSelect
                            options={nameOptions}
                            value={it.name}
                            onChange={(val) => {
                              const m = master.find(x => x.name === val);
                              updateItem(it._key, {
                                name: val,
                                type: m?.type || '',
                                code: m?.code || '',
                                category: m?.category || '',
                                uom: m?.uom || '',
                              });
                            }}
                            placeholder="— Search material —"
                          />
                        </td>
                        <td>
                          <SearchSelect
                            options={typeOptions}
                            value={it.type}
                            onChange={(val) => {
                              updateItem(it._key, {
                                type: val,
                                // only clear fields not consistent with new type
                                name: it.name && master.find(m => m.name === it.name && m.type === val) ? it.name : '',
                                code: it.code && master.find(m => m.code === it.code && m.type === val) ? it.code : '',
                                category: it.category && master.find(m => m.category === it.category && m.type === val) ? it.category : '',
                                uom: '',
                              });
                            }}
                            placeholder="— Search type —"
                          />
                        </td>
                        <td>
                          <SearchSelect
                            options={codeOptions}
                            value={it.code}
                            onChange={(val) => {
                              const m = master.find(x => x.code === val);
                              updateItem(it._key, {
                                code: val,
                                name: m?.name || '',
                                type: m?.type || '',
                                category: m?.category || '',
                                uom: m?.uom || '',
                              });
                            }}
                            placeholder="— Search code —"
                          />
                        </td>
                        <td>
                          <SearchSelect
                            options={categoryOptions}
                            value={it.category}
                            onChange={(val) => {
                              updateItem(it._key, {
                                category: val,
                                // only clear fields not consistent with new category
                                name: it.name && master.find(m => m.name === it.name && m.category === val) ? it.name : '',
                                code: it.code && master.find(m => m.code === it.code && m.category === val) ? it.code : '',
                                type: it.type && master.find(m => m.type === it.type && m.category === val) ? it.type : '',
                                uom: '',
                              });
                            }}
                            placeholder="— Search category —"
                          />
                        </td>
                        <td>
                          <input
                            type="number" min="0" step="any"
                            value={it.qty}
                            onChange={(e) => updateItem(it._key, { qty: e.target.value })}
                            placeholder="0"
                          />
                        </td>
                        <td>{it.uom || <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                        <td>
                          <input
                            type="date"
                            value={it.expectedDeliveryDate}
                            min={date || todayStr()}
                            onChange={(e) => updateItem(it._key, { expectedDeliveryDate: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            value={it.projectName}
                            onChange={(e) => updateItem(it._key, { projectName: e.target.value })}
                            placeholder="e.g. Site A, Phase 2"
                          />
                        </td>
                        <td>
                          <input
                            value={it.remarks}
                            onChange={(e) => updateItem(it._key, { remarks: e.target.value })}
                            placeholder="Optional"
                          />
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              title="Clear filters for this row"
                              onClick={() => updateItem(it._key, {
                                name: '', type: '', code: '', category: '', uom: ''
                              })}
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              className="btn-del btn-sm itemtable-row-remove"
                              onClick={() => removeItemRow(it._key)}
                              disabled={items.length === 1}
                            >✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="actionrow">
              <button type="button" className="btn btn-ghost" onClick={addItemRow}>
                + Add item
              </button>
            </div>

            <div className="actionrow" style={{ marginTop: 16 }}>
              <button className="btn btn-in" type="submit" disabled={loading}>
                {loading ? "Saving…" : editingId ? "Update request" : "Submit request"}
              </button>
              {editingId && (
                <button type="button" className="btn btn-ghost" onClick={resetForm}>
                  Cancel edit
                </button>
              )}
              {msg.text && (
                <span className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</span>
              )}
            </div>
          </form>
        </div>
      )}

      <div className="card card-wide">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0 }}>
            {canReview ? "All requests" : "My requests"}{" "}
            <span className="pill-count">{visible.length}</span>
          </h3>
          {hasListFilters && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={clearListFilters}
            >
              Clear filters
            </button>
          )}
        </div>

        <div style={{ marginTop: -2, marginBottom: 14, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", paddingBottom: 2 }}>
            {STATUS_TABS.map((s) => (
              <button
                key={s} type="button"
                className={`btn btn-sm ${statusFilter === s ? "btn-in" : "btn-ghost"}`}
                onClick={() => setStatusFilter(s)}
                style={{ flexShrink: 0 }}
              >
                {s === "all" ? "All" : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "flex-end",
            marginBottom: 14,
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minWidth: 260,
              flex: "1 1 260px",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--text-3)",
              }}
            >
              Search material
            </span>
            <input
              value={materialSearch}
              onChange={(e) => setMaterialSearch(e.target.value)}
              placeholder="Material name — see if ordered on each PR…"
              style={{
                height: 40,
                padding: "8px 12px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                fontSize: 13.5,
                fontFamily: "inherit",
                boxSizing: "border-box",
                width: "100%",
              }}
            />
          </label>
          {materialQ && (
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--text-3)",
                flex: "1 1 200px",
                lineHeight: 1.4,
              }}
            >
              Showing PRs that include this material, with order status per request.
            </p>
          )}
        </div>

        <div className="tablewrap">
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
                <th>
                  <ThFilter
                    label="PR No"
                    values={statusScoped.map((p) => p.prNumber)}
                    selected={colFilters.prNumber}
                    onChange={(v) =>
                      setColFilters((f) => ({ ...f, prNumber: v }))
                    }
                  />
                </th>
                <th>
                  <ThFilter
                    label="Date"
                    values={statusScoped.map((p) => formatDDMMYYYY(p.date))}
                    selected={colFilters.date}
                    onChange={(v) => setColFilters((f) => ({ ...f, date: v }))}
                  />
                </th>
                <th>
                  <ThFilter
                    label="Project Name"
                    values={statusScoped.map((p) => p.projectName || "—")}
                    selected={colFilters.projectName}
                    onChange={(v) =>
                      setColFilters((f) => ({ ...f, projectName: v }))
                    }
                  />
                </th>
                <th>
                  <ThFilter
                    label="Request From"
                    values={statusScoped.map((p) => p.requestFrom || "—")}
                    selected={colFilters.requestFrom}
                    onChange={(v) =>
                      setColFilters((f) => ({ ...f, requestFrom: v }))
                    }
                  />
                </th>
                <th>
                  <ThFilter
                    label="Requested by"
                    values={statusScoped.map((p) => p.requestedByName)}
                    selected={colFilters.requestedBy}
                    onChange={(v) =>
                      setColFilters((f) => ({ ...f, requestedBy: v }))
                    }
                  />
                </th>
                <th>
                  <ThFilter
                    label="Items"
                    values={statusScoped.map((p) =>
                      String((p.items || []).length),
                    )}
                    selected={colFilters.items}
                    onChange={(v) => setColFilters((f) => ({ ...f, items: v }))}
                  />
                </th>
                <th>
                  <ThFilter
                    label="Status"
                    values={statusScoped.map(
                      (p) => STATUS_LABEL[p.status] || p.status,
                    )}
                    selected={colFilters.status}
                    onChange={(v) =>
                      setColFilters((f) => ({ ...f, status: v }))
                    }
                  />
                </th>
                {materialQ && <th>Material order</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((pr) => {
                const isOwner = pr.requestedByUsername === user?.username;
                const canEditThis = isOwner || user?.role === "admin" || user?.role === "store_manager";
                const isPartial = pr.status === "partial";
                const receivedByName = getReceivedByName(pr);
                const materialOrderLabel = materialQ
                  ? getMaterialOrderLabel(pr, materialQ)
                  : null;
                const matchedNames = materialQ
                  ? [
                      ...new Set(
                        matchingMaterialItems(pr, materialQ).map((it) => it.name),
                      ),
                    ]
                  : [];
                const colSpan = materialQ ? 9 : 8;
                return (
                  <React.Fragment key={pr._id}>
                    <tr
                      style={{ cursor: "pointer" }}
                      onClick={() => toggleExpanded(pr)}
                    >
                      <td className="mono" style={{ fontWeight: 600 }}>{pr.prNumber}</td>
                      <td className="nowrap">{formatDDMMYYYY(pr.date)}</td>
                      <td>{pr.projectName || <span style={{ color: "var(--text-3)" }}>—</span>}</td>
                      <td>{pr.requestFrom || <span style={{ color: "var(--text-3)" }}>—</span>}</td>
                      <td>{pr.requestedByName}</td>
                      <td>{pr.items.length}</td>
                      <td>
                        <span className={`tag ${pr.status}`}>{STATUS_LABEL[pr.status]}</span>
                        {isPartial && <span className="partial-badge">Partially Ordered</span>}
                      </td>
                      {materialQ && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "3px 10px",
                              borderRadius: 12,
                              background:
                                materialOrderLabel === "Ordered"
                                  ? "#e6f2f0"
                                  : materialOrderLabel === "Partial"
                                    ? "#fef3c7"
                                    : materialOrderLabel === "Not ordered"
                                      ? "#fde8e8"
                                      : "var(--paper-dim)",
                              color:
                                materialOrderLabel === "Ordered"
                                  ? "var(--teal-dark)"
                                  : materialOrderLabel === "Partial"
                                    ? "#92400e"
                                    : materialOrderLabel === "Not ordered"
                                      ? "var(--red)"
                                      : "var(--text-3)",
                            }}
                            title={
                              matchedNames.length
                                ? matchedNames.join(", ")
                                : undefined
                            }
                          >
                            {materialOrderLabel}
                          </span>
                          {matchedNames.length > 0 && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--text-3)",
                                marginTop: 4,
                                maxWidth: 180,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {matchedNames.join(", ")}
                            </div>
                          )}
                        </td>
                      )}
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {pr.status === "pending" && canEditThis && (
                            <>
                              <button className="btn btn-sm btn-ghost" onClick={() => startEdit(pr)}>Edit</button>
                              <button className="btn-del btn-sm" onClick={() => handleCancel(pr)}>Cancel</button>
                            </>
                          )}
                          {canReview && pr.status === "pending" && (
                            <>
                              <button className="btn btn-sm btn-in" onClick={() => handleApprove(pr)}>Approve</button>
                              <button className="btn-del btn-sm" onClick={() => handleReject(pr)}>Reject</button>
                            </>
                          )}
                          {canPendingCreatePO && prNeedsCreatePO(pr) && (
                            <button className="btn btn-sm btn-in" onClick={() => navigate("/purchase-orders")}>Pending Create PO</button>
                          )}
                          {canPendingInward && pr.status === "ordered" && (
                            <button className="btn btn-sm btn-in" onClick={() => goToInward(pr)}>Pending Inward Entry</button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {expanded === pr._id && (
                      <tr>
                        <td colSpan={colSpan} style={{ background: "var(--paper-dim)" }}>
                          <div style={{ padding: "14px 6px" }}>
                            {(pr.status === "partial" || pr.status === "ordered" || pr.status === "received") && poDataLoading[pr._id] && (
                              <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: "0 0 8px" }}>Loading PO data…</p>
                            )}
                            <div className="tablewrap" style={{ marginBottom: 12 }}>
                              <table>
                                <thead>
                                  <tr>
                                    <th>Material</th>
                                    <th>Type</th>
                                    <th>Code</th>
                                    <th>Category</th>
                                    <th className="num">Qty</th>
                                    <th>UOM</th>
                                    <th>Expected Delivery (PR)</th>
                                    <th>Project Name</th>
                                    <th>Remarks</th>
                                    <th className="num">Current Stock</th>
                                    {(pr.status === "partial" || pr.status === "ordered" || pr.status === "received") && (
                                      <>
                                        <th className="num">Ordered Qty</th>
                                        <th className="num">Bal.</th>
                                        <th>Expected Delivery (PO)</th>
                                        <th className="num">Received Qty</th>
                                        <th className="num">Pending Receipt</th>
                                      </>
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  {pr.items.map((it, i) => {
                                    const stock = stockMap[it.name] ?? null;
                                    const isLow = stock !== null && stock < it.qty;
                                    const showOrderTracking = pr.status === "partial" || pr.status === "ordered" || pr.status === "received";
                                    const poInfo =
                                      poDataByPr[pr._id]?.byName?.[
                                        `${String(it.name || "").trim()}||${String(it.projectName || pr.projectName || "").trim()}`
                                      ];
                                    const orderedQty = poInfo?.orderedQty || 0;
                                    const balance = Math.max(0, (parseFloat(it.qty) || 0) - orderedQty);
                                    const itemPartial = showOrderTracking && orderedQty > 0 && balance > 0;
                                    const poExpectedDates = poInfo?.expectedDates || [];
                                    const poLoading = !!poDataLoading[pr._id];
                                    const receivedQty = receivedByName[it.name] || 0;
                                    const pendingReceipt = Math.max(0, (parseFloat(it.qty) || 0) - receivedQty);
                                    const matchesMaterial =
                                      materialQ &&
                                      String(it.name || "")
                                        .toLowerCase()
                                        .includes(materialQ.toLowerCase());
                                    return (
                                      <tr
                                        key={i}
                                        style={
                                          matchesMaterial
                                            ? { background: "rgba(0,128,128,0.10)" }
                                            : itemPartial
                                              ? { background: "rgba(217,119,6,0.08)" }
                                              : undefined
                                        }
                                      >
                                        <td>
                                          {it.name}
                                          {itemPartial && <span className="partial-badge">Partial</span>}
                                        </td>
                                        <td>{it.type || "—"}</td>
                                        <td className="mono">{it.code || "—"}</td>
                                        <td>{it.category || "—"}</td>
                                        <td className="num">{formatNum(it.qty)}</td>
                                        <td>{it.uom || "—"}</td>
                                        <td className="nowrap">{it.expectedDeliveryDate ? formatDDMMYYYY(it.expectedDeliveryDate) : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                                        <td>{it.projectName || pr.projectName || "—"}</td>
                                        <td>{it.remarks || "—"}</td>
                                        <td className="num">
                                          {stock !== null ? (
                                            <strong style={{ color: stock <= 0 ? 'var(--red)' : isLow ? 'var(--amber)' : 'var(--teal-dark)' }}>
                                              {formatNum(stock)}
                                            </strong>
                                          ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                                        </td>
                                        {showOrderTracking && (
                                          <>
                                            <td className="num">
                                              {poLoading ? <span style={{ color: 'var(--text-3)' }}>…</span> : formatNum(orderedQty)}
                                            </td>
                                            <td className="num">
                                              {poLoading ? (
                                                <span style={{ color: 'var(--text-3)' }}>…</span>
                                              ) : balance > 0 ? (
                                                <strong style={{ color: 'var(--amber, #b45309)' }}>{formatNum(balance)}</strong>
                                              ) : (
                                                <span style={{ color: 'var(--teal-dark)' }}>0</span>
                                              )}
                                            </td>
                                            <td>
                                              {poLoading ? (
                                                <span style={{ color: 'var(--text-3)' }}>…</span>
                                              ) : poExpectedDates.length === 0 ? (
                                                <span style={{ color: 'var(--text-3)' }}>—</span>
                                              ) : poExpectedDates.length === 1 ? (
                                                formatDDMMYYYY(poExpectedDates[0])
                                              ) : (
                                                poExpectedDates.map(formatDDMMYYYY).join(', ')
                                              )}
                                            </td>
                                            <td className="num">
                                              {poLoading ? <span style={{ color: 'var(--text-3)' }}>…</span> : formatNum(receivedQty)}
                                            </td>
                                            <td className="num">
                                              {poLoading ? (
                                                <span style={{ color: 'var(--text-3)' }}>…</span>
                                              ) : pendingReceipt > 0 ? (
                                                <strong style={{ color: 'var(--amber, #b45309)' }}>{formatNum(pendingReceipt)}</strong>
                                              ) : (
                                                <span style={{ color: 'var(--teal-dark)' }}>0</span>
                                              )}
                                            </td>
                                          </>
                                        )}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {pr.requestFrom && (
                              <p style={{ fontSize: 12.5, marginBottom: 8 }}>
                                <strong>Request From:</strong> {pr.requestFrom}
                              </p>
                            )}
                            {pr.status === "rejected" && pr.rejectReason && (
                              <p style={{ fontSize: 12.5, marginBottom: 8, color: "var(--red)" }}>
                                <strong>Rejection reason:</strong> {pr.rejectReason}
                              </p>
                            )}
                            {(pr.poNumber || pr.vendor) && (
                              <p style={{ fontSize: 12.5, marginBottom: 8 }}>
                                <strong>PO number:</strong> {pr.poNumber || "—"}&nbsp;&nbsp;
                                <strong>Vendor:</strong> {pr.vendor || "—"}
                              </p>
                            )}
                            <div style={{ fontSize: 11.5, color: "#8a8270", lineHeight: 1.7 }}>
                              {pr.history.map((h, i) => (
                                <div key={i}>
                                  • {STATUS_LABEL[h.status]} by {h.byName} — {formatDateTimeDMY(h.at)}
                                  {h.note ? ` — ${h.note}` : ""}
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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

        {!visible.length && (
          <div className="empty">
            {hasListFilters
              ? "No purchase requests match these filters."
              : `No purchase requests${statusFilter !== "all" ? ` with status "${STATUS_LABEL[statusFilter]}"` : ""}.`}
            {!hasListFilters && canCreate && (
              <p>Use the form above to raise your first request.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}