import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { acknowledgeJobOrder, getJobOrders, unwrapList } from "../api/api";
import { useAuth } from "../context/AuthContext";
import { todayStr } from "../utils/helpers";

function isVendorAcknowledged(order) {
  return !!String(order?.vendorExpectedDate || "").trim();
}

function jobTypeLabel(type) {
  return type === "fabrication" ? "Fabrication" : "Powder Coating";
}

function formatDate(d) {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  if (!y || !m || !day) return String(d);
  return `${day}/${m}/${y}`;
}

function formatQty(n) {
  const v = Math.round(Number(n) * 1000) / 1000;
  return Number.isFinite(v) ? String(v) : "—";
}

function submittedReadyQty(item) {
  const total = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.origin === "rework") return sum;
    return sum + (Number(round.readyQty) || 0);
  }, 0);
  return Math.round(total * 1000) / 1000;
}

function pendingRounds(item) {
  return (item?.qcRounds || []).filter((round) => round.status === "pending");
}

function reworkQty(item) {
  const rejected = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.status !== "inspected") return sum;
    return sum + (Number(round.rejectedQty) || 0);
  }, 0);
  const sentBack = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.origin !== "rework") return sum;
    return sum + (Number(round.readyQty) || 0);
  }, 0);
  return Math.max(0, Math.round((rejected - sentBack) * 1000) / 1000);
}

function dispatchQty(item) {
  return (item?.qcRounds || []).reduce((sum, round) => {
    if (round.status !== "inspected") return sum;
    return sum + (Number(round.dispatchQty) || 0);
  }, 0);
}

function isItemComplete(item) {
  const orderQty = Number(item?.qty) || 0;
  if (orderQty <= 0) return false;
  const sent = submittedReadyQty(item);
  if (sent < orderQty - 0.001) return false;
  if (pendingRounds(item).length) return false;
  if (reworkQty(item) > 0.001) return false;
  return (item?.qcRounds || []).some((r) => r.status === "inspected");
}

function orderStats(order) {
  const items = order.items || [];
  const acknowledged = isVendorAcknowledged(order);
  const pendingReceive = !acknowledged;
  const hasPendingQc = items.some((it) => pendingRounds(it).length > 0);
  const hasRework = items.some((it) => reworkQty(it) > 0.001);
  const readyDispatch = items.reduce((s, it) => s + dispatchQty(it), 0);
  const completed = items.length > 0 && items.every(isItemComplete);
  const inProcess = acknowledged && !completed;
  const expected = String(order.vendorExpectedDate || "").trim();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let overdue = false;
  if (acknowledged && !completed && /^\d{4}-\d{2}-\d{2}$/.test(expected)) {
    const [y, m, d] = expected.split("-").map(Number);
    const exp = new Date(y, m - 1, d);
    overdue = exp < today;
  }
  return {
    pendingReceive,
    acknowledged,
    hasPendingQc,
    hasRework,
    readyDispatch: Math.round(readyDispatch * 1000) / 1000,
    completed,
    inProcess,
    overdue,
    itemCount: items.length,
  };
}

function statusMeta(stats) {
  if (stats.pendingReceive) return { label: "Pending receive", tone: "warn" };
  if (stats.completed) return { label: "Completed", tone: "ok" };
  if (stats.hasPendingQc) return { label: "Pending QC", tone: "amber" };
  if (stats.hasRework) return { label: "Rework open", tone: "warn" };
  if (stats.overdue) return { label: "Overdue", tone: "amber" };
  return { label: "In process", tone: "" };
}

