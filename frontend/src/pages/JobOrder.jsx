import React, { Fragment, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { todayStr } from "../utils/helpers";
import { unwrapList } from "../api/api";
import Pagination from "../components/Pagination";
import VendorQc from "./VendorQc";
import useClientPagination from "../hooks/useClientPagination";
import { vendorsForJobType } from "../utils/jobOrderVendors";

// ── Excel-style dropdown filter (same pattern as Live Stock) ──────────────────
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
        type="button"
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

// ── API helpers (add these to your api.js too) ────────────────────────────────
const API = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, "")}/api`
  : "/api";
async function apiGet(path) {
  const token = localStorage.getItem("sy_token");
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let errMsg = res.statusText;
    try {
      errMsg = (await res.json()).error || errMsg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(errMsg);
  }
  return res.json();
}
async function apiDelete(path) {
  const token = localStorage.getItem("sy_token");
  const res = await fetch(`${API}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let errMsg = res.statusText;
    try {
      errMsg = (await res.json()).error || errMsg;
    } catch {
      /* non-JSON error body */
    }
    console.error(`[apiDelete] ${path} -> ${res.status}`, errMsg);
    throw new Error(errMsg);
  }
  // DELETE responses often have no body
  try {
    return await res.json();
  } catch {
    return null;
  }
}
async function apiPost(path, body) {
  const token = localStorage.getItem("sy_token");
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errMsg = res.statusText;
    try {
      errMsg = (await res.json()).error || errMsg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(errMsg);
  }
  return res.json();
}
async function apiPatch(path, body) {
  const token = localStorage.getItem("sy_token");
  const res = await fetch(`${API}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errMsg = res.statusText;
    try {
      errMsg = (await res.json()).error || errMsg;
    } catch {
      /* non-JSON error body */
    }
    // Surface enough info in the console to debug without opening devtools Network tab
    console.error(`[apiPatch] ${path} -> ${res.status}`, errMsg);
    throw new Error(errMsg);
  }
  return res.json();
}

// Item shape:
//   description, weightPerPc, perimeter, length, area (auto), qty, unit,
//   process (main process, dropdown), processSub (RAL code/finish sub-option,
//   only used when the chosen process has one — Powder Coating / Anodizing),
//   processOther (typed value when process === OTHER_PROCESS), projectName,
//   remark.
// NOTE: RAL Code / Finish is no longer a separate field — it is folded into
// `process` as a single combined string (see finalizeProcess below). The
// saved value is now JUST the RAL code / finish (e.g. "PC-RAL-9003 Matt",
// "Matt") — the main process name ("Powder Coating:", "Anodizing:") is no
// longer prefixed onto it. For processes with no sub-option (Galvanized,
// Hot-Dip) the process name itself is stored as-is.
const emptyItem = () => ({
  _key: Math.random().toString(36).slice(2),
  description: "",
  weightPerPc: "",
  perimeter: "",
  length: "",
  qty: "",
  unit: "NOS",
  process: "",
  processSub: "", // RAL code / finish chosen for the selected process
  processOther: "", // typed value when process === OTHER_PROCESS
  projectName: "",
  remark: "",
});

const CREATE_ROLES = ["admin", "store_manager", "store", "purchase"];

/** Preset item descriptions for Fabrication challans (searchable dropdown). */
const FABRICATION_ITEM_DESCRIPTIONS = [
  "Vertical Drop clamp",
  "90* Form clamp",
  "L angle ( 56x41 )",
  "L angle ( 56x56 )",
  "L angle ( 56x96 )",
  "C washer",
  "4 way Bracket",
  "1 way joint clamp",
  "2 way Joint clamp",
  "3 way Joint clamp",
  "4 way Joint clamp",
  "One way hook clamp",
  "41x41 C Strut Connector",
  "Outer C clamp",
  "Seismic hook clamp",
  "Big C clamp",
];

const LOCATIONS = ["Factory", "Site"];
const UNITS = ["NOS", "MTR", "KG", "SET", "PKT", "BOX", "LTR"];

// Process → RAL Code / Finish. Powder Coating and Anodizing each reveal a
// second dropdown of finish options once selected; Galvanized and Hot-Dip
// have no sub-options and are used as-is (nothing else to pick).
const PROCESS_MAIN_OPTIONS = ["Powder Coating", "Anodizing", "Galvanized", "Hot-Dip"];
const PROCESS_SUBOPTIONS = {
  "Powder Coating": [
    "PC-RAL-9003 Matt",
    "PC-RAL-9003 SG",
    "PC-RAL-9003 Texture",
    "PC-RAL-7035 SG",
    "PC-RAL-7035 Texture",
    "PC-RAL-7035 Structure",
    "PC-RAL-9005 Texture",
    "PC-RAL-9005 Matt",
    "PC-RAL-9010 SG",
    "PC-RAL-9016 SG",
    "PC-RAL-9002 SG",
  ],
  Anodizing: ["Anodizing-Matt", "Anodizing-Glossy"],
};
const OTHER_PROCESS = "__other_process__";

// Combines the selected process + sub-option (or typed custom process) into
// the single string stored on the item and sent to the backend.
// NOTE: for processes with sub-options (Powder Coating / Anodizing), only the
// selected RAL code / finish is stored — the main process name is NOT
// prefixed onto it anymore (e.g. "PC-RAL-9003 Matt", not
// "Powder Coating: PC-RAL-9003 Matt").
// Change to (process name + RAL code):
// Current (RAL code only):
function finalizeProcess(it) {
  if (it.process === OTHER_PROCESS) return String(it.processOther || "").trim();
  if (PROCESS_SUBOPTIONS[it.process]) {
    return String(it.processSub || it.process || "").trim();
  }
  return String(it.process || "").trim();
}



const OTHER_VENDOR = "__other__";

// Preset "Send From" party — currently just the company itself. Selecting it
// auto-fills both Send From Name and Send From Address; "Add own…" switches
// to free-typed entry for both fields (same pattern as the Vendor dropdown).
const SEND_FROM_OPTIONS = [
  {
    name: "PROFILE DATA CENTER SOLUTIONS PVT LTD",
    address:
      "Gut No. 74/B, MANOR HIGHWAY Zilla Parishad School Sonarpada, Khutal, Palghar Maharashtra 421303 India GSTIN (27AALCP0046M1Z5)",
  },
];
const OTHER_SEND_FROM = "__other_sendfrom__";

const COMPANY_LOGO_URL =
  "https://www.profile-solution.com/wp-content/uploads/PS-Logo-1-e1771321686738.png";
const COMPANY_STAMP_URL = "/profile-stamp.png?v=2";
const COMPANY_NAME = "PROFILE DATA CENTER SOLUTIONS PVT. LTD.";
const COMPANY_ADDRESS_SHORT =
  "Office No. 1701, Friends Business Bay, LT Road, Near Veer Savarkar Garden, Borivali (W), Mumbai : 400092";

function sendFromFields(order) {
  return {
    name: String(order?.sendFromName ?? "").trim() || "—",
    address: String(order?.sendFromAddress ?? "").trim() || "—",
  };
}

// Soft-wrap long pasted addresses for print (keeps real newlines; splits
// jammed "Head Office…Factory…GST" blobs onto separate lines).
function formatPrintAddress(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw === "—") return "—";
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\s*[-–—]?\s*(Head Office(?:\s+address)?)\s*[:\-]?\s*/gi, "\n$1: ")
    .replace(/\s*[-–—]?\s*(Factory(?:\s+address)?)\s*[:\-]?\s*/gi, "\n$1: ")
    .replace(/\s*(\(?\s*GST\s*No\.?\s*[:\-]?\s*[^)\n]+\)?)/gi, "\n$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const challanLabelStyle = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#333",
  marginBottom: 6,
};

const challanBodyText = {
  fontSize: 12,
  lineHeight: 1.45,
  color: "#222",
  whiteSpace: "pre-line",
  wordBreak: "break-word",
};

// Display-only date formatting — dd/mm/yyyy. Accepts a plain 'YYYY-MM-DD'
// string (from the date input) or a full ISO datetime string.
function formatDate(d) {
  if (!d) return "—";
  const datePart = String(d).slice(0, 10);
  const [y, m, day] = datePart.split("-");
  if (!y || !m || !day) return String(d);
  return `${day}/${m}/${y}`;
}

// Date the goods arrived for one receipt lot. Newer receipts store
// receivedDate; older ones only have the save timestamp.
function receiptReceivedDate(receipt) {
  if (receipt?.receivedDate) return String(receipt.receivedDate).slice(0, 10);
  if (receipt?.at) return String(receipt.at).slice(0, 10);
  return "";
}

function receiptWhereLabel(receipt) {
  return `${receipt.qty} @ ${receipt.location}`;
}

// One receiving receipt per confirm-received action. Newer lots share a
// lotId. Older lots are grouped by the moment they were saved.
function receiveLots(order) {
  const buckets = new Map();
  (order?.items || []).forEach((item, itemIndex) => {
    (item.receipts || []).forEach((receipt) => {
      const atMs = receipt?.at ? new Date(receipt.at).getTime() : 0;
      const key = receipt?.lotId
        ? `id:${receipt.lotId}`
        : atMs
          ? `legacy:${Math.floor(atMs / 15000)}`
          : `legacy-date:${receiptReceivedDate(receipt)}|${receipt.receivedBy || ""}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          id: key,
          receivedDate: receiptReceivedDate(receipt),
          challanNo: receipt.challanNo || "",
          receivedBy: receipt.receivedBy || "",
          at: Number.isFinite(atMs) ? atMs : 0,
          lines: [],
        });
      }
      const bucket = buckets.get(key);
      if (!bucket.challanNo && receipt.challanNo) bucket.challanNo = receipt.challanNo;
      bucket.lines.push({ item, itemIndex, receipt });
    });
  });
  const lots = [...buckets.values()].sort(
    (a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id)),
  );
  const receivedSoFar = new Map();
  lots.forEach((lot, index) => {
    lot.index = index + 1;
    lot.total = lots.length;
    lot.lines.forEach((line) => {
      const prev = receivedSoFar.get(line.itemIndex) || 0;
      const next = prev + num(line.receipt.qty);
      receivedSoFar.set(line.itemIndex, next);
      line.pending = Math.max(0, num(line.item.qty) - next);
    });
  });
  return lots;
}

function orderDispatchedQty(order) {
  return (order.items || []).reduce((sum, it) => sum + num(it.qty), 0);
}

function orderReceivedQty(order) {
  return (order.items || []).reduce((sum, it) => sum + num(it.receivedQty), 0);
}

const EMPTY_COL_FILTERS = {
  challanNo: [],
  date: [],
  sendFrom: [],
  sendTo: [],
  vehicleNo: [],
  issuedBy: [],
  dispatchedQty: [],
  receivedQty: [],
  vendorExpected: [],
  status: [],
};

function vendorExpectedLabel(order) {
  const raw = String(order?.vendorExpectedDate || "").trim();
  if (!raw) return "—";
  return formatDate(raw);
}

