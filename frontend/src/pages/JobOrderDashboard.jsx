import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getJobOrders, unwrapList } from "../api/api";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round3(n) {
  return Math.round(num(n) * 1000) / 1000;
}

function formatQty(n) {
  const v = round3(n);
  return Number.isFinite(v) ? String(v) : "—";
}

function formatDate(d) {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  if (!y || !m || !day) return String(d);
  return `${day}/${m}/${y}`;
}

function jobTypeLabel(type) {
  return type === "fabrication" ? "Fabrication" : "Powder Coating";
}

function jobTypeShort(type) {
  return type === "fabrication" ? "Fab" : "PC";
}

function isVendorAcknowledged(order) {
  return !!String(order?.vendorExpectedDate || "").trim();
}

function submittedReadyQty(item) {
  const total = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.origin === "rework") return sum;
    return sum + num(round.readyQty);
  }, 0);
  return round3(total);
}

function pendingQcQty(item) {
  const total = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.status !== "pending") return sum;
    return sum + num(round.readyQty);
  }, 0);
  return round3(total);
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
  return Math.max(0, round3(rejected - sentBack));
}

function scrapQty(item) {
  const total = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.status !== "inspected") return sum;
    return sum + num(round.scrapQty);
  }, 0);
  return round3(total);
}

function readyToDispatchQty(item) {
  const total = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.status !== "inspected") return sum;
    return sum + num(round.dispatchQty);
  }, 0);
  return round3(total);
}

function receivableNow(item) {
  const dispatchLeft = Math.max(0, readyToDispatchQty(item) - num(item?.receivedQty));
  const orderLeft = Math.max(0, num(item?.qty) - num(item?.receivedQty));
  return round3(Math.min(dispatchLeft, orderLeft));
}

function itemPipelineStatus(item, order) {
  if (!isVendorAcknowledged(order)) return "Awaiting vendor receive";
  const orderQty = num(item?.qty);
  const ready = submittedReadyQty(item);
  const pending = pendingQcQty(item);
  const rework = reworkQty(item);
  const scrap = scrapQty(item);
  const dispatch = readyToDispatchQty(item);
  const received = num(item?.receivedQty);
  if (orderQty > 0 && received >= orderQty - 0.001) return "Fully received";
  if (pending > 0.001) return "With QC";
  if (rework > 0.001) return "Rework open";
  if (scrap > 0.001 && pending <= 0.001 && rework <= 0.001 && receivableNow(item) <= 0.001) {
    return "Rejected (scrap)";
  }
  if (receivableNow(item) > 0.001) return "Ready to receive";
  if (dispatch > 0.001 && received < dispatch - 0.001) return "Ready to dispatch";
  if (orderQty > 0 && ready >= orderQty - 0.001) return "Inspection complete";
  if (ready > 0.001) return "In process";
  return "Waiting for vendor qty";
}