const FILTERS = [
  {
    id: "pending_receive",
    label: "Pending for receive",
    hint: "Awaiting your confirmation",
    match: (s) => s.pendingReceive,
    tone: "rust",
  },
  {
    id: "received",
    label: "Received material",
    hint: "Already acknowledged",
    match: (s) => s.acknowledged,
    tone: "teal",
  },
  {
    id: "pending_qc",
    label: "Pending QC",
    hint: "With quality check",
    match: (s) => s.hasPendingQc,
    tone: "amber",
  },
  {
    id: "in_process",
    label: "In process",
    hint: "Work in progress",
    match: (s) => s.inProcess,
    tone: "ink",
  },
  {
    id: "rework",
    label: "Rework open",
    hint: "Needs rework return",
    match: (s) => s.hasRework,
    tone: "rust",
  },
  {
    id: "ready_dispatch",
    label: "Ready to dispatch",
    hint: "QC approved quantity",
    match: (s) => s.readyDispatch > 0.001,
    tone: "teal",
  },
  {
    id: "overdue",
    label: "Overdue expected",
    hint: "Past expected date",
    match: (s) => s.overdue,
    tone: "amber",
  },
  {
    id: "completed",
    label: "Completed",
    hint: "Fully finished",
    match: (s) => s.completed,
    tone: "ink",
  },
];