// dd/mm/yyyy, hh:mm AM/PM — used for history timestamps.
function formatDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  const day = String(dt.getDate()).padStart(2, "0");
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const year = dt.getFullYear();
  let hours = dt.getHours();
  const mins = String(dt.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${day}/${month}/${year}, ${hours}:${mins} ${ampm}`;
}

// Coerce possibly-string numeric fields (e.g. from lean() JSON) safely.
// Used for arithmetic only (pending qty, area preview, etc) — NOT for
// display, since it collapses null/blank down to 0.
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function receivePercent(order) {
  const items = order?.items || [];
  const totalQty = items.reduce((sum, it) => sum + num(it.qty), 0);
  if (totalQty <= 0) return 0;
  const receivedQty = items.reduce((sum, it) => sum + num(it.receivedQty), 0);
  return Math.min(100, Math.round((receivedQty / totalQty) * 100));
}

function statusLabel(order) {
  const status = order?.status || "issued";
  const pct = receivePercent(order);
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return `${label} (${pct}%)`;
}

function qcSummary(order) {
  if (!String(order?.vendorExpectedDate || "").trim()) {
    return "Awaiting vendor";
  }
  let pending = 0;
  let dispatch = 0;
  for (const it of order?.items || []) {
    for (const round of it.qcRounds || []) {
      if (round.status === "pending") pending += 1;
      else dispatch += Number(round.dispatchQty) || 0;
    }
  }
  const parts = [];
  if (pending) parts.push(`${pending} QC`);
  if (dispatch) parts.push(`${Math.round(dispatch * 1000) / 1000} dispatch`);
  const rework = (order?.items || []).reduce((sum, it) => sum + reworkQty(it), 0);
  if (rework > 0.001) parts.push(`${Math.round(rework * 1000) / 1000} rework`);
  return parts.length ? parts.join(" · ") : "Awaiting qty";
}

function qcPercent(qty, orderQty) {
  const total = Number(orderQty);
  if (!total || !qty) return 0;
  return Math.round((Number(qty) / total) * 10000) / 100;
}

function qcQtyLabel(qty, orderQty) {
  const n = Number(qty) || 0;
  if (!n) return "—";
  return `${Math.round(n * 1000) / 1000} (${qcPercent(n, orderQty)}%)`;
}

function reworkQty(item) {
  const rejected = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.status !== "inspected") return sum;
    return sum + num(round.rejectedQty);
  }, 0);
  const sentBack = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.origin !== "rework") return sum;
    return sum + num(round.readyQty);
  }, 0);
  return Math.max(0, Math.round((rejected - sentBack) * 1000) / 1000);
}

function readyToDispatchQty(item) {
  const total = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.status !== "inspected") return sum;
    return sum + num(round.dispatchQty);
  }, 0);
  return Math.round(total * 1000) / 1000;
}

function receivableNow(item) {
  const dispatchLeft = Math.max(0, readyToDispatchQty(item) - num(item?.receivedQty));
  const orderLeft = Math.max(0, num(item?.qty) - num(item?.receivedQty));
  return Math.round(Math.min(dispatchLeft, orderLeft) * 1000) / 1000;
}

function qcLine(item) {
  const rounds = item?.qcRounds || [];
  const pendingQty = rounds.reduce(
    (sum, round) => sum + (round.status === "pending" ? Number(round.readyQty) || 0 : 0),
    0,
  );
  const readyQty = rounds.reduce((sum, round) => {
    if (round.origin === "rework") return sum;
    return sum + (Number(round.readyQty) || 0);
  }, 0);
  const orderQty = Number(item?.qty) || 0;
  const percent = qcPercent(readyQty, orderQty);
  let dispatch = 0;
  let rejected = 0;
  for (const round of rounds) {
    if (round.status !== "inspected") continue;
    dispatch += Number(round.dispatchQty) || 0;
    rejected += Number(round.rejectedQty) || 0;
  }
  const rework = reworkQty(item);
  const reworkNotes = rounds
    .filter((round) => round.status === "inspected" && Number(round.rejectedQty) > 0 && String(round.reworkRemark || "").trim())
    .map((round) => ({
      qty: Math.round((Number(round.rejectedQty) || 0) * 1000) / 1000,
      remark: String(round.reworkRemark || "").trim(),
    }));
  let status = "Waiting for vendor qty";
  if (pendingQty > 0) status = `With QC — ${Math.round(pendingQty * 1000) / 1000}`;
  else if (rework > 0.001) status = `Rework — ${rework}`;
  else if (orderQty && readyQty >= orderQty - 0.001 && rounds.some((round) => round.status === "inspected"))
    status = "Inspection complete";
  else if (readyQty > 0) status = "Vendor can send more";
  return {
    readyQty,
    percent,
    orderQty,
    pendingQty,
    dispatch,
    rejected,
    rework,
    reworkNotes,
    status,
  };
}

const showNum = (v) => (v === null || v === undefined || v === "" ? "—" : v);


const AREA_DIVISOR = 645.2;
function calcArea(perimeter, length) {
  const p = num(perimeter);
  const l = num(length);
  if (!p || !l) return 0;
  return (p * l) / AREA_DIVISOR;
}

function setPrintPageSize(orientation) {
  const id = "job-order-page-size-style";
  let styleEl = document.getElementById(id);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = id;
    document.head.appendChild(styleEl);
  }
  const margin = orientation === "landscape" ? "8mm" : "6mm";
  styleEl.textContent = `@page { size: A4 ${orientation}; margin: ${margin}; }`;
}

// Chrome crops absolutely-positioned print content to page 1 unless the
// document's printable height covers the full challan. Measure the node and
// stretch <html>/<body> so every page is generated.
function prepareDeliveryChallanPrint(printRootId = "job-order-print") {
  const el = document.getElementById(printRootId);
  document.body.classList.add("print-delivery-challan");
  const height = el ? Math.ceil(el.scrollHeight) : 0;
  if (height > 0) {
    document.documentElement.style.setProperty(
      "--jo-print-height",
      `${height}px`,
    );
  }
  return () => {
    document.body.classList.remove("print-delivery-challan");
    document.documentElement.style.removeProperty("--jo-print-height");
  };
}

// ── Delivery Challan Print Template ───────────────────────────────────────────
function PrintChallan({ order }) {
  const ref = useRef();
  const sendFrom = sendFromFields(order);

  function handlePrint() {
    setPrintPageSize("portrait");
    let cleanup = prepareDeliveryChallanPrint("job-order-print");
    const onAfterPrint = () => {
      cleanup();
      window.removeEventListener("afterprint", onAfterPrint);
    };
    window.addEventListener("afterprint", onAfterPrint);
    // Re-measure after layout settles (stamp/logo), then print.
    requestAnimationFrame(() => {
      cleanup();
      cleanup = prepareDeliveryChallanPrint("job-order-print");
      window.print();
    });
  }

  const items = order.items || [];

  return (
    <>
      <style>{PRINT_STYLE}</style>
      <div
        id="job-order-print"
        ref={ref}
        style={{
          fontFamily: "'Helvetica Neue', Arial, sans-serif",
          fontSize: 12,
          color: "#1a1a1a",
          lineHeight: 1.45,
          background: "#fff",
          padding: 12,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {/* Header */}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td
                colSpan={2}
                style={{
                  border: "1px solid #000",
                  background: "#f3f1ec",
                  textAlign: "center",
                  padding: "8px 6px",
                  fontWeight: 700,
                  fontSize: 15,
                  letterSpacing: 2.5,
                }}
              >
                DELIVERY CHALLAN
              </td>
            </tr>
            <tr>
              <td
                style={{
                  width: "28%",
                  border: "1px solid #000",
                  borderTop: "none",
                  padding: 10,
                  verticalAlign: "middle",
                  textAlign: "center",
                }}
              >
                <img
                  src={COMPANY_LOGO_URL}
                  alt="Profile Solution Logo"
                  style={{
                    width: "100%",
                    maxWidth: 150,
                    height: "auto",
                    maxHeight: 70,
                    objectFit: "contain",
                    display: "block",
                    margin: 0,
                  }}
                />
              </td>
              <td
                style={{
                  border: "1px solid #000",
                  borderTop: "none",
                  borderLeft: "none",
                  padding: "10px 14px",
                  verticalAlign: "middle",
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                  {COMPANY_NAME}
                </div>
                <div style={{ color: "#333" }}>
                  <strong>Head Office:</strong> {COMPANY_ADDRESS_SHORT}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Parties + document meta — Send From (left) | Delivery (right) */}
        <table
          style={{ width: "100%", borderCollapse: "collapse", marginTop: -1 }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  border: "1px solid #000",
                  borderTop: "none",
                  padding: "10px 12px",
                  width: "50%",
                  verticalAlign: "top",
                  
                }}
              >
                <div style={{ ...challanLabelStyle, fontSize: 12, fontWeight: 700 }}
                
                >Send From</div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    marginBottom: 4,
                    lineHeight: 1.35,
                  }}
                >
                  {sendFrom.name}
                </div>
                <div style={{ ...challanBodyText, marginBottom: 10 }}>
                  {formatPrintAddress(sendFrom.address)}
                </div>
                <div
                  style={{
                    borderTop: "1px solid #000",
                    marginTop: 4,
                    paddingTop: 10,
                    fontSize: 12,
                  }}
                >
                  <strong>Issued By Name :</strong>{" "}
                  {order.issuedBy
                    ? order.issuedBy
                    : "___________________"}
                </div>
              </td>
              <td
                style={{
                  border: "1px solid #000",
                  borderTop: "none",
                  borderLeft: "none",
                  padding: "10px 12px",
                  width: "50%",
                  verticalAlign: "top",
               
                }}
              >
                <div style={{ ...challanLabelStyle, fontSize: 12, fontWeight: 700 }}>
                  Send To
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    marginBottom: 4,
                    lineHeight: 1.35,
                  }}
                >
                  {order.vendorName || "—"}
                </div>
                <div style={{ ...challanBodyText, marginBottom: 10 }}>
                  {formatPrintAddress(order.deliveryAddress || "—")}
                </div>

                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    borderTop: "1px solid #000",
                    marginTop: 4,
                  }}
                >
                  <tbody>
                    {[
                      {
                        label: "Challan No.",
                        value: order.srNo || "—",
                      },
                      {
                        label: "Date",
                        value: order.date
                          ? order.date.split("-").reverse().join("/")
                          : "—",
                      },
                      {
                        label: "Vehicle No.",
                        value: order.vehicleNo || "—",
                      },
                    ].map((row) => (
                      <tr key={row.label}>
                        <td
                          style={{
                            padding: "5px 0 0",
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#222",
                            width: "42%",
                            verticalAlign: "top",
                          }}
                        >
                          {row.label}
                        </td>
                        <td
                          style={{
                            padding: "5px 0 0",
                            fontSize: 12,
                            fontWeight: 400,
                            textAlign: "right",
                            verticalAlign: "top",
                          }}
                        >
                          {row.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div
                  style={{
                    borderTop: "1px solid #000",
                    marginTop: 10,
                    paddingTop: 10,
                    fontSize: 10,
                  }}
                >
                  <strong>Receive By :</strong> ___________________
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Items table */}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: -1,
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "28%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr style={{ background: "#f3f1ec" }}>
              {[
                "Sr",
                "Item Description",
                "Weight/Pcs (Kg)",
                "Perimeter (mm)",
                "Length (mm)",
                "Area/nos (Sq in)",
                "Qty",
                "UOM",
                "Process / RAL Code / Finish",
                "Project Name",
                "Remark",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    border: "1px solid #000",
                    padding: "7px 3px",
                    textAlign: "center",
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                    whiteSpace: "normal",
                    wordBreak: "break-word",
                    lineHeight: 1.25,
                    verticalAlign: "middle",
                    color: "#222",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const cellBase = {
                border: "1px solid #000",
                borderTop: "none",
                padding: "6px 4px",
                whiteSpace: "normal",
                wordBreak: "break-word",
                lineHeight: 1.3,
                verticalAlign: "top",
                fontSize: 11,
              };
              return (
                <tr key={i}>
                  <td style={{ ...cellBase, textAlign: "center" }}>{i + 1}</td>
                  <td style={cellBase}>{it.description}</td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {showNum(it.weightPerPc)}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {showNum(it.perimeter)}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {showNum(it.length)}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {it.area !== null && it.area !== undefined
                      ? Number(it.area).toFixed(2)
                      : "—"}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {it.qty}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {it.unit}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {it.process || "—"}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {it.projectName || "—"}
                  </td>
                  <td style={cellBase}>{it.remark || "—"}</td>
                </tr>
              );
            })}
            {Array.from({ length: Math.max(0, 4 - items.length) }).map(
              (_, i) => (
                <tr key={`empty-${i}`}>
                  {Array.from({ length: 11 }).map((_, j) => (
                    <td
                      key={j}
                      style={{
                        border: "1px solid #000",
                        borderTop: "none",
                        padding: "12px 6px",
                      }}
                    >
                      &nbsp;
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>

        {/* Footer — keep signature/stamp block together across page breaks */}
        <table
          className="jo-print-footer"
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: -1,
            pageBreakInside: "avoid",
            breakInside: "avoid",
          }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  border: "1px solid #000",
                  borderTop: "none",
                  padding: "12px 14px",
                  width: "58%",
                  verticalAlign: "top",
                  fontSize: 12,
                }}
              >
                <div style={{ marginBottom: 36 }}>
                  <strong>Prepared By Name &amp; Signature :</strong>{" "}
                  {order.issuedBy || " ___________________"}
                </div>
                <div>
                  <strong>Checked By Name &amp; Signature :</strong>{" "}
                  ___________________
                </div>
              </td>
              <td
                style={{
                  border: "1px solid #000",
                  borderTop: "none",
                  borderLeft: "none",
                  padding: "8px 12px 10px",
                  textAlign: "center",
                  verticalAlign: "bottom",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: 4,
                    letterSpacing: "0.04em",
                    fontSize: 11,
                  }}
                >
                  FOR PROFILE SOLUTION
                </div>
                <img
                  src={COMPANY_STAMP_URL}
                  alt="Profile Data Center Solutions stamp"
                  style={{
                    display: "block",
                    margin: "0 auto 4px",
                    width: 86,
                    height: 86,
                    objectFit: "contain",
                  }}
                />
                <div
                  style={{
                    borderTop: "1px solid #000",
                    paddingTop: 5,
                    fontSize: 10,
                    color: "#444",
                    letterSpacing: "0.04em",
                  }}
                >
                  Authorized Signatory
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Print button — hidden during print */}
      <div style={{ textAlign: "center", marginTop: 20 }} className="no-print">
        <button
          onClick={handlePrint}
          style={{
            background: "var(--teal)",
            color: "#fff",
            border: "none",
            padding: "10px 28px",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
            fontFamily: "Poppins, sans-serif",
          }}
        >
          🖨 Print Delivery Challan
        </button>
      </div>
    </>
  );
}

// ── Delivery Challan Print Style ──────────────────────────────────────────────
// #job-order-print is the DELIVERY CHALLAN (PrintChallan above) — portrait,
// since it's a single-column narrow document (logo box + address + a modest
// items table), same as a standard invoice/challan layout.
// Orientation itself is set dynamically by setPrintPageSize('portrait') right
// before window.print() — Chrome does not reliably honor `size` on NAMED
// @page rules, so we don't declare one here (see setPrintPageSize above).
const PRINT_STYLE = `
  @media print {
    /* Multi-page fix: keep challan in normal flow, unclip ancestors, and
       collapse non-print UI so Chrome doesn't crop to a single viewport page. */
    html, body, #root {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
    }

    body * {
      visibility: hidden !important;
    }

    #job-order-print,
    #job-order-print * {
      visibility: visible !important;
    }

    #job-order-print {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      background: #fff !important;
      z-index: 99999 !important;
      padding: 8px !important;
      margin: 0 !important;
      box-shadow: none !important;
      display: block !important;
    }

    /* Stretch printable document to the measured challan height so page 2+
       are not dropped when #job-order-print is position:absolute. */
    body.print-delivery-challan,
    body.print-delivery-challan html,
    html:has(body.print-delivery-challan) {
      height: auto !important;
      min-height: var(--jo-print-height, 100%) !important;
      overflow: visible !important;
    }
    body.print-delivery-challan {
      min-height: var(--jo-print-height, 100%) !important;
    }

    /* Critical: overflow:hidden / max-height on layout + modal was clipping
       tall challans to one printed page. */
    .shell,
    .main,
    .topbar,
    .sidebar,
    .nav,
    .jo-print-mount,
    .jo-modal-overlay,
    .jo-modal-panel,
    .jo-modal-body,
    .jo-modal-form,
    .jo-modal-header,
    .card,
    .tablewrap {
      position: static !important;
      inset: auto !important;
      top: auto !important;
      left: auto !important;
      right: auto !important;
      bottom: auto !important;
      width: auto !important;
      max-width: none !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      transform: none !important;
      box-shadow: none !important;
    }

    .jo-print-mount {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      z-index: 99999 !important;
      visibility: visible !important;
    }

    .jo-print-mount #job-order-print {
      position: relative !important;
      top: auto !important;
      left: auto !important;
    }

    .jo-modal-header,
    .jo-modal-actions,
    .no-print,
    .pagehead,
    .topbar,
    .sidebar,
    .nav,
    .navlist,
    .nav-overlay,
    .brand {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      overflow: hidden !important;
    }

    #job-order-print table {
      page-break-inside: auto !important;
      break-inside: auto !important;
    }
    #job-order-print thead {
      display: table-header-group !important;
    }
    #job-order-print tfoot {
      display: table-footer-group !important;
    }
    #job-order-print tr {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      page-break-after: auto !important;
    }
    #job-order-print img {
      max-width: 100% !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    #job-order-print .jo-print-footer {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    /* When challan is printed from View modal (not off-screen mount), pin it
       to the top of the print document and expand past the modal viewport. */
    body.print-delivery-challan .jo-modal-overlay,
    body.print-delivery-challan .jo-modal-panel,
    body.print-delivery-challan .jo-modal-body,
    body.print-delivery-challan .jo-modal-form {
      position: static !important;
      display: block !important;
      overflow: visible !important;
      max-height: none !important;
      height: auto !important;
      background: transparent !important;
      border: none !important;
      padding: 0 !important;
      margin: 0 !important;
    }

    body.print-delivery-challan .jo-modal-body > *:not(#job-order-print) {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      overflow: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    body.print-delivery-challan #job-order-print {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: auto !important;
      overflow: visible !important;
    }
  }
`;

// ── Receiving Receipt / Items-only Print Style ────────────────────────────────
// #job-order-items-print is the RECEIVING RECEIPT (PrintItemsTable below) —
// landscape, since it's a wide, many-column table that needs the extra
// horizontal room.
// Orientation set dynamically by setPrintPageSize('landscape') — see note above.
const ITEMS_PRINT_STYLE = `
  @media print {
    body.print-items-only,
    body.print-items-only html,
    body.print-items-only body,
    body.print-items-only #root {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
    }

    body.print-items-only .nav,
    body.print-items-only .topbar,
    body.print-items-only .nav-overlay,
    body.print-items-only .no-print,
    body.print-items-only .pagehead,
    body.print-items-only .jo-modal-header,
    body.print-items-only .jo-modal-body > *:not(.jo-print-mount) {
      display: none !important;
    }

    body.print-items-only #job-order-print {
      display: none !important;
      visibility: hidden !important;
    }

    body.print-items-only #job-order-items-print,
    body.print-items-only #job-order-items-print * {
      visibility: visible !important;
    }

    body.print-items-only #job-order-items-print {
      position: relative !important;
      top: auto !important;
      left: auto !important;
      width: 100% !important;
      max-width: none !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      background: #fff !important;
      z-index: 1 !important;
      padding: 0 !important;
      margin: 0 !important;
      display: block !important;
      box-shadow: none !important;
    }

    body.print-items-only .jo-print-mount {
      position: static !important;
      top: auto !important;
      left: auto !important;
      right: auto !important;
      width: 100% !important;
      max-width: none !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      z-index: auto !important;
      visibility: visible !important;
      background: #fff !important;
      transform: none !important;
    }

    body.print-items-only .shell,
    body.print-items-only .main,
    body.print-items-only .jo-modal-overlay,
    body.print-items-only .jo-modal-panel,
    body.print-items-only .jo-modal-panel--lg,
    body.print-items-only .jo-modal-body,
    body.print-items-only .jo-modal-form {
      position: static !important;
      inset: auto !important;
      width: 100% !important;
      max-width: none !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      transform: none !important;
      background: #fff !important;
      box-shadow: none !important;
      border: none !important;
      border-radius: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      display: block !important;
      backdrop-filter: none !important;
      min-height: 0 !important;
    }

    body.print-items-only #job-order-items-print table {
      width: 100% !important;
      page-break-inside: auto !important;
      break-inside: auto !important;
      margin: 0 !important;
    }
    body.print-items-only #job-order-items-print table + table {
      margin-top: -1px !important;
    }
    body.print-items-only #job-order-items-print thead {
      display: table-header-group !important;
    }
    body.print-items-only #job-order-items-print tr {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      page-break-after: auto !important;
    }
    body.print-items-only #job-order-items-print th,
    body.print-items-only #job-order-items-print td {
      overflow: hidden !important;
    }
    body.print-items-only .jo-receipt-page {
      width: 100% !important;
      background: #fff !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
      break-after: page;
      page-break-after: always;
    }
    body.print-items-only .jo-receipt-page:last-child,
    body.print-items-only .jo-receipt-page[data-print-only="true"] {
      break-after: auto !important;
      page-break-after: auto !important;
    }
  }