function receiveStatus(order) {
  const status = order?.status || "issued";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function lineMetrics(order, item, itemIndex) {
  const orderQty = num(item?.qty);
  const ready = submittedReadyQty(item);
  const pending = pendingQcQty(item);
  const dispatch = readyToDispatchQty(item);
  const rework = reworkQty(item);
  const scrap = scrapQty(item);
  const received = num(item?.receivedQty);
  const receivable = receivableNow(item);
  return {
    key: `${order._id}-${itemIndex}`,
    orderId: order._id,
    srNo: order.srNo,
    date: order.date,
    jobType: order.jobType === "fabrication" ? "fabrication" : "powder_coating",
    vendorName: String(order.vendorName || "").trim() || "—",
    vehicleNo: order.vehicleNo || "",
    expectedDate: order.vendorExpectedDate || "",
    acknowledged: isVendorAcknowledged(order),
    receiveStatus: receiveStatus(order),
    orderStatus: order.status || "issued",
    description: String(item?.description || "").trim() || "—",
    process: item?.process || "",
    projectName: item?.projectName || "",
    unit: item?.unit || "NOS",
    orderQty,
    ready,
    pending,
    dispatch,
    rework,
    scrap,
    received,
    receivable,
    balance: Math.max(0, round3(orderQty - received)),
    pipeline: itemPipelineStatus(item, order),
  };
}

function lineMatchesKpi(line, kpiId) {
  if (kpiId === "total") return true;
  if (kpiId === "awaiting_ack") return !line.acknowledged;
  if (kpiId === "pending_qc") return line.pending > 0.001;
  if (kpiId === "rework") return line.rework > 0.001;
  if (kpiId === "rejected") return line.scrap > 0.001;
  if (kpiId === "ready_dispatch") return line.dispatch > 0.001;
  if (kpiId === "receivable") return line.receivable > 0.001;
  if (kpiId === "partial") {
    return line.orderStatus === "partial" || (line.received > 0.001 && line.balance > 0.001);
  }
  if (kpiId === "completed") {
    return line.orderStatus === "received" || (line.orderQty > 0 && line.received >= line.orderQty - 0.001);
  }
  return true;
}

// Card value: "challans" = distinct challans, "lines" = matching item rows (same as table).
const KPI_CARDS = [
  { id: "total", label: "Total challans", tone: "ink", hint: "All loaded job orders", countBy: "challans" },
  { id: "awaiting_ack", label: "Awaiting vendor", tone: "rust", hint: "Not yet received by vendor", countBy: "challans" },
  { id: "pending_qc", label: "Pending QC", tone: "amber", hint: "Item lots waiting with QC", countBy: "lines" },
  { id: "rework", label: "Rework open", tone: "rust", hint: "Items sent back for rework", countBy: "lines" },
  { id: "rejected", label: "Rejected", tone: "rust", hint: "Items permanently rejected", countBy: "lines" },
  { id: "ready_dispatch", label: "Ready to dispatch", tone: "teal", hint: "Items with QC-approved qty", countBy: "lines" },
  { id: "receivable", label: "Can receive", tone: "teal", hint: "Items store can take now", countBy: "lines" },
  { id: "partial", label: "Partial receive", tone: "amber", hint: "Partially received at store", countBy: "challans" },
  { id: "completed", label: "Fully received", tone: "ink", hint: "All qty received at store", countBy: "challans" },
];

export default function JobOrderDashboard() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [jobType, setJobType] = useState("all");
  const [activeKpi, setActiveKpi] = useState("total");
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [panelKey, setPanelKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const params = jobType === "all" ? {} : { jobType };
      const list = unwrapList(await getJobOrders(params));
      setOrders(list);
    } catch (e) {
      setErr(e.message || "Could not load job orders");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [jobType]);

  useEffect(() => {
    load();
  }, [load]);

  const lines = useMemo(() => {
    const out = [];
    for (const order of orders) {
      (order.items || []).forEach((item, itemIndex) => {
        out.push(lineMetrics(order, item, itemIndex));
      });
    }
    return out;
  }, [orders]);

  const vendors = useMemo(() => {
    const set = new Set();
    for (const line of lines) {
      if (line.vendorName && line.vendorName !== "—") set.add(line.vendorName);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [lines]);

  // Scope used for card counts — same vendor filter as the table (not search).
  const scopedLines = useMemo(() => {
    if (vendorFilter === "all") return lines;
    return lines.filter((l) => l.vendorName === vendorFilter);
  }, [lines, vendorFilter]);

  const counts = useMemo(() => {
    const out = {};
    for (const card of KPI_CARDS) {
      const matching = scopedLines.filter((l) => lineMatchesKpi(l, card.id));
      if (card.countBy === "lines") {
        out[card.id] = matching.length;
      } else {
        out[card.id] = new Set(matching.map((l) => l.orderId)).size;
      }
    }
    return out;
  }, [scopedLines]);

  const q = normalize(search);

  const filteredLines = useMemo(() => {
    let list = scopedLines;
    if (q) {
      list = list.filter((l) => {
        const hay = normalize(
          [
            l.description,
            l.projectName,
            l.process,
            l.srNo,
            l.vendorName,
            l.vehicleNo,
            l.pipeline,
          ].join(" "),
        );
        return hay.includes(q);
      });
    }
    if (activeKpi !== "total") {
      list = list.filter((l) => lineMatchesKpi(l, activeKpi));
    }
    return list;
  }, [scopedLines, q, activeKpi]);

  const filteredChallanCount = useMemo(
    () => new Set(filteredLines.map((l) => l.orderId)).size,
    [filteredLines],
  );

  const vendorSummary = useMemo(() => {
    if (!q) return [];
    const map = new Map();
    for (const line of filteredLines) {
      const key = `${line.vendorName}||${line.jobType}||${normalize(line.description)}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          vendorName: line.vendorName,
          jobType: line.jobType,
          description: line.description,
          unit: line.unit,
          challans: 0,
          orderQty: 0,
          ready: 0,
          pending: 0,
          dispatch: 0,
          rework: 0,
          scrap: 0,
          received: 0,
          receivable: 0,
          balance: 0,
          statuses: new Set(),
        });
      }
      const row = map.get(key);
      row.challans += 1;
      row.orderQty = round3(row.orderQty + line.orderQty);
      row.ready = round3(row.ready + line.ready);
      row.pending = round3(row.pending + line.pending);
      row.dispatch = round3(row.dispatch + line.dispatch);
      row.rework = round3(row.rework + line.rework);
      row.scrap = round3(row.scrap + line.scrap);
      row.received = round3(row.received + line.received);
      row.receivable = round3(row.receivable + line.receivable);
      row.balance = round3(row.balance + line.balance);
      row.statuses.add(line.pipeline);
    }
    return [...map.values()]
      .map((row) => ({
        ...row,
        statusText: [...row.statuses].join(" · "),
      }))
      .sort((a, b) => {
        const v = a.vendorName.localeCompare(b.vendorName, undefined, { sensitivity: "base" });
        if (v) return v;
        return a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
      });
  }, [filteredLines, q]);

  const totals = useMemo(() => {
    return filteredLines.reduce(
      (acc, line) => ({
        orderQty: round3(acc.orderQty + line.orderQty),
        ready: round3(acc.ready + line.ready),
        pending: round3(acc.pending + line.pending),
        dispatch: round3(acc.dispatch + line.dispatch),
        rework: round3(acc.rework + line.rework),
        scrap: round3(acc.scrap + line.scrap),
        received: round3(acc.received + line.received),
        receivable: round3(acc.receivable + line.receivable),
        balance: round3(acc.balance + line.balance),
      }),
      {
        orderQty: 0,
        ready: 0,
        pending: 0,
        dispatch: 0,
        rework: 0,
        scrap: 0,
        received: 0,
        receivable: 0,
        balance: 0,
      },
    );
  }, [filteredLines]);

  function selectKpi(id) {
    if (id === activeKpi) return;
    setActiveKpi(id);
    setPanelKey((k) => k + 1);
  }

  function openOrder(line) {
    const path =
      line.jobType === "fabrication" ? "/job-orders/fabrication" : "/job-orders";
    navigate(path, { state: { focusChallan: line.srNo } });
  }

  const activeLabel =
    KPI_CARDS.find((c) => c.id === activeKpi)?.label || "Total challans";

  return (
    <div className="jod">
      <style>{`
        .jod {
          display: block;
          width: 100% !important;
          max-width: none !important;
          box-sizing: border-box;
          animation: jodIn 0.25s ease;
        }
        @keyframes jodIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .jod .pagehead {
          width: 100%;
          margin-bottom: 16px;
          align-items: center;
        }
        .jod-toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 16px;
          align-items: end;
          width: 100%;
        }
        .jod-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 160px;
        }
        .jod-field.grow { flex: 1; min-width: 220px; }
        .jod-field label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #8a8270;
        }
        .jod-field input,
        .jod-field select {
          font: inherit;
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 9px 11px;
          background: #fff;
          color: var(--ink);
          min-height: 38px;
          width: 100%;
          box-sizing: border-box;
        }
        .jod-field input:focus,
        .jod-field select:focus {
          outline: none;
          border-color: var(--teal);
          box-shadow: 0 0 0 2px rgba(31, 92, 82, 0.12);
        }
        .jod-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 18px;
          width: 100%;
        }
        .jod-card {
          position: relative;
          text-align: left;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: #fff;
          padding: 14px 16px 14px 18px;
          cursor: pointer;
          font-family: inherit;
          color: inherit;
          overflow: hidden;
          min-height: 92px;
          width: 100%;
          box-sizing: border-box;
          transition: border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
        }
        .jod-card::before {
          content: "";
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 3px;
          background: #cfc8b8;
        }
        .jod-card.tone-teal::before { background: var(--teal); }
        .jod-card.tone-rust::before { background: var(--rust); }
        .jod-card.tone-amber::before { background: #c8861b; }
        .jod-card.tone-ink::before { background: var(--ink); }
        .jod-card:hover {
          border-color: #c9c1ad;
          box-shadow: 0 4px 14px rgba(28, 26, 22, 0.05);
        }
        .jod-card.is-active {
          border-color: var(--teal);
          background: linear-gradient(180deg, #f3f8f7 0%, #fff 55%);
          box-shadow: 0 0 0 1px rgba(31, 92, 82, 0.18);
        }
        .jod-card.is-active::before { width: 4px; background: var(--teal); }
        .jod-card .label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #7d7666;
          margin-bottom: 8px;
        }
        .jod-card .value {
          font-size: 28px;
          font-weight: 700;
          line-height: 1;
          font-variant-numeric: tabular-nums;
          color: var(--ink);
        }
        .jod-card.tone-teal .value { color: var(--teal-dark); }
        .jod-card.tone-rust .value { color: var(--rust); }
        .jod-card.tone-amber .value { color: #9a3412; }
        .jod-card .hint {
          margin-top: 8px;
          font-size: 12px;
          color: var(--text-2);
          line-height: 1.35;
        }
        .jod-panel {
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #fff;
          overflow: hidden;
          margin-bottom: 16px;
          width: 100%;
          box-sizing: border-box;
          box-shadow: 0 1px 2px rgba(28, 26, 22, 0.03);
        }
        .jod-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          padding: 14px 16px;
          border-bottom: 1px solid var(--line);
          background: linear-gradient(180deg, #f8f5ed 0%, #f3efe4 100%);
        }
        .jod-panel-head h3 {
          margin: 0;
          font-size: 15px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .jod-panel-body { animation: jodPanel 0.2s ease; }
        @keyframes jodPanel {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .jod-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--line);
          background: #faf8f2;
        }
        .jod-stat {
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 10px 12px;
          background: #fff;
        }
        .jod-stat span {
          display: block;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #8a8270;
          margin-bottom: 4px;
        }
        .jod-stat strong {
          font-size: 16px;
          font-variant-numeric: tabular-nums;
          color: var(--ink);
        }
        .jod-tablewrap {
          width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .jod-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 13px;
        }
        .jod-table th {
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #8a8270;
          padding: 11px 10px;
          border-bottom: 1px solid var(--line);
          background: #faf8f2;
          white-space: nowrap;
        }
        .jod-table td {
          padding: 11px 10px;
          border-bottom: 1px solid #ebe6d8;
          vertical-align: middle;
          color: var(--ink);
          overflow: hidden;
        }
        .jod-table tr:last-child td { border-bottom: none; }
        .jod-table tbody tr { transition: background 0.12s ease; }
        .jod-table tbody tr:hover { background: #faf8f2; }
        .jod-table .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          font-weight: 600;
          color: var(--ink);
        }
        .jod-clip {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .jod-item {
          font-weight: 600;
          color: var(--ink);
        }
        .jod-empty {
          padding: 32px 16px;
          text-align: center;
          color: var(--text-2);
          font-size: 13.5px;
        }
        .jod-pill {
          display: inline-flex;
          align-items: center;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 9px;
          border-radius: 999px;
          background: #eceae4;
          color: #6b6555;
          white-space: nowrap;
        }
        .jod-pill.warn { background: #ffedd5; color: #9a3412; }
        .jod-pill.amber { background: #fef3c7; color: #92400e; }
        .jod-pill.ok { background: #e8f0ee; color: #16483f; }
        .jod-pill.teal { background: #e6f2f0; color: #143e38; }
        /* Flexible middle columns fill the page; qty cols stay compact */
        .jod-table col.jod-c-challan { width: 7%; }
        .jod-table col.jod-c-date { width: 8%; }
        .jod-table col.jod-c-item { width: 16%; }
        .jod-table col.jod-c-vendor { width: 16%; }
        .jod-table col.jod-c-qty { width: 6%; }
        .jod-table col.jod-c-pipe { width: 14%; }
        .jod-table col.jod-c-store { width: 8%; }
        .jod-table col.jod-c-act { width: 7%; }
        @media (max-width: 1100px) {
          .jod-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .jod-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 560px) {
          .jod-grid { grid-template-columns: 1fr; }
          .jod-stats { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="pagehead">
        <div className="pagehead-text">
          <h2>Job Order Dashboard</h2>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate("/job-orders")}
          >
            Powder Coating
          </button>
          <button
            type="button"
            className="btn btn-in btn-sm"
            onClick={() => navigate("/job-orders/fabrication")}
          >
            Fabrication
          </button>
        </div>
      </div>

      {err && <p className="msg err" style={{ marginBottom: 12 }}>{err}</p>}

      <div className="jod-toolbar">
        <div className="jod-field grow">
          <label htmlFor="jod-search">Search item / challan / vendor</label>
          <input
            id="jod-search"
            type="search"
            value={search}
            placeholder="e.g. Strap Clamp, project name, challan no…"
            onChange={(e) => {
              setSearch(e.target.value);
              setPanelKey((k) => k + 1);
            }}
          />
        </div>
        <div className="jod-field">
          <label htmlFor="jod-type">Job type</label>
          <select
            id="jod-type"
            value={jobType}
            onChange={(e) => {
              setJobType(e.target.value);
              setActiveKpi("total");
            }}
          >
            <option value="all">All types</option>
            <option value="powder_coating">Powder Coating</option>
            <option value="fabrication">Fabrication</option>
          </select>
        </div>
        <div className="jod-field">
          <label htmlFor="jod-vendor">Vendor</label>
          <select
            id="jod-vendor"
            value={vendorFilter}
            onChange={(e) => {
              setVendorFilter(e.target.value);
              setPanelKey((k) => k + 1);
            }}
          >
            <option value="all">All vendors</option>
            {vendors.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="jod-grid">
        {KPI_CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`jod-card tone-${card.tone}${activeKpi === card.id ? " is-active" : ""}`}
            onClick={() => selectKpi(card.id)}
          >
            <div className="label">{card.label}</div>
            <div className="value">{loading ? "—" : counts[card.id]}</div>
            <div className="hint">{card.hint}</div>
          </button>
        ))}
      </div>

      {q ? (
        <div className="jod-panel">
          <div className="jod-panel-head">
            <div>
              <h3>
                Item by vendor
                <span className="pill-count">{vendorSummary.length}</span>
              </h3>
            </div>
          </div>
          <div key={`vendor-${panelKey}`} className="jod-panel-body">
            {loading ? (
              <div className="jod-empty">Loading…</div>
            ) : vendorSummary.length === 0 ? (
              <div className="jod-empty">No matching items for this search.</div>
            ) : (
              <>
                <div className="jod-stats">
                  <div className="jod-stat">
                    <span>Order qty</span>
                    <strong>{formatQty(totals.orderQty)}</strong>
                  </div>
                  <div className="jod-stat">
                    <span>With vendors (ready)</span>
                    <strong>{formatQty(totals.ready)}</strong>
                  </div>
                  <div className="jod-stat">
                    <span>Ready to dispatch</span>
                    <strong>{formatQty(totals.dispatch)}</strong>
                  </div>
                  <div className="jod-stat">
                    <span>Received at store</span>
                    <strong>{formatQty(totals.received)}</strong>
                  </div>
                </div>
                <div className="jod-tablewrap">
                  <table className="jod-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Vendor</th>
                        <th>Type</th>
                        <th className="num">Challans</th>
                        <th className="num">Order qty</th>
                        <th className="num">Ready</th>
                        <th className="num">Pending QC</th>
                        <th className="num">Dispatch</th>
                        <th className="num">Rework</th>
                        <th className="num">Rejected</th>
                        <th className="num">Received</th>
                        <th className="num">Balance</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendorSummary.map((row) => (
                        <tr key={row.key}>
                          <td className="jod-clip" title={`${row.description} (${row.unit})`}>
                            <span className="jod-item">{row.description}</span>
                          </td>
                          <td className="jod-clip" title={row.vendorName}>{row.vendorName}</td>
                          <td className="jod-clip" title={jobTypeLabel(row.jobType)}>
                            {jobTypeShort(row.jobType)}
                          </td>
                          <td className="num">{row.challans}</td>
                          <td className="num">{formatQty(row.orderQty)}</td>
                          <td className="num">{formatQty(row.ready)}</td>
                          <td className="num">{row.pending ? formatQty(row.pending) : "—"}</td>
                          <td className="num">{row.dispatch ? formatQty(row.dispatch) : "—"}</td>
                          <td className="num">{row.rework ? formatQty(row.rework) : "—"}</td>
                          <td className="num">{row.scrap ? formatQty(row.scrap) : "—"}</td>
                          <td className="num">{formatQty(row.received)}</td>
                          <td className="num">{formatQty(row.balance)}</td>
                          <td title={row.statusText}>
                            <span className="jod-pill">{row.statusText}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      <div className="jod-panel">
        <div className="jod-panel-head">
          <div>
            <h3>
              {q ? "Matching line details" : activeLabel}
              <span className="pill-count">
                {filteredLines.length} item{filteredLines.length === 1 ? "" : "s"}
                {filteredChallanCount > 0
                  ? ` · ${filteredChallanCount} challan${filteredChallanCount === 1 ? "" : "s"}`
                  : ""}
              </span>
            </h3>
          </div>
        </div>
        <div key={`lines-${panelKey}`} className="jod-panel-body">
          {loading ? (
            <div className="jod-empty">Loading…</div>
          ) : filteredLines.length === 0 ? (
            <div className="jod-empty">No lines in this view.</div>
          ) : (
            <div className="jod-tablewrap">
              <table className="jod-table">
                <colgroup>
                  <col className="jod-c-challan" />
                  <col className="jod-c-date" />
                  <col className="jod-c-item" />
                  <col className="jod-c-vendor" />
                  <col className="jod-c-qty" />
                  <col className="jod-c-qty" />
                  <col className="jod-c-qty" />
                  <col className="jod-c-qty" />
                  <col className="jod-c-pipe" />
                  <col className="jod-c-store" />
                  <col className="jod-c-act" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Challan</th>
                    <th>Date</th>
                    <th>Item</th>
                    <th>Vendor</th>
                    <th className="num">Order</th>
                    <th className="num">Ready</th>
                    <th className="num">Disp</th>
                    <th className="num">Recv</th>
                    <th>Pipeline</th>
                    <th>Store</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLines.map((line) => {
                    let pill = "";
                    if (
                      line.pipeline.includes("Awaiting")
                      || line.pipeline.includes("Rework")
                      || line.pipeline.includes("Rejected")
                    ) pill = "warn";
                    else if (line.pipeline.includes("QC") || line.pipeline.includes("Partial")) pill = "amber";
                    else if (line.pipeline.includes("receive") || line.pipeline.includes("dispatch")) pill = "teal";
                    else if (line.pipeline.includes("complete") || line.pipeline.includes("Fully")) pill = "ok";
                    const itemTitle = [
                      line.description,
                      jobTypeLabel(line.jobType),
                      line.projectName,
                      line.process,
                      line.pending ? `QC ${formatQty(line.pending)}` : null,
                      line.rework ? `Rework ${formatQty(line.rework)}` : null,
                      line.scrap ? `Rejected ${formatQty(line.scrap)}` : null,
                      line.receivable ? `Avail ${formatQty(line.receivable)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <tr key={line.key}>
                        <td className="mono jod-clip" style={{ fontWeight: 700 }}>{line.srNo}</td>
                        <td className="jod-clip">{formatDate(line.date)}</td>
                        <td className="jod-clip" title={itemTitle}>
                          <span className="jod-item">{line.description}</span>
                        </td>
                        <td className="jod-clip" title={line.vendorName}>{line.vendorName}</td>
                        <td className="num">{formatQty(line.orderQty)}</td>
                        <td className="num">{formatQty(line.ready)}</td>
                        <td className="num">{line.dispatch ? formatQty(line.dispatch) : "—"}</td>
                        <td className="num">{formatQty(line.received)}</td>
                        <td title={line.pipeline}>
                          <span className={`jod-pill${pill ? ` ${pill}` : ""}`}>{line.pipeline}</span>
                        </td>
                        <td title={line.receiveStatus}>
                          <span className="jod-pill">{line.receiveStatus}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => openOrder(line)}
                          >
                            View
                          </button>
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
    </div>
  );
}