export default function VendorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState({ text: "", ok: true });
  const [active, setActive] = useState("pending_receive");
  const [listSearch, setListSearch] = useState("");
  const [panelKey, setPanelKey] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const [ackOrder, setAckOrder] = useState(null);
  const [ackExpectedDate, setAckExpectedDate] = useState(todayStr());
  const [ackNote, setAckNote] = useState("");
  const [ackSaving, setAckSaving] = useState(false);
  const [ackErr, setAckErr] = useState("");
  const [ackQtyInputs, setAckQtyInputs] = useState([]);

  const jobType =
    user?.vendorJobType === "fabrication" ? "fabrication" : "powder_coating";

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const list = unwrapList(await getJobOrders({ jobType }));
      setOrders(list);
    } catch (e) {
      setErr(e.message || "Could not load dashboard");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [jobType]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!ackOrder) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [ackOrder]);

  const enriched = useMemo(
    () =>
      orders.map((order) => ({
        order,
        stats: orderStats(order),
      })),
    [orders],
  );

  const counts = useMemo(() => {
    const map = { total: enriched.length };
    for (const f of FILTERS) {
      map[f.id] = enriched.filter((row) => f.match(row.stats)).length;
    }
    return map;
  }, [enriched]);

  const activeFilter = FILTERS.find((f) => f.id === active) || FILTERS[0];
  const listRows = useMemo(() => {
    let list = active === "total"
      ? enriched
      : enriched.filter((row) => activeFilter.match(row.stats));
    const q = String(listSearch || "").trim().toLowerCase();
    if (q) {
      list = list.filter(({ order }) => {
        const itemHay = (order.items || [])
          .map((it) => [it.description, it.projectName, it.process].join(" "))
          .join(" ");
        const hay = [
          order.srNo,
          order.date,
          order.vehicleNo,
          order.sendFromName,
          order.vendorName,
          order.issuedBy,
          order.vendorExpectedDate,
          itemHay,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }, [active, activeFilter, enriched, listSearch]);

  function selectFilter(id) {
    if (id === active) return;
    setActive(id);
    setPanelKey((k) => k + 1);
  }

  function openReceive(order) {
    setAckOrder(order);
    setAckExpectedDate(todayStr());
    setAckNote("");
    setAckErr("");
    setAckQtyInputs(
      (order.items || []).map((it) => {
        const q = Number(it.qty);
        return Number.isFinite(q) && q > 0 ? String(q) : "";
      }),
    );
    setMsg({ text: "", ok: true });
  }

  function setAckQty(i, raw) {
    setAckQtyInputs((list) => list.map((v, idx) => (idx === i ? raw : v)));
  }

  function goToJobOrder(order, { receive = false } = {}) {
    setLeaving(true);
    window.setTimeout(() => {
      navigate("/job-orders", {
        state: {
          focusChallan: order.srNo,
          openReceive: receive && !isVendorAcknowledged(order),
        },
      });
    }, 180);
  }

  async function submitVendorAck(e) {
    e?.preventDefault?.();
    if (!ackOrder) return;
    setAckErr("");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ackExpectedDate || "").trim())) {
      setAckErr("Expected date is compulsory.");
      return;
    }

    const items = [];
    for (let i = 0; i < (ackOrder.items || []).length; i++) {
      const it = ackOrder.items[i];
      const ordered = Number(it.qty) || 0;
      const raw = String(ackQtyInputs[i] ?? "").trim();
      if (raw === "") {
        setAckErr(`Enter received qty for "${it.description || `Item ${i + 1}`}".`);
        return;
      }
      const receivedQty = Number(raw);
      if (!Number.isFinite(receivedQty) || receivedQty <= 0) {
        setAckErr(`Received qty for "${it.description || `Item ${i + 1}`}" must be greater than 0.`);
        return;
      }
      if (Math.abs(receivedQty - ordered) > 0.0001) {
        items.push({ itemIndex: i, qty: Math.round(receivedQty * 1000) / 1000 });
      }
    }

    setAckSaving(true);
    try {
      await acknowledgeJobOrder(ackOrder._id, {
        expectedDate: ackExpectedDate,
        note: ackNote,
        ...(items.length ? { items } : {}),
      });
      setMsg({
        text: items.length
          ? `Challan ${ackOrder.srNo} received. Qty updated on ${items.length} item${items.length === 1 ? "" : "s"}.`
          : `Challan ${ackOrder.srNo} received. Expected date saved.`,
        ok: true,
      });
      setAckOrder(null);
      setAckQtyInputs([]);
      await load();
      setActive("received");
      setPanelKey((k) => k + 1);
    } catch (error) {
      setAckErr(error.message || "Could not save.");
    } finally {
      setAckSaving(false);
    }
  }

  return (
    <div className={`vdash${leaving ? " is-leaving" : ""}`}>
      <style>{`
        .vdash {
          animation: vdashIn 0.28s ease;
        }
        .vdash.is-leaving {
          opacity: 0.55;
          transform: translateY(4px);
          transition: opacity 0.18s ease, transform 0.18s ease;
          pointer-events: none;
        }
        @keyframes vdashIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .vdash .pagehead {
          margin-bottom: 20px;
          align-items: flex-start;
        }
        .vdash-kicker {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--teal);
          margin-bottom: 4px;
        }
        .vdash-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }
        .vdash-card {
          position: relative;
          text-align: left;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: #fff;
          padding: 16px 16px 14px;
          cursor: pointer;
          font-family: inherit;
          color: inherit;
          overflow: hidden;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
          min-height: 108px;
        }
        .vdash-card::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: #cfc8b8;
          transition: background 0.18s ease;
        }
        .vdash-card.tone-teal::before { background: var(--teal); }
        .vdash-card.tone-rust::before { background: var(--rust); }
        .vdash-card.tone-amber::before { background: #c8861b; }
        .vdash-card.tone-ink::before { background: var(--ink); }
        .vdash-card:hover {
          border-color: #c9c1ad;
          box-shadow: 0 4px 14px rgba(28, 26, 22, 0.05);
        }
        .vdash-card.is-active {
          border-color: var(--teal);
          background: linear-gradient(180deg, #f3f8f7 0%, #fff 55%);
          box-shadow: 0 0 0 1px rgba(31, 92, 82, 0.18);
        }
        .vdash-card.is-active::before { background: var(--teal); width: 4px; }
        .vdash-card .label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #7d7666;
          margin-bottom: 8px;
        }
        .vdash-card .value {
          font-size: 30px;
          font-weight: 700;
          line-height: 1;
          color: var(--ink);
          font-variant-numeric: tabular-nums;
        }
        .vdash-card.tone-teal .value { color: var(--teal-dark); }
        .vdash-card.tone-rust .value { color: var(--rust); }
        .vdash-card.tone-amber .value { color: #9a3412; }
        .vdash-card .hint {
          margin-top: 8px;
          font-size: 12px;
          color: var(--text-2);
          line-height: 1.35;
        }
        .vdash-panel {
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #fff;
          overflow: hidden;
          box-shadow: 0 1px 2px rgba(28, 26, 22, 0.03);
        }
        .vdash-panel-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          padding: 16px 18px;
          border-bottom: 1px solid var(--line);
          background: linear-gradient(180deg, #f8f5ed 0%, #f3efe4 100%);
        }
        .vdash-panel-head h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .vdash-panel-head p {
          margin: 4px 0 0;
          font-size: 12.5px;
          color: var(--text-2);
        }
        .vdash-panel-body {
          animation: vdashPanel 0.22s ease;
        }
        @keyframes vdashPanel {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .vdash-tablewrap {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .vdash-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          min-width: 860px;
        }
        .vdash-table th {
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #8a8270;
          padding: 11px 14px;
          border-bottom: 1px solid var(--line);
          background: #fff;
          white-space: nowrap;
        }
        .vdash-table td {
          padding: 12px 14px;
          border-bottom: 1px solid #ebe6d8;
          vertical-align: middle;
        }
        .vdash-table tr:last-child td { border-bottom: none; }
        .vdash-table tbody tr {
          transition: background 0.14s ease;
        }
        .vdash-table tbody tr:hover { background: #faf8f2; }
        .vdash-challan {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--ink);
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          max-width: 220px;
        }
        .vdash-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .vdash-empty {
          padding: 36px 16px;
          text-align: center;
          color: var(--text-2);
          font-size: 13.5px;
        }
        .vdash-pill {
          display: inline-flex;
          align-items: center;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 9px;
          border-radius: 999px;
          background: #eceae4;
          color: #6b6555;
          white-space: nowrap;
        }
        .vdash-pill.warn { background: #ffedd5; color: #9a3412; }
        .vdash-pill.amber { background: #fef3c7; color: #92400e; }
        .vdash-pill.ok { background: #e8f0ee; color: #16483f; }
        .vdash-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 80;
          background: rgba(20, 18, 14, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: vdashFade 0.16s ease;
        }
        @keyframes vdashFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .vdash-modal {
          width: min(720px, 100%);
          max-height: min(86vh, 820px);
          overflow: auto;
          background: #fff;
          border-radius: 12px;
          border: 1px solid var(--line);
          box-shadow: 0 18px 48px rgba(20, 18, 14, 0.22);
          animation: vdashModal 0.2s ease;
        }
        @keyframes vdashModal {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .vdash-modal-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 18px;
          border-bottom: 1px solid var(--line);
          background: var(--paper-dim);
        }
        .vdash-modal-head h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
        }
        .vdash-modal-body { padding: 16px 18px 18px; }
        .vdash-modal-meta {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 14px;
        }
        .vdash-modal-meta div {
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 10px 12px;
          background: #faf8f2;
        }
        .vdash-modal-meta span {
          display: block;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #8a8270;
          margin-bottom: 4px;
        }
        .vdash-modal-meta strong {
          font-size: 13px;
          color: var(--ink);
        }
        .vdash-ack-scroll {
          border: 1px solid var(--line);
          border-radius: 8px;
          overflow: auto;
          max-height: 220px;
          margin-bottom: 14px;
        }
        .vdash-ack-scroll table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12.5px;
        }
        .vdash-ack-scroll th,
        .vdash-ack-scroll td {
          padding: 8px 10px;
          border-bottom: 1px solid #ebe6d8;
          text-align: left;
          white-space: nowrap;
        }
        .vdash-ack-scroll th {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #8a8270;
          background: #f7f4ec;
          position: sticky;
          top: 0;
        }
        .vdash-form-grid {
          display: grid;
          grid-template-columns: 1fr 1.4fr;
          gap: 12px;
          margin-bottom: 14px;
        }
        .vdash-form-grid label {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          color: var(--ink);
        }
        .vdash-form-grid input,
        .vdash-form-grid textarea {
          font: inherit;
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 9px 11px;
          background: #fff;
        }
        .vdash-modal-foot {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        @media (max-width: 1100px) {
          .vdash-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (max-width: 860px) {
          .vdash-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .vdash-modal-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .vdash-form-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 520px) {
          .vdash-grid { grid-template-columns: 1fr; }
          .vdash-card .value { font-size: 26px; }
        }
      `}</style>

      <div className="pagehead">
        <div className="pagehead-text">
          <div className="vdash-kicker">Operations overview</div>
          <h2>Vendor Dashboard</h2>
          <p>
            {user?.vendorName || "Your company"} · {jobTypeLabel(jobType)}.
            Select a card to filter challans — no page jump.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="btn btn-in btn-sm"
            onClick={() => {
              setLeaving(true);
              window.setTimeout(() => navigate("/job-orders"), 180);
            }}
          >
            My Job Orders
          </button>
        </div>
      </div>

      {err && <p className="msg err" style={{ marginBottom: 12 }}>{err}</p>}
      {msg.text && (
        <p className={`msg ${msg.ok ? "ok" : "err"}`} style={{ marginBottom: 12 }}>
          {msg.text}
        </p>
      )}

      <div className="vdash-grid">
        <button
          type="button"
          className={`vdash-card tone-ink${active === "total" ? " is-active" : ""}`}
          onClick={() => selectFilter("total")}
        >
          <div className="label">Total challans</div>
          <div className="value">{loading ? "—" : counts.total}</div>
          <div className="hint">All assigned {jobTypeLabel(jobType).toLowerCase()} challans</div>
        </button>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`vdash-card tone-${f.tone}${active === f.id ? " is-active" : ""}`}
            onClick={() => selectFilter(f.id)}
          >
            <div className="label">{f.label}</div>
            <div className="value">{loading ? "—" : counts[f.id]}</div>
            <div className="hint">{f.hint}</div>
          </button>
        ))}
      </div>

      <div className="vdash-panel">
        <div className="vdash-panel-head">
          <div>
            <h3>
              {active === "total" ? "All challans" : activeFilter.label}
              <span className="pill-count">{listRows.length}</span>
            </h3>
            <p>
              {active === "total"
                ? "Full list for your vendor login."
                : activeFilter.hint}
              {" "}Use Receive to acknowledge, or Open to work the challan.
            </p>
          </div>
        </div>
        <div className="searchbar" style={{ padding: "0 4px 12px" }}>
          <input
            type="search"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="Search challan, vehicle, item…"
            aria-label="Search challans"
          />
        </div>

        <div key={panelKey} className="vdash-panel-body">
          {loading ? (
            <div className="vdash-empty">Loading challans…</div>
          ) : listRows.length === 0 ? (
            <div className="vdash-empty">No challans in this group.</div>
          ) : (
            <div className="vdash-tablewrap">
              <table className="vdash-table">
                <thead>
                  <tr>
                    <th>Challan</th>
                    <th>Date</th>
                    <th>Items</th>
                    <th>Expected</th>
                    <th>Ready to dispatch</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {listRows.map(({ order, stats }) => {
                    const status = statusMeta(stats);
                    return (
                      <tr key={order._id}>
                        <td className="vdash-challan mono">{order.srNo}</td>
                        <td>{formatDate(order.date)}</td>
                        <td>{stats.itemCount}</td>
                        <td>
                          {stats.acknowledged ? (
                            formatDate(order.vendorExpectedDate)
                          ) : (
                            <span style={{ color: "var(--text-3)" }}>—</span>
                          )}
                        </td>
                        <td>{stats.readyDispatch ? formatQty(stats.readyDispatch) : "—"}</td>
                        <td>
                          <span className={`vdash-pill${status.tone ? ` ${status.tone}` : ""}`}>
                            {status.label}
                          </span>
                        </td>
                        <td>
                          <div className="vdash-actions">
                            {stats.pendingReceive ? (
                              <button
                                type="button"
                                className="btn btn-in btn-sm"
                                onClick={() => openReceive(order)}
                              >
                                Receive
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => goToJobOrder(order)}
                            >
                              Open
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {ackOrder &&
        createPortal(
          <div className="vdash-modal-overlay" onClick={() => !ackSaving && setAckOrder(null)}>
            <div
              className="vdash-modal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Receive challan"
            >
              <div className="vdash-modal-head">
                <div>
                  <h3>
                    Receive {jobTypeLabel(jobType)} challan {ackOrder.srNo}
                  </h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-2)" }}>
                    Confirm materials received. Edit Received qty only if it differs from the challan qty.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label="Close"
                  disabled={ackSaving}
                  onClick={() => {
                    setAckOrder(null);
                    setAckQtyInputs([]);
                  }}
                >
                  ✕
                </button>
              </div>
              <form className="vdash-modal-body" onSubmit={submitVendorAck}>
                <div className="vdash-modal-meta">
                  <div>
                    <span>Date</span>
                    <strong>{formatDate(ackOrder.date)}</strong>
                  </div>
                  <div>
                    <span>Vehicle</span>
                    <strong>{ackOrder.vehicleNo || "—"}</strong>
                  </div>
                  <div>
                    <span>Items</span>
                    <strong>{(ackOrder.items || []).length}</strong>
                  </div>
                  <div>
                    <span>Send from</span>
                    <strong>{ackOrder.sendFromName || "—"}</strong>
                  </div>
                </div>

                <div className="vdash-ack-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Sr</th>
                        <th>Item</th>
                        <th>Order qty</th>
                        <th>Received qty</th>
                        <th>UOM</th>
                        <th>Process / RAL</th>
                        <th>Project</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ackOrder.items || []).map((it, idx) => {
                        const ordered = Number(it.qty) || 0;
                        const raw = ackQtyInputs[idx] ?? "";
                        const recv = Number(raw);
                        const changed =
                          raw !== "" &&
                          Number.isFinite(recv) &&
                          Math.abs(recv - ordered) > 0.0001;
                        return (
                          <tr key={idx}>
                            <td>{idx + 1}</td>
                            <td>
                              <strong>{it.description || "—"}</strong>
                            </td>
                            <td>{formatQty(it.qty)}</td>
                            <td>
                              <input
                                type="number"
                                min="0.001"
                                step="any"
                                value={raw}
                                onChange={(e) => setAckQty(idx, e.target.value)}
                                style={{
                                  width: 88,
                                  height: 32,
                                  padding: "0 8px",
                                  border: `1.5px solid ${changed ? "var(--teal)" : "var(--line)"}`,
                                  borderRadius: 6,
                                  textAlign: "right",
                                  background: changed ? "#f3faf8" : "#fff",
                                  font: "inherit",
                                  fontSize: 13,
                                }}
                                title="Change only if received qty differs from order qty"
                                aria-label={`Received qty for ${it.description || `item ${idx + 1}`}`}
                              />
                            </td>
                            <td>{it.unit || "NOS"}</td>
                            <td>{it.process || "—"}</td>
                            <td>{it.projectName || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="vdash-form-grid">
                  <label>
                    Expected ready date *
                    <input
                      type="date"
                      required
                      value={ackExpectedDate}
                      onChange={(e) => setAckExpectedDate(e.target.value)}
                    />
                  </label>
                  <label>
                    Note (optional)
                    <input
                      type="text"
                      value={ackNote}
                      placeholder="Any remark for store / QC"
                      onChange={(e) => setAckNote(e.target.value)}
                    />
                  </label>
                </div>

                {ackErr && <p className="msg err" style={{ marginBottom: 12 }}>{ackErr}</p>}

                <div className="vdash-modal-foot">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={ackSaving}
                    onClick={() => setAckOrder(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={ackSaving}
                    onClick={() => goToJobOrder(ackOrder, { receive: true })}
                  >
                    Open on Job Orders
                  </button>
                  <button type="submit" className="btn btn-in" disabled={ackSaving}>
                    {ackSaving ? "Saving…" : "Confirm receive"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
