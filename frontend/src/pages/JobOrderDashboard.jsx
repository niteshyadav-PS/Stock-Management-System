import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getJobOrders, getJobOrderVendors, unwrapList } from "../api/api";
import { ThFilter } from "../components/ColFilter";
import { JobOrderViewModal } from "./JobOrder";
import {
  VENDOR_MATERIAL_CATEGORIES,
  setJobOrderVendorsCache,
  vendorMaterialCategory,
  vendorMaterialCategoryLabel,
} from "../utils/jobOrderVendors";

const EMPTY_COL_FILTERS = {
  challan: [],
  sendFrom: [],
  sendTo: [],
  dcDate: [],
  expected: [],
  delivery: [],
  delay: [],
  orderQty: [],
  ready: [],
  dispatch: [],
  received: [],
  pipeline: [],
};

function filterNameKey(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function matchesColFilter(selected, value) {
  if (!selected?.length) return true;
  const key = filterNameKey(value);
  return selected.some((s) => filterNameKey(s) === key);
}

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

function parseYmd(value) {
  const raw = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function receiptReceivedDate(receipt) {
  if (receipt?.receivedDate) return String(receipt.receivedDate).slice(0, 10);
  if (receipt?.at) return String(receipt.at).slice(0, 10);
  return "";
}

/** Latest material receive date on this item line (yyyy-mm-dd). */
function itemDeliveryDate(item) {
  let best = "";
  for (const receipt of item?.receipts || []) {
    const day = receiptReceivedDate(receipt);
    if (day && (!best || day > best)) best = day;
  }
  return best;
}

/** Delivery − expected in whole days. Positive = late. */
function calcDelayDays(expectedDate, deliveryDate) {
  const expected = parseYmd(expectedDate);
  const delivery = parseYmd(deliveryDate);
  if (!expected || !delivery) return null;
  return Math.round((delivery - expected) / 86400000);
}

function delayDaysLabel(days) {
  if (days == null || !Number.isFinite(days)) return "—";
  if (days === 0) return "On time";
  if (days > 0) return `${days}d late`;
  return `${Math.abs(days)}d early`;
}

function jobTypeLabel(type) {
  return type === "fabrication" ? "Fabrication" : "Powder Coating";
}

/** Case/whitespace key so "Fusion Metal" and "FUSION METAL" collapse in filters. */
function vendorKey(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function dedupeVendorNames(names) {
  const map = new Map();
  for (const raw of names || []) {
    const display = String(raw || "").trim().replace(/\s+/g, " ");
    if (!display || display === "—") continue;
    const key = display.toLowerCase();
    if (!map.has(key)) map.set(key, display);
  }
  return [...map.values()];
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

/** One dashboard row per challan (item details stay in View). */
function challanMetrics(order) {
  const items = order?.items || [];
  let orderQty = 0;
  let ready = 0;
  let pending = 0;
  let dispatch = 0;
  let rework = 0;
  let scrap = 0;
  let received = 0;
  let receivable = 0;
  let deliveryDate = "";
  const itemNames = [];
  const projectNames = [];

  items.forEach((item) => {
    orderQty += num(item?.qty);
    ready += submittedReadyQty(item);
    pending += pendingQcQty(item);
    dispatch += readyToDispatchQty(item);
    rework += reworkQty(item);
    scrap += scrapQty(item);
    received += num(item?.receivedQty);
    receivable += receivableNow(item);
    const day = itemDeliveryDate(item);
    if (day && (!deliveryDate || day > deliveryDate)) deliveryDate = day;
    const desc = String(item?.description || "").trim();
    if (desc) itemNames.push(desc);
    const project = String(item?.projectName || "").trim();
    if (project) projectNames.push(project);
  });

  orderQty = round3(orderQty);
  ready = round3(ready);
  pending = round3(pending);
  dispatch = round3(dispatch);
  rework = round3(rework);
  scrap = round3(scrap);
  received = round3(received);
  receivable = round3(receivable);

  const expectedDate = String(order.vendorExpectedDate || "").trim().slice(0, 10);
  const delayDays = calcDelayDays(expectedDate, deliveryDate);
  const sendFromName = String(order.sendFromName || "").trim() || "—";
  const vendorName = String(order.vendorName || "").trim() || "—";
  const categoryLabel = vendorMaterialCategoryLabel(order.vendorName) || "—";
  const totals = {
    orderQty,
    ready,
    pending,
    dispatch,
    rework,
    scrap,
    received,
    receivable,
  };

  return {
    key: String(order._id),
    orderId: order._id,
    srNo: order.srNo,
    date: order.date,
    dcDateLabel: formatDate(order.date),
    jobType: order.jobType === "fabrication" ? "fabrication" : "powder_coating",
    sendFromName,
    vendorName,
    sendToName: vendorName,
    categoryLabel,
    vehicleNo: order.vehicleNo || "",
    expectedDate,
    expectedLabel: expectedDate ? formatDate(expectedDate) : "—",
    deliveryDate,
    deliveryLabel: deliveryDate ? formatDate(deliveryDate) : "—",
    delayDays,
    delayLabel: delayDaysLabel(delayDays),
    acknowledged: isVendorAcknowledged(order),
    receiveStatus: receiveStatus(order),
    orderStatus: order.status || "issued",
    itemCount: items.length,
    itemNames,
    projectNames: [...new Set(projectNames)],
    orderQty,
    ready,
    pending,
    dispatch,
    rework,
    scrap,
    received,
    receivable,
    balance: Math.max(0, round3(orderQty - received)),
    pipeline: challanPipelineStatus(totals, order),
  };
}

function challanPipelineStatus(totals, order) {
  const orderQty = num(totals.orderQty);
  const ready = num(totals.ready);
  const pending = num(totals.pending);
  const rework = num(totals.rework);
  const scrap = num(totals.scrap);
  const dispatch = num(totals.dispatch);
  const received = num(totals.received);
  const receivable = num(totals.receivable);
  if (orderQty > 0 && received >= orderQty - 0.001) return "Fully received";
  if (order?.status === "received") return "Fully received";
  if (!isVendorAcknowledged(order)) return "Awaiting vendor receive";
  if (pending > 0.001) return "With QC";
  if (rework > 0.001) return "Rework open";
  if (scrap > 0.001 && pending <= 0.001 && rework <= 0.001 && receivable <= 0.001) {
    return "Rejected (scrap)";
  }
  if (receivable > 0.001) return "Ready to receive";
  if (dispatch > 0.001 && received < dispatch - 0.001) return "Ready to dispatch";
  if (orderQty > 0 && ready >= orderQty - 0.001) return "Inspection complete";
  if (ready > 0.001) return "In process";
  return "Waiting for vendor qty";
}

function isFullyDelivered(line) {
  return (
    line.orderStatus === "received"
    || (line.orderQty > 0 && line.received >= line.orderQty - 0.001)
  );
}

function isPartialDelivered(line) {
  if (isFullyDelivered(line)) return false;
  return (
    line.orderStatus === "partial"
    || (line.received > 0.001 && line.balance > 0.001)
  );
}

function challanMatchesKpi(row, kpiId) {
  if (kpiId === "total") return true;
  if (kpiId === "waiting_vendor") {
    return !row.acknowledged && !isFullyDelivered(row);
  }
  if (kpiId === "in_process") {
    return (
      row.acknowledged
      && !isFullyDelivered(row)
      && row.received <= 0.001
      && row.pending <= 0.001
      && row.receivable <= 0.001
      && row.rework <= 0.001
    );
  }
  if (kpiId === "pending_qc") return row.pending > 0.001;
  if (kpiId === "ready_dispatch") return row.receivable > 0.001;
  if (kpiId === "partial") return isPartialDelivered(row);
  if (kpiId === "completed") return isFullyDelivered(row);
  if (kpiId === "rework") return row.rework > 0.001;
  if (kpiId === "rejected") return row.scrap > 0.001;
  return true;
}

const KPI_CARDS = [
  {
    id: "total",
    label: "Total Challan",
    tone: "ink",
    hint: "All job order challans",
  },
  {
    id: "waiting_vendor",
    label: "Waiting for Vendor Confirmation",
    tone: "rust",
    hint: "Pending vendor receive",
  },
  {
    id: "in_process",
    label: "In Process",
    tone: "amber",
    hint: "Vendor has received the job order",
  },
  {
    id: "pending_qc",
    label: "Pending QC",
    tone: "amber",
    hint: "Pending on QC",
  },
  {
    id: "ready_dispatch",
    label: "Ready to Dispatch",
    tone: "teal",
    hint: "Ready material available to receive",
  },
  {
    id: "partial",
    label: "Partial Delivered at Factory/Site",
    tone: "amber",
    hint: "Partially received material",
  },
  {
    id: "completed",
    label: "Fully Delivered at Factory/Site",
    tone: "ink",
    hint: "Fully received material",
  },
  {
    id: "rework",
    label: "Rework",
    tone: "rust",
    hint: "Items sent back for rework",
  },
  {
    id: "rejected",
    label: "Reject",
    tone: "rust",
    hint: "Permanently rejected qty",
  },
];

export default function JobOrderDashboard() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [jobType, setJobType] = useState("all");
  const [activeKpi, setActiveKpi] = useState("total");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [colFilters, setColFilters] = useState(EMPTY_COL_FILTERS);
  const [panelKey, setPanelKey] = useState(0);
  const [viewOrder, setViewOrder] = useState(null);
  const [vendorRev, setVendorRev] = useState(0);

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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = unwrapList(await getJobOrderVendors({ active: "true" }));
        setJobOrderVendorsCache(rows);
        if (alive) setVendorRev((n) => n + 1);
      } catch {
        /* keep token matchers */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const challans = useMemo(
    () => orders.map((order) => challanMetrics(order)),
    [orders],
  );

  const categoryScoped = useMemo(() => {
    if (categoryFilter === "all") return challans;
    return challans.filter(
      (row) => vendorMaterialCategory(row.vendorName) === categoryFilter,
    );
  }, [challans, categoryFilter, vendorRev]);

  const vendors = useMemo(() => {
    const names = categoryScoped.map((row) => row.vendorName).filter(Boolean);
    return dedupeVendorNames(names).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [categoryScoped]);

  // Drop vendor pick if it is outside the selected category.
  useEffect(() => {
    if (vendorFilter === "all") return;
    if (!vendors.some((name) => vendorKey(name) === vendorKey(vendorFilter))) {
      setVendorFilter("all");
    }
  }, [vendors, vendorFilter]);

  // Cards + table share this scope (job type from API load, then category + vendor).
  const scopedChallans = useMemo(() => {
    if (vendorFilter === "all") return categoryScoped;
    const key = vendorKey(vendorFilter);
    return categoryScoped.filter((row) => vendorKey(row.vendorName) === key);
  }, [categoryScoped, vendorFilter]);

  const counts = useMemo(() => {
    const out = {};
    for (const card of KPI_CARDS) {
      out[card.id] = scopedChallans.filter((row) =>
        challanMatchesKpi(row, card.id),
      ).length;
    }
    return out;
  }, [scopedChallans, categoryFilter, vendorFilter]);

  const filterScopeLabel = useMemo(() => {
    const parts = [];
    if (jobType !== "all") {
      parts.push(jobType === "fabrication" ? "Fabrication" : "Powder Coating");
    }
    if (categoryFilter !== "all") {
      const cat = VENDOR_MATERIAL_CATEGORIES.find((c) => c.id === categoryFilter);
      parts.push(cat?.label || categoryFilter);
    }
    if (vendorFilter !== "all") parts.push(vendorFilter);
    return parts.length ? parts.join(" · ") : "";
  }, [jobType, categoryFilter, vendorFilter]);

  const q = normalize(search);

  const filteredChallans = useMemo(() => {
    let list = scopedChallans;
    if (q) {
      list = list.filter((row) => {
        const hay = normalize(
          [
            row.srNo,
            row.sendFromName,
            row.sendToName,
            row.vendorName,
            row.categoryLabel,
            row.dcDateLabel,
            row.expectedLabel,
            row.deliveryLabel,
            row.delayLabel,
            row.vehicleNo,
            row.pipeline,
            ...(row.itemNames || []),
            ...(row.projectNames || []),
          ].join(" "),
        );
        return hay.includes(q);
      });
    }
    if (activeKpi !== "total") {
      list = list.filter((row) => challanMatchesKpi(row, activeKpi));
    }
    if (colFilters.challan.length) {
      list = list.filter((row) => matchesColFilter(colFilters.challan, row.srNo));
    }
    if (colFilters.sendFrom.length) {
      list = list.filter((row) => matchesColFilter(colFilters.sendFrom, row.sendFromName));
    }
    if (colFilters.sendTo.length) {
      list = list.filter((row) => matchesColFilter(colFilters.sendTo, row.sendToName));
    }
    if (colFilters.dcDate.length) {
      list = list.filter((row) => matchesColFilter(colFilters.dcDate, row.dcDateLabel));
    }
    if (colFilters.expected.length) {
      list = list.filter((row) => matchesColFilter(colFilters.expected, row.expectedLabel));
    }
    if (colFilters.delivery.length) {
      list = list.filter((row) => matchesColFilter(colFilters.delivery, row.deliveryLabel));
    }
    if (colFilters.delay.length) {
      list = list.filter((row) => matchesColFilter(colFilters.delay, row.delayLabel));
    }
    if (colFilters.orderQty.length) {
      list = list.filter((row) => matchesColFilter(colFilters.orderQty, formatQty(row.orderQty)));
    }
    if (colFilters.ready.length) {
      list = list.filter((row) => matchesColFilter(colFilters.ready, formatQty(row.ready)));
    }
    if (colFilters.dispatch.length) {
      list = list.filter((row) =>
        matchesColFilter(colFilters.dispatch, row.dispatch ? formatQty(row.dispatch) : "—"),
      );
    }
    if (colFilters.received.length) {
      list = list.filter((row) => matchesColFilter(colFilters.received, formatQty(row.received)));
    }
    if (colFilters.pipeline.length) {
      list = list.filter((row) => matchesColFilter(colFilters.pipeline, row.pipeline));
    }
    return list;
  }, [scopedChallans, q, activeKpi, colFilters]);

  const colOpts = useMemo(() => {
    const base = scopedChallans.filter((row) => {
      if (activeKpi !== "total" && !challanMatchesKpi(row, activeKpi)) return false;
      return true;
    });
    return {
      challan: base.map((row) => row.srNo),
      sendFrom: base.map((row) => row.sendFromName),
      sendTo: base.map((row) => row.sendToName),
      dcDate: base.map((row) => row.dcDateLabel),
      expected: base.map((row) => row.expectedLabel),
      delivery: base.map((row) => row.deliveryLabel),
      delay: base.map((row) => row.delayLabel),
      orderQty: base.map((row) => formatQty(row.orderQty)),
      ready: base.map((row) => formatQty(row.ready)),
      dispatch: base.map((row) => (row.dispatch ? formatQty(row.dispatch) : "—")),
      received: base.map((row) => formatQty(row.received)),
      pipeline: base.map((row) => row.pipeline),
    };
  }, [scopedChallans, activeKpi]);

  function selectKpi(id) {
    // Second click on the same card clears the filter (back to all challans).
    const next = id === activeKpi ? "total" : id;
    if (next === activeKpi) return;
    setActiveKpi(next);
    setPanelKey((k) => k + 1);
  }

  function openOrder(row) {
    const found = orders.find((o) => String(o._id) === String(row.orderId));
    if (found) {
      setViewOrder(found);
      return;
    }
    setViewOrder({
      _id: row.orderId,
      srNo: row.srNo,
      date: row.date,
      jobType: row.jobType,
      vendorName: row.vendorName,
      vendorExpectedDate: row.expectedDate,
      status: row.orderStatus,
      items: [],
    });
  }

  const activeLabel =
    KPI_CARDS.find((c) => c.id === activeKpi)?.label || "Total Challan";

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
          display: grid;
          grid-template-columns: minmax(220px, 1.6fr) repeat(3, minmax(150px, 0.85fr));
          gap: 12px 14px;
          align-items: end;
          width: 100%;
          margin-bottom: 16px;
          padding: 14px 16px;
          box-sizing: border-box;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 12px;
          box-shadow: 0 1px 2px rgba(28, 26, 22, 0.03);
        }
        .jod-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
          width: 100%;
        }
        .jod-field.grow { min-width: 0; }
        .jod-field label {
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #8a8270;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .jod-field input,
        .jod-field select {
          font: inherit;
          font-size: 13.5px;
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 0 12px;
          background: #fff;
          color: var(--ink);
          height: 40px;
          min-height: 40px;
          width: 100%;
          box-sizing: border-box;
          appearance: none;
          -webkit-appearance: none;
          line-height: 1.2;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .jod-field select {
          padding-right: 32px;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%238a8270' d='M1 1l5 5 5-5'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          cursor: pointer;
        }
        .jod-field input::placeholder {
          color: #a39c8e;
        }
        .jod-field input:hover,
        .jod-field select:hover {
          border-color: #c9c1ad;
        }
        .jod-field input:focus,
        .jod-field select:focus {
          outline: none;
          border-color: var(--teal);
          box-shadow: 0 0 0 2px rgba(31, 92, 82, 0.12);
        }
        .jod-scope {
          margin: 0 0 10px;
          font-size: 13px;
          color: var(--text-2);
          line-height: 1.4;
        }
        .jod-scope strong {
          color: var(--ink);
          font-weight: 650;
        }
        .jod-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
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
          padding: 14px 14px 14px 16px;
          cursor: pointer;
          font-family: inherit;
          color: inherit;
          overflow: visible;
          min-height: 108px;
          width: 100%;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 6px;
          transition: border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
        }
        .jod-card::before {
          content: "";
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 3px;
          border-radius: 10px 0 0 10px;
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
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: #7d7666;
          line-height: 1.4;
          white-space: normal;
          overflow: visible;
          word-break: break-word;
        }
        .jod-card .value {
          font-size: 26px;
          font-weight: 700;
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
          color: var(--ink);
        }
        .jod-card.tone-teal .value { color: var(--teal-dark); }
        .jod-card.tone-rust .value { color: var(--rust); }
        .jod-card.tone-amber .value { color: #9a3412; }
        .jod-card .hint {
          margin-top: auto;
          font-size: 12px;
          color: var(--text-2);
          line-height: 1.35;
          white-space: normal;
        }
        .jod-panel {
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #fff;
          overflow: visible;
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
          max-width: 100%;
          overflow-x: auto;
          overflow-y: visible;
          -webkit-overflow-scrolling: touch;
          border-top: 1px solid var(--line);
        }
        .jod-table {
          width: max-content;
          min-width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: auto;
          font-size: 12.5px;
        }
        .jod-table th {
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #7a7466;
          padding: 11px 10px;
          border-bottom: 1px solid #e4dfd2;
          background: #f7f4ec;
          white-space: normal;
          line-height: 1.3;
          position: sticky;
          top: 0;
          z-index: 2;
          vertical-align: middle;
        }
        .jod-table td {
          padding: 11px 10px;
          border-bottom: 1px solid #efeae0;
          vertical-align: middle;
          color: var(--ink);
        }
        .jod-table tr:last-child td { border-bottom: none; }
        .jod-table tbody tr { transition: background 0.12s ease; }
        .jod-table tbody tr:hover { background: #fbfaf6; }
        .jod-table .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          font-weight: 600;
          color: var(--ink);
        }
        .jod-table .jod-date {
          font-variant-numeric: tabular-nums;
          font-size: 12px;
          color: #3f3a32;
          letter-spacing: 0.01em;
          white-space: nowrap;
        }
        .jod-table .jod-challan {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }
        .jod-table .jod-vendor {
          font-weight: 600;
          white-space: normal;
          min-width: 140px;
          max-width: 220px;
          line-height: 1.35;
        }
        .jod-clip {
          overflow: visible;
          text-overflow: unset;
          white-space: normal;
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
          max-width: none;
          overflow: visible;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.01em;
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid transparent;
          background: #f0eee8;
          color: #5c5648;
          white-space: normal;
          line-height: 1.3;
          text-align: left;
        }
        .jod-pill.warn {
          background: #fff4ec;
          border-color: #f0d2bc;
          color: #9a3412;
        }
        .jod-pill.amber {
          background: #fff8e8;
          border-color: #edd9a8;
          color: #8a5a10;
        }
        .jod-pill.ok {
          background: #eef5f3;
          border-color: #c5ddd6;
          color: #16483f;
        }
        .jod-pill.teal {
          background: #eef6f5;
          border-color: #c3dcd7;
          color: #143e38;
        }
        .jod-table col.jod-c-challan { width: 88px; }
        .jod-table col.jod-c-party { width: 150px; }
        .jod-table col.jod-c-date { width: 100px; }
        .jod-table col.jod-c-delay { width: 96px; }
        .jod-table col.jod-c-qty { width: 68px; }
        .jod-table col.jod-c-status { width: 140px; }
        .jod-table col.jod-c-act { width: 96px; }
        .jod-table .jod-party {
          font-weight: 600;
          white-space: normal;
          min-width: 110px;
          max-width: 180px;
          line-height: 1.35;
        }
        .jod-table th .col-filter-btn,
        .jod-table th button {
          vertical-align: middle;
        }
        .jod-table td.jod-status {
          min-width: 130px;
        }
        .jod-delay {
          display: inline-flex;
          align-items: center;
          font-size: 11px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          padding: 3px 7px;
          border-radius: 6px;
          background: #f0eee8;
          color: #5c5648;
          white-space: nowrap;
        }
        .jod-delay-late {
          background: #fff1eb;
          color: var(--rust);
        }
        .jod-delay-early {
          background: #eef6f3;
          color: var(--teal-dark, var(--teal));
        }
        .jod-delay-ok {
          background: #eef5f3;
          color: #16483f;
        }
        /* Keep Action + View fully visible while scrolling wide tables. */
        .jod-table th.jod-act,
        .jod-table td.jod-act {
          position: sticky;
          right: 0;
          z-index: 3;
          min-width: 96px;
          width: 96px;
          box-sizing: border-box;
          text-align: center;
          padding: 10px 12px;
          white-space: nowrap;
          background: #fff;
          box-shadow: -6px 0 10px rgba(28, 26, 22, 0.06);
        }
        .jod-table th.jod-act {
          z-index: 4;
          background: #f7f4ec;
        }
        .jod-table tbody tr:hover td.jod-act {
          background: #fbfaf6;
        }
        .jod-table td.jod-act .btn {
          white-space: nowrap;
        }
        @media (max-width: 1100px) {
          .jod-toolbar {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          }
          .jod-field.grow { grid-column: 1 / -1; }
          .jod-grid { grid-template-columns: repeat(2, minmax(200px, 1fr)); }
          .jod-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 640px) {
          .jod-toolbar {
            grid-template-columns: 1fr;
            padding: 12px;
          }
          .jod-field.grow { grid-column: auto; }
          .jod-grid { grid-template-columns: 1fr; }
          .jod-stats { grid-template-columns: 1fr; }
          .jod-card { min-height: 0; }
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
        </div>
      </div>

      {err && <p className="msg err" style={{ marginBottom: 12 }}>{err}</p>}

      {viewOrder && (
        <JobOrderViewModal
          order={viewOrder}
          onClose={() => setViewOrder(null)}
        />
      )}

      <div className="jod-toolbar">
        <div className="jod-field grow">
          <label htmlFor="jod-search">Search challan / vendor / item</label>
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
              setColFilters(EMPTY_COL_FILTERS);
              setPanelKey((k) => k + 1);
            }}
          >
            <option value="all">All types</option>
            <option value="powder_coating">Powder Coating</option>
            <option value="fabrication">Fabrication</option>
          </select>
        </div>
        <div className="jod-field">
          <label htmlFor="jod-category">Category</label>
          <select
            id="jod-category"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setVendorFilter("all");
              setActiveKpi("total");
              setColFilters(EMPTY_COL_FILTERS);
              setPanelKey((k) => k + 1);
            }}
          >
            <option value="all">All categories</option>
            {VENDOR_MATERIAL_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.label}</option>
            ))}
          </select>
        </div>
        <div className="jod-field">
          <label htmlFor="jod-vendor">Vendor</label>
          <select
            id="jod-vendor"
            value={vendorFilter}
            onChange={(e) => {
              setVendorFilter(e.target.value);
              setActiveKpi("total");
              setColFilters(EMPTY_COL_FILTERS);
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

      {filterScopeLabel ? (
        <p className="jod-scope">
          Cards &amp; table filtered by <strong>{filterScopeLabel}</strong>
        </p>
      ) : null}

      <div className="jod-grid" key={`kpi-${categoryFilter}-${vendorFilter}-${jobType}`}>
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

      <div className="jod-panel">
        <div className="jod-panel-head">
          <div>
            <h3>
              {q ? "Matching challans" : activeLabel}
              <span className="pill-count">
                {filteredChallans.length} challan{filteredChallans.length === 1 ? "" : "s"}
              </span>
            </h3>
          </div>
        </div>
        <div key={`challans-${panelKey}`} className="jod-panel-body">
          {loading ? (
            <div className="jod-empty">Loading…</div>
          ) : filteredChallans.length === 0 ? (
            <div className="jod-empty">No challans in this view.</div>
          ) : (
            <div className="jod-tablewrap">
              <table className="jod-table">
                <colgroup>
                  <col className="jod-c-challan" />
                  <col className="jod-c-party" />
                  <col className="jod-c-party" />
                  <col className="jod-c-date" />
                  <col className="jod-c-date" />
                  <col className="jod-c-date" />
                  <col className="jod-c-delay" />
                  <col className="jod-c-qty" />
                  <col className="jod-c-qty" />
                  <col className="jod-c-qty" />
                  <col className="jod-c-qty" />
                  <col className="jod-c-status" />
                  <col className="jod-c-act" />
                </colgroup>
                <thead>
                  <tr>
                    <ThFilter
                      label="Challan"
                      values={colOpts.challan}
                      selected={colFilters.challan}
                      onChange={(v) => setColFilters((f) => ({ ...f, challan: v }))}
                    />
                    <ThFilter
                      label="Send From"
                      values={colOpts.sendFrom}
                      selected={colFilters.sendFrom}
                      onChange={(v) => setColFilters((f) => ({ ...f, sendFrom: v }))}
                    />
                    <ThFilter
                      label="Send To"
                      values={colOpts.sendTo}
                      selected={colFilters.sendTo}
                      onChange={(v) => setColFilters((f) => ({ ...f, sendTo: v }))}
                    />
                    <ThFilter
                      label="Dc Date"
                      values={colOpts.dcDate}
                      selected={colFilters.dcDate}
                      onChange={(v) => setColFilters((f) => ({ ...f, dcDate: v }))}
                    />
                    <ThFilter
                      label="Expected Date"
                      values={colOpts.expected}
                      selected={colFilters.expected}
                      onChange={(v) => setColFilters((f) => ({ ...f, expected: v }))}
                    />
                    <ThFilter
                      label="Delivery Date"
                      values={colOpts.delivery}
                      selected={colFilters.delivery}
                      onChange={(v) => setColFilters((f) => ({ ...f, delivery: v }))}
                    />
                    <ThFilter
                      label="Delay Day"
                      values={colOpts.delay}
                      selected={colFilters.delay}
                      onChange={(v) => setColFilters((f) => ({ ...f, delay: v }))}
                    />
                    <ThFilter
                      label="Order"
                      className="num"
                      values={colOpts.orderQty}
                      selected={colFilters.orderQty}
                      onChange={(v) => setColFilters((f) => ({ ...f, orderQty: v }))}
                    />
                    <ThFilter
                      label="Ready"
                      className="num"
                      values={colOpts.ready}
                      selected={colFilters.ready}
                      onChange={(v) => setColFilters((f) => ({ ...f, ready: v }))}
                    />
                    <ThFilter
                      label="Disp"
                      className="num"
                      values={colOpts.dispatch}
                      selected={colFilters.dispatch}
                      onChange={(v) => setColFilters((f) => ({ ...f, dispatch: v }))}
                    />
                    <ThFilter
                      label="Recv"
                      className="num"
                      values={colOpts.received}
                      selected={colFilters.received}
                      onChange={(v) => setColFilters((f) => ({ ...f, received: v }))}
                    />
                    <ThFilter
                      label="Status"
                      values={colOpts.pipeline}
                      selected={colFilters.pipeline}
                      onChange={(v) => setColFilters((f) => ({ ...f, pipeline: v }))}
                    />
                    <th className="jod-act">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChallans.map((row) => {
                    let pill = "";
                    if (
                      row.pipeline.includes("Awaiting")
                      || row.pipeline.includes("Rework")
                      || row.pipeline.includes("Rejected")
                    ) pill = "warn";
                    else if (row.pipeline.includes("QC") || row.pipeline.includes("Partial")) pill = "amber";
                    else if (row.pipeline.includes("receive") || row.pipeline.includes("dispatch")) pill = "teal";
                    else if (row.pipeline.includes("complete") || row.pipeline.includes("Fully")) pill = "ok";
                    const rowTitle = [
                      jobTypeLabel(row.jobType),
                      row.itemCount ? `${row.itemCount} item${row.itemCount === 1 ? "" : "s"}` : null,
                      ...(row.itemNames || []).slice(0, 4),
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    let delayClass = "jod-delay";
                    if (row.delayDays != null && row.delayDays > 0) delayClass += " jod-delay-late";
                    else if (row.delayDays != null && row.delayDays < 0) delayClass += " jod-delay-early";
                    else if (row.delayDays === 0) delayClass += " jod-delay-ok";
                    return (
                      <tr key={row.key} title={rowTitle}>
                        <td className="mono jod-clip jod-challan">{row.srNo}</td>
                        <td className="jod-clip jod-party" title={row.sendFromName}>{row.sendFromName}</td>
                        <td className="jod-clip jod-party" title={row.sendToName}>{row.sendToName}</td>
                        <td className="jod-clip jod-date">{row.dcDateLabel}</td>
                        <td className="jod-clip jod-date">{row.expectedLabel}</td>
                        <td className="jod-clip jod-date">{row.deliveryLabel}</td>
                        <td className="jod-clip">
                          {row.delayLabel === "—"
                            ? "—"
                            : <span className={delayClass}>{row.delayLabel}</span>}
                        </td>
                        <td className="num">{formatQty(row.orderQty)}</td>
                        <td className="num">{formatQty(row.ready)}</td>
                        <td className="num">{row.dispatch ? formatQty(row.dispatch) : "—"}</td>
                        <td className="num">{formatQty(row.received)}</td>
                        <td className="jod-status" title={row.pipeline}>
                          <span className={`jod-pill${pill ? ` ${pill}` : ""}`}>{row.pipeline}</span>
                        </td>
                        <td className="jod-act">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => openOrder(row)}
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
