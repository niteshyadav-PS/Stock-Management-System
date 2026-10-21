import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { acknowledgeJobOrder, getJobOrders, unwrapList, updateJobOrderQcStage } from "../api/api";
import { useAuth } from "../context/AuthContext";
import { todayStr } from "../utils/helpers";
import Pagination from "../components/Pagination";
import useClientPagination from "../hooks/useClientPagination";
import { vendorNamesForJobType } from "../utils/jobOrderVendors";

function isVendorAcknowledged(order) {
  return !!String(order?.vendorExpectedDate || "").trim();
}

function orderJobType(order) {
  return order?.jobType === "fabrication" ? "fabrication" : "powder_coating";
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
  if (n === null || n === undefined || n === "") return "—";
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

function reworkRemarks(item) {
  return (item?.qcRounds || [])
    .filter((round) => round.status === "inspected" && Number(round.rejectedQty) > 0 && String(round.reworkRemark || "").trim())
    .map((round) => ({
      qty: Math.round((Number(round.rejectedQty) || 0) * 1000) / 1000,
      remark: String(round.reworkRemark || "").trim(),
    }));
}

function skipRemarks(item) {
  return (item?.qcRounds || [])
    .filter((round) => round.skipped && String(round.skipRemark || "").trim())
    .map((round) => ({
      qty: Math.round((Number(round.dispatchQty) || Number(round.readyQty) || 0) * 1000) / 1000,
      remark: String(round.skipRemark || "").trim(),
    }));
}

function toPercent(qty, orderQty) {
  const total = Number(orderQty);
  if (!total) return 0;
  return Math.round((Number(qty) / total) * 10000) / 100;
}

function qtyWithPercent(qty, orderQty) {
  const n = Number(qty) || 0;
  if (!n) return "—";
  return `${formatQty(n)} (${toPercent(n, orderQty)}%)`;
}

function pendingRounds(item) {
  return (item?.qcRounds || []).filter((round) => round.status === "pending");
}

function pendingReadyQty(item) {
  const total = pendingRounds(item).reduce((sum, round) => sum + (Number(round.readyQty) || 0), 0);
  return Math.round(total * 1000) / 1000;
}

function inspectedTotals(item) {
  return (item?.qcRounds || []).reduce(
    (sum, round) => {
      if (round.status !== "inspected") return sum;
      return {
        dispatch: sum.dispatch + (Number(round.dispatchQty) || 0),
        rejected: sum.rejected + (Number(round.rejectedQty) || 0),
      };
    },
    { dispatch: 0, rejected: 0 },
  );
}

function isFullySent(item) {
  const orderQty = Number(item?.qty) || 0;
  return orderQty > 0 && submittedReadyQty(item) >= orderQty - 0.001;
}

function flowState(item) {
  if (pendingRounds(item).length) return "qc_pending";
  if (isFullySent(item) && (item?.qcRounds || []).some((round) => round.status === "inspected"))
    return "inspected";
  if ((item?.qcRounds || []).some((round) => round.status === "inspected")) return "partial";
  return "in_process";
}

export default function VendorQc({ embedded = false, jobType = null, onUpdated }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const focusHandledRef = useRef("");
  const pendingFocusIdRef = useRef(null);
  const isAdmin = user?.role === "admin";
  const isVendor = user?.role === "vendor";
  const isQc = user?.role === "quality";
  const canSetReady = isVendor || isAdmin;
  const canInspect = isQc || isAdmin;
  const showVendor = isAdmin || isQc;
  // Vendor: only their assigned type. QC/store-style pages: lock to the sidebar page type.
  const vendorUserType =
    isVendor
      ? (user?.vendorJobType === "fabrication" ? "fabrication" : "powder_coating")
      : null;
  const lockedJobType = isVendor
    ? vendorUserType
    : (jobType === "fabrication" || jobType === "powder_coating" ? jobType : null);
  const showTypeTabs = !lockedJobType;
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  // Default All so each QC page shows challans grouped by vendor right away.
  const [stageFilter, setStageFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState(lockedJobType || "all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [msg, setMsg] = useState({ text: "", ok: true });
  const [rowErrors, setRowErrors] = useState({});
  const [busyKey, setBusyKey] = useState("");
  const [drafts, setDrafts] = useState({});
  const [openChallans, setOpenChallans] = useState({});
  const [editRow, setEditRow] = useState(null);
  const [ackOrder, setAckOrder] = useState(null);
  const [ackExpectedDate, setAckExpectedDate] = useState(todayStr());
  const [ackNote, setAckNote] = useState("");
  const [ackSaving, setAckSaving] = useState(false);
  const [ackErr, setAckErr] = useState("");
  // QC dialogs: check one item | skip one item | check all pending on a challan
  const [qcDialog, setQcDialog] = useState(null); // { type, orderId, itemIndex? }
  const [qcDialogErr, setQcDialogErr] = useState("");
  const [qcDialogBusy, setQcDialogBusy] = useState(false);
  const [bulkDrafts, setBulkDrafts] = useState({}); // { [itemIndex]: { dispatch, rejected, remark } }

  useEffect(() => {
    if (lockedJobType) setTypeFilter(lockedJobType);
    setVendorFilter("all");
    setOpenChallans({});
    setEditRow(null);
    setQcDialog(null);
    setStageFilter("all");
  }, [lockedJobType]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Vendor API already scopes by company + job type; still pass jobType for clarity.
      // QC loads both (no jobType). Embedded admin loads the page type only.
      const params = lockedJobType ? { jobType: lockedJobType } : {};
      const list = unwrapList(await getJobOrders(params));
      setOrders(list);
      if (isVendor) {
        const pendingAck = list.find((order) => !isVendorAcknowledged(order));
        if (pendingAck) {
          setAckOrder(pendingAck);
          setAckExpectedDate(todayStr());
          setAckNote("");
          setAckErr("");
        } else {
          setAckOrder(null);
        }
      }
    } catch (err) {
      setMsg({ text: err.message, ok: false });
    } finally {
      setLoading(false);
    }
  }, [isVendor, lockedJobType]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!editRow && !ackOrder && !qcDialog) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [editRow, ackOrder, qcDialog]);

  function openQcCheck(order, itemIndex) {
    const item = order?.items?.[itemIndex];
    if (!item || !pendingRounds(item).length) {
      setMsg({ text: "Nothing is waiting for QC on this material yet.", ok: false });
      return;
    }
    const key = `${order._id}-${itemIndex}`;
    setRowError(key, "");
    setDraft(key, { dispatch: String(pendingReadyQty(item)), rejected: "", remark: "" });
    setQcDialogErr("");
    setQcDialog({ type: "check", orderId: order._id, itemIndex });
  }

  function openQcSkip(order, itemIndex) {
    const item = order?.items?.[itemIndex];
    const orderQty = Number(item?.qty) || 0;
    const remaining = Math.round((orderQty - submittedReadyQty(item)) * 1000) / 1000;
    if (!pendingRounds(item).length && remaining <= 0.001) {
      setMsg({ text: "Nothing left to skip on this material.", ok: false });
      return;
    }
    const key = `${order._id}-${itemIndex}`;
    setRowError(key, "");
    setDraft(key, { skipRemark: "" });
    setQcDialogErr("");
    setQcDialog({ type: "skip", orderId: order._id, itemIndex });
  }

  function openQcCheckAll(order) {
    const items = order.items || [];
    if (!items.length) {
      setMsg({ text: "This challan has no items.", ok: false });
      return;
    }
    const pendingIndexes = items
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => pendingRounds(item).length > 0);
    if (!pendingIndexes.length) {
      setMsg({ text: "No items are waiting for QC on this challan.", ok: false });
      return;
    }
    const next = {};
    for (const { item, itemIndex } of pendingIndexes) {
      next[itemIndex] = {
        dispatch: String(pendingReadyQty(item)),
        rejected: "",
        remark: "",
      };
    }
    setBulkDrafts(next);
    setQcDialogErr("");
    setOpenChallans((prev) => ({ ...prev, [order._id]: true }));
    setQcDialog({ type: "check_all", orderId: order._id });
  }

  function orderPendingQcCount(order) {
    return (order?.items || []).filter((item) => pendingRounds(item).length > 0).length;
  }

  async function submitVendorAck(e) {
    e?.preventDefault?.();
    if (!ackOrder) return;
    setAckErr("");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ackExpectedDate || "").trim())) {
      setAckErr("Expected date is compulsory.");
      return;
    }
    setAckSaving(true);
    try {
      await acknowledgeJobOrder(ackOrder._id, {
        expectedDate: ackExpectedDate,
        note: ackNote,
      });
      setMsg({ text: `Challan ${ackOrder.srNo} received. Expected date saved.`, ok: true });
      setAckOrder(null);
      await load();
      if (onUpdated) onUpdated();
    } catch (err) {
      setAckErr(err.message || "Could not save.");
    } finally {
      setAckSaving(false);
    }
  }

  const rows = useMemo(() => {
    const list = [];
    for (const order of orders) {
      (order.items || []).forEach((item, itemIndex) => {
        list.push({
          key: `${order._id}-${itemIndex}`,
          order,
          item,
          itemIndex,
          stage: flowState(item),
        });
      });
    }
    return list;
  }, [orders]);

  const vendorOptions = useMemo(() => {
    const names = new Set();
    // Preset companies for this page type so QC always sees the Vendor filter.
    const presetType =
      lockedJobType
      || (typeFilter !== "all" ? typeFilter : null);
    if (presetType === "powder_coating" || presetType === "fabrication") {
      for (const name of vendorNamesForJobType(presetType)) names.add(name);
    } else {
      for (const name of vendorNamesForJobType("powder_coating")) names.add(name);
      for (const name of vendorNamesForJobType("fabrication")) names.add(name);
    }
    for (const order of orders) {
      if (lockedJobType && orderJobType(order) !== lockedJobType) continue;
      const name = String(order.vendorName || "").trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [orders, lockedJobType, typeFilter]);

  useEffect(() => {
    if (
      vendorFilter !== "all"
      && !vendorOptions.some((n) => n.toLowerCase() === vendorFilter.toLowerCase())
    ) {
      setVendorFilter("all");
    }
  }, [vendorOptions, vendorFilter]);

  const visible = useMemo(() => {
    let list = stageFilter === "all" ? rows : rows.filter((row) => row.stage === stageFilter);
    if (!lockedJobType && typeFilter !== "all") {
      list = list.filter((row) => orderJobType(row.order) === typeFilter);
    }
    if (showVendor && vendorFilter !== "all") {
      list = list.filter(
        (row) => String(row.order.vendorName || "").trim().toLowerCase() === vendorFilter.toLowerCase(),
      );
    }
    return list;
  }, [rows, stageFilter, showVendor, vendorFilter, typeFilter, lockedJobType]);

  const vendorOrders = useMemo(() => {
    const grouped = new Map();
    for (const row of visible) {
      const id = row.order._id;
      if (!grouped.has(id)) grouped.set(id, { order: row.order, rows: [] });
      grouped.get(id).rows.push(row);
    }
    const list = [...grouped.values()];
    if (!showVendor) return list;
    return list.sort((a, b) => {
      const va = String(a.order.vendorName || "").localeCompare(
        String(b.order.vendorName || ""),
        undefined,
        { sensitivity: "base" },
      );
      if (va !== 0) return va;
      return String(b.order.date || "").localeCompare(String(a.order.date || ""));
    });
  }, [visible, showVendor]);

  const vendorGroups = useMemo(() => {
    if (!showVendor) return null;
    const grouped = new Map();
    for (const entry of vendorOrders) {
      const name = String(entry.order.vendorName || "").trim() || "Unknown vendor";
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name).push(entry);
    }
    return [...grouped.entries()].map(([vendorName, challans]) => ({ vendorName, challans }));
  }, [vendorOrders, showVendor]);

  const linePage = useClientPagination(visible, 25);
  const orderPage = useClientPagination(vendorOrders, 8);
  const vendorGroupPage = useClientPagination(vendorGroups || [], 6);
  const showChallans = isVendor || isQc || isAdmin;
  const pageState = showVendor && showChallans
    ? vendorGroupPage
    : showChallans
    ? orderPage
    : linePage;
  const { pageItems, page, pageSize, total, setPage, setPageSize } = pageState;

  // Open a challan (and optionally receive modal) from Vendor Dashboard.
  useEffect(() => {
    const focusChallan = location.state?.focusChallan;
    const openReceive = !!location.state?.openReceive;
    if (!focusChallan || loading || !showChallans || showVendor) return;
    if (focusHandledRef.current === String(focusChallan)) return;
    const idx = vendorOrders.findIndex(
      (entry) => String(entry.order.srNo) === String(focusChallan),
    );
    if (idx < 0) return;
    focusHandledRef.current = String(focusChallan);
    const target = vendorOrders[idx].order;
    const orderId = target._id;
    pendingFocusIdRef.current = orderId;
    setOpenChallans((prev) => ({ ...prev, [orderId]: true }));
    if (openReceive && isVendor && !isVendorAcknowledged(target)) {
      setAckOrder(target);
      setAckExpectedDate(todayStr());
      setAckNote("");
      setAckErr("");
    }
    const targetPage = Math.floor(idx / pageSize) + 1;
    if (page !== targetPage) setPage(targetPage);
    navigate(location.pathname, { replace: true, state: {} });
  }, [
    isVendor,
    loading,
    location.pathname,
    location.state,
    navigate,
    page,
    pageSize,
    setPage,
    showChallans,
    showVendor,
    vendorOrders,
  ]);

  useEffect(() => {
    const orderId = pendingFocusIdRef.current;
    if (!orderId || loading) return;
    const el = document.getElementById(`vq-challan-${orderId}`);
    if (!el) return;
    pendingFocusIdRef.current = null;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading, pageItems, openChallans]);

  function draftFor(row) {
    return drafts[row.key] || {};
  }

  function setDraft(key, patch) {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function setRowError(key, text) {
    setRowErrors((prev) => ({ ...prev, [key]: text || "" }));
  }

  async function submit(row, action, body, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyKey(row.key);
    setMsg({ text: "", ok: true });
    try {
      await updateJobOrderQcStage(row.order._id, { itemIndex: row.itemIndex, action, ...body });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.key];
        return next;
      });
      await load();
      if (onUpdated) onUpdated();
      if (isAdmin) setEditRow(null);
      if (action === "inspect" || action === "skip_qc") {
        setQcDialog(null);
        setQcDialogErr("");
      }
      setMsg({
        text: action === "inspect"
          ? "QC saved. Dispatch and rework quantities are recorded."
          : action === "skip_qc"
          ? "QC skipped. Quantity marked ready to dispatch."
          : action === "send_rework"
          ? "Rework sent for QC."
          : "Ready quantity sent for QC.",
        ok: true,
      });
    } catch (err) {
      setMsg({ text: err.message, ok: false });
      setQcDialogErr(err.message || "Could not save.");
    } finally {
      setBusyKey("");
    }
  }

  async function saveQcCheckFromDialog(row) {
    const draft = draftFor(row);
    const sliceQty = pendingReadyQty(row.item);
    const orderQty = Number(row.item.qty) || 0;
    const dispatch = draft.dispatch === "" || draft.dispatch == null ? 0 : Number(draft.dispatch);
    const rejected = draft.rejected === "" || draft.rejected == null ? 0 : Number(draft.rejected);
    const remark = String(draft.remark || "").trim();
    setQcDialogErr("");
    if (!Number.isFinite(dispatch) || dispatch < 0 || !Number.isFinite(rejected) || rejected < 0) {
      setQcDialogErr("Enter dispatch and rework quantities.");
      return;
    }
    const inspected = Math.round((dispatch + rejected) * 1000) / 1000;
    if (inspected <= 0) {
      setQcDialogErr("Enter the quantity you inspected.");
      return;
    }
    if (rejected > 0.001 && !remark) {
      setQcDialogErr("Enter a remark for the rework quantity.");
      return;
    }
    if (dispatch - sliceQty > 0.001 || rejected - sliceQty > 0.001 || inspected - sliceQty > 0.001) {
      setQcDialogErr(`Cannot update more than the quantity (${formatQty(sliceQty)}).`);
      return;
    }
    const alreadyDispatch = inspectedTotals(row.item).dispatch;
    const dispatchRoom = Math.round((orderQty - alreadyDispatch) * 1000) / 1000;
    if (dispatch - dispatchRoom > 0.001) {
      setQcDialogErr(`Cannot update more than the quantity (${formatQty(Math.max(0, dispatchRoom))}).`);
      return;
    }
    await submit(row, "inspect", {
      dispatchQty: dispatch,
      rejectedQty: rejected,
      reworkRemark: remark,
    });
  }

  async function saveQcSkipFromDialog(row) {
    const draft = draftFor(row);
    const skipRemark = String(draft.skipRemark || "").trim();
    setQcDialogErr("");
    if (!skipRemark) {
      setQcDialogErr("Enter a remark explaining why QC is skipped.");
      return;
    }
    const pending = pendingRounds(row.item).length;
    const orderQty = Number(row.item.qty) || 0;
    const remaining = Math.round((orderQty - submittedReadyQty(row.item)) * 1000) / 1000;
    const qtyNote = pending ? formatQty(pendingReadyQty(row.item)) : formatQty(remaining);
    await submit(
      row,
      "skip_qc",
      { skipRemark },
      `Skip QC for ${qtyNote} ${row.item.unit || "NOS"}? It will be marked ready to dispatch.\n\nReason: ${skipRemark}`,
    );
  }

  async function saveQcCheckAllFromDialog(order) {
    const pendingItems = (order.items || [])
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => pendingRounds(item).length > 0);
    setQcDialogErr("");
    for (const { item, itemIndex } of pendingItems) {
      const d = bulkDrafts[itemIndex] || {};
      const sliceQty = pendingReadyQty(item);
      const orderQty = Number(item.qty) || 0;
      const dispatch = d.dispatch === "" || d.dispatch == null ? 0 : Number(d.dispatch);
      const rejected = d.rejected === "" || d.rejected == null ? 0 : Number(d.rejected);
      const remark = String(d.remark || "").trim();
      const inspected = Math.round((dispatch + rejected) * 1000) / 1000;
      if (!Number.isFinite(dispatch) || dispatch < 0 || !Number.isFinite(rejected) || rejected < 0 || inspected <= 0) {
        setQcDialogErr(`${item.description}: enter dispatch / rework quantities.`);
        return;
      }
      if (rejected > 0.001 && !remark) {
        setQcDialogErr(`${item.description}: remark required for rework.`);
        return;
      }
      if (dispatch - sliceQty > 0.001 || rejected - sliceQty > 0.001 || inspected - sliceQty > 0.001) {
        setQcDialogErr(`${item.description}: cannot update more than ${formatQty(sliceQty)}.`);
        return;
      }
      const dispatchRoom = Math.round((orderQty - inspectedTotals(item).dispatch) * 1000) / 1000;
      if (dispatch - dispatchRoom > 0.001) {
        setQcDialogErr(`${item.description}: cannot update more than ${formatQty(Math.max(0, dispatchRoom))}.`);
        return;
      }
    }
    if (!window.confirm(`Save QC for ${pendingItems.length} item${pendingItems.length === 1 ? "" : "s"} on challan ${order.srNo}?`)) {
      return;
    }
    setQcDialogBusy(true);
    setMsg({ text: "", ok: true });
    try {
      for (const { itemIndex } of pendingItems) {
        const d = bulkDrafts[itemIndex] || {};
        const dispatch = d.dispatch === "" || d.dispatch == null ? 0 : Number(d.dispatch);
        const rejected = d.rejected === "" || d.rejected == null ? 0 : Number(d.rejected);
        await updateJobOrderQcStage(order._id, {
          itemIndex,
          action: "inspect",
          dispatchQty: dispatch,
          rejectedQty: rejected,
          reworkRemark: String(d.remark || "").trim(),
        });
      }
      setQcDialog(null);
      setBulkDrafts({});
      await load();
      if (onUpdated) onUpdated();
      setMsg({ text: `QC saved for ${pendingItems.length} item${pendingItems.length === 1 ? "" : "s"}.`, ok: true });
    } catch (err) {
      setQcDialogErr(err.message || "Could not save QC for all items.");
      setMsg({ text: err.message, ok: false });
      await load();
    } finally {
      setQcDialogBusy(false);
    }
  }

  function materialUpdate(row, { inPopup = false } = {}) {
    if (isVendor && !isVendorAcknowledged(row.order)) {
      return (
        <button
          type="button"
          className="btn btn-in btn-sm"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setAckOrder(row.order);
            setAckExpectedDate(todayStr());
            setAckNote("");
            setAckErr("");
          }}
        >
          Receive challan
        </button>
      );
    }
    if (isAdmin && !inPopup) {
      const hasAction =
        pendingRounds(row.item).length > 0
        || reworkQty(row.item) > 0.001
        || Number(row.item.qty) - submittedReadyQty(row.item) > 0.001;
      return (
        <button
          type="button"
          className="btn btn-in btn-sm"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setRowError(row.key, "");
            setMsg({ text: "", ok: true });
            setEditRow({
              key: row.key,
              orderId: row.order._id,
              itemIndex: row.itemIndex,
            });
          }}
        >
          {hasAction ? "Update" : "View"}
        </button>
      );
    }
    const pending = pendingRounds(row.item);
    const sent = submittedReadyQty(row.item);
    const orderQty = Number(row.item.qty) || 0;
    const draft = draftFor(row);
    const busy = busyKey === row.key;
    const rework = reworkQty(row.item);
    const remaining = Math.round((orderQty - sent) * 1000) / 1000;
    const vendorLimit = Math.min(orderQty, remaining);
    const rowError = rowErrors[row.key] || "";
    const vendorQty = draft.qty === "" || draft.qty == null ? NaN : Number(draft.qty);
    const vendorOver = Number.isFinite(vendorQty) && vendorQty - vendorLimit > 0.001;

    function rejectOver(limit) {
      const text = `Cannot update more than the quantity (${formatQty(limit)}).`;
      setRowError(row.key, text);
      setMsg({ text, ok: false });
    }

    return (
      <div className="vq-update">
        {canSetReady && orderQty - sent > 0.001 && (
          <div className="vq-update-block">
            <div className="vq-update-row">
              <input
                type="number"
                min="0.001"
                max={vendorLimit}
                step="any"
                value={draft.qty ?? ""}
                placeholder={sent ? `Another lot, max ${formatQty(vendorLimit)}` : `Ready qty, max ${formatQty(orderQty)}`}
                title={`Cannot update more than the quantity (${formatQty(vendorLimit)})`}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "") {
                    setDraft(row.key, { qty: "" });
                    setRowError(row.key, "");
                    return;
                  }
                  const n = Number(value);
                  if (!Number.isFinite(n)) return;
                  if (n - vendorLimit > 0.001) {
                    rejectOver(vendorLimit);
                    return;
                  }
                  setDraft(row.key, { qty: value });
                  setRowError(row.key, "");
                }}
              />
              <button
                type="button"
                className="btn btn-in btn-sm"
                disabled={!!busyKey || vendorOver}
                onClick={() => {
                  const qty = Number(draft.qty);
                  if (!Number.isFinite(qty) || qty <= 0) {
                    setMsg({ text: "Enter the quantity for this lot.", ok: false });
                    return;
                  }
                  if (qty - vendorLimit > 0.001) {
                    rejectOver(vendorLimit);
                    return;
                  }
                  submit(
                    row,
                    "request_qc",
                    { readyQty: qty },
                    `Submit a lot of ${qty}? This lot cannot be changed. Remaining after this will be ${formatQty(remaining - qty)}.`,
                  );
                }}
              >
                {busy ? "Saving…" : sent ? "Add another lot" : "Submit lot"}
              </button>
            </div>
          </div>
        )}
        {canSetReady && rework > 0.001 && !(canInspect && pending.length > 0) && (
          <div className="vq-update-block">
            {reworkRemarks(row.item).length > 0 && (
              <div className="vq-rework-notes">
                {reworkRemarks(row.item).map((note, idx) => (
                  <div key={idx} className="vq-rework-note">
                    Rework {formatQty(note.qty)}: {note.remark}
                  </div>
                ))}
              </div>
            )}
            <div className="vq-update-row">
              <input
                type="number"
                min="0.001"
                max={rework}
                step="any"
                value={draft.rework ?? ""}
                placeholder={`Rework, max ${formatQty(rework)}`}
                title={`Cannot update more than the quantity (${formatQty(rework)})`}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "") {
                    setDraft(row.key, { rework: "" });
                    setRowError(row.key, "");
                    return;
                  }
                  const n = Number(value);
                  if (!Number.isFinite(n)) return;
                  if (n - rework > 0.001) {
                    rejectOver(rework);
                    return;
                  }
                  setDraft(row.key, { rework: value });
                  setRowError(row.key, "");
                }}
              />
              <button
                type="button"
                className="btn btn-in btn-sm"
                disabled={!!busyKey}
                onClick={() => {
                  const qty = Number(draft.rework);
                  if (!Number.isFinite(qty) || qty <= 0) {
                    setMsg({ text: "Enter the rework quantity.", ok: false });
                    return;
                  }
                  if (qty - rework > 0.001) {
                    rejectOver(rework);
                    return;
                  }
                  submit(
                    row,
                    "send_rework",
                    { readyQty: qty },
                    `Send ${formatQty(qty)} rework for inspection? If QC marks it dispatch, it is added to ready to dispatch.`,
                  );
                }}
              >
                {busy ? "Saving…" : "Send for inspection"}
              </button>
            </div>
          </div>
        )}
        {canSetReady && orderQty - sent <= 0.001 && rework <= 0.001 && !canInspect && (
          <span className="vq-muted">All quantity submitted</span>
        )}
        {canInspect && (pending.length > 0 || remaining > 0.001) && (
          <div className="vq-qc-actions">
            {pending.length > 0 && (
              <button
                type="button"
                className="btn btn-in btn-sm"
                disabled={!!busyKey}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openQcCheck(row.order, row.itemIndex);
                }}
              >
                QC Check
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!!busyKey}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openQcSkip(row.order, row.itemIndex);
              }}
            >
              Skip
            </button>
          </div>
        )}
        {canInspect && skipRemarks(row.item).length > 0 && (
          <div className="vq-rework-notes">
            {skipRemarks(row.item).map((note, idx) => (
              <div key={idx} className="vq-skip-note">
                QC skipped {formatQty(note.qty)}: {note.remark}
              </div>
            ))}
          </div>
        )}
        {canInspect && !pending.length && remaining <= 0.001 && !skipRemarks(row.item).length && (
          <span className="vq-muted">QC complete</span>
        )}
        {canSetReady && rework > 0.001 && canInspect && pending.length === 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!!busyKey}
            onClick={() => submit(
              row,
              "send_rework",
              { readyQty: rework },
              `Send ${formatQty(rework)} for inspection? If QC marks it dispatch, it is added to ready to dispatch.`,
            )}
          >
            {busy ? "Saving…" : `Send ${formatQty(rework)} for inspection`}
          </button>
        )}
        {rowError && <div className="vq-err">{rowError}</div>}
      </div>
    );
  }

  const filters = isQc && !isAdmin
    ? [
        ["all", "All"],
        ["qc_pending", "Pending QC"],
        ["partial", "Part inspected"],
        ["inspected", "Fully inspected"],
      ]
    : [
        ["all", "All"],
        ["in_process", "In process"],
        ["qc_pending", "Pending QC"],
        ["partial", "Part inspected"],
        ["inspected", "Fully inspected"],
      ];

  return (
    <>
      <style>{`
        .vq-embed-head { margin-bottom: 8px; }
        .vq-embed-head h3 { margin: 0 0 2px; font-size: 14px; font-weight: 700; color: var(--ink); }
        .vq-embed-head p { margin: 0; font-size: 12px; color: var(--text-2); }
        .vq-embed-wrap { margin-bottom: 12px; }
        .vq-filters {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 16px;
          align-items: center;
        }
        .vq-filters .btn {
          height: 34px;
          display: inline-flex;
          align-items: center;
          box-sizing: border-box;
        }
        .vq-vendor-filter {
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 34px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-2);
        }
        .vq-vendor-filter select {
          min-width: 180px;
          max-width: 260px;
          height: 34px;
          padding: 0 10px;
          border: 1px solid var(--line);
          border-radius: 6px;
          background: #fff;
          font-family: inherit;
          font-size: 13px;
          color: var(--ink);
          box-sizing: border-box;
        }
        .vq-list { display: flex; flex-direction: column; gap: 18px; }
        .vq-vendor-section { display: flex; flex-direction: column; gap: 8px; }
        .vq-vendor-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          padding: 2px 2px 8px;
          border-bottom: 1px solid var(--line);
        }
        .vq-vendor-title {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--ink);
          line-height: 1.3;
        }
        .vq-vendor-sub {
          margin: 0;
          flex-shrink: 0;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-3);
          white-space: nowrap;
        }
        .vq-challan-stack { display: flex; flex-direction: column; gap: 8px; }
        .vq-card {
          border: 1px solid var(--line);
          border-radius: 10px;
          background: #fff;
          overflow: hidden;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .vq-card:hover {
          border-color: #cfc8b8;
          box-shadow: 0 1px 0 rgba(28, 26, 22, 0.04);
        }
        .vq-body { padding: 4px 16px 16px; }
        .vq-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 12px 0; align-items: start; }
        .vq-kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8a8270; margin-bottom: 4px; }
        .vq-party-name { font-weight: 700; font-size: 13px; margin-bottom: 4px; }
        .vq-party-text { font-size: 13px; line-height: 1.45; white-space: pre-line; color: var(--text-2); word-break: break-word; }
        .vq-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .vq-table {
          width: 100%;
          min-width: 1180px;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .vq-table th, .vq-table td {
          vertical-align: middle;
          text-align: left;
          padding: 8px 8px;
          border-bottom: 1px solid var(--line);
          word-break: break-word;
        }
        .vq-table th {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #8a8270;
          white-space: normal;
          background: var(--paper-dim);
          line-height: 1.25;
        }
        .vq-table td { font-size: 12.5px; }
        .vq-table td.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .vq-table th.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: normal;
        }
        .vq-table th.vq-th-dispatch {
          white-space: normal;
          line-height: 1.2;
          hyphens: auto;
        }
        .vq-table th.vq-th-act {
          white-space: nowrap;
          text-align: center;
        }
        .vq-table td.vq-desc { white-space: normal; font-weight: 500; }
        .vq-table td.vq-act {
          white-space: nowrap;
          vertical-align: middle;
          text-align: center;
        }
        .vq-table col.vq-col-sr { width: 40px; }
        .vq-table col.vq-col-desc { width: 16%; }
        .vq-table col.vq-col-qty { width: 56px; }
        .vq-table col.vq-col-uom { width: 52px; }
        .vq-table col.vq-col-process { width: 13%; }
        .vq-table col.vq-col-project { width: 11%; }
        .vq-table col.vq-col-remark { width: 10%; }
        .vq-table col.vq-col-ready { width: 140px; }
        .vq-table col.vq-col-dispatch { width: 92px; }
        .vq-table col.vq-col-act { width: 110px; }
        .vq-flat { width: 100%; min-width: 760px; border-collapse: collapse; }
        .vq-flat th, .vq-flat td {
          vertical-align: middle;
          text-align: left;
          padding: 10px 12px;
          border-bottom: 1px solid var(--line);
        }
        .vq-flat th {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #8a8270;
          white-space: nowrap;
          background: var(--paper-dim);
        }
        .vq-flat td.num, .vq-flat th.num { text-align: right; font-variant-numeric: tabular-nums; }
        .vq-flat td.vq-act { min-width: 160px; white-space: normal; vertical-align: top; }
        .vq-update-block { display: flex; flex-direction: column; gap: 6px; }
        .vq-update-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }
        .vq-qc-actions {
          display: inline-flex;
          flex-direction: row;
          flex-wrap: nowrap;
          align-items: center;
          justify-content: flex-start;
          gap: 6px;
          width: auto;
        }
        .vq-qc-actions .btn {
          flex: 0 0 auto;
          width: auto;
          height: 30px;
          padding: 0 12px;
          box-sizing: border-box;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.01em;
          justify-content: center;
          white-space: nowrap;
        }
        .vq-update {
          display: inline-flex;
          flex-direction: column;
          gap: 6px;
          align-items: flex-start;
          width: auto;
        }
        .vq-card-tools {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .vq-bulk-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: min(62vh, 520px);
          overflow: auto;
          padding-right: 2px;
        }
        .vq-bulk-item {
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 8px 10px;
          background: #fff;
        }
        .vq-bulk-item.is-pending,
        .vq-bulk-item.is-done {
          background: #fff;
          border-color: var(--line);
        }
        .vq-bulk-item.is-done {
          opacity: 0.85;
        }
        .vq-bulk-row {
          display: flex;
          align-items: center;
          gap: 10px 12px;
          flex-wrap: nowrap;
          min-width: 0;
        }
        .vq-bulk-desc {
          flex: 1 1 180px;
          min-width: 140px;
        }
        .vq-bulk-desc .vq-sr {
          display: block;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #8a8270;
          margin-bottom: 1px;
        }
        .vq-bulk-desc strong {
          display: block;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.25;
          color: var(--ink);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .vq-bulk-desc .vq-item-sub {
          margin-top: 2px;
          font-size: 11px;
          color: var(--text-2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .vq-bulk-chip {
          flex: 0 0 auto;
          font-size: 11.5px;
          color: var(--ink);
          white-space: nowrap;
        }
        .vq-bulk-chip span {
          display: block;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #8a8270;
          margin-bottom: 1px;
        }
        .vq-bulk-chip strong { font-weight: 600; }
        .vq-bulk-badge {
          flex-shrink: 0;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 3px 7px;
          border-radius: 999px;
          white-space: nowrap;
        }
        .vq-bulk-badge.wait {
          background: #e8f0ee;
          color: var(--teal-dark, #16483f);
        }
        .vq-bulk-badge.done {
          background: #eceae4;
          color: #6b6555;
        }
        .vq-bulk-fields {
          display: flex;
          flex-wrap: nowrap;
          gap: 8px;
          align-items: flex-end;
          flex: 0 0 auto;
          margin-left: auto;
        }
        .vq-bulk-fields label {
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #8a8270;
        }
        .vq-bulk-fields input {
          width: 88px;
          height: 30px;
          box-sizing: border-box;
          padding: 4px 8px;
          border: 1px solid var(--line);
          border-radius: 6px;
          font: inherit;
          font-size: 12.5px;
          font-weight: 500;
          text-transform: none;
          letter-spacing: normal;
          color: var(--ink);
          background: #fff;
        }
        .vq-bulk-lots {
          margin-top: 4px;
          font-size: 11px;
          color: var(--text-2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .vq-modal-foot {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 8px;
          margin-top: 16px;
          padding-top: 12px;
          border-top: 1px solid var(--line);
        }
        @media (max-width: 900px) {
          .vq-bulk-row { flex-wrap: wrap; }
          .vq-bulk-fields { margin-left: 0; width: 100%; }
        }
        .vq-check-fields {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 10px;
        }
        .vq-check-fields label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #8a8270;
        }
        .vq-check-fields input {
          width: 100%;
          height: 36px;
          box-sizing: border-box;
          padding: 6px 10px;
          border: 1px solid var(--line);
          border-radius: 6px;
          font: inherit;
          font-size: 13px;
          font-weight: 500;
          text-transform: none;
          letter-spacing: normal;
          color: var(--ink);
          background: #fff;
        }
        @media (max-width: 480px) {
          .vq-bulk-fields { width: 100%; }
          .vq-bulk-fields input { width: 100%; }
          .vq-check-fields { grid-template-columns: 1fr; }
        }
        .vq-update input {
          width: 140px;
          max-width: 100%;
          min-width: 110px;
          height: 34px;
          box-sizing: border-box;
          padding: 6px 8px;
          border: 1px solid var(--line);
          border-radius: 6px;
          font: inherit;
          font-size: 13px;
          background: #fff;
        }
        .vq-remark {
          width: 100%;
          box-sizing: border-box;
          min-height: 58px;
          padding: 8px 10px;
          border: 1px solid var(--line);
          border-radius: 6px;
          font: inherit;
          font-size: 13px;
          resize: vertical;
          background: #fff;
        }
        .vq-rework-notes {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 4px;
        }
        .vq-rework-note {
          font-size: 12px;
          color: #9a3412;
          line-height: 1.35;
          white-space: normal;
        }
        .vq-skip-note {
          font-size: 12px;
          color: #9a3412;
          line-height: 1.35;
          white-space: normal;
        }
        .vq-ack-items {
          margin: 0 0 14px;
          border: 1px solid var(--line);
          border-radius: 8px;
          overflow: hidden;
        }
        .vq-ack-items-head {
          padding: 8px 12px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #8a8270;
          background: var(--paper-dim);
          border-bottom: 1px solid var(--line);
        }
        .vq-ack-items-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .vq-ack-items table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12.5px;
          table-layout: fixed;
        }
        .vq-ack-items col.vq-ack-sr { width: 40px; }
        .vq-ack-items col.vq-ack-item { width: 22%; }
        .vq-ack-items col.vq-ack-qty { width: 70px; }
        .vq-ack-items col.vq-ack-uom { width: 56px; }
        .vq-ack-items col.vq-ack-process { width: 18%; }
        .vq-ack-items col.vq-ack-project { width: 14%; }
        .vq-ack-items col.vq-ack-remark { width: 16%; }
        .vq-ack-items th {
          text-align: left;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #8a8270;
          padding: 7px 10px;
          border-bottom: 1px solid var(--line);
          background: #fff;
          white-space: nowrap;
        }
        .vq-ack-items td {
          padding: 8px 10px;
          border-bottom: 1px solid var(--line);
          vertical-align: top;
          word-break: break-word;
        }
        .vq-ack-items tr:last-child td { border-bottom: none; }
        .vq-ack-items td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .vq-ack-items th.num { text-align: right; }
        .vq-update .btn { white-space: nowrap; flex-shrink: 0; }
        .vq-muted { font-size: 12px; color: var(--text-3); line-height: 1.35; }
        .vq-err { font-size: 12px; color: var(--red, #b42318); line-height: 1.35; }
        .vq-lots { display: flex; flex-direction: column; gap: 2px; font-size: 12px; white-space: normal; min-width: 120px; }
        .vq-card-head {
          width: 100%;
          text-align: left;
          background: #fff;
          border: none;
          padding: 12px 14px;
          font-family: inherit;
        }
        .vq-card-head.is-open { background: var(--paper-dim); }
        .vq-card-top { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
        .vq-card-toggle {
          flex: 1;
          min-width: 0;
          text-align: left;
          background: transparent;
          border: none;
          padding: 0;
          cursor: pointer;
          font-family: inherit;
          color: inherit;
        }
        .vq-card-title {
          font-weight: 700;
          font-size: 15px;
          margin-top: 2px;
          color: var(--ink);
          line-height: 1.3;
        }
        .vq-card-chevron {
          background: transparent;
          border: none;
          padding: 4px 2px;
          cursor: pointer;
          font-size: 16px;
          color: #8a8270;
          line-height: 1;
          flex-shrink: 0;
        }
        .vq-card-meta {
          font-size: 12.5px;
          color: var(--text-2);
          margin-top: 4px;
          line-height: 1.45;
          word-break: break-word;
        }
        .vq-mobile-list { display: none; flex-direction: column; gap: 12px; }
        .vq-mobile-item {
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 12px;
          background: var(--paper-dim);
        }
        .vq-mobile-item h4 { margin: 0 0 8px; font-size: 14px; font-weight: 700; }
        .vq-mobile-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px 12px;
          margin-bottom: 10px;
          font-size: 12.5px;
        }
        .vq-mobile-grid span { color: var(--text-3); display: block; font-size: 11px; margin-bottom: 2px; }
        .vq-mobile-grid strong { font-weight: 600; color: var(--ink); word-break: break-word; }
        @media (max-width: 1100px) {
          .vq-update input { width: 110px; min-width: 90px; }
          .vq-table th, .vq-table td { padding: 7px 6px; font-size: 12px; }
          .vq-vendor-filter {
            margin-left: 0;
            width: 100%;
            height: auto;
            flex-wrap: wrap;
          }
          .vq-vendor-filter select { flex: 1; max-width: none; min-width: 160px; }
          .vq-filters .btn { flex: 0 1 auto; }
        }
        @media (max-width: 900px) {
          .vq-parties { grid-template-columns: 1fr; gap: 10px; margin: 8px 0; }
          .vq-body { padding: 4px 12px 14px; }
          .vq-card-head { padding: 12px; }
          .vq-desktop-only { display: none !important; }
          .vq-mobile-list { display: flex; }
          .vq-flat { min-width: 0; }
          .vq-vendor-head { flex-wrap: wrap; align-items: center; }
          .vq-update-row { flex-direction: column; align-items: stretch; }
          .vq-update input, .vq-update .btn { width: 100%; max-width: none; }
          .vq-list { gap: 14px; }
        }
        @media (max-width: 680px) {
          .vq-card-top {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
          }
          .vq-card-top > div {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            width: 100%;
          }
          .vq-card-top .btn { flex: 1 1 auto; justify-content: center; }
          .vq-filters .btn {
            flex: 1 1 calc(50% - 4px);
            min-width: 0;
            justify-content: center;
          }
        }
        @media (max-width: 480px) {
          .vq-mobile-grid { grid-template-columns: 1fr; }
          .vq-filters .btn { flex: 1 1 100%; }
          .vq-modal-overlay { padding: 8px; align-items: flex-start; }
          .vq-modal {
            width: 100%;
            max-height: calc(100vh - 16px);
            border-radius: 10px;
          }
          .vq-modal-head { padding: 12px 14px; }
          .vq-modal-body { padding: 12px 14px 16px; }
        }
        .vq-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(28, 26, 22, 0.55);
          backdrop-filter: blur(3px);
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .vq-modal {
          background: var(--card, #fff);
          border: 1px solid var(--line);
          border-radius: 12px;
          box-shadow: var(--shadow-lg);
          width: min(560px, 100%);
          max-height: calc(100vh - 32px);
          overflow: auto;
          display: flex;
          flex-direction: column;
        }
        .vq-modal.vq-modal--wide {
          width: min(960px, calc(100vw - 32px));
          max-width: calc(100vw - 32px);
        }
        .vq-modal.vq-modal--qc-all {
          width: min(1100px, calc(100vw - 32px));
          max-width: calc(100vw - 32px);
        }
        .vq-modal.vq-modal--qc {
          width: min(520px, calc(100vw - 32px));
          max-width: calc(100vw - 32px);
        }
        .vq-item-desc {
          margin: 0 0 12px;
          padding: 10px 12px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: var(--paper-dim, #f7f4ec);
        }
        .vq-item-desc span {
          display: block;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #8a8270;
          margin-bottom: 3px;
        }
        .vq-item-desc strong {
          display: block;
          font-size: 15px;
          font-weight: 700;
          line-height: 1.35;
          color: var(--ink);
          word-break: break-word;
        }
        .vq-item-desc .vq-item-sub {
          margin-top: 4px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-2);
        }
        .vq-modal-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 18px;
          border-bottom: 1px solid var(--line);
        }
        .vq-modal-head h3 { margin: 0; font-size: 16px; }
        .vq-modal-body { padding: 16px 18px 20px; }
        .vq-modal-meta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 14px;
          margin-bottom: 16px;
          font-size: 13px;
        }
        .vq-modal-meta span { display: block; font-size: 11px; color: var(--text-3); margin-bottom: 2px; }
        .vq-modal-meta strong { font-weight: 600; word-break: break-word; }
        .vq-modal .vq-update input { width: 150px; min-width: 120px; }
        @media (max-width: 520px) {
          .vq-modal-meta { grid-template-columns: 1fr; }
          .vq-modal .vq-update-row { flex-direction: column; align-items: stretch; }
          .vq-modal .vq-update input, .vq-modal .vq-update .btn { width: 100%; }
        }
      `}</style>
      <div className={embedded ? "vq-embed-wrap" : undefined}>
      {embedded ? (
        <div className="vq-embed-head">
          <h3>Vendor &amp; QC</h3>
          <p>Challans grouped by vendor — click one to inspect.</p>
        </div>
      ) : (
        <div className="pagehead">
          <div className="pagehead-text">
            <h2>
              {isVendor
                ? `My ${jobTypeLabel(lockedJobType || "powder_coating")} Orders`
                : isQc
                ? `${jobTypeLabel(lockedJobType || "powder_coating")} QC`
                : "Vendor and QC"}
            </h2>
            <p>
              {isVendor
                ? `Your ${jobTypeLabel(lockedJobType || "powder_coating").toLowerCase()} challans. Receive new ones with an expected date, then update ready quantity.`
                : isQc
                ? `${jobTypeLabel(lockedJobType || "powder_coating")} challans only, grouped by vendor. Same QC flow — click a challan to inspect.`
                : "Click a challan to see item details."}
            </p>
          </div>
        </div>
      )}

      <div className="card card-wide">
        {showTypeTabs && (
          <div className="vq-filters" style={{ marginBottom: 10 }}>
            {[
              ["all", "All"],
              ["powder_coating", "Powder Coating"],
              ["fabrication", "Fabrication"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={typeFilter === id ? "btn btn-in btn-sm" : "btn btn-ghost btn-sm"}
                onClick={() => { setTypeFilter(id); setPage(1); }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="vq-filters">
          {filters.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={stageFilter === id ? "btn btn-in btn-sm" : "btn btn-ghost btn-sm"}
              onClick={() => { setStageFilter(id); setPage(1); }}
            >
              {label}
            </button>
          ))}
          {showVendor && (
            <label className="vq-vendor-filter">
              Vendor
              <select
                value={vendorFilter}
                onChange={(e) => {
                  setVendorFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All vendors</option>
                {vendorOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {msg.text && <p className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</p>}

        {loading ? (
          <p style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</p>
        ) : showChallans ? (
          <div className="vq-list">
            {(showVendor ? pageItems : [{ vendorName: null, challans: pageItems }]).map((group) => (
              <div key={group.vendorName || "all"} className="vq-vendor-section">
                {group.vendorName && (
                  <div className="vq-vendor-head">
                    <h3 className="vq-vendor-title">{group.vendorName}</h3>
                    <p className="vq-vendor-sub">
                      {(group.challans || []).length} challan{(group.challans || []).length === 1 ? "" : "s"}
                    </p>
                  </div>
                )}
                <div className="vq-challan-stack">
            {(group.challans || []).map(({ order }) => {
              const open = !!openChallans[order._id];
              const acknowledged = isVendorAcknowledged(order);
              return (
              <div key={order._id} id={`vq-challan-${order._id}`} className="vq-card">
                <div className={`vq-card-head${open ? " is-open" : ""}`}>
                  <div className="vq-card-top">
                    <button
                      type="button"
                      className="vq-card-toggle"
                      onClick={() => setOpenChallans((prev) => ({ ...prev, [order._id]: !prev[order._id] }))}
                    >
                      <div className="vq-kicker">
                        {jobTypeLabel(orderJobType(order))} · Delivery challan
                      </div>
                      <div className="vq-card-title">Challan No {order.srNo}</div>
                      <div className="vq-card-meta">
                        {formatDate(order.date)} · {(order.items || []).length} item{(order.items || []).length === 1 ? "" : "s"} · Vehicle {order.vehicleNo || "—"}
                        {acknowledged
                          ? ` · Expected ${formatDate(order.vendorExpectedDate)}`
                          : " · Waiting for vendor receive"}
                      </div>
                    </button>
                    <div className="vq-card-tools">
                      {isVendor && !acknowledged && (
                        <button
                          type="button"
                          className="btn btn-in btn-sm"
                          onClick={() => {
                            setAckOrder(order);
                            setAckExpectedDate(todayStr());
                            setAckNote("");
                            setAckErr("");
                          }}
                        >
                          Receive
                        </button>
                      )}
                      {canInspect && orderPendingQcCount(order) > 0 && (
                        <button
                          type="button"
                          className="btn btn-in btn-sm"
                          title="Open QC for every item on this challan"
                          onClick={(e) => {
                            e.stopPropagation();
                            openQcCheckAll(order);
                          }}
                        >
                          QC Check all ({orderPendingQcCount(order)})
                        </button>
                      )}
                      <button
                        type="button"
                        className="vq-card-chevron"
                        aria-label={open ? "Collapse" : "Expand"}
                        onClick={() => setOpenChallans((prev) => ({ ...prev, [order._id]: !prev[order._id] }))}
                      >
                        {open ? "▾" : "▸"}
                      </button>
                    </div>
                  </div>
                </div>
                {open && (
                <div className="vq-body">
                <div className="vq-parties">
                  <div>
                    <div className="vq-kicker">Send from</div>
                    <div className="vq-party-name">{order.sendFromName || "—"}</div>
                    <div className="vq-party-text">{order.sendFromAddress || "—"}</div>
                  </div>
                  <div>
                    <div className="vq-kicker">Delivery address</div>
                    <div className="vq-party-name">{order.vendorName || "—"}</div>
                    <div className="vq-party-text">{order.deliveryAddress || "—"}</div>
                  </div>
                </div>
                <div className="vq-scroll tablewrap vq-desktop-only">
                  <table className="vq-table">
                    <colgroup>
                      <col className="vq-col-sr" />
                      <col className="vq-col-desc" />
                      <col className="vq-col-qty" />
                      <col className="vq-col-uom" />
                      <col className="vq-col-process" />
                      <col className="vq-col-project" />
                      <col className="vq-col-remark" />
                      <col className="vq-col-ready" />
                      <col className="vq-col-dispatch" />
                      <col className="vq-col-act" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Sr</th>
                        <th>Item Description</th>
                        <th className="num">Qty</th>
                        <th>UOM</th>
                        <th>Process / RAL / Finish</th>
                        <th>Project</th>
                        <th>Remark</th>
                        <th>Ready qty</th>
                        <th className="num vq-th-dispatch">Ready to dispatch</th>
                        <th className="vq-th-act">Update</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(order.items || []).map((item, itemIndex) => {
                        const row = { key: `${order._id}-${itemIndex}`, order, item, itemIndex };
                        const totals = inspectedTotals(row.item);
                        const rounds = row.item.qcRounds || [];
                        return (
                          <tr key={row.key}>
                            <td>{itemIndex + 1}</td>
                            <td className="vq-desc">{row.item.description}</td>
                            <td className="num">{formatQty(row.item.qty)}</td>
                            <td>{row.item.unit || "NOS"}</td>
                            <td>{row.item.process || "—"}</td>
                            <td>{row.item.projectName || "—"}</td>
                            <td>{row.item.remark || "—"}</td>
                            <td>
                              <div className="vq-lots">
                                {rounds.length ? rounds.map((round, lotIndex) => (
                                  <div key={lotIndex}>
                                    Lot {lotIndex + 1}: {formatQty(round.readyQty)} ·{" "}
                                    {round.status === "pending"
                                      ? "With QC"
                                      : round.skipped
                                      ? "QC skipped"
                                      : "Inspected"}
                                  </div>
                                )) : "—"}
                              </div>
                            </td>
                            <td className="num">{totals.dispatch ? formatQty(totals.dispatch) : "—"}</td>
                            <td className="vq-act">{materialUpdate(row)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="vq-mobile-list">
                  {(order.items || []).map((item, itemIndex) => {
                    const row = { key: `${order._id}-${itemIndex}`, order, item, itemIndex };
                    const totals = inspectedTotals(row.item);
                    const rounds = row.item.qcRounds || [];
                    return (
                      <div key={row.key} className="vq-mobile-item">
                        <h4>{itemIndex + 1}. {item.description}</h4>
                        <div className="vq-mobile-grid">
                          <div><span>Qty</span><strong>{formatQty(item.qty)} {item.unit || "NOS"}</strong></div>
                          <div><span>Process</span><strong>{item.process || "—"}</strong></div>
                          <div><span>Project</span><strong>{item.projectName || "—"}</strong></div>
                          <div><span>Ready to dispatch</span><strong>{totals.dispatch ? formatQty(totals.dispatch) : "—"}</strong></div>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <span>Ready qty</span>
                            <strong>
                              {rounds.length
                                ? rounds.map((round, lotIndex) => `Lot ${lotIndex + 1}: ${formatQty(round.readyQty)} (${round.status === "pending" ? "With QC" : round.skipped ? "QC skipped" : "Inspected"})`).join(" · ")
                                : "—"}
                            </strong>
                          </div>
                          {item.remark ? <div style={{ gridColumn: "1 / -1" }}><span>Remark</span><strong>{item.remark}</strong></div> : null}
                        </div>
                        {materialUpdate(row)}
                      </div>
                    );
                  })}
                </div>
                </div>
                )}
              </div>
              );
            })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="vq-scroll tablewrap">
            <table className="vq-flat">
              <thead>
                <tr>
                  <th>SR No</th>
                  <th>Date</th>
                  {showVendor && <th>Vendor</th>}
                  <th>Material</th>
                  <th className="num">Order qty</th>
                  <th>Ready qty / %</th>
                  <th className="num">Ready to dispatch</th>
                  <th>Update</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((row) => {
                  const sent = submittedReadyQty(row.item);
                  const totals = inspectedTotals(row.item);
                  const orderQty = Number(row.item.qty) || 0;
                  const sliceQty = pendingReadyQty(row.item);
                  return (
                    <tr key={row.key}>
                      <td className="mono" style={{ fontWeight: 700 }}>{row.order.srNo}</td>
                      <td>{formatDate(row.order.date)}</td>
                      {showVendor && <td>{row.order.vendorName}</td>}
                      <td className="vq-desc">
                        <div>{row.item.description}</div>
                        <div className="vq-muted">
                          {row.item.process || "—"} · {row.item.projectName || "—"}
                        </div>
                      </td>
                      <td className="num">{formatQty(orderQty)} {row.item.unit || "NOS"}</td>
                      <td>
                        <strong>{qtyWithPercent(sent, orderQty)}</strong>
                        {sliceQty > 0 && (
                          <div className="vq-muted" style={{ color: "#9a3412", marginTop: 4 }}>
                            {qtyWithPercent(sliceQty, orderQty)} with QC
                          </div>
                        )}
                      </td>
                      <td className="num">{qtyWithPercent(totals.dispatch, orderQty)}</td>
                      <td className="vq-act">{materialUpdate(row)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !visible.length && (
          <div className="empty">
            {isVendor
              ? `No ${jobTypeLabel(lockedJobType || "powder_coating").toLowerCase()} materials assigned to your company yet.`
              : !orders.length && lockedJobType
              ? `No ${jobTypeLabel(lockedJobType).toLowerCase()} challans yet. Store or purchase must create them under Job Order → ${jobTypeLabel(lockedJobType)}.`
              : !orders.length
              ? "No challans yet."
              : "No materials in this stage."}
          </div>
        )}

        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
      </div>

      {isAdmin && editRow && createPortal((() => {
        const liveOrder = orders.find((o) => String(o._id) === String(editRow.orderId));
        const liveItem = liveOrder?.items?.[editRow.itemIndex];
        if (!liveOrder || !liveItem) {
          return (
            <div className="vq-modal-overlay" onClick={() => setEditRow(null)}>
              <div className="vq-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                <div className="vq-modal-head">
                  <h3>Update</h3>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditRow(null)}>✕</button>
                </div>
                <div className="vq-modal-body">
                  <p className="vq-muted">This material could not be loaded. Close and try again.</p>
                </div>
              </div>
            </div>
          );
        }
        const liveRow = {
          key: editRow.key,
          order: liveOrder,
          item: liveItem,
          itemIndex: editRow.itemIndex,
        };
        const sent = submittedReadyQty(liveItem);
        const totals = inspectedTotals(liveItem);
        const orderQty = Number(liveItem.qty) || 0;
        const sliceQty = pendingReadyQty(liveItem);
        return (
          <div className="vq-modal-overlay" onClick={() => setEditRow(null)}>
            <div className="vq-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
              <div className="vq-modal-head">
                <div>
                  <h3>{liveItem.description}</h3>
                  <div className="vq-muted" style={{ marginTop: 4 }}>
                    Challan {liveOrder.srNo} · {liveOrder.vendorName || "—"}
                  </div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditRow(null)}>✕</button>
              </div>
              <div className="vq-modal-body">
                <div className="vq-modal-meta">
                  <div><span>Order qty</span><strong>{formatQty(orderQty)} {liveItem.unit || "NOS"}</strong></div>
                  <div><span>Ready qty</span><strong>{qtyWithPercent(sent, orderQty)}</strong></div>
                  <div><span>With QC</span><strong>{sliceQty ? qtyWithPercent(sliceQty, orderQty) : "—"}</strong></div>
                  <div><span>Ready to dispatch</span><strong>{qtyWithPercent(totals.dispatch, orderQty)}</strong></div>
                  <div><span>Rework</span><strong>{qtyWithPercent(reworkQty(liveItem), orderQty)}</strong></div>
                  <div><span>Process</span><strong>{liveItem.process || "—"}</strong></div>
                </div>
                {reworkRemarks(liveItem).length > 0 && (
                  <div className="vq-rework-notes" style={{ marginBottom: 12 }}>
                    {reworkRemarks(liveItem).map((note, idx) => (
                      <div key={idx} className="vq-rework-note">
                        Rework {formatQty(note.qty)}: {note.remark}
                      </div>
                    ))}
                  </div>
                )}
                {materialUpdate(liveRow, { inPopup: true })}
              </div>
            </div>
          </div>
        );
      })(), document.body)}

      {qcDialog && createPortal((() => {
        const liveOrder = orders.find((o) => String(o._id) === String(qcDialog.orderId));
        if (!liveOrder) {
          return (
            <div className="vq-modal-overlay" onClick={() => setQcDialog(null)}>
              <div className="vq-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                <div className="vq-modal-head">
                  <h3>QC</h3>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQcDialog(null)}>✕</button>
                </div>
                <div className="vq-modal-body">
                  <p className="vq-muted">This challan could not be loaded.</p>
                </div>
              </div>
            </div>
          );
        }

        if (qcDialog.type === "check_all") {
          const allItems = (liveOrder.items || []).map((item, itemIndex) => ({ item, itemIndex }));
          const pendingCount = allItems.filter(({ item }) => pendingRounds(item).length > 0).length;
          return (
            <div className="vq-modal-overlay" onClick={() => !qcDialogBusy && setQcDialog(null)}>
              <div className="vq-modal vq-modal--qc-all" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="QC Check all items">
                <div className="vq-modal-head">
                  <div>
                    <h3>QC Check all items</h3>
                    <div className="vq-muted" style={{ marginTop: 4 }}>
                      Challan {liveOrder.srNo}
                      {liveOrder.vendorName ? ` · ${liveOrder.vendorName}` : ""}
                      {" · "}
                      {allItems.length} item{allItems.length === 1 ? "" : "s"}
                      {" · "}
                      {pendingCount} waiting for QC
                    </div>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={qcDialogBusy} onClick={() => setQcDialog(null)}>✕</button>
                </div>
                <div className="vq-modal-body">
                  <div className="vq-modal-meta" style={{ marginBottom: 14 }}>
                    <div><span>Date</span><strong>{formatDate(liveOrder.date)}</strong></div>
                    <div><span>Vehicle</span><strong>{liveOrder.vehicleNo || "—"}</strong></div>
                    <div><span>Send from</span><strong>{liveOrder.sendFromName || "—"}</strong></div>
                    <div><span>Type</span><strong>{jobTypeLabel(orderJobType(liveOrder))}</strong></div>
                  </div>
                  <div className="vq-bulk-list">
                    {allItems.map(({ item, itemIndex }) => {
                      const sliceQty = pendingReadyQty(item);
                      const waiting = pendingRounds(item).length > 0;
                      const totals = inspectedTotals(item);
                      const rounds = item.qcRounds || [];
                      const d = bulkDrafts[itemIndex] || {};
                      return (
                        <div
                          key={itemIndex}
                          className={`vq-bulk-item${waiting ? " is-pending" : " is-done"}`}
                        >
                          <div className="vq-bulk-row">
                            <div className="vq-bulk-desc" title={item.description || ""}>
                              <span className="vq-sr">Item {itemIndex + 1}</span>
                              <strong>{item.description || "—"}</strong>
                              <div className="vq-item-sub">
                                {[item.process, item.projectName].filter(Boolean).join(" · ") || "—"}
                              </div>
                            </div>
                            <div className="vq-bulk-chip">
                              <span>Qty</span>
                              <strong>{formatQty(item.qty)} {item.unit || "NOS"}</strong>
                            </div>
                            <div className="vq-bulk-chip">
                              <span>Ready</span>
                              <strong>{totals.dispatch ? formatQty(totals.dispatch) : "—"}</strong>
                            </div>
                            <div className="vq-bulk-chip">
                              <span>With QC</span>
                              <strong>{waiting ? formatQty(sliceQty) : "—"}</strong>
                            </div>
                            <span className={`vq-bulk-badge${waiting ? " wait" : " done"}`}>
                              {waiting ? "Waiting" : "Done"}
                            </span>
                            {waiting ? (
                              <div className="vq-bulk-fields">
                                <label>
                                  Dispatch
                                  <input
                                    type="number"
                                    min="0"
                                    max={sliceQty}
                                    step="any"
                                    value={d.dispatch ?? ""}
                                    placeholder={`Max ${formatQty(sliceQty)}`}
                                    onChange={(e) => setBulkDrafts((prev) => ({
                                      ...prev,
                                      [itemIndex]: { ...prev[itemIndex], dispatch: e.target.value },
                                    }))}
                                  />
                                </label>
                                <label>
                                  Rework
                                  <input
                                    type="number"
                                    min="0"
                                    max={sliceQty}
                                    step="any"
                                    value={d.rejected ?? ""}
                                    placeholder={`Max ${formatQty(sliceQty)}`}
                                    onChange={(e) => setBulkDrafts((prev) => ({
                                      ...prev,
                                      [itemIndex]: { ...prev[itemIndex], rejected: e.target.value },
                                    }))}
                                  />
                                </label>
                              </div>
                            ) : null}
                          </div>
                          <div className="vq-bulk-lots" title={
                            rounds.length
                              ? rounds.map((round, lotIndex) => (
                                  `Lot ${lotIndex + 1}: ${formatQty(round.readyQty)} (${
                                    round.status === "pending"
                                      ? "With QC"
                                      : round.skipped
                                      ? "QC skipped"
                                      : "Inspected"
                                  })`
                                )).join(" · ")
                              : ""
                          }>
                            {rounds.length
                              ? rounds.map((round, lotIndex) => (
                                  `Lot ${lotIndex + 1}: ${formatQty(round.readyQty)} (${
                                    round.status === "pending"
                                      ? "With QC"
                                      : round.skipped
                                      ? "Skipped"
                                      : "Inspected"
                                  })`
                                )).join(" · ")
                              : (item.remark ? `Remark: ${item.remark}` : "")}
                          </div>
                          {waiting && Number(d.rejected) > 0 && (
                            <textarea
                              className="vq-remark"
                              rows={2}
                              style={{ marginTop: 6 }}
                              value={d.remark ?? ""}
                              placeholder="Remark for rework (required)"
                              onChange={(e) => setBulkDrafts((prev) => ({
                                ...prev,
                                [itemIndex]: { ...prev[itemIndex], remark: e.target.value },
                              }))}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {qcDialogErr && <div className="vq-err" style={{ marginTop: 10 }}>{qcDialogErr}</div>}
                  <div className="vq-modal-foot">
                    <button type="button" className="btn btn-ghost" disabled={qcDialogBusy} onClick={() => setQcDialog(null)}>Cancel</button>
                    <button
                      type="button"
                      className="btn btn-in"
                      disabled={qcDialogBusy || pendingCount === 0}
                      onClick={() => saveQcCheckAllFromDialog(liveOrder)}
                    >
                      {qcDialogBusy ? "Saving…" : `Save QC (${pendingCount})`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        const liveItem = liveOrder.items?.[qcDialog.itemIndex];
        if (!liveItem) {
          return (
            <div className="vq-modal-overlay" onClick={() => setQcDialog(null)}>
              <div className="vq-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                <div className="vq-modal-head">
                  <h3>QC</h3>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQcDialog(null)}>✕</button>
                </div>
                <div className="vq-modal-body">
                  <p className="vq-muted">This material could not be loaded.</p>
                </div>
              </div>
            </div>
          );
        }

        const liveRow = {
          key: `${liveOrder._id}-${qcDialog.itemIndex}`,
          order: liveOrder,
          item: liveItem,
          itemIndex: qcDialog.itemIndex,
        };
        const draft = draftFor(liveRow);
        const sliceQty = pendingReadyQty(liveItem);
        const orderQty = Number(liveItem.qty) || 0;
        const remaining = Math.round((orderQty - submittedReadyQty(liveItem)) * 1000) / 1000;
        const busy = busyKey === liveRow.key;

        if (qcDialog.type === "skip") {
          const qtyNote = pendingRounds(liveItem).length
            ? `${formatQty(sliceQty)} ${liveItem.unit || "NOS"} (pending)`
            : `${formatQty(remaining)} ${liveItem.unit || "NOS"} (remaining)`;
          return (
            <div className="vq-modal-overlay" onClick={() => setQcDialog(null)}>
              <div className="vq-modal vq-modal--qc" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Skip QC">
                <div className="vq-modal-head">
                  <div>
                    <h3>Skip QC</h3>
                    <div className="vq-muted" style={{ marginTop: 4 }}>
                      Challan {liveOrder.srNo}
                      {liveOrder.vendorName ? ` · ${liveOrder.vendorName}` : ""}
                    </div>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQcDialog(null)}>✕</button>
                </div>
                <div className="vq-modal-body">
                  <div className="vq-item-desc">
                    <span>Item description</span>
                    <strong>{liveItem.description || "—"}</strong>
                    <div className="vq-item-sub">
                      {formatQty(orderQty)} {liveItem.unit || "NOS"}
                      {liveItem.process ? ` · ${liveItem.process}` : ""}
                      {liveItem.projectName ? ` · ${liveItem.projectName}` : ""}
                    </div>
                  </div>
                  <p className="vq-muted" style={{ marginBottom: 12 }}>
                    Skip only when quality check is not required. {qtyNote} will go to ready to dispatch.
                  </p>
                  <div className="field" style={{ marginBottom: 12 }}>
                    <label>
                      Reason for skip <span style={{ color: "var(--red)" }}>*</span>
                    </label>
                    <textarea
                      className="vq-remark"
                      rows={3}
                      value={draft.skipRemark ?? ""}
                      placeholder="Why is quality check not required?"
                      onChange={(e) => {
                        setDraft(liveRow.key, { skipRemark: e.target.value });
                        setQcDialogErr("");
                      }}
                      required
                    />
                  </div>
                  {qcDialogErr && <div className="vq-err" style={{ marginBottom: 10 }}>{qcDialogErr}</div>}
                  <div className="vq-modal-foot">
                    <button type="button" className="btn btn-ghost" onClick={() => setQcDialog(null)}>Cancel</button>
                    <button
                      type="button"
                      className="btn btn-in"
                      disabled={busy}
                      onClick={() => saveQcSkipFromDialog(liveRow)}
                    >
                      {busy ? "Saving…" : "Confirm skip"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        // type === "check"
        return (
          <div className="vq-modal-overlay" onClick={() => setQcDialog(null)}>
            <div className="vq-modal vq-modal--qc" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="QC Check">
              <div className="vq-modal-head">
                <div>
                  <h3>QC Check</h3>
                  <div className="vq-muted" style={{ marginTop: 4 }}>
                    Challan {liveOrder.srNo}
                    {liveOrder.vendorName ? ` · ${liveOrder.vendorName}` : ""}
                  </div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQcDialog(null)}>✕</button>
              </div>
              <div className="vq-modal-body">
                <div className="vq-item-desc">
                  <span>Item description</span>
                  <strong>{liveItem.description || "—"}</strong>
                  <div className="vq-item-sub">
                    {[liveItem.process, liveItem.projectName, liveItem.remark].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <div className="vq-modal-meta">
                  <div><span>Order qty</span><strong>{formatQty(orderQty)} {liveItem.unit || "NOS"}</strong></div>
                  <div><span>With QC</span><strong>{formatQty(sliceQty)} {liveItem.unit || "NOS"}</strong></div>
                  <div><span>Ready to dispatch</span><strong>{formatQty(inspectedTotals(liveItem).dispatch)}</strong></div>
                  <div><span>Project</span><strong>{liveItem.projectName || "—"}</strong></div>
                </div>
                <div className="vq-check-fields">
                  <label>
                    Dispatch
                    <input
                      type="number"
                      min="0"
                      max={sliceQty}
                      step="any"
                      value={draft.dispatch ?? ""}
                      placeholder={`Max ${formatQty(sliceQty)}`}
                      onChange={(e) => {
                        setDraft(liveRow.key, { dispatch: e.target.value });
                        setQcDialogErr("");
                      }}
                    />
                  </label>
                  <label>
                    Rework
                    <input
                      type="number"
                      min="0"
                      max={sliceQty}
                      step="any"
                      value={draft.rejected ?? ""}
                      placeholder={`Max ${formatQty(sliceQty)}`}
                      onChange={(e) => {
                        setDraft(liveRow.key, { rejected: e.target.value });
                        setQcDialogErr("");
                      }}
                    />
                  </label>
                </div>
                {Number(draft.rejected) > 0 && (
                  <textarea
                    className="vq-remark"
                    rows={2}
                    value={draft.remark ?? ""}
                    placeholder="Remark for rework (required)"
                    onChange={(e) => {
                      setDraft(liveRow.key, { remark: e.target.value });
                      setQcDialogErr("");
                    }}
                  />
                )}
                {qcDialogErr && <div className="vq-err" style={{ marginTop: 10 }}>{qcDialogErr}</div>}
                <div className="vq-modal-foot">
                  <button type="button" className="btn btn-ghost" onClick={() => setQcDialog(null)}>Cancel</button>
                  <button
                    type="button"
                    className="btn btn-in"
                    disabled={busy}
                    onClick={() => saveQcCheckFromDialog(liveRow)}
                  >
                    {busy ? "Saving…" : "Save QC"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })(), document.body)}

      {isVendor && ackOrder && createPortal(
        <div className="vq-modal-overlay" onClick={() => setAckOrder(null)}>
          <div className="vq-modal vq-modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Receive challan">
            <div className="vq-modal-head">
              <div>
                <h3>Receive {jobTypeLabel(orderJobType(ackOrder))} challan {ackOrder.srNo}</h3>
                <div className="vq-muted" style={{ marginTop: 4 }}>
                  Confirm the materials received and enter the expected ready date.
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setAckOrder(null)}>✕</button>
            </div>
            <form className="vq-modal-body" onSubmit={submitVendorAck}>
              <div className="vq-modal-meta">
                <div><span>Date</span><strong>{formatDate(ackOrder.date)}</strong></div>
                <div><span>Vehicle</span><strong>{ackOrder.vehicleNo || "—"}</strong></div>
                <div><span>Items</span><strong>{(ackOrder.items || []).length}</strong></div>
                <div><span>Send from</span><strong>{ackOrder.sendFromName || "—"}</strong></div>
              </div>
              <div className="vq-ack-items">
                <div className="vq-ack-items-head">Items you are receiving</div>
                <div className="vq-ack-items-scroll">
                  <table>
                    <colgroup>
                      <col className="vq-ack-sr" />
                      <col className="vq-ack-item" />
                      <col className="vq-ack-qty" />
                      <col className="vq-ack-uom" />
                      <col className="vq-ack-process" />
                      <col className="vq-ack-project" />
                      <col className="vq-ack-remark" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Sr</th>
                        <th>Item</th>
                        <th className="num">Qty</th>
                        <th>UOM</th>
                        <th>Process / RAL</th>
                        <th>Project</th>
                        <th>Remark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ackOrder.items || []).map((it, idx) => (
                        <tr key={idx}>
                          <td>{idx + 1}</td>
                          <td><strong>{it.description || "—"}</strong></td>
                          <td className="num">{formatQty(it.qty)}</td>
                          <td>{it.unit || "NOS"}</td>
                          <td>{it.process || "—"}</td>
                          <td>{it.projectName || "—"}</td>
                          <td>{it.remark || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>
                  Expected Dispatch Date <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  type="date"
                  value={ackExpectedDate}
                  onChange={(e) => setAckExpectedDate(e.target.value)}
                  onClick={(e) => e.target.showPicker && e.target.showPicker()}
                  required
                  style={{ width: "100%", cursor: "pointer" }}
                />
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Remark</label>
                <textarea
                  className="vq-remark"
                  rows={2}
                  value={ackNote}
                  onChange={(e) => setAckNote(e.target.value)}
                  placeholder="Optional note"
                />
              </div>
              {ackErr && <div className="vq-err" style={{ marginBottom: 10 }}>{ackErr}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="submit" className="btn btn-in" disabled={ackSaving}>
                  {ackSaving ? "Saving…" : "Confirm receive"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