`;
function PrintItemsTable({ order }) {
  const lots = receiveLots(order);
  return (
    <>
      <style>{ITEMS_PRINT_STYLE}</style>
      <div
        id="job-order-items-print"
        style={{
          fontFamily: "'Helvetica Neue', Arial, sans-serif",
          fontSize: 11,
          color: "#1a1a1a",
          lineHeight: 1.4,
          background: "#fff",
          padding: 0,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {lots.map((lot) => (
        <div key={lot.id} className="jo-receipt-page" data-lot-id={lot.id}>
        {/* Branded header — just two boxes: logo, and document title */}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  width: 160,
                  border: "1px solid #000",
                  padding: 6,
                  verticalAlign: "middle",
                  textAlign: "center",
                }}
              >
                <img
                  src={COMPANY_LOGO_URL}
                  alt="Profile Solution Logo"
                  style={{
                    width: "100%",
                    height: "auto",
                    maxHeight: 64,
                    objectFit: "contain",
                    display: "block",
                    margin: "0 auto",
                  }}
                />
              </td>
              <td
                style={{
                  border: "1px solid #000",
                  borderLeft: "none",
                  padding: "8px 14px",
                  textAlign: "center",
                  verticalAlign: "middle",
                  background: "#f3f1ec",
                }}
              >
                <div
                  style={{ fontWeight: 700, fontSize: 18, letterSpacing: 2 }}
                >
                  RECEIVING RECEIPT
                </div>
                <div style={{ fontWeight: 600, fontSize: 11, marginTop: 4 }}>
                  Receipt {lot.index}
                  {lot.total > 1 ? ` of ${lot.total}` : ""}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Meta info */}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",

            fontSize: 11,
          }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  border: "1px solid #000",
                  padding: "5px 10px",
                  fontWeight: 700,
                  background: "#f3f1ec",
                  width: "10%",
                }}
              >
                Challan No
              </td>
              <td
                style={{
                  border: "1px solid #000",
                  padding: "5px 10px",
                  width: "20%",
                }}
              >
                {order.srNo || "—"}
              </td>
              <td
                style={{
                  border: "1px solid #000",
                  padding: "5px 10px",
                  fontWeight: 700,
                  background: "#f3f1ec",
                  width: "10%",
                }}
              >
                Date
              </td>
              <td
                style={{
                  border: "1px solid #000",
                  padding: "5px 10px",
                  width: "17%",
                }}
              >
                {formatDate(order.date)}
              </td>
              <td
                style={{
                  border: "1px solid #000",
                  padding: "5px 10px",
                  fontWeight: 700,
                  background: "#f3f1ec",
                  width: "13%",
                }}
              >
                Vendor
              </td>
              <td
                style={{
                  border: "1px solid #000",
                  padding: "5px 10px",
                  width: "30%",
                }}
              >
                {order.vendorName || "—"}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  border: "1px solid #000",
                  padding: "5px 10px",
                  fontWeight: 700,
                  background: "#f3f1ec",
                }}
              >
                Vehicle No
              </td>
              <td style={{ border: "1px solid #000", padding: "5px 10px" }}>
                {order.vehicleNo || "—"}
              </td>
              <td
                style={{
                  border: "1px solid #000",
                  padding: "5px 10px",
                  fontWeight: 700,
                  background: "#f3f1ec",
                }}
              >
                Receving Challan No 
              </td>
              <td style={{ border: "1px solid #000", padding: "5px 10px" }}>
                {lot.challanNo || order.challanNo || "—"}
              </td>
              <td
                style={{
                  border: "1px solid #000",
                  padding: "5px 10px",
                  fontWeight: 700,
                  background: "#f3f1ec",
                }}
              >
                Status
              </td>
              <td
                style={{
                  border: "1px solid #000",
                  padding: "5px 10px",
                  textTransform: "capitalize",
                }}
              >
                {statusLabel(order)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Items table — colgroup widths keep every column on the page.
            tableLayout:'fixed' makes each <col> width authoritative, but by
            default overflowing text still spills visibly into the next cell
            instead of wrapping — that's what caused the header/cell text to
            overlap. Forcing whiteSpace:'normal' + wordBreak + a fixed cell
            padding/line-height on every th/td stops that overflow and lets
            long labels ("Received (where)") wrap onto a second line inside
            their own column instead. */}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: "4%" }} />    {/* Sr */}
            <col style={{ width: "14%" }} />   {/* Item Description */}
            <col style={{ width: "6%" }} />    {/* Weight/Pcs */}
            <col style={{ width: "6.5%" }} />  {/* Perimeter */}
            <col style={{ width: "6.5%" }} />  {/* Length */}
            <col style={{ width: "6.5%" }} />  {/* Area/nos */}
            <col style={{ width: "6%" }} />    {/* Outward */}
            <col style={{ width: "12%" }} />   {/* Received (where) */}
            <col style={{ width: "9%" }} />    {/* Receive date */}
            <col style={{ width: "6%" }} />    {/* Pending */}
            <col style={{ width: "5%" }} />    {/* UOM */}
            <col style={{ width: "8%" }} />    {/* Process / RAL Code / Finish */}
            <col style={{ width: "6%" }} />    {/* Project Name */}
            <col style={{ width: "4.5%" }} />  {/* Remark */}
          </colgroup>
          <thead>
            <tr style={{ background: "#f3f1ec" }}>
              {[
                "Sr",
                "Item Description",
                "Wt/Pcs (Kg)",
                "Perimeter (mm)",
                "Length (mm)",
                "Area/nos (Sq in)",
                "Outward",
                "Received (where)",
                "Receive date",
                "Pending",
                "UOM",
                "Process / RAL Code / Finish",
                "Project Name",
                "Remark",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    border: "1px solid #000",
                    padding: "5px 3px",
                    textAlign: "center",
                    fontSize: 8,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0,
                    whiteSpace: "normal",
                    wordBreak: "break-word",
                    lineHeight: 1.2,
                    verticalAlign: "middle",
                    background: "#f3f1ec",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lot.lines.map((line, i) => {
              const it = line.item;
              const pending = line.pending;
              const receipt = line.receipt;
              const cellBase = {
                border: "1px solid #000",
                padding: "5px 5px",
                whiteSpace: "normal",
                wordBreak: "break-word",
                lineHeight: 1.3,
                verticalAlign: "top",
              };
              return (
                <tr key={i}>
                  <td style={{ ...cellBase, textAlign: "center" }}>{i + 1}</td>
                  <td style={cellBase}>{it.description}</td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {showNum(it.weightPerPc)}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {showNum(it.perimeter)}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {showNum(it.length)}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {it.area !== null && it.area !== undefined
                      ? Number(it.area).toFixed(2)
                      : "—"}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>{it.qty}</td>
                  <td style={{ ...cellBase, fontSize: 9 }}>
                    {receiptWhereLabel(receipt)}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center", fontSize: 9 }}>
                    {formatDate(receiptReceivedDate(receipt))}
                  </td>
                  <td
                    style={{
                      ...cellBase,
                      textAlign: "center",
                      fontWeight: pending > 0 ? 700 : 400,
                    }}
                  >
                    {pending}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {it.unit}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {it.process || "—"}
                  </td>
                  <td style={{ ...cellBase, textAlign: "center" }}>
                    {it.projectName || "—"}
                  </td>
                  <td style={cellBase}>{it.remark || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Footer */}
        <div
          style={{
            marginTop: 14,
            display: "flex",
            justifyContent: "space-between",
            fontSize: 9.5,
            color: "#555",
          }}
        >
          <div>Generated on {formatDateTime(new Date().toISOString())}</div>
          <div style={{ fontWeight: 700 }}>{COMPANY_NAME}</div>
        </div>
        </div>
        ))}
      </div>
    </>
  );
}

// Given a saved process string, figures out how to prefill the edit form's
// process dropdown(s). The current save format stores JUST the RAL code /
// finish for processes with sub-options (e.g. "PC-RAL-9003 Matt", "Matt") —
// no "Powder Coating: " / "Anodizing: " prefix. Older records saved before
// this change may still have that prefix, so both formats are handled:
//  - exact match to a no-suboption process (Galvanized / Hot-Dip) -> select it
//  - exact match to a known sub-option value -> select its main process +
//    that sub-option (current format)
//  - "Main: Sub" (or bare main) matching a known process+suboption -> select
//    both dropdowns (legacy format, kept for backward compatibility)
//  - anything else -> select "Other" and preload the typed field with it
//  - blank -> nothing selected
function deriveProcessFields(savedProcess) {
  const val = String(savedProcess || "").trim();
  if (!val) return { process: "", processSub: "", processOther: "" };

  if (PROCESS_MAIN_OPTIONS.includes(val) && !PROCESS_SUBOPTIONS[val]) {
    return { process: val, processSub: "", processOther: "" };
  }

  // Current format: the saved value IS the sub-option itself.
  for (const main of Object.keys(PROCESS_SUBOPTIONS)) {
    if (PROCESS_SUBOPTIONS[main].includes(val)) {
      return { process: main, processSub: val, processOther: "" };
    }
  }

  // Legacy format: "Main: Sub" (or bare main name) from before this change.
  for (const main of Object.keys(PROCESS_SUBOPTIONS)) {
    if (val === main) return { process: main, processSub: "", processOther: "" };
    const prefix = `${main}: `;
    if (val.startsWith(prefix)) {
      const sub = val.slice(prefix.length);
      return { process: main, processSub: sub, processOther: "" };
    }
  }

  return { process: OTHER_PROCESS, processSub: "", processOther: val };
}

// ── Hover-flyout Process / RAL Code / Finish picker ─────────────────────────
// Replaces a plain <select> so the RAL/finish sub-options for Powder Coating
// and Anodizing appear as a flyout the moment you hover the main process row
// — no click required to reveal them. Falls back to tap-to-open on touch
// devices (no hover there) via the `@media (hover: none)` rule in the CSS
// block below.
function ProcessPicker({ value, subValue, otherValue, onSelect }) {
  const [open, setOpen] = useState(false);
  const [openSub, setOpenSub] = useState(null); // which main option's submenu is open
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [subPos, setSubPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const subRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (
        btnRef.current?.contains(e.target) ||
        menuRef.current?.contains(e.target) ||
        subRef.current?.contains(e.target)
      )
        return;
      setOpen(false);
      setOpenSub(null);
      setSubPos(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onScroll(e) {
      if (menuRef.current?.contains(e.target) || subRef.current?.contains(e.target)) return;
      setOpen(false);
      setOpenSub(null);
      setSubPos(null);
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const label =
    value === OTHER_PROCESS
      ? otherValue || "Other (type your own)"
      : PROCESS_SUBOPTIONS[value]
        ? subValue || `Select ${value === "Anodizing" ? "finish" : "RAL code"}…`
        : value || "Select process…";

  function pick(main, sub) {
    onSelect(main, sub);
    setOpen(false);
    setOpenSub(null);
    setSubPos(null);
  }

  function placeSubmenu(main, anchor) {
    const rect = anchor.getBoundingClientRect();
    const menuRect = menuRef.current?.getBoundingClientRect();
    const subW = 250;
    const gap = 6;
    const pad = 12;
    const count = PROCESS_SUBOPTIONS[main]?.length || 0;
    const estimatedH = Math.min(320, count * 32 + 12);
    let left = (menuRect?.right ?? rect.right) + gap;
    if (left + subW > window.innerWidth - pad) {
      left = (menuRect?.left ?? rect.left) - subW - gap;
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - subW - pad));
    let top = rect.top;
    const maxHeight = Math.max(120, Math.min(estimatedH, window.innerHeight - pad * 2));
    if (top + maxHeight > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - pad - maxHeight);
    }
    setSubPos({ top, left, maxHeight, width: subW });
  }

  function toggleSub(main, e) {
    e.stopPropagation();
    if (openSub === main) {
      setOpenSub(null);
      setSubPos(null);
      return;
    }
    placeSubmenu(main, e.currentTarget);
    setOpenSub(main);
  }

  function handleOpen() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuW = 240;
      const gap = 4;
      const pad = 12;
      // Always open BELOW the trigger so the menu never covers fields above
      // (Send From / Vendor / etc.). Scroll inside the menu if needed.
      let left = rect.left;
      left = Math.min(left, window.innerWidth - menuW - pad);
      left = Math.max(pad, left);
      const top = rect.bottom + gap;
      const maxHeight = Math.max(160, window.innerHeight - top - pad);

      setPos({ top, left, maxHeight });
    }
    setOpen((v) => !v);
    setOpenSub(null);
    setSubPos(null);
  }

  const menu =
    open &&
    createPortal(
      <ul
        ref={menuRef}
        className="jo-process-menu jo-process-menu--portal"
        style={{
          top: pos.top,
          left: pos.left,
          maxHeight: pos.maxHeight || 280,
          overflowX: "hidden",
          overflowY: "auto",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {PROCESS_MAIN_OPTIONS.map((main) => {
          const subs = PROCESS_SUBOPTIONS[main];
          if (subs) {
            return (
              <li
                key={main}
                className={`jo-process-menu-item has-sub${openSub === main ? " is-open" : ""}`}
                onClick={(e) => toggleSub(main, e)}
              >
                <span className="jo-process-menu-label">
                  {main} <span className="jo-process-menu-arrow">▸</span>
                </span>
              </li>
            );
          }
          return (
            <li
              key={main}
              className="jo-process-menu-item"
              onClick={() => pick(main, "")}
            >
              {main}
            </li>
          );
        })}
        <li
          className="jo-process-menu-item"
          onClick={() => pick(OTHER_PROCESS, "")}
        >
          Other (type your own)
        </li>
      </ul>,
      document.body,
    );

  const submenu =
    open &&
    openSub &&
    subPos &&
    PROCESS_SUBOPTIONS[openSub] &&
    createPortal(
      <ul
        ref={subRef}
        className="jo-process-submenu jo-process-submenu--portal"
        style={{
          top: subPos.top,
          left: subPos.left,
          width: subPos.width,
          maxHeight: subPos.maxHeight,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {PROCESS_SUBOPTIONS[openSub].map((s) => (
          <li
            key={s}
            onClick={(e) => {
              e.stopPropagation();
              pick(openSub, s);
            }}
          >
            {s}
          </li>
        ))}
      </ul>,
      document.body,
    );

  return (
    <div className="jo-process-picker">
      <button
        ref={btnRef}
        type="button"
        className="jo-process-trigger"
        onClick={handleOpen}
      >
        <span className="jo-process-trigger-label">{label}</span>
        <span className="jo-process-caret">▾</span>
      </button>
      {menu}
      {submenu}
    </div>
  );
}
/** Searchable item description: filters presets as you type; Other = free text. */
function DescriptionCombobox({ value, options, onChange, placeholder }) {
  const list = Array.isArray(options) ? options : [];
  const isPreset = list.some((n) => n === value);
  const [open, setOpen] = useState(false);
  const [otherMode, setOtherMode] = useState(() => !!value && !isPreset);
  const [query, setQuery] = useState(value || "");
  const wrapRef = useRef(null);

  useEffect(() => {
    const preset = list.some((n) => n === value);
    setOtherMode(!!value && !preset);
    setQuery(value || "");
  }, [value, list]);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return list;
    return list.filter((n) => n.toLowerCase().includes(q));
  }, [list, query]);

  function pickPreset(name) {
    setOtherMode(false);
    setQuery(name);
    onChange(name);
    setOpen(false);
  }

  function pickOther() {
    setOtherMode(true);
    setQuery("");
    onChange("");
    setOpen(true);
  }

  return (
    <div className="jo-desc-combo" ref={wrapRef}>
      <input
        type="text"
        value={query}
        placeholder={placeholder || "Search or type item…"}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          const exact = list.find((n) => n.toLowerCase() === next.trim().toLowerCase());
          if (exact) {
            setOtherMode(false);
            onChange(exact);
          } else {
            setOtherMode(true);
            onChange(next);
          }
        }}
        autoComplete="off"
      />
      {open && (
        <div className="jo-desc-menu" role="listbox">
          {filtered.length === 0 && !otherMode && (
            <div className="jo-desc-empty">No matching items</div>
          )}
          {filtered.map((name) => (
            <button
              key={name}
              type="button"
              className={`jo-desc-option${name === value ? " is-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickPreset(name)}
            >
              {name}
            </button>
          ))}
          <button
            type="button"
            className={`jo-desc-option jo-desc-other${otherMode ? " is-active" : ""}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={pickOther}
          >
            Other (type your own)
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shared item-row field renderer ─────────────────────────────────────────
// Used by both the create form and EditModal so the mobile fix (stacked,
// individually-labelled fields) only has to live in one place. Every field
// gets its own <label> — hidden via CSS on desktop (where the shared
// .jo-item-header row above the rows already provides column labels) and
// shown on mobile (where that header row is hidden and rows stack to a
// single column, so each input needs its own label to stay legible).
function ItemRow({ it, idx, updateItem, removeItem, disableRemove, descriptionOptions }) {
  const area = calcArea(it.perimeter, it.length);
  const useDescList = Array.isArray(descriptionOptions) && descriptionOptions.length > 0;
  return (
    <div className="jo-item-row">
      <div className="field">
        <label>Item Description</label>
        {useDescList ? (
          <DescriptionCombobox
            value={it.description}
            options={descriptionOptions}
            onChange={(description) => updateItem(it._key, { description })}
            placeholder={`Item ${idx + 1} — search or type`}
          />
        ) : (
          <input
            value={it.description}
            onChange={(e) => updateItem(it._key, { description: e.target.value })}
            placeholder={`Item ${idx + 1} description`}
          />
        )}
      </div>
      <div className="field">
        <label>Weight/Pcs (Kg)</label>
        <input
          type="number"
          min="0"
          step="any"
          value={it.weightPerPc}
          onChange={(e) => updateItem(it._key, { weightPerPc: e.target.value })}
          placeholder="0.00"
        />
      </div>
      <div className="field">
        <label>Perimeter (mm)</label>
        <input
          type="number"
          min="0"
          step="any"
          value={it.perimeter}
          onChange={(e) => updateItem(it._key, { perimeter: e.target.value })}
          placeholder="0"
        />
      </div>
      <div className="field">
        <label>Length (mm)</label>
        <input
          type="number"
          min="0"
          step="any"
          value={it.length}
          onChange={(e) => updateItem(it._key, { length: e.target.value })}
          placeholder="0"
        />
      </div>
      <div className="field">
        <label>Area/nos (Sq in)</label>
        <input
          value={area ? area.toFixed(2) : ""}
          disabled
          placeholder="Auto"
          title="Perimeter × Length ÷ 645.2 — calculated automatically"
        />
      </div>
      <div className="field">
        <label>Qty</label>
        <input
          type="number"
          min="0"
          step="any"
          value={it.qty}
          onChange={(e) => updateItem(it._key, { qty: e.target.value })}
          placeholder="0"
        />
      </div>
      <div className="field">
        <label>UOM</label>
        <select
          value={it.unit}
          onChange={(e) => updateItem(it._key, { unit: e.target.value })}
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Process / RAL Code / Finish</label>
        <input
          type="text"
          value={
            it.process === OTHER_PROCESS
              ? it.processOther
              : PROCESS_SUBOPTIONS[it.process]
                ? it.processSub || ""
                : it.process || ""
          }
          onChange={(e) =>
            updateItem(it._key, {
              process: e.target.value,
              processSub: "",
              processOther: "",
            })
          }
          placeholder="Type process / RAL / finish"
        />
      </div>
      <div className="field">
        <label>
          Project Name <span style={{ color: "var(--red)" }}>*</span>
        </label>
        <input
          value={it.projectName}
          onChange={(e) => updateItem(it._key, { projectName: e.target.value })}
          placeholder="Project name"
        />
      </div>
      <div className="field">
        <label>Remark</label>
        <input
          value={it.remark}
          onChange={(e) => updateItem(it._key, { remark: e.target.value })}
          placeholder="NTT, NAV DC-3…"
        />
      </div>
      <button
        type="button"
        onClick={() => removeItem(it._key)}
        disabled={disableRemove}
        className="jo-item-remove"
      >
        ✕
      </button>
    </div>
  );
}

// ── View Details Modal ────────────────────────────────────────────────────────
function ViewModal({ order, onClose, onEdit }) {
  const [detail, setDetail] = useState(order);

  useEffect(() => {
    setDetail(order);
    if (!order?._id) return;
    let cancelled = false;
    (async () => {
      try {
        const full = await apiGet(`/job-orders/${order._id}`);
        if (!cancelled) setDetail(full);
      } catch (err) {
        console.error("[ViewModal] failed to load order details", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Cleans up the body class used to isolate the items-only print output
  // (see handleDownloadItemsPdf below) in case the print dialog is
  // cancelled or closed — 'afterprint' fires either way.
  useEffect(() => {
    const cleanup = () => {
      document.body.classList.remove("print-items-only");
      document
        .querySelectorAll("#job-order-items-print .jo-receipt-page")
        .forEach((el) => {
          el.style.display = "";
          delete el.dataset.printOnly;
        });
    };
    window.addEventListener("afterprint", cleanup);
    return () => window.removeEventListener("afterprint", cleanup);
  }, []);

  function handleDownloadItemsPdf(lotId) {
    document
      .querySelectorAll("#job-order-items-print .jo-receipt-page")
      .forEach((el) => {
        const show = !lotId || el.dataset.lotId === String(lotId);
        el.style.display = show ? "block" : "none";
        if (lotId && show) el.dataset.printOnly = "true";
        else delete el.dataset.printOnly;
      });
    setPrintPageSize("landscape");
    document.body.classList.add("print-items-only");
    setTimeout(() => window.print(), 100);
  }

  const sendFrom = sendFromFields(detail);
  const receiptLots = receiveLots(detail);

  return (
    <div className="jo-modal-overlay" onClick={onClose}>
      <div
        className="jo-modal-panel jo-modal-panel--lg jo-modal-panel--view"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="jo-modal-header">
          <div className="jo-modal-header-text">
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              Job Order #{detail.srNo}
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#8a8270" }}>
              {formatDate(detail.date)} · {detail.vendorName} ·{" "}
              {detail.vehicleNo || "—"}
            </p>
          </div>
          <div className="jo-modal-actions no-print">
            {onEdit && (
              <button
                onClick={onEdit}
                className="btn btn-ghost btn-sm"
                style={{ whiteSpace: "nowrap" }}
              >
                ✎ Edit
              </button>
            )}
            <button
              type="button"
              className="jo-modal-close"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal body */}
        <div className="jo-modal-body">
          {/* Meta info */}
          <div className="jo-meta-grid">
            {[
              { label: "challan No", value: detail.srNo },
              { label: "Date", value: formatDate(detail.date) },
              { label: "Send From Name", value: sendFrom.name },
              { label: "Send From Address", value: sendFrom.address },
              { label: "Vendor Name", value: detail.vendorName },
              {
                label: "Vendor Expected",
                value: String(detail.vendorExpectedDate || "").trim()
                  ? formatDate(detail.vendorExpectedDate)
                  : "Waiting for vendor receive",
              },
              { label: "Vehicle No", value: detail.vehicleNo || "—" },
              { label: "Issued By", value: detail.issuedBy || "—" },
              {
                label: "Delivery Address",
                value: detail.deliveryAddress || "—",
              },
              { label: "Challan No", value: detail.challanNo || "—" },
              { label: "Received At", value: detail.receivedAt || "—" },
              { label: "Received By", value: detail.receivedBy || "—" },
              { label: "Status", value: statusLabel(detail) },
            ].map((f) => (
              <div
                key={f.label}
                style={{
                  background: "var(--paper-dim)",
                  borderRadius: 8,
                  padding: "10px 14px",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "#8a8270",
                    marginBottom: 4,
                  }}
                >
                  {f.label}
                </div>
                <div
                  style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
                >
                  {f.value}
                </div>
              </div>
            ))}
          </div>

          {/* Items table */}
          <div className="jo-items-toolbar">
            <h3
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "1px",
                color: "#8a8270",
                margin: 0,
              }}
            >
              Items
            </h3>
            <div className="no-print" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {receiptLots.map((lot) => (
                <button
                  key={lot.id}
                  onClick={() => handleDownloadItemsPdf(lot.id)}
                  style={{
                    background: "var(--paper-dim)",
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--ink)",
                    padding: "5px 10px",
                  }}
                >
                  ⬇ Receipt {lot.index}
                  {lot.receivedDate ? ` · ${formatDate(lot.receivedDate)}` : ""}
                </button>
              ))}
            </div>
          </div>
          {/* Off-screen mount feeding the items-only print/PDF (see ITEMS_PRINT_STYLE) */}
          <div
            className="jo-print-mount"
            style={{ position: "fixed", top: -99999, left: -99999, zIndex: -1 }}
          >
            <PrintItemsTable order={detail} />
          </div>
          <div className="tablewrap jo-view-items-wrap" style={{ marginBottom: 20 }}>
            <table>
              <thead>
                <tr>
                  <th>Sr No</th>
                  <th>Item Description</th>
                  <th className="num">Wt/Pcs (Kg)</th>
                  <th className="num">Perimeter (mm)</th>
                  <th className="num">Length (mm)</th>
                  <th className="num">Area/nos (Sq in)</th>
                  <th className="num">Out</th>
                  <th>Received (where)</th>
                  <th>Receive date</th>
                  <th className="num">Pending</th>
                  <th>UOM</th>
                  <th>Process / RAL Code / Finish</th>
                  <th>Project Name</th>
                  <th>Remark</th>
                </tr>
              </thead>
              <tbody>
                {(detail.items || []).map((it, i) => {
                  const received = num(it.receivedQty);
                  const pending = Math.max(0, num(it.qty) - received);
                  const receipts = it.receipts || [];
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td style={{ fontWeight: 500 }}>{it.description}</td>
                      <td className="num">{showNum(it.weightPerPc)}</td>
                      <td className="num">{showNum(it.perimeter)}</td>
                      <td className="num">{showNum(it.length)}</td>
                      <td className="num">
                        {it.area !== null && it.area !== undefined
                          ? Number(it.area).toFixed(2)
                          : "—"}
                      </td>
                      <td className="num">{it.qty}</td>
                      <td style={{ fontSize: 12 }}>
                        {receipts.length ? (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                            }}
                          >
                            {receipts.map((r, ri) => (
                              <span
                                key={ri}
                                style={{
                                  color: "var(--teal-dark)",
                                  fontWeight: 600,
                                }}
                              >
                                {receiptWhereLabel(r)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: "#8a8270" }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {receipts.length ? (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                            }}
                          >
                            {receipts.map((r, ri) => (
                              <span key={ri} style={{ fontWeight: 600 }}>
                                {formatDate(receiptReceivedDate(r))}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: "#8a8270" }}>—</span>
                        )}
                      </td>
                      <td
                        className="num"
                        style={{
                          color: pending > 0 ? "var(--rust-dark)" : undefined,
                          fontWeight: pending > 0 ? 700 : undefined,
                        }}
                      >
                        {pending}
                      </td>
                      <td>{it.unit}</td>
                      <td>{it.process || "—"}</td>
                      <td>{it.projectName || "—"}</td>
                      <td>{it.remark || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h3
            className="no-print"
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "#8a8270",
              marginBottom: 10,
            }}
          >
            Vendor readiness and QC
          </h3>
          <div className="tablewrap jo-view-qc-wrap no-print" style={{ marginBottom: 20 }}>
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th className="num">Order qty</th>
                  <th className="num">Vendor ready</th>
                  <th className="num">Qty with QC</th>
                  <th className="num">Ready to dispatch</th>
                  <th className="num">Rework</th>
                  <th>Rework remark</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(detail.items || []).map((it, i) => {
                  const line = qcLine(it);
                  return (
                    <tr key={`qc-${i}`}>
                      <td style={{ fontWeight: 500 }}>{it.description}</td>
                      <td className="num">{it.qty} {it.unit || "NOS"}</td>
                      <td className="num">{line.readyQty ? Math.round(line.readyQty * 1000) / 1000 : "—"}</td>
                      <td className="num">{line.pendingQty ? Math.round(line.pendingQty * 1000) / 1000 : "—"}</td>
                      <td className="num">{line.dispatch ? Math.round(line.dispatch * 1000) / 1000 : "—"}</td>
                      <td className="num">{line.rework ? Math.round(line.rework * 1000) / 1000 : "—"}</td>
                      <td style={{ fontSize: 12, whiteSpace: "normal", maxWidth: 220 }}>
                        {line.reworkNotes.length
                          ? line.reworkNotes.map((note) => note.remark).join(" · ")
                          : "—"}
                      </td>
                      <td style={{ fontSize: 12 }}>{line.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Transaction history */}
          {detail.history?.length > 0 && (
            <>
              <h3
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "1px",
                  color: "#8a8270",
                  marginBottom: 10,
                }}
              >
                Transaction History
              </h3>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginBottom: 20,
                }}
              >
                {detail.history.map((h, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "8px 14px",
                      background: "var(--paper-dim)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 10,
                        background:
                          h.action === "issued"
                            ? "#e6f2f0"
                            : h.action === "received"
                              ? "#eef2ff"
                              : "#f8ede7",
                        color:
                          h.action === "issued"
                            ? "var(--teal-dark)"
                            : h.action === "received"
                              ? "#3730a3"
                              : "var(--rust-dark)",
                        textTransform: "uppercase",
                      }}
                    >
                      {h.action}
                    </span>
                    <span style={{ color: "var(--ink)" }}>{h.note || "—"}</span>
                    <span style={{ marginLeft: "auto", color: "#8a8270" }}>
                      {h.by} · {formatDateTime(h.at)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Print challan */}
          <h3
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "#8a8270",
              marginBottom: 10,
            }}
          >
            Delivery Challan
          </h3>
          <PrintChallan order={detail} />
        </div>
      </div>
    </div>
  );
}

function OrderMaterials({ order }) {
  return (
    <div className="jo-materials">
      <div className="jo-materials-parties">
        <div>
          <div className="jo-materials-kicker">Send from</div>
          <div className="jo-materials-name">{order.sendFromName || "—"}</div>
          <div className="jo-materials-text">{order.sendFromAddress || "—"}</div>
        </div>
        <div>
          <div className="jo-materials-kicker">Delivery address</div>
          <div className="jo-materials-name">{order.vendorName || "—"}</div>
          <div className="jo-materials-text">{order.deliveryAddress || "—"}</div>
        </div>
      </div>
      <div className="jo-materials-scroll jo-materials-desktop">
        <table className="jo-materials-table">
          <colgroup>
            <col className="jo-m-sr" />
            <col className="jo-m-desc" />
            <col className="jo-m-qty" />
            <col className="jo-m-process" />
            <col className="jo-m-project" />
            <col className="jo-m-num" />
            <col className="jo-m-num" />
            <col className="jo-m-num" />
            <col className="jo-m-num" />
          </colgroup>
          <thead>
            <tr>
              <th>Sr</th>
              <th>Item</th>
              <th className="num">Qty</th>
              <th>Process / RAL</th>
              <th>Project</th>
              <th className="num">Ready</th>
              <th className="num">Rework</th>
              <th className="num">Recv</th>
              <th className="num">Avail</th>
            </tr>
          </thead>
          <tbody>
            {(order.items || []).map((it, i) => {
              const line = qcLine(it);
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="jo-materials-desc">{it.description}</td>
                  <td className="num">{it.qty} {it.unit || "NOS"}</td>
                  <td>{it.process || "—"}</td>
                  <td>{it.projectName || "—"}</td>
                  <td className="num">{line.dispatch ? Math.round(line.dispatch * 1000) / 1000 : "—"}</td>
                  <td className="num">{line.rework ? Math.round(line.rework * 1000) / 1000 : "—"}</td>
                  <td className="num">{num(it.receivedQty) || "—"}</td>
                  <td className="num">{receivableNow(it) || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="jo-materials-mobile">
        {(order.items || []).map((it, i) => {
          const line = qcLine(it);
          return (
            <div key={i} className="jo-materials-card">
              <h4>{i + 1}. {it.description || "—"}</h4>
              <div className="jo-materials-grid">
                <div><span>Qty</span><strong>{it.qty} {it.unit || "NOS"}</strong></div>
                <div><span>Process</span><strong>{it.process || "—"}</strong></div>
                <div><span>Project</span><strong>{it.projectName || "—"}</strong></div>
                <div><span>Ready</span><strong>{qcQtyLabel(line.dispatch, line.orderQty)}</strong></div>
                <div><span>Rework</span><strong>{qcQtyLabel(line.rework, line.orderQty)}</strong></div>
                <div><span>Received</span><strong>{num(it.receivedQty)}</strong></div>
                <div><span>Can receive</span><strong>{receivableNow(it)}</strong></div>
                {it.remark ? <div className="jo-materials-span"><span>Remark</span><strong>{it.remark}</strong></div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReceiveModal({ order, onSave, onClose }) {
  const { user } = useAuth();
  const [receivedBy, setReceivedBy] = useState("");
  const [challanNo, setChallanNo] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // qtyInputs[i]      = qty being received NOW for item i, defaulted to the remaining (pending) qty.
  // locationInputs[i] = location this item's qty is being received at (only matters when qty > 0).
  const [qtyInputs, setQtyInputs] = useState(() =>
    (order.items || []).map((it) => receivableNow(it)),
  );
  const [locationInputs, setLocationInputs] = useState(() =>
    (order.items || []).map(() => LOCATIONS[0]),
  );
  const [siteNames, setSiteNames] = useState(() =>
    (order.items || []).map(() => ""),
  );

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function setQty(i, rawVal) {
    const it = order.items[i];
    const allowed = receivableNow(it);
    const dispatchQty = readyToDispatchQty(it);
    if (rawVal === "") {
      setErr("");
      setQtyInputs((list) => list.map((v, idx) => (idx === i ? "" : v)));
      return;
    }
    const n = num(rawVal);
    if (n < 0) {
      setQtyInputs((list) => list.map((v, idx) => (idx === i ? "0" : v)));
      return;
    }
    if (n > allowed + 0.0001) {
      setErr(
        allowed <= 0.0001
          ? `"${it.description}": nothing is ready to dispatch, so it cannot be received.`
          : `"${it.description}": cannot receive more than ready to dispatch (${dispatchQty}). Only ${allowed} is still left to receive.`,
      );
      return;
    }
    setErr("");
    setQtyInputs((list) => list.map((v, idx) => (idx === i ? rawVal : v)));
  }
  function setItemLocation(i, val) {
    setLocationInputs((list) => list.map((v, idx) => (idx === i ? val : v)));
  }
  function setSiteName(i, val) {
    setSiteNames((list) => list.map((v, idx) => (idx === i ? val : v)));
  }

  async function handleSave(e) {
    e.preventDefault();
    setErr("");
    if (!receivedBy.trim()) {
      setErr("Please enter who received the goods.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(receivedDate || "").trim())) {
      setErr("Receive date is compulsory.");
      return;
    }

    const itemsPayload = [];
    let anyReceiving = false;
    for (let i = 0; i < order.items.length; i++) {
      const it = order.items[i];
      const already = num(it.receivedQty);
      const remaining = Math.max(0, num(it.qty) - already);
      const allowed = receivableNow(it);
      const dispatchQty = readyToDispatchQty(it);
      const receiving = num(qtyInputs[i]);

      if (receiving < 0) {
        setErr(`"${it.description}": quantity can't be negative.`);
        return;
      }
      if (receiving > remaining + 0.0001) {
        setErr(
          `"${it.description}": received qty (${receiving}) can't exceed ordered qty. Only ${remaining} of ${num(it.qty)} is still pending.`,
        );
        return;
      }
      if (receiving > allowed + 0.0001) {
        setErr(
          allowed <= 0.0001
            ? `"${it.description}": nothing is ready to dispatch, so it cannot be received.`
            : `"${it.description}": cannot receive more than ready to dispatch (${dispatchQty}). Only ${allowed} is still left to receive.`,
        );
        return;
      }
      const siteName = String(siteNames[i] || "").trim();
      if (receiving > 0) {
        anyReceiving = true;
        if (!locationInputs[i]) {
          setErr(`Choose a location for "${it.description}".`);
          return;
        }
        if (locationInputs[i] === "Site" && !siteName) {
          setErr(`Site name is compulsory for "${it.description}".`);
          return;
        }
      }
      itemsPayload.push({
        receiving,
        location: locationInputs[i],
        siteName: locationInputs[i] === "Site" ? siteName : "",
      });
    }
    if (!anyReceiving) {
      const canReceiveAny = order.items.some((it) => receivableNow(it) > 0.0001);
      setErr(
        canReceiveAny
          ? "Enter a received quantity for at least one item — you can receive part of the ready-to-dispatch quantity now and the rest later."
          : "Nothing is ready to dispatch yet, so this order cannot be received.",
      );
      return;
    }

    setSaving(true);
    try {
      const payload = {
        items: itemsPayload,
        receivedBy,
        challanNo,
        receivedDate,
        note,
      };
      console.log(
        "[ReceiveModal] submitting receive payload",
        order._id,
        payload,
      ); // remove once confirmed working
      await onSave(payload);
    } catch (e) {
      console.error("[ReceiveModal] receive failed", e);
      setErr(e.message || "Something went wrong while saving.");
      setSaving(false);
    }
  }

  return (
    <div className="jo-modal-overlay jo-modal-overlay--high">
      <div
        className="jo-modal-panel jo-modal-panel--md"
        role="dialog"
        aria-modal="true"
        aria-label={`Mark as Received ${order.srNo}`}
      >
        <div className="jo-modal-header">
          <div className="jo-modal-header-text">
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              Mark as Received — #{order.srNo}
            </h2>
          </div>
          <button
            type="button"
            className="jo-modal-close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <form
          onSubmit={handleSave}
          className="jo-modal-form"
        >
          <div className="jo-modal-body">
            <div className="jo-receive-hint">Receive only ready-to-dispatch quantity.</div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginBottom: 20,
              }}
            >
              {order.items.map((it, i) => {
                const already = num(it.receivedQty);
                const dispatchQty = readyToDispatchQty(it);
                const allowed = receivableNow(it);
                const receiving = num(qtyInputs[i]);
                const needsSite =
                  locationInputs[i] === "Site" && allowed > 0 && receiving > 0;
                return (
                  <div key={i} className="jo-receive-row">
                    <div className="jo-receive-main">
                      <div className="jo-receive-title">{it.description}</div>
                      <div className="jo-receive-sub">
                        Outward {it.qty} {it.unit}
                        {it.perimeter != null && it.length != null
                          ? ` · ${it.perimeter}×${it.length}mm`
                          : ""}
                      </div>
                      <div className="jo-receive-stats">
                        <span>Already <strong>{already}</strong></span>
                        <span>Ready to dispatch <strong>{dispatchQty}</strong></span>
                        <span>Can receive <strong className={allowed > 0 ? "is-open" : "is-done"}>{allowed}</strong></span>
                      </div>
                      {allowed <= 0 && (
                        <div className="jo-receive-note">
                          {dispatchQty <= 0.0001
                            ? "Nothing is ready to dispatch yet, so location stays locked."
                            : already >= dispatchQty - 0.0001
                            ? "This ready-to-dispatch quantity is already received. Location stays locked until QC marks more."
                            : "Nothing left to receive on this line."}
                        </div>
                      )}
                    </div>
                    <div className="jo-receive-controls">
                      <div className="field" style={{ margin: 0 }}>
                        <label>Qty received</label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          max={allowed}
                          value={qtyInputs[i]}
                          onChange={(e) => setQty(i, e.target.value)}
                          disabled={allowed <= 0}
                          placeholder="0"
                        />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label>Location</label>
                        <select
                          value={locationInputs[i]}
                          onChange={(e) => setItemLocation(i, e.target.value)}
                          disabled={allowed <= 0}
                        >
                          {LOCATIONS.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </div>
                      {needsSite && (
                        <div className="field jo-receive-site" style={{ margin: 0 }}>
                          <label>
                            Site name{" "}
                            <span style={{ color: "var(--red)" }}>*</span>
                          </label>
                          <input
                            value={siteNames[i]}
                            onChange={(e) => setSiteName(i, e.target.value)}
                            placeholder="Type the site name"
                            required
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="formgrid">
              <div className="field full">
                <label>
                  Received by <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  value={receivedBy}
                  onChange={(e) => setReceivedBy(e.target.value)}
                  placeholder="Name of person receiving"
                />
              </div>
              <div className="field full">
                <label>
                  Receving Challan No <span style={{ color: "red" }}>*</span>
                </label>
                <input
                  value={challanNo}
                  onChange={(e) => setChallanNo(e.target.value)}
                  placeholder="Vendor's delivery challan no."
                  required
                />
              </div>
              <div className="field full">
                <label>
                  Receive date <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  type="date"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                  onClick={(e) => e.target.showPicker && e.target.showPicker()}
                  required
                  style={{ cursor: "pointer" }}
                />
              </div>
            </div>
            {err && (
              <div className="alert err" style={{ marginTop: 12 }}>
                {err}
              </div>
            )}
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              padding: "14px 24px",
              borderTop: "1px solid var(--line)",
              background: "var(--paper-dim)",
              flexShrink: 0,
            }}
          >
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-in" disabled={saving}>
              {saving ? "Saving…" : "Confirm received"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Modal ──────────────────────────────────────────────────────────────
// Header fields are always editable. Items are only editable while the order
// is still 'issued' — once receiving has started, receivedQty/receipts are
// tied to each item's position in the array, so structural item edits (add,
// remove, reorder) would corrupt that tracking. The backend enforces this
// too (see PATCH /:id); this UI just avoids offering something that will be
// rejected.
function EditModal({ order, onSave, onClose }) {
  const itemsLocked = order.status !== "issued";
  const editJobType =
    order.jobType === "fabrication" ? "fabrication" : "powder_coating";
  const vendors = vendorsForJobType(editJobType);
  const descriptionOptions = FABRICATION_ITEM_DESCRIPTIONS;

  const [srNo, setSrNo] = useState(order.srNo || "");
  const [date, setDate] = useState((order.date || "").slice(0, 10) || todayStr());
  const [sendFromName, setSendFromName] = useState(order.sendFromName || "");
  const [sendFromAddress, setSendFromAddress] = useState(order.sendFromAddress || "");
  const [sendFromCustom, setSendFromCustom] = useState(
    () =>
      !!order.sendFromName &&
      !SEND_FROM_OPTIONS.some((v) => v.name === order.sendFromName),
  );
  const [vendorName, setVendorName] = useState(order.vendorName || "");
  const [vendorCustom, setVendorCustom] = useState(
    () => !!order.vendorName && !vendors.some((v) => v.name === order.vendorName),
  );
  const [vehicleNo, setVehicleNo] = useState(order.vehicleNo || "");
  const [issuedBy, setIssuedBy] = useState(order.issuedBy || "");
  const [deliveryAddress, setDeliveryAddress] = useState(order.deliveryAddress || "");

  const [items, setItems] = useState(() =>
    (order.items || []).map((it) => ({
      _key: Math.random().toString(36).slice(2),
      description: it.description || "",
      weightPerPc: it.weightPerPc != null ? String(it.weightPerPc) : "",
      perimeter: it.perimeter != null ? String(it.perimeter) : "",
      length: it.length != null ? String(it.length) : "",
      qty: it.qty != null ? String(it.qty) : "",
      unit: it.unit || "NOS",
      process: it.process || "",
      processSub: "",
      processOther: "",
      projectName: it.projectName || "",
      remark: it.remark || "",
    })),
  );

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setSrNo(order.srNo || "");
    setDate((order.date || "").slice(0, 10) || todayStr());
    setSendFromName(order.sendFromName || "");
    setSendFromAddress(order.sendFromAddress || "");
    setSendFromCustom(
      !!order.sendFromName &&
        !SEND_FROM_OPTIONS.some((v) => v.name === order.sendFromName),
    );
    setVendorName(order.vendorName || "");
    setVendorCustom(
      !!order.vendorName && !vendors.some((v) => v.name === order.vendorName),
    );
    setVehicleNo(order.vehicleNo || "");
    setIssuedBy(order.issuedBy || "");
    setDeliveryAddress(order.deliveryAddress || "");
  }, [order]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function updateItem(key, patch) {
    setItems((list) =>
      list.map((it) => (it._key === key ? { ...it, ...patch } : it)),
    );
  }
  function addItem() {
    setItems((list) => [...list, emptyItem()]);
  }
  function removeItem(key) {
    setItems((list) =>
      list.length > 1 ? list.filter((it) => it._key !== key) : list,
    );
  }

  async function handleSave(e) {
    e.preventDefault();
    setErr("");

    if (!srNo.trim()) return setErr("SR No is required.");
    if (!vendorName.trim()) return setErr("Vendor name is required.");
    if (!issuedBy.trim()) return setErr("Issued By is required.");

    const payload = {
      srNo: srNo.trim(),
      date,
      sendFromName: sendFromName.trim(),
      sendFromAddress: sendFromAddress.trim(),
      vendorName: vendorName.trim(),
      vehicleNo,
      issuedBy: issuedBy.trim(),
      deliveryAddress,
    };

    if (!itemsLocked) {
      const touchedItems = items.filter(
        (it) =>
          it.description.trim() ||
          it.qty ||
          it.projectName.trim() ||
          it.weightPerPc ||
          it.perimeter ||
          it.length ||
          it.process ||
          it.remark.trim(),
      );
      if (!touchedItems.length)
        return setErr("Add at least one item with description, qty, and project name.");

      const invalidItem = touchedItems.find(
        (it) => !it.description.trim() || !it.qty || !it.projectName.trim(),
      );
      if (invalidItem) {
        const missing = [];
        if (!invalidItem.description.trim()) missing.push("description");
        if (!invalidItem.qty) missing.push("qty");
        if (!invalidItem.projectName.trim()) missing.push("project name");
        return setErr(
          `"${invalidItem.description || "An item"}" is missing ${missing.join(", ")}. Fill it in or remove the row before saving.`,
        );
      }

      payload.items = touchedItems.map((it) => ({
        description: it.description,
        weightPerPc: it.weightPerPc === "" ? null : parseFloat(it.weightPerPc),
        perimeter: it.perimeter === "" ? null : parseFloat(it.perimeter),
        length: it.length === "" ? null : parseFloat(it.length),
        qty: parseFloat(it.qty) || 0,
        unit: it.unit,
        process: finalizeProcess(it),
        projectName: it.projectName,
        remark: it.remark,
      }));
    }

    setSaving(true);
    try {
      await onSave(payload);
    } catch (e) {
      console.error("[EditModal] save failed", e);
      setErr(e.message || "Something went wrong while saving.");
      setSaving(false);
    }
  }

  return (
    <div className="jo-modal-overlay jo-modal-overlay--high">
      <div
        className="jo-modal-panel jo-modal-panel--lg"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit Job Order ${order.srNo}`}
      >
        <div className="jo-modal-header">
          <div className="jo-modal-header-text">
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              Edit Job Order — #{order.srNo}
            </h2>
          </div>
          <button
            type="button"
            className="jo-modal-close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={handleSave}
          className="jo-modal-form"
          onKeyDown={(e) => {
            // Enter in a field used to submit & close the modal mid-edit.
            if (
              e.key === "Enter" &&
              e.target.tagName !== "TEXTAREA" &&
              e.target.type !== "submit"
            ) {
              e.preventDefault();
            }
          }}
        >
          <div className="jo-modal-body">
            {/* Header fields */}
            <div className="formgrid" style={{ marginBottom: 20 }}>
              <div className="field">
                <label>
                  challan No. <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input value={srNo} onChange={(e) => setSrNo(e.target.value)} />
              </div>
              <div className="field">
                <label>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Send From Name</label>
                {sendFromCustom ? (
                  <div className="jo-vendor-custom-row">
                    <input
                      value={sendFromName}
                      onChange={(e) => setSendFromName(e.target.value)}
                      placeholder="Enter sender name"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ whiteSpace: "nowrap" }}
                      onClick={() => {
                        setSendFromCustom(false);
                        setSendFromName("");
                        setSendFromAddress("");
                      }}
                    >
                      ← Back
                    </button>
                  </div>
                ) : (
                  <select
                    value={sendFromName}
                    onChange={(e) => {
                      if (e.target.value === OTHER_SEND_FROM) {
                        setSendFromCustom(true);
                        setSendFromName("");
                        setSendFromAddress("");
                      } else {
                        setSendFromName(e.target.value);
                        const found = SEND_FROM_OPTIONS.find(
                          (v) => v.name === e.target.value,
                        );
                        if (found) setSendFromAddress(found.address);
                        else setSendFromAddress("");
                      }
                    }}
                  >
                    <option value="">— Select sender —</option>
                    {SEND_FROM_OPTIONS.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                    <option value={OTHER_SEND_FROM}>✎ Add own…</option>
                  </select>
                )}
              </div>
              <div className="field">
                <label>Send From Address</label>
                <input
                  value={sendFromAddress}
                  onChange={(e) => setSendFromAddress(e.target.value)}
                  placeholder="Auto-filled from selection, or enter manually"
                />
              </div>
              <div className="field">
                <label>
                  Send To Name <span style={{ color: "var(--red)" }}>*</span>
                </label>
                {vendorCustom ? (
                  <div className="jo-vendor-custom-row">
                    <input
                      value={vendorName}
                      onChange={(e) => setVendorName(e.target.value)}
                      placeholder="Enter vendor name"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ whiteSpace: "nowrap" }}
                      onClick={() => setVendorCustom(false)}
                    >
                      ← Back
                    </button>
                  </div>
                ) : (
                  <select
                    value={vendorName}
                    onChange={(e) => {
                      if (e.target.value === "__custom__") {
                        setVendorCustom(true);
                        setVendorName("");
                      } else {
                        setVendorName(e.target.value);
                        const found = vendors.find((v) => v.name === e.target.value);
                        if (found) setDeliveryAddress(found.address);
                      }
                    }}
                  >
                    <option value="">— Select vendor —</option>
                    {vendors.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                    <option value="__custom__">✎ Add own vendor…</option>
                  </select>
                )}
              </div>
              <div className="field">
                <label>Send To Address</label>
                <input
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Vehicle No</label>
                <input
                  value={vehicleNo}
                  onChange={(e) => setVehicleNo(e.target.value)}
                />
              </div>
              <div className="field">
                <label>
                  Issued By <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  value={issuedBy}
                  onChange={(e) => setIssuedBy(e.target.value)}
                />
              </div>
            </div>

            {/* Items */}
            <div
              style={{
                marginBottom: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h4
                style={{
                  margin: 0,
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "1px",
                  color: "#8a8270",
                }}
              >
                Items
              </h4>
              {itemsLocked && (
                <span style={{ fontSize: 11, color: "var(--rust-dark)" }}>
                  🔒 Locked — receiving has started on this order, so items
                  can't be changed here.
                </span>
              )}
            </div>

            {itemsLocked ? (
              <div className="tablewrap" style={{ marginBottom: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Sr No</th>
                      <th>Item Description</th>
                      <th className="num">Qty</th>
                      <th>UOM</th>
                      <th>Process / RAL Code / Finish</th>
                      <th>Project Name</th>
                      <th>Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(order.items || []).map((it, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{it.description}</td>
                        <td className="num">{it.qty}</td>
                        <td>{it.unit}</td>
                        <td>{it.process || "—"}</td>
                        <td>{it.projectName || "—"}</td>
                        <td>{it.remark || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                {/* Column-header row — desktop only. On mobile the grid
                    collapses to a single stacked column (see .jo-item-row
                    media queries), so this shared header no longer lines up
                    with anything and is hidden via .jo-item-header there;
                    each field gets its own <label> inside ItemRow instead. */}
                <div className="jo-item-header">
                  <span>Item Description</span>
                  <span>Weight/Pcs (Kg)</span>
                  <span>Perimeter (mm)</span>
                  <span>Length (mm)</span>
                  <span>Area/nos (Sq in)</span>
                  <span>Qty</span>
                  <span>UOM</span>
                  <span>Process / RAL Code / Finish</span>
                  <span>
                    Project Name <span style={{ color: "var(--red)" }}>*</span>
                  </span>
                  <span>Remark</span>
                  <span></span>
                </div>

                {items.map((it, idx) => (
                  <ItemRow
                    key={it._key}
                    it={it}
                    idx={idx}
                    updateItem={updateItem}
                    removeItem={removeItem}
                    disableRemove={items.length === 1}
                    descriptionOptions={descriptionOptions}
                  />
                ))}

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={addItem}
                  style={{ marginBottom: 4 }}
                >
                  + Add item
                </button>
              </>
            )}

            {err && (
              <div className="alert err" style={{ marginTop: 16 }}>
                {err}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              padding: "14px 24px",
              borderTop: "1px solid var(--line)",
              background: "var(--paper-dim)",
              flexShrink: 0,
            }}
          >
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

const JOB_TYPE_META = {
  powder_coating: {
    key: "powder_coating",
    label: "Powder Coating",
    listTitle: "All Powder Coating",
    newButton: "+ New Powder Coating",
    formTitle: "New Powder Coating / Delivery Challan",
    createButton: "Create Powder Coating",
    emptyNoun: "powder coating",
  },
  fabrication: {
    key: "fabrication",
    label: "Fabrication",
    listTitle: "All Fabrication",
    newButton: "+ New Fabrication",
    formTitle: "New Fabrication / Delivery Challan",
    createButton: "Create Fabrication",
    emptyNoun: "fabrication",
  },
};

// ── Main component ─────────────────────────────────────────────────────────────
export default function JobOrder({ jobType = "powder_coating" }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const focusHandledRef = useRef("");
  const meta = JOB_TYPE_META[jobType] || JOB_TYPE_META.powder_coating;
  const resolvedJobType = meta.key;
  const vendors = vendorsForJobType(resolvedJobType);

  const canCreate = CREATE_ROLES.includes(user?.role);
  const isAdmin = user?.role === "admin";
  const [orders, setOrders] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [viewOrder, setViewOrder] = useState(null);
  const [openOrderId, setOpenOrderId] = useState(null);
  const [actionsMenuId, setActionsMenuId] = useState(null);
  const [receiveOrder, setReceiveOrder] = useState(null);
  const [editOrder, setEditOrder] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ text: "", ok: true });
  const [colFilters, setColFilters] = useState(EMPTY_COL_FILTERS);

  // Form state
  const [srNo, setSrNo] = useState("");
  const [date, setDate] = useState(todayStr());
  const [sendFromName, setSendFromName] = useState("");
  const [sendFromAddress, setSendFromAddress] = useState("");
  const [sendFromCustom, setSendFromCustom] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [vendorCustom, setVendorCustom] = useState(false);
  const [vehicleNo, setVehicleNo] = useState("");
  const [issuedBy, setIssuedBy] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");

  const [items, setItems] = useState([emptyItem()]);

  function resetFields() {
    setSrNo("");
    setDate(todayStr());
    setSendFromName("");
    setSendFromAddress("");
    setSendFromCustom(false);
    setVendorName("");
    setVendorCustom(false);
    setVehicleNo("");
    setIssuedBy("");
    setDeliveryAddress("");
    setItems([emptyItem()]);
  }

  function resetForm() {
    resetFields();
    setShowForm(false);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`/job-orders?jobType=${encodeURIComponent(resolvedJobType)}`);
      setOrders(unwrapList(data));
    } catch (err) {
      console.error("[JobOrder] failed to load job orders", err);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [resolvedJobType]);
  useEffect(() => {
    resetForm();
    setViewOrder(null);
    setOpenOrderId(null);
    setActionsMenuId(null);
    setReceiveOrder(null);
    setEditOrder(null);
    setColFilters(EMPTY_COL_FILTERS);
    setMsg({ text: "", ok: true });
    load();
  }, [load]);

  useEffect(() => {
    if (!actionsMenuId) return undefined;
    const onDoc = (e) => {
      if (!e.target.closest?.(".jo-more-wrap")) setActionsMenuId(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setActionsMenuId(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [actionsMenuId]);

  // Open challan when arriving from Job Order Dashboard.
  useEffect(() => {
    const focusChallan = location.state?.focusChallan;
    if (!focusChallan || loading) return;
    if (focusHandledRef.current === String(focusChallan)) return;
    const match = orders.find((o) => String(o.srNo) === String(focusChallan));
    if (!match) return;
    focusHandledRef.current = String(focusChallan);
    setViewOrder(match);
    setOpenOrderId(match._id);
    navigate(location.pathname, { replace: true, state: {} });
  }, [loading, location.pathname, location.state, navigate, orders]);

  // Sends the currently-selected order's challan to the browser's print dialog
  // (from which the user can choose "Save as PDF") whenever printOrder is set.
  useEffect(() => {
    if (!printOrder) return;

    setPrintPageSize("portrait"); // this flow always prints the Delivery Challan
    let cleanupPrint = () => {};

    const t = setTimeout(() => {
      cleanupPrint = prepareDeliveryChallanPrint("job-order-print");
      // Re-measure after layout — stamp/logo may still be loading.
      requestAnimationFrame(() => {
        cleanupPrint = prepareDeliveryChallanPrint("job-order-print");
        window.print();
      });
    }, 200);

    const handleAfterPrint = () => {
      cleanupPrint();
      setPrintOrder(null);
    };

    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      clearTimeout(t);
      cleanupPrint();
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [printOrder]);

  function updateItem(key, patch) {
    setItems((list) =>
      list.map((it) => (it._key === key ? { ...it, ...patch } : it)),
    );
  }
  function addItem() {
    setItems((list) => [...list, emptyItem()]);
  }
  function removeItem(key) {
    setItems((list) =>
      list.length > 1 ? list.filter((it) => it._key !== key) : list,
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg({ text: "", ok: true });
    if (!canCreate) {
      setMsg({
        text: "You don't have permission to create job orders.",
        ok: false,
      });
      return;
    }
    if (!srNo.trim()) {
      setMsg({ text: "SR No is required.", ok: false });
      return;
    }
    if (!vendorName.trim()) {
      setMsg({ text: "Vendor name is required.", ok: false });
      return;
    }
    if (!issuedBy.trim()) {
      setMsg({ text: "Issued By is required.", ok: false });
      return;
    }

    // Any row the user actually started filling in — used to detect rows
    // that were partially filled and would otherwise be silently dropped.
    const touchedItems = items.filter(
      (it) =>
        it.description.trim() ||
        it.qty ||
        it.projectName.trim() ||
        it.weightPerPc ||
        it.perimeter ||
        it.length ||
        it.process ||
        it.remark.trim(),
    );
    if (!touchedItems.length) {
      setMsg({
        text: "Add at least one item with description, qty, and project name.",
        ok: false,
      });
      return;
    }

    // Every touched row MUST have description + qty + project name — instead
    // of silently filtering incomplete rows out (which used to make items
    // disappear without any warning), we now block submit and say exactly
    // which row and field is missing.
    const invalidItem = touchedItems.find(
      (it) => !it.description.trim() || !it.qty || !it.projectName.trim(),
    );
    if (invalidItem) {
      const missing = [];
      if (!invalidItem.description.trim()) missing.push("description");
      if (!invalidItem.qty) missing.push("qty");
      if (!invalidItem.projectName.trim()) missing.push("project name");
      setMsg({
        text: `"${invalidItem.description || "An item"}" is missing ${missing.join(", ")}. Fill it in or remove the row before saving.`,
        ok: false,
      });
      return;
    }

    const validItems = touchedItems;

    setSaving(true);
    try {
      await apiPost("/job-orders", {
        srNo: srNo.trim(),
        date,
        jobType: resolvedJobType,
        sendFromName: sendFromName.trim(),
        sendFromAddress: sendFromAddress.trim(),
        vendorName: vendorName.trim(),
        vehicleNo,
        issuedBy,
        deliveryAddress,
        items: validItems.map((it) => ({
          description: it.description,
          // Blank stays blank ("" -> null) instead of being coerced to 0, so
          // the backend/UI can tell "not entered" apart from "entered as 0".
          weightPerPc: it.weightPerPc === "" ? null : parseFloat(it.weightPerPc),
          perimeter: it.perimeter === "" ? null : parseFloat(it.perimeter),
          length: it.length === "" ? null : parseFloat(it.length),
          qty: parseFloat(it.qty) || 0,
          unit: it.unit,
          process: finalizeProcess(it),
          projectName: it.projectName,
          remark: it.remark,
        })),
        status: "issued",
        history: [
          {
            action: "issued",
            by: user?.name || user?.username,
            at: new Date().toISOString(),
            note: `Issued to ${vendorName}`,
          },
        ],
      });
      setMsg({ text: `✓ ${meta.label} ${srNo} created successfully.`, ok: true });
      resetFields();
      load();
      setTimeout(() => {
        setMsg({ text: "", ok: true });
      }, 2500);
    } catch (err) {
      console.error("[JobOrder] create failed", err);
      setMsg({ text: "Error: " + err.message, ok: false });
    } finally {
      setSaving(false);
    }
  }

  // Forwards per-item {receiving, location} straight to the backend, which
  // computes status, appends receipts, and writes its own history entry.
  // Supports PARTIAL receiving — items not fully received stay "pending" and
  // the order's status becomes 'partial', so the list shows "Continue receiving".
  async function handleReceive({
    items,
    receivedBy,
    challanNo,
    receivedDate,
    note,
  }) {
    const order = receiveOrder;
    if (!order?._id) {
      console.error(
        "[JobOrder] handleReceive called with no order / no _id",
        order,
      );
      throw new Error(
        "No order selected — please close and reopen the receive dialog.",
      );
    }
    await apiPatch(`/job-orders/${order._id}/receive`, {
      items,
      receivedBy,
      challanNo,
      receivedDate,
      note,
    });
    setReceiveOrder(null);
    load();
  }

  // Sends only the changed header fields (and items, if items were
  // editable) to the backend, then refreshes the list. The backend re-runs
  // full validation and re-derives area server-side same as create.
  async function handleEditSave(payload) {
    const order = editOrder;
    if (!order?._id) {
      throw new Error("No order selected — please close and reopen the edit dialog.");
    }
    const updated = await apiPatch(`/job-orders/${order._id}`, payload);
    const updatedId = String(updated._id);
    setOrders((prev) =>
      prev.map((o) =>
        String(o._id) === updatedId ? { ...o, ...updated } : o,
      ),
    );
    if (viewOrder && String(viewOrder._id) === updatedId) {
      setViewOrder({ ...viewOrder, ...updated });
    }
    setEditOrder(null);
    await load();
  }

  async function handlePrintPdf(order) {
    try {
      const full = await apiGet(`/job-orders/${order._id}`);
      setPrintOrder(full);
    } catch (err) {
      console.error("[JobOrder] failed to load order for print", err);
      setPrintOrder(order);
    }
  }

  async function handleDelete(order) {
  if (
    !window.confirm(
      `Delete job order #${order.srNo}? This cannot be undone.`,
    )
  )
    return;
  try {
    await apiDelete(`/job-orders/${order._id}`);
    load();
  } catch (err) {
    console.error("[JobOrder] delete failed", err);
    alert("Failed to delete: " + err.message);
  }
}

  const STATUS_COLORS = {
    issued: { bg: "#e6f2f0", color: "var(--teal-dark)" },
    received: { bg: "#eef2ff", color: "#3730a3" },
    partial: { bg: "#fef3c7", color: "#92400e" },
  };

  const visible = useMemo(
    () =>
      orders.filter((o) => {
        const dispatchedQty = orderDispatchedQty(o);
        const receivedQty = orderReceivedQty(o);

        if (colFilters.challanNo.length && !colFilters.challanNo.includes(o.srNo))
          return false;
        if (
          colFilters.date.length &&
          !colFilters.date.includes(formatDate(o.date))
        )
          return false;
        if (
          colFilters.sendFrom.length &&
          !colFilters.sendFrom.includes(o.sendFromName)
        )
          return false;
        if (colFilters.sendTo.length && !colFilters.sendTo.includes(o.vendorName))
          return false;
        if (
          colFilters.vehicleNo.length &&
          !colFilters.vehicleNo.includes(o.vehicleNo)
        )
          return false;
        if (
          colFilters.issuedBy.length &&
          !colFilters.issuedBy.includes(o.issuedBy)
        )
          return false;
        if (
          colFilters.dispatchedQty.length &&
          !colFilters.dispatchedQty.includes(String(dispatchedQty))
        )
          return false;
        if (
          colFilters.receivedQty.length &&
          !colFilters.receivedQty.includes(String(receivedQty))
        )
          return false;
        if (
          colFilters.vendorExpected?.length &&
          !colFilters.vendorExpected.includes(vendorExpectedLabel(o))
        )
          return false;
        if (
          colFilters.status.length &&
          !colFilters.status.includes(statusLabel(o))
        )
          return false;
        return true;
      }),
    [orders, colFilters],
  );
  const { pageItems, page, pageSize, total, setPage, setPageSize } =
    useClientPagination(visible, 25);

  const hasActiveFilters = Object.values(colFilters).some((v) => v.length > 0);

  function clearJoFilters() {
    setColFilters(EMPTY_COL_FILTERS);
  }

  function OrderActionButtons({ order, hasPending }) {
    const open = actionsMenuId === order._id;
    const menuItems = [];
    if (canCreate) {
      menuItems.push({
        key: "edit",
        label: "Edit",
        onClick: () => setEditOrder(order),
      });
    }
    if (hasPending && canCreate) {
      menuItems.push({
        key: "receive",
        label: order.status === "partial" ? "Receive" : "Received",
        primary: true,
        onClick: () => setReceiveOrder(order),
      });
    }
    menuItems.push({
      key: "pdf",
      label: "PDF",
      onClick: () => handlePrintPdf(order),
    });
    if (isAdmin) {
      menuItems.push({
        key: "delete",
        label: "Delete",
        danger: true,
        onClick: () => handleDelete(order),
      });
    }

    return (
      <div className="jo-order-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setViewOrder(order)}
          title="View details"
        >
          View
        </button>
        {menuItems.length > 0 && (
          <div className="jo-more-wrap">
            <button
              type="button"
              className={`btn btn-ghost btn-sm jo-more-btn${open ? " is-open" : ""}`}
              title="More actions"
              aria-label="More actions"
              aria-expanded={open}
              onClick={() =>
                setActionsMenuId((id) => (id === order._id ? null : order._id))
              }
            >
              ⋮
            </button>
            {open && (
              <div className="jo-more-menu" role="menu">
                {menuItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    className={`jo-more-item${item.primary ? " is-primary" : ""}${item.danger ? " is-danger" : ""}`}
                    onClick={() => {
                      setActionsMenuId(null);
                      item.onClick();
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="jo-page">
      <style>{`
       @media print {
  .no-print { display: none !important; }
  .jo-print-mount {
    position: static !important;
    top: auto !important;
    left: auto !important;
    z-index: auto !important;
  }
}

        /* ── Item row grid (create form + EditModal, via <ItemRow>) ───────── */
        .jo-item-row {
          display: grid;
          grid-template-columns: 1.5fr 0.75fr 0.75fr 0.75fr 0.85fr 0.55fr 0.65fr 1.3fr 1fr 1fr auto;
          gap: 8px;
          align-items: start;
          padding: 10px;
          border: 1px solid var(--line);
          border-radius: 8px;
          margin-bottom: 8px;
        }
        /* Shared column-header — wide desktop only. Tablets/phones use the
           per-field <label>s on each ItemRow instead. */
        .jo-item-header {
          display: grid;
          grid-template-columns: 1.5fr 0.75fr 0.75fr 0.75fr 0.85fr 0.55fr 0.65fr 1.3fr 1fr 1fr 32px;
          gap: 8px;
          padding: 4px 10px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #8a8270;
        }

        .jo-item-row .field label {
          font-size: 11px;
          margin-bottom: 3px;
          display: none; /* laptop/desktop: .jo-item-header already names columns */
          color: var(--text-3);
          font-weight: 600;
          line-height: 1.2;
        }
        .jo-item-row .field { display: flex; flex-direction: column; min-width: 0; }
        .jo-item-row .field input,
        .jo-item-row .field select {
          padding: 6px 8px; font-size: 13px; height: 32px; width: 100%; box-sizing: border-box;
          border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--ink);
          font-family: inherit;
        }
        .jo-item-row .field input:disabled {
          background: var(--paper-dim); color: var(--text-3); cursor: not-allowed;
        }
        .jo-item-row .field select {
          appearance: none; -webkit-appearance: none; -moz-appearance: none;
          background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a8270' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
          background-repeat: no-repeat; background-position: right 8px center; background-size: 14px;
          padding-right: 26px; cursor: pointer;
        }
        .jo-item-row .field input:focus,
        .jo-item-row .field select:focus {
          outline: none; border-color: var(--teal); box-shadow: 0 0 0 3px rgba(0,128,128,0.12);
        }
        .jo-item-row .field input:disabled,
        .jo-item-row .field select:disabled { background: var(--paper-dim); cursor: not-allowed; }
        .jo-item-row .field-other-input { margin-top: 6px; }

        .jo-desc-combo { position: relative; width: 100%; }
        .jo-desc-combo input { width: 100%; }
        .jo-desc-menu {
          position: absolute;
          z-index: 40;
          left: 0;
          right: 0;
          top: calc(100% + 4px);
          max-height: 220px;
          overflow-y: auto;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(28, 26, 22, 0.12);
          padding: 4px;
        }
        .jo-desc-option {
          display: block;
          width: 100%;
          text-align: left;
          border: none;
          background: transparent;
          padding: 7px 10px;
          font-size: 13px;
          font-family: inherit;
          color: var(--ink);
          border-radius: 6px;
          cursor: pointer;
        }
        .jo-desc-option:hover,
        .jo-desc-option.is-active { background: var(--paper-dim); }
        .jo-desc-other {
          border-top: 1px solid var(--line);
          margin-top: 4px;
          padding-top: 10px;
          font-weight: 600;
          color: var(--teal-dark, #0f5c5c);
        }
        .jo-desc-empty {
          padding: 8px 10px;
          font-size: 12px;
          color: var(--text-3);
        }

        .jo-item-remove {
          height: 32px; width: 32px; border-radius: 6px; border: 1px solid var(--line);
          background: transparent; cursor: pointer; color: var(--red); font-size: 14px;
          flex-shrink: 0; align-self: end;
          margin-bottom: 0;
        }
        .jo-item-remove:disabled { opacity: 0.4; cursor: not-allowed; }

        /* Tablet / small laptop: 2-col grid — hide header, show per-field labels */
        @media (max-width: 1279px) {
          .jo-item-row {
            grid-template-columns: 1fr 1fr;
          }
          .jo-item-header { display: none !important; }
          .jo-item-row .field label { display: block !important; }
          .jo-item-remove {
            grid-column: 1 / -1;
            width: 100%;
            height: 36px;
            align-self: stretch;
          }
        }

        /* Phone: one field per row */
        @media (max-width: 640px) {
          .jo-item-row { grid-template-columns: 1fr; }
          .jo-item-row .field label { display: block !important; }
          .jo-item-remove { width: 100%; height: 36px; }
        }

        /* ── Process / RAL Code / Finish hover-flyout picker ───────────────
           Replaces the old native select for this field. Hovering
           "Powder Coating" or "Anodizing" in the open menu instantly reveals
           their RAL/finish sub-options in a flyout — no click needed to see
           them. Touch devices (no hover) fall back to tap-to-open, handled
           by the media (hover: none) rule below. */
        .jo-process-picker { position: relative; }
        .jo-process-trigger {
          display: flex; align-items: center; justify-content: space-between;
          width: 100%; box-sizing: border-box; text-align: left;
          padding: 6px 8px; font-size: 13px; height: 32px;
          border: 1px solid var(--line); border-radius: 6px; background: #fff;
          color: var(--ink); font-family: inherit; cursor: pointer;
        }
        .jo-process-trigger:focus {
          outline: none; border-color: var(--teal); box-shadow: 0 0 0 3px rgba(0,128,128,0.12);
        }
        .jo-process-trigger-label {
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .jo-process-caret { color: #8a8270; font-size: 11px; margin-left: 6px; flex-shrink: 0; }

       .jo-process-menu {
  position: absolute; top: calc(100% + 2px); left: 0; z-index: 50;
  min-width: 220px;
  background: #fff; border: 1px solid var(--line); border-radius: 6px;
  box-shadow: var(--shadow-lg); list-style: none; margin: 0; padding: 4px 0;
}
.jo-process-menu--portal {
  position: fixed;
  z-index: 12000;
  min-width: 240px;
  max-height: min(280px, calc(100vh - 24px));
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.jo-process-menu-item {
  position: relative; padding: 6px 12px; font-size: 13px; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between;
}
.jo-process-menu-item:hover,
.jo-process-menu-item.has-sub.is-open { background: var(--paper-dim); }
.jo-process-menu-label { display: flex; align-items: center; gap: 6px; width: 100%; justify-content: space-between; }
.jo-process-menu-arrow { font-size: 10px; color: #8a8270; }

.jo-process-submenu--portal {
  position: fixed;
  z-index: 12001;
  min-width: 220px;
  overflow-x: hidden;
  overflow-y: auto;
  background: #fff; border: 1px solid var(--line); border-radius: 6px;
  box-shadow: var(--shadow-lg); list-style: none; margin: 0; padding: 4px 0;
}
.jo-process-submenu--portal li { padding: 6px 12px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.jo-process-submenu--portal li:hover { background: var(--paper-dim); }

        /* ── Receive-modal per-item row ── */
        .jo-receive-row {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(220px, 0.9fr);
          gap: 12px 16px;
          align-items: start;
          padding: 12px;
          border: 1px solid var(--line);
          border-radius: 8px;
          overflow: visible;
        }
        .jo-receive-main { min-width: 0; }
        .jo-receive-title { font-weight: 600; font-size: 13px; }
        .jo-receive-sub { font-size: 11px; color: #8a8270; margin-top: 2px; }
        .jo-receive-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 14px;
          margin-top: 8px;
          font-size: 12px;
          color: #8a8270;
        }
        .jo-receive-stats strong { color: var(--ink); }
        .jo-receive-stats strong.is-open { color: var(--rust-dark); }
        .jo-receive-stats strong.is-done { color: var(--teal-dark); }
        .jo-receive-note {
          margin-top: 8px;
          font-size: 12px;
          color: #9a3412;
          line-height: 1.35;
        }
        .jo-receive-controls {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          min-width: 0;
          position: relative;
          z-index: 1;
        }
        .jo-receive-controls .field label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-3);
          margin-bottom: 3px;
        }
        .jo-receive-controls input,
        .jo-receive-controls select {
          width: 100%;
          box-sizing: border-box;
          min-height: 34px;
          pointer-events: auto;
        }
        .jo-receive-controls select:disabled,
        .jo-receive-controls input:disabled {
          background: var(--paper-dim);
          color: var(--text-3);
          cursor: not-allowed;
        }
        .jo-receive-site { grid-column: 1 / -1; }
        .jo-mobile-only-label { display: none; font-size: 11px; font-weight: 600; color: var(--text-3); margin-bottom: 3px; }

        .jo-materials { padding: 0; width: 100%; box-sizing: border-box; }
        .jo-materials-parties {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 16px;
          margin: 0 0 10px;
        }
        .jo-materials-kicker {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #8a8270;
          margin-bottom: 2px;
        }
        .jo-materials-name { font-weight: 700; font-size: 12.5px; margin-bottom: 2px; line-height: 1.25; }
        .jo-materials-text {
          font-size: 12px;
          line-height: 1.35;
          white-space: pre-line;
          color: var(--text-2);
          word-break: break-word;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .jo-materials-scroll {
          width: 100%;
          overflow: visible;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: #fff;
        }
        .jo-materials-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .jo-materials-table th,
        .jo-materials-table td {
          vertical-align: middle;
          text-align: left;
          padding: 8px 8px;
          border-bottom: 1px solid var(--line);
          font-size: 12px;
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .jo-materials-table th {
          font-size: 9.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #8a8270;
          background: #fff;
          line-height: 1.2;
          white-space: nowrap;
        }
        .jo-materials-table td.num,
        .jo-materials-table th.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          overflow: visible;
          text-overflow: clip;
        }
        .jo-materials-table col.jo-m-sr { width: 40px; }
        .jo-materials-table col.jo-m-desc { width: 18%; }
        .jo-materials-table col.jo-m-qty { width: 88px; }
        .jo-materials-table col.jo-m-process { width: 18%; }
        .jo-materials-table col.jo-m-project { width: 14%; }
        .jo-materials-table col.jo-m-num { width: 64px; }
        .jo-materials-table .jo-materials-desc,
        .jo-materials-table td:nth-child(4),
        .jo-materials-table td:nth-child(5) {
          white-space: normal;
          word-break: break-word;
        }
        .jo-materials-desc { font-weight: 500; }
        .jo-materials-mobile { display: none; flex-direction: column; gap: 8px; }
        .jo-materials-card {
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 10px 12px;
          background: var(--paper-dim);
        }
        .jo-materials-card h4 { margin: 0 0 8px; font-size: 13px; font-weight: 700; }
        .jo-materials-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px 10px;
          font-size: 12px;
        }
        .jo-materials-grid span { display: block; font-size: 10px; color: var(--text-3); margin-bottom: 1px; }
        .jo-materials-grid strong { font-weight: 600; color: var(--ink); word-break: break-word; }
        .jo-materials-span { grid-column: 1 / -1; }

        @media (max-width: 900px) {
          .jo-receive-row { grid-template-columns: 1fr; }
          .jo-receive-controls { grid-template-columns: 1fr; }
          .jo-materials-parties { grid-template-columns: 1fr; }
          .jo-materials-desktop { display: none !important; }
          .jo-materials-mobile { display: flex; }
        }

        @media (max-width: 480px) {
          .jo-materials-grid { grid-template-columns: 1fr; }
        }

        /* ── Page layout ─────────────────────────────────────────────────── */
        .jo-page {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          overflow-x: clip;
          box-sizing: border-box;
        }
        .jo-form-card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
        }
        .jo-list-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 10px;
        }
        .jo-status-filters {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .jo-th-filter {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .jo-vendor-custom-row {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .jo-vendor-custom-row input { flex: 1; min-width: 0; }

        /* ── Orders table ────────────────────────────────────────────────── */
        .jo-orders-wrap {
          width: 100% !important;
          max-width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          box-sizing: border-box;
        }
        .jo-orders-table {
          width: 100% !important;
          min-width: 100% !important;
          table-layout: fixed;
          border-collapse: collapse;
        }
        .jo-orders-table th {
          padding: 8px 6px;
          font-size: 9.5px;
          line-height: 1.25;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .jo-orders-table td {
          padding: 8px 6px;
          font-size: 12px;
          line-height: 1.35;
          vertical-align: middle;
          overflow: hidden;
        }
        .jo-orders-table .jo-th-filter {
          max-width: 100%;
        }
        /* Fixed cols stay compact; From / To / QC grow to fill the card */
        .jo-orders-table col.jo-col-challan { width: 78px; }
        .jo-orders-table col.jo-col-date { width: 86px; }
        .jo-orders-table col.jo-col-from { width: 22%; }
        .jo-orders-table col.jo-col-to { width: 20%; }
        .jo-orders-table col.jo-col-vehicle { width: 80px; }
        .jo-orders-table col.jo-col-issued { width: 80px; }
        .jo-orders-table col.jo-col-qty { width: 52px; }
        .jo-orders-table col.jo-col-expected { width: 86px; }
        .jo-orders-table col.jo-col-qc { width: 16%; }
        .jo-orders-table col.jo-col-status { width: 118px; }
        .jo-orders-table col.jo-col-act { width: 96px; }
        .jo-orders-table td.jo-td-date,
        .jo-orders-table td.jo-td-qty,
        .jo-orders-table td.jo-td-expected {
          white-space: nowrap;
          overflow-wrap: normal;
          word-break: normal;
        }
        .jo-orders-table td.jo-td-qc {
          overflow: hidden;
        }
        .jo-orders-table td.jo-td-qc .jo-qc-text {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 11px;
          color: var(--text-2);
        }
        .jo-orders-table td.jo-td-clip {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .jo-orders-table td.jo-col-status {
          white-space: nowrap;
        }
        .jo-orders-table th.jo-col-act,
        .jo-orders-table td.jo-col-act {
          width: 96px;
          min-width: 96px;
          overflow: visible;
        }
        .jo-orders-table tbody tr.is-open td {
          background: var(--paper-dim);
        }
        .jo-status-pill {
          display: inline-block;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 12px;
          white-space: nowrap;
          text-transform: capitalize;
          vertical-align: middle;
        }
        .jo-order-actions {
          display: flex;
          gap: 4px;
          flex-wrap: nowrap;
          align-items: center;
          justify-content: flex-end;
        }
        .jo-order-actions .btn {
          height: 28px;
          padding: 0 8px;
          font-size: 11px;
          white-space: nowrap;
          flex-shrink: 0;
          box-sizing: border-box;
        }
        .jo-more-wrap {
          position: relative;
        }
        .jo-more-btn {
          width: 28px;
          padding: 0 !important;
          justify-content: center;
          font-size: 18px !important;
          line-height: 1;
          font-weight: 700;
        }
        .jo-more-btn.is-open {
          background: var(--paper-dim);
          border-color: var(--line);
        }
        .jo-more-menu {
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          z-index: 40;
          min-width: 132px;
          padding: 4px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: #fff;
          box-shadow: 0 8px 22px rgba(28, 26, 22, 0.14);
        }
        .jo-more-item {
          display: block;
          width: 100%;
          text-align: left;
          border: none;
          background: transparent;
          font: inherit;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--ink);
          padding: 8px 10px;
          border-radius: 6px;
          cursor: pointer;
        }
        .jo-more-item:hover { background: var(--paper-dim); }
        .jo-more-item.is-primary { color: var(--teal-dark); }
        .jo-more-item.is-danger { color: var(--red, #b42318); }
        .jo-orders-table td.jo-detail-cell {
          position: relative;
          z-index: 1;
          background: var(--paper-dim) !important;
          padding: 12px !important;
          overflow: visible !important;
        }
        .jo-orders-table td.jo-detail-cell[colspan] {
          width: 100%;
        }
        .jo-orders-mobile { display: none; flex-direction: column; gap: 10px; }
        .jo-order-card {
          border: 1px solid var(--line);
          border-radius: 10px;
          background: #fff;
          overflow: hidden;
        }
        .jo-order-card-head {
          width: 100%;
          text-align: left;
          background: #fff;
          border: none;
          padding: 12px 14px;
          cursor: pointer;
          font-family: inherit;
          color: inherit;
        }
        .jo-order-card-head.is-open { background: var(--paper-dim); }
        .jo-order-card-title {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
          margin-bottom: 6px;
        }
        .jo-order-card-title strong { font-size: 15px; font-weight: 700; }
        .jo-order-card-meta {
          font-size: 12px;
          color: var(--text-2);
          line-height: 1.4;
        }
        .jo-order-card-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 0 12px 12px;
        }
        .jo-order-card-actions .btn {
          height: 32px;
          padding: 0 10px;
          font-size: 12px;
          flex: 1 1 auto;
          justify-content: center;
          box-sizing: border-box;
        }
        .jo-order-card-detail {
          padding: 0 12px 12px;
          border-top: 1px solid var(--line);
          background: #fff;
        }

        /* ── Modals ─────────────────────────────────────────────────────── */
        .jo-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(28, 26, 22, 0.6);
          backdrop-filter: blur(4px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          overflow-x: hidden;
          overflow-y: auto;
        }
        .jo-modal-overlay--high { z-index: 1100; }
        .jo-modal-panel {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          width: 100%;
          max-height: 95vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .jo-modal-panel--lg { max-width: 980px; }
        /* View details: full available width; tables scroll inside if needed */
        .jo-modal-panel--view {
          width: 100%;
          max-width: 1280px;
          min-width: 0;
        }
        .jo-modal-panel--view .jo-modal-header,
        .jo-modal-panel--view .jo-modal-body {
          width: 100%;
          box-sizing: border-box;
        }
        .jo-modal-panel--view .jo-meta-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          width: 100%;
        }
        .jo-modal-panel--view .jo-meta-grid > div {
          min-width: 0;
          word-break: break-word;
        }
        .jo-view-items-wrap,
        .jo-view-qc-wrap {
          width: 100%;
          max-width: 100%;
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch;
        }
        .jo-view-items-wrap table,
        .jo-view-qc-wrap table {
          width: 100%;
          min-width: 980px;
          table-layout: fixed;
        }
        .jo-view-items-wrap th,
        .jo-view-items-wrap td,
        .jo-view-qc-wrap th,
        .jo-view-qc-wrap td {
          padding: 8px 8px;
          vertical-align: middle;
        }
        .jo-view-items-wrap th,
        .jo-view-qc-wrap th {
          white-space: normal;
          line-height: 1.2;
        }
        .jo-view-items-wrap td.num,
        .jo-view-qc-wrap td.num {
          white-space: nowrap;
        }
        .jo-view-items-wrap td:nth-child(2),
        .jo-view-items-wrap td:nth-child(8),
        .jo-view-items-wrap td:nth-child(12),
        .jo-view-items-wrap td:nth-child(13),
        .jo-view-items-wrap td:nth-child(14) {
          white-space: normal;
          word-break: break-word;
        }
        .jo-modal-panel--md { max-width: 720px; }
        .jo-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 24px;
          border-bottom: 1px solid var(--line);
          flex-shrink: 0;
        }
        .jo-modal-header-text {
          min-width: 0;
          flex: 1;
        }
        .jo-modal-header-text h2,
        .jo-modal-header-text p {
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        .jo-modal-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .jo-modal-close {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 20px;
          color: #8a8270;
          padding: 4px 8px;
          line-height: 1;
          flex-shrink: 0;
        }
        .jo-modal-form {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          flex: 1;
          min-height: 0;
        }
        .jo-modal-body {
          padding: 20px 24px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }
        .jo-meta-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }
        .jo-items-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        .jo-receive-hint {
          margin-bottom: 12px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #8a8270;
          line-height: 1.4;
        }

        /* Hide lower-priority columns so Status + Actions stay on screen */
        @media (max-width: 1400px) {
          .jo-col-secondary { display: none !important; }
          .jo-orders-table col.jo-col-from { width: 28%; }
          .jo-orders-table col.jo-col-to { width: 24%; }
          .jo-orders-table col.jo-col-qc { width: 20%; }
        }

        @media (max-width: 1100px) {
          .jo-col-tablet-hide { display: none !important; }
          .jo-orders-table col.jo-col-to { width: 40%; }
          .jo-orders-table col.jo-col-status { width: 130px; }
          .jo-materials-table col.jo-m-num { width: 56px; }
          .jo-materials-table col.jo-m-qty { width: 72px; }
        }

        @media (max-width: 900px) {
          .jo-status-filters { width: 100%; }
          .jo-status-filters .btn {
            flex: 1 1 calc(50% - 3px);
            min-width: 0;
            justify-content: center;
          }
          .jo-orders-desktop { display: none !important; }
          .jo-orders-mobile { display: flex; }
          .jo-order-card-actions .jo-order-actions {
            max-width: none;
            width: 100%;
          }
          .jo-list-head { align-items: flex-start; }
          .jo-list-head .btn { flex-shrink: 0; }
        }

        @media (max-width: 768px) {
          .jo-modal-overlay {
            padding: 12px;
            align-items: flex-start;
            overflow-y: auto;
          }
          .jo-modal-panel {
            max-height: calc(100vh - 24px);
            overflow: hidden;
          }
          .jo-modal-panel--view {
            width: 100%;
            max-width: 100%;
          }
          .jo-modal-panel--view .jo-meta-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .jo-view-items-wrap table,
          .jo-view-qc-wrap table {
            min-width: 860px;
          }
          .jo-modal-header {
            padding: 14px 16px;
            flex-wrap: wrap;
          }
          .jo-modal-actions { flex-wrap: wrap; }
          .jo-modal-body { padding: 14px 16px; }
          .jo-meta-grid { grid-template-columns: 1fr 1fr; }
          .jo-form-card-head { flex-wrap: wrap; }
          .jo-form-card-head h3 { font-size: 15px; line-height: 1.3; }
          .jo-vendor-custom-row {
            flex-direction: column;
            align-items: stretch;
          }
          .jo-vendor-custom-row .btn { width: 100%; }
        }

        @media (max-width: 480px) {
          .jo-modal-overlay { padding: 0; }
          .jo-modal-panel {
            max-height: 100vh;
            min-height: 100vh;
            border-radius: 0;
          }
          .jo-meta-grid { grid-template-columns: 1fr; }
          .jo-status-filters .btn { flex: 1 1 100%; }
          .jo-items-toolbar {
            flex-direction: column;
            align-items: stretch;
          }
          .jo-items-toolbar button { width: 100%; justify-content: center; }
          .jo-order-card-actions .btn { flex: 1 1 100%; }
        }
      `}</style>

      {viewOrder && (
        <ViewModal
          order={viewOrder}
          onClose={() => setViewOrder(null)}
          onEdit={
            canCreate
              ? () => {
                  setEditOrder(viewOrder);
                  setViewOrder(null);
                }
              : undefined
          }
        />
      )}
      {receiveOrder && (
        <ReceiveModal
          order={receiveOrder}
          onSave={handleReceive}
          onClose={() => setReceiveOrder(null)}
        />
      )}
      {editOrder && (
        <EditModal
          order={editOrder}
          onSave={handleEditSave}
          onClose={() => setEditOrder(null)}
        />
      )}

      {/* Off-screen mount used purely to feed the browser print/"Save as PDF" dialog
          when the person clicks "PDF" in the orders table below. The print media
          query above forces #job-order-print (inside PrintChallan) to take over the
          page during printing, so this stays invisible the rest of the time. */}
      {printOrder && (
        <div
         className="jo-print-mount"
          style={{ position: "fixed", top: -99999, left: -99999, zIndex: -1 }}
        >
          <PrintChallan order={printOrder} />
        </div>
      )}

      <div className="pagehead">
        <div className="pagehead-text">
          <h2>{meta.label}</h2>
          <p>Track challans sent for work and received back.</p>
        </div>
        <div className="no-print">
          {!showForm && canCreate && (
            <button className="btn btn-in" onClick={() => setShowForm(true)}>
              {meta.newButton}
            </button>
          )}
        </div>
      </div>

      {/* ── Create form ── */}
      {showForm && canCreate && (
        <div className="card no-print">
          <div className="jo-form-card-head">
            <h3 style={{ margin: 0 }}>{meta.formTitle}</h3>
            <button className="btn btn-ghost btn-sm" onClick={resetForm}>
              ✕ Cancel
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Header fields */}
            <div className="formgrid" style={{ marginBottom: 20 }}>
              <div className="field">
                <label>
                  Challan No  <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  value={srNo}
                  onChange={(e) => setSrNo(e.target.value)}
                  placeholder="e.g. 2136"
                />
              </div>
              <div className="field">
                <label>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Send From Name</label>
                {sendFromCustom ? (
                  <div className="jo-vendor-custom-row">
                    <input
                      value={sendFromName}
                      onChange={(e) => setSendFromName(e.target.value)}
                      placeholder="Enter sender name"
                      autoFocus
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ whiteSpace: "nowrap" }}
                      onClick={() => {
                        setSendFromCustom(false);
                        setSendFromName("");
                        setSendFromAddress("");
                      }}
                    >
                      ← Back
                    </button>
                  </div>
                ) : (
                  <select
                    value={sendFromName}
                    onChange={(e) => {
                      if (e.target.value === OTHER_SEND_FROM) {
                        setSendFromCustom(true);
                        setSendFromName("");
                        setSendFromAddress("");
                      } else {
                        setSendFromName(e.target.value);
                        const found = SEND_FROM_OPTIONS.find(
                          (v) => v.name === e.target.value,
                        );
                        if (found) setSendFromAddress(found.address);
                        else setSendFromAddress("");
                      }
                    }}
                  >
                    <option value="">— Select sender —</option>
                    {SEND_FROM_OPTIONS.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                    <option value={OTHER_SEND_FROM}>✎ Add own…</option>
                  </select>
                )}
              </div>
              <div className="field">
                <label>Send From Address</label>
                <input
                  value={sendFromAddress}
                  onChange={(e) => setSendFromAddress(e.target.value)}
                  placeholder="Auto-filled from selection, or enter manually"
                />
              </div>
              <div className="field">
                <label>
                  Send To Name <span style={{ color: "var(--red)" }}>*</span>
                </label>
                {vendorCustom ? (
                  <div className="jo-vendor-custom-row">
                    <input
                      value={vendorName}
                      onChange={(e) => setVendorName(e.target.value)}
                      placeholder="Enter vendor name"
                      autoFocus
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ whiteSpace: "nowrap" }}
                      onClick={() => {
                        setVendorCustom(false);
                        setVendorName("");
                        setDeliveryAddress("");
                      }}
                    >
                      ← Back
                    </button>
                  </div>
                ) : (
                  <select
                    value={vendorName}
                    onChange={(e) => {
                      if (e.target.value === "__custom__") {
                        setVendorCustom(true);
                        setVendorName("");
                        setDeliveryAddress("");
                      } else {
                        setVendorName(e.target.value);
                        const found = vendors.find(
                          (v) => v.name === e.target.value,
                        );
                        if (found) setDeliveryAddress(found.address);
                        else setDeliveryAddress("");
                      }
                    }}
                  >
                    <option value="">— Select vendor —</option>
                    {vendors.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                    <option value="__custom__">✎ Add own vendor…</option>
                  </select>
                )}
              </div>

              <div className="field">
                <label>Send To Address</label>
                <input
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="Auto-filled from vendor, or enter manually"
                />
              </div>
              <div className="field">
                <label>Vehicle No</label>
                <input
                  value={vehicleNo}
                  onChange={(e) => setVehicleNo(e.target.value)}
                  placeholder="e.g. MH04 GU47"
                />
              </div>
              <div className="field">
                <label>
                  Issued By <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  value={issuedBy}
                  onChange={(e) => setIssuedBy(e.target.value)}
                  placeholder="Your name"
                />
              </div>
            </div>

            {/* Items */}
            <div
              style={{
                marginBottom: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h4
                style={{
                  margin: 0,
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "1px",
                  color: "#8a8270",
                }}
              >
                Items
              </h4>
            </div>

            {/* Column-header row — desktop only (hidden on mobile via
                .jo-item-header media query, since the rows below collapse to
                a single stacked column there and per-field labels take over). */}
            <div className="jo-item-header">
              <span>Item Description</span>
              <span>Weight/Pcs (Kg)</span>
              <span>Perimeter (mm)</span>
              <span>Length (mm)</span>
              <span>Area/nos (Sq in)</span>
              <span>Qty</span>
              <span>UOM</span>
              <span>Process / RAL Code / Finish</span>
              <span>
                Project Name <span style={{ color: "var(--red)" }}>*</span>
              </span>
              <span>Remark</span>
              <span></span>
            </div>

            {items.map((it, idx) => (
              <ItemRow
                key={it._key}
                it={it}
                idx={idx}
                updateItem={updateItem}
                removeItem={removeItem}
                disableRemove={items.length === 1}
                descriptionOptions={FABRICATION_ITEM_DESCRIPTIONS}
              />
            ))}

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={addItem}
              style={{ marginBottom: 16 }}
            >
              + Add item
            </button>

            <div className="actionrow">
              <button className="btn btn-in" type="submit" disabled={saving}>
                {saving ? "Saving…" : meta.createButton}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetForm}
              >
                Cancel
              </button>
              {msg.text && (
                <span className={`msg ${msg.ok ? "ok" : "err"}`}>
                  {msg.text}
                </span>
              )}
            </div>
          </form>
        </div>
      )}

      {isAdmin && <VendorQc embedded jobType={resolvedJobType} onUpdated={load} />}

      {/* ── Orders list ── */}
      <div className="card card-wide no-print">
        <div className="jo-list-head">
          <div>
            <h3 style={{ margin: 0 }}>
              {meta.listTitle} <span className="pill-count">{visible.length}</span>
            </h3>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={clearJoFilters}
            disabled={!hasActiveFilters}
          >
            Clear filters
          </button>
        </div>

        {loading ? (
          <p style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</p>
        ) : (
          <>
          <div className="tablewrap jo-orders-wrap jo-orders-desktop">
            <table className="jo-orders-table">
              <colgroup>
                <col className="jo-col-challan" />
                <col className="jo-col-date" />
                <col className="jo-col-from jo-col-tablet-hide" />
                <col className="jo-col-to" />
                <col className="jo-col-vehicle jo-col-secondary" />
                <col className="jo-col-issued jo-col-secondary" />
                <col className="jo-col-qty jo-col-tablet-hide" />
                <col className="jo-col-qty jo-col-tablet-hide" />
                <col className="jo-col-expected jo-col-secondary" />
                <col className="jo-col-qc jo-col-tablet-hide" />
                <col className="jo-col-status" />
                <col className="jo-col-act" />
              </colgroup>
              <thead
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 3,
                  background: "var(--paper-dim)",
                }}
              >
                <tr>
                  <th>
                    <span className="jo-th-filter">
                      Challan{" "}
                      <ColFilter
                        values={orders.map((o) => o.srNo)}
                        selected={colFilters.challanNo}
                        onChange={(v) =>
                          setColFilters((f) => ({ ...f, challanNo: v }))
                        }
                      />
                    </span>
                  </th>
                  <th>
                    <span className="jo-th-filter">
                      Date{" "}
                      <ColFilter
                        values={orders.map((o) => formatDate(o.date))}
                        selected={colFilters.date}
                        onChange={(v) =>
                          setColFilters((f) => ({ ...f, date: v }))
                        }
                      />
                    </span>
                  </th>
                  <th className="jo-col-tablet-hide">
                    <span className="jo-th-filter">
                      Send From{" "}
                      <ColFilter
                        values={orders.map((o) => o.sendFromName)}
                        selected={colFilters.sendFrom}
                        onChange={(v) =>
                          setColFilters((f) => ({ ...f, sendFrom: v }))
                        }
                      />
                    </span>
                  </th>
                  <th>
                    <span className="jo-th-filter">
                      Send To{" "}
                      <ColFilter
                        values={orders.map((o) => o.vendorName)}
                        selected={colFilters.sendTo}
                        onChange={(v) =>
                          setColFilters((f) => ({ ...f, sendTo: v }))
                        }
                      />
                    </span>
                  </th>
                  <th className="jo-col-secondary">
                    <span className="jo-th-filter">
                      Vehicle{" "}
                      <ColFilter
                        values={orders.map((o) => o.vehicleNo)}
                        selected={colFilters.vehicleNo}
                        onChange={(v) =>
                          setColFilters((f) => ({ ...f, vehicleNo: v }))
                        }
                      />
                    </span>
                  </th>
                  <th className="jo-col-secondary">
                    <span className="jo-th-filter">
                      Issued By{" "}
                      <ColFilter
                        values={orders.map((o) => o.issuedBy)}
                        selected={colFilters.issuedBy}
                        onChange={(v) =>
                          setColFilters((f) => ({ ...f, issuedBy: v }))
                        }
                      />
                    </span>
                  </th>
                  <th className="num jo-col-tablet-hide">
                    <span className="jo-th-filter">
                      Disp{" "}
                      <ColFilter
                        values={orders.map((o) =>
                          String(orderDispatchedQty(o)),
                        )}
                        selected={colFilters.dispatchedQty}
                        onChange={(v) =>
                          setColFilters((f) => ({ ...f, dispatchedQty: v }))
                        }
                      />
                    </span>
                  </th>
                  <th className="num jo-col-tablet-hide">
                    <span className="jo-th-filter">
                      Recv{" "}
                      <ColFilter
                        values={orders.map((o) => String(orderReceivedQty(o)))}
                        selected={colFilters.receivedQty}
                        onChange={(v) =>
                          setColFilters((f) => ({ ...f, receivedQty: v }))
                        }
                      />
                    </span>
                  </th>
                  <th className="jo-col-secondary">
                    <span className="jo-th-filter">
                      Expected{" "}
                      <ColFilter
                        values={orders.map((o) => vendorExpectedLabel(o))}
                        selected={colFilters.vendorExpected}
                        onChange={(v) =>
                          setColFilters((f) => ({ ...f, vendorExpected: v }))
                        }
                      />
                    </span>
                  </th>
                  <th className="jo-col-tablet-hide">QC</th>
                  <th>
                    <span className="jo-th-filter">
                      Status{" "}
                      <ColFilter
                        values={orders.map((o) => statusLabel(o))}
                        selected={colFilters.status}
                        onChange={(v) =>
                          setColFilters((f) => ({ ...f, status: v }))
                        }
                      />
                    </span>
                  </th>
                  <th className="jo-col-act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((order) => {
                  const sc =
                    STATUS_COLORS[order.status] || STATUS_COLORS.issued;
                  const dispatchedQty = orderDispatchedQty(order);
                  const receivedQtyTotal = orderReceivedQty(order);
                  const pendingTotal = (order.items || []).reduce(
                    (sum, it) =>
                      sum + Math.max(0, num(it.qty) - num(it.receivedQty)),
                    0,
                  );
                  const hasPending = pendingTotal > 0.0001;
                  const open = openOrderId === order._id;
                  return (
                    <Fragment key={order._id}>
                    <tr
                      className={open ? "is-open" : undefined}
                      onClick={() => setOpenOrderId(open ? null : order._id)}
                      style={{ cursor: "pointer", background: open ? "var(--paper-dim)" : undefined }}
                    >
                      <td className="mono jo-td-clip" style={{ fontWeight: 700 }}>
                        {open ? "▾ " : "▸ "}{order.srNo}
                      </td>
                      <td className="jo-td-date">{formatDate(order.date)}</td>
                      <td className="jo-col-tablet-hide jo-td-clip" title={order.sendFromName || ""}>
                        {order.sendFromName || "—"}
                      </td>
                      <td className="jo-td-clip" style={{ fontWeight: 500 }} title={order.vendorName || ""}>
                        {order.vendorName}
                      </td>
                      <td className="jo-col-secondary jo-td-clip">{order.vehicleNo || "—"}</td>
                      <td className="jo-col-secondary jo-td-clip">{order.issuedBy || "—"}</td>
                      <td className="num jo-col-tablet-hide jo-td-qty">{dispatchedQty}</td>
                      <td className="num jo-col-tablet-hide jo-td-qty">{receivedQtyTotal}</td>
                      <td className="jo-col-secondary jo-td-expected">
                        {String(order.vendorExpectedDate || "").trim()
                          ? formatDate(order.vendorExpectedDate)
                          : <span style={{ color: "var(--text-3)" }}>—</span>}
                      </td>
                      <td className="jo-col-tablet-hide jo-td-qc" title={qcSummary(order)}>
                        <span className="jo-qc-text">{qcSummary(order)}</span>
                      </td>
                      <td className="jo-col-status">
                        <span
                          className="jo-status-pill"
                          title={statusLabel(order)}
                          style={{ background: sc.bg, color: sc.color }}
                        >
                          {statusLabel(order)}
                        </span>
                      </td>
                      <td className="jo-col-act" onClick={(e) => e.stopPropagation()}>
                        <OrderActionButtons
                          order={order}
                          hasPending={hasPending}
                        />
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={12} className="jo-detail-cell">
                          <OrderMaterials order={order} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="jo-orders-mobile">
            {pageItems.map((order) => {
              const sc = STATUS_COLORS[order.status] || STATUS_COLORS.issued;
              const pendingTotal = (order.items || []).reduce(
                (sum, it) =>
                  sum + Math.max(0, num(it.qty) - num(it.receivedQty)),
                0,
              );
              const hasPending = pendingTotal > 0.0001;
              const open = openOrderId === order._id;
              return (
                <div key={order._id} className="jo-order-card">
                  <button
                    type="button"
                    className={`jo-order-card-head${open ? " is-open" : ""}`}
                    onClick={() => setOpenOrderId(open ? null : order._id)}
                  >
                    <div className="jo-order-card-title">
                      <strong>{open ? "▾ " : "▸ "}Challan {order.srNo}</strong>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "3px 10px",
                          borderRadius: 12,
                          background: sc.bg,
                          color: sc.color,
                          textTransform: "capitalize",
                          flexShrink: 0,
                        }}
                      >
                        {statusLabel(order)}
                      </span>
                    </div>
                    <div className="jo-order-card-meta">
                      {formatDate(order.date)} · {order.vendorName || "—"}
                      <br />
                      Disp {orderDispatchedQty(order)} · Recv {orderReceivedQty(order)}
                      {String(order.vendorExpectedDate || "").trim()
                        ? ` · Expected ${formatDate(order.vendorExpectedDate)}`
                        : ""}
                    </div>
                    <div className="jo-order-card-meta" style={{ marginTop: 4 }}>
                      {qcSummary(order)}
                    </div>
                  </button>
                  <div className="jo-order-card-actions" onClick={(e) => e.stopPropagation()}>
                    <OrderActionButtons order={order} hasPending={hasPending} />
                  </div>
                  {open && (
                    <div className="jo-order-card-detail">
                      <OrderMaterials order={order} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </>
        )}
        {!loading && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
        {!loading && !visible.length && (
          <div className="empty">
            {hasActiveFilters
              ? `No ${meta.emptyNoun} challans match these filters.`
              : `No ${meta.emptyNoun} challans yet.`}
            {!hasActiveFilters && (
              <p>
                Click <strong>{meta.newButton}</strong> above to create your first
                delivery challan.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}