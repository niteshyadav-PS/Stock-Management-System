import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  getMaster,
  getPurchaseRequests,
  getPurchaseOrdersByPR,
  createPurchaseOrder,
  healPendingCreatePOs,
  getPurchaseOrders,
  getInward,
  getOutward,
  savePrItemPrices,
  deletePurchaseOrder,
  updatePurchaseOrder,
  getPurchaseOrderActivity,
  unwrapList,
} from "../api/api";
import { useAuth } from "../context/AuthContext";
import { todayStr, toDDMMYYYY } from "../utils/helpers";
import Pagination from "../components/Pagination";
import useClientPagination from "../hooks/useClientPagination";
import { buildStockByName } from "../utils/stockMaps";

const STATUS_LABEL = {
  pending: "Pending",
  approved: "Approved",
  partial: "Partially Ordered",
  rejected: "Rejected",
  ordered: "Ordered",
  received: "Received",
};

// Same material can appear on a PR for different projects — key by both.
function itemLineKey(name, projectName) {
  return `${String(name || "").trim()}||${String(projectName || "").trim()}`;
}

function resolveProject(...parts) {
  for (const p of parts) {
    const s = String(p || "").trim();
    if (s) return s;
  }
  return "";
}

function buildAlreadyOrderedMap(existingPOs) {
  const alreadyOrdered = {};
  for (const po of existingPOs || []) {
    for (const it of po.items || []) {
      // Prefer line project; fall back to PO header (legacy rows missing line projectName)
      const key = itemLineKey(
        it.name,
        resolveProject(it.projectName, po.projectName),
      );
      alreadyOrdered[key] =
        (alreadyOrdered[key] || 0) + (parseFloat(it.orderedQty) || 0);
    }
  }
  return alreadyOrdered;
}

function alreadyForPrLine(alreadyOrdered, pr, it) {
  const project = resolveProject(it.projectName, pr.projectName);
  const key = itemLineKey(it.name, project);
  if ((alreadyOrdered[key] || 0) > 0) return alreadyOrdered[key] || 0;

  const bareKey = itemLineKey(it.name, "");
  const sameNameCount = (pr.items || []).filter(
    (x) => String(x.name || "").trim() === String(it.name || "").trim(),
  ).length;
  if (sameNameCount === 1 && (alreadyOrdered[bareKey] || 0) > 0) {
    return alreadyOrdered[bareKey] || 0;
  }
  return alreadyOrdered[key] || 0;
}

function prHasRemaining(pr, allPos) {
  const prPos = (allPos || []).filter(
    (p) => String(p.prId) === String(pr._id),
  );
  const alreadyOrdered = buildAlreadyOrderedMap(prPos);
  return (pr.items || []).some((it) => {
    const already = alreadyForPrLine(alreadyOrdered, pr, it);
    return parseFloat(it.qty) - already > 0.00001;
  });
}

export default function PurchaseOrders() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const userRole = String(user?.role || "")
    .trim()
    .toLowerCase();
  const isAdmin = userRole === "admin";
  const isPurchase = userRole === "purchase";
  const canEditPO = isAdmin || isPurchase;
  const canDeletePO = isAdmin;
  const canViewActivity = isAdmin || isPurchase;

  const [requests, setRequests] = useState([]);
  const [poList, setPoList] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [expandedPr, setExpandedPr] = useState(null);
  const [expandedPo, setExpandedPo] = useState(null);
  const [prItemsMap, setPrItemsMap] = useState({});
  const [prItemsLoading, setPrItemsLoading] = useState({});

  const [selectedPrId, setSelectedPrId] = useState("");
  const [selectedPr, setSelectedPr] = useState(null);
  const [poNumber, setPoNumber] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [poProjectName, setPoProjectName] = useState("");
  const [poDate, setPoDate] = useState(todayStr());
  const [poExpectedDate, setPoExpectedDate] = useState("");
  const [poItems, setPoItems] = useState([]);
  const [initLoading, setInitLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [msg, setMsg] = useState({ text: "", ok: true });
  const [stockMap, setStockMap] = useState({});
  const [exportLoading, setExportLoading] = useState(false);
  const [poExportLoading, setPoExportLoading] = useState(false);

  // ── PO edit / delete state ───────────────────────────────────────────────
  const [editingPO, setEditingPO] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoadingId, setDeleteLoadingId] = useState(null);

  // ── Per-PO activity, shown inline when a PO row is expanded ─────────────
  const [poActivityMap, setPoActivityMap] = useState({});
  const [poActivityLoading, setPoActivityLoading] = useState({});

  // ── Price-save state per PR (keyed by PR id) ─────────────────────────────
  const [priceSaveLoading, setPriceSaveLoading] = useState({});
  const [priceSaveMsg, setPriceSaveMsg] = useState({});

  const load = useCallback(async () => {
    try {
      const [m, reqs, pos, inw, out] = await Promise.all([
        getMaster(),
        getPurchaseRequests(),
        getPurchaseOrders(),
        getInward(),
        getOutward(),
      ]);
      const masterList = unwrapList(m);
      const requestList = unwrapList(reqs);
      const posList = unwrapList(pos);
      const map = buildStockByName(masterList, unwrapList(inw), unwrapList(out));

      // Show data immediately — never block the table on heal
      setStockMap(map);
      setPoList(posList);
      setRequests(requestList);

      // Heal stuck PRs in the background; refresh lists only if something changed
      healPendingCreatePOs()
        .then(async (heal) => {
          if (!(heal?.healed > 0 || heal?.itemsFixed > 0)) return;
          const [reqs2, pos2] = await Promise.all([
            getPurchaseRequests(),
            getPurchaseOrders(),
          ]);
          setRequests(unwrapList(reqs2));
          setPoList(unwrapList(pos2));
        })
        .catch(() => {
          /* heal is best-effort */
        });
    } catch (err) {
      console.error("Failed to load purchase orders page:", err);
      setMsg({
        text: "Failed to load data: " + (err.message || "unknown error"),
        ok: false,
      });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const eligiblePRs = useMemo(
    () =>
      requests.filter(
        (r) =>
          ["approved", "partial"].includes(r.status) &&
          prHasRemaining(r, poList),
      ),
    [requests, poList],
  );
  const {
    pageItems: prPageItems,
    page: prPage,
    pageSize: prPageSize,
    total: prTotal,
    setPage: setPrPage,
    setPageSize: setPrPageSize,
  } = useClientPagination(eligiblePRs, 25);
  const {
    pageItems: poPageItems,
    page: poPage,
    pageSize: poPageSize,
    total: poTotal,
    setPage: setPoPage,
    setPageSize: setPoPageSize,
  } = useClientPagination(poList, 25);

  // ── Load pending items for a PR in the pending section ───────────────────
  // Only lines with remaining qty > 0 are kept. Fully ordered lines (PR Qty =
  // Already Ordered) are dropped from Pending Create PO.
  async function loadPrItems(pr) {
    if (prItemsMap[pr._id]) {
      setExpandedPr((prev) => (prev === pr._id ? null : pr._id));
      return;
    }
    setExpandedPr(pr._id);
    setPrItemsLoading((prev) => ({ ...prev, [pr._id]: true }));
    try {
      const existingPOs = await getPurchaseOrdersByPR(pr._id);
      const alreadyOrdered = buildAlreadyOrderedMap(existingPOs);

      const rows = pr.items
        .map((it) => {
          const already = alreadyForPrLine(alreadyOrdered, pr, it);
          const remaining = Math.max(
            0,
            parseFloat((it.qty - already).toFixed(6)),
          );
          return { ...it, already, remaining, price: it.price ?? "" };
        })
        .filter((it) => it.remaining > 0.00001);
      setPrItemsMap((prev) => ({ ...prev, [pr._id]: rows }));
    } catch (err) {
      console.error(err);
    } finally {
      setPrItemsLoading((prev) => ({ ...prev, [pr._id]: false }));
    }
  }

  function remainingLinesCount(pr) {
    if (prItemsMap[pr._id]) return prItemsMap[pr._id].length;
    // Until expanded, estimate from poList already in memory
    const prPos = poList.filter((p) => String(p.prId) === String(pr._id));
    const alreadyOrdered = buildAlreadyOrderedMap(prPos);
    return (pr.items || []).filter((it) => {
      const already = alreadyForPrLine(alreadyOrdered, pr, it);
      return parseFloat(it.qty) - already > 0.00001;
    }).length;
  }

  // ── Expand/collapse a PO row, loading its activity log the first time ────
  async function togglePoRow(po) {
    const id = po._id;
    const willOpen = expandedPo !== id;
    setExpandedPo((prev) => (prev === id ? null : id));

    if (willOpen && canViewActivity && !poActivityMap[id]) {
      await fetchPoActivity(id);
    }
  }

  async function fetchPoActivity(id) {
    setPoActivityLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const activities = await getPurchaseOrderActivity(id);
      setPoActivityMap((prev) => ({
        ...prev,
        [id]: Array.isArray(activities) ? activities : [],
      }));
    } catch (err) {
      setPoActivityMap((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setPoActivityLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  function updatePrItemPrice(prId, idx, value) {
    setPrItemsMap((prev) => {
      const rows = prev[prId];
      if (!rows) return prev;
      const updated = rows.map((row, i) =>
        i === idx ? { ...row, price: value } : row,
      );
      return { ...prev, [prId]: updated };
    });
  }

  async function savePrPrices(pr) {
    const rows = prItemsMap[pr._id];
    if (!rows || !rows.length) return;

    setPriceSaveLoading((prev) => ({ ...prev, [pr._id]: true }));
    setPriceSaveMsg((prev) => ({ ...prev, [pr._id]: { text: "", ok: true } }));
    try {
      const payload = rows.map((r) => ({
        name: r.name,
        price: parseFloat(r.price) || 0,
      }));
      const updatedPr = await savePrItemPrices(pr._id, payload);
      setPrItemsMap((prev) => ({
        ...prev,
        [pr._id]: prev[pr._id].map((row) => {
          const match = updatedPr.items.find((it) => it.name === row.name);
          return match ? { ...row, price: match.price } : row;
        }),
      }));
      setPriceSaveMsg((prev) => ({
        ...prev,
        [pr._id]: { text: "✓ Prices saved.", ok: true },
      }));
    } catch (err) {
      setPriceSaveMsg((prev) => ({
        ...prev,
        [pr._id]: { text: "Error: " + err.message, ok: false },
      }));
    } finally {
      setPriceSaveLoading((prev) => ({ ...prev, [pr._id]: false }));
    }
  }

  // ── PO edit / delete ──────────────────────────────────────────────────────
  function handleEditPO(po) {
    if (!canEditPO) {
      alert("You do not have permission to edit purchase orders.");
      return;
    }

    setEditingPO({
      ...po,
      items: (po.items || []).map((item) => ({
        ...item,
        orderedQty: item.orderedQty ?? "",
        price: item.price ?? "",
        remarks: item.remarks ?? "",
        projectName: item.projectName ?? po.projectName ?? "",
      })),
    });
  }

  function updateEditingPOField(field, value) {
    setEditingPO((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  function updateEditingPOItem(index, field, value) {
    setEditingPO((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((item, i) =>
          i === index ? { ...item, [field]: value } : item,
        ),
      };
    });
  }

  function removeEditingPOItem(index) {
    setEditingPO((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.filter((_, i) => i !== index),
      };
    });
  }

  async function handleUpdatePO() {
    if (!editingPO) return;

    if (!canEditPO) {
      alert("You do not have permission to edit purchase orders.");
      return;
    }

    if (!editingPO.poNumber?.trim()) {
      alert("PO number is required.");
      return;
    }
    if (!editingPO.vendorName?.trim()) {
      alert("Vendor name is required.");
      return;
    }
    if (!editingPO.poDate) {
      alert("PO date is required.");
      return;
    }
    if (!editingPO.items?.length) {
      alert("At least one item is required.");
      return;
    }

    for (const item of editingPO.items) {
      const qty = parseFloat(item.orderedQty);
      const price = parseFloat(item.price);

      if (!qty || qty <= 0) {
        alert(`"${item.name}": ordered quantity must be greater than 0.`);
        return;
      }
      if (!price || price <= 0) {
        alert(`"${item.name}": unit price must be greater than 0.`);
        return;
      }
    }

    setEditLoading(true);

    try {
      await updatePurchaseOrder(editingPO._id, {
        poNumber: editingPO.poNumber.trim(),
        vendorName: editingPO.vendorName.trim(),
        projectName: editingPO.projectName || "",
        poDate: editingPO.poDate,
        poExpectedDate: editingPO.poExpectedDate || "",
        items: editingPO.items.map((item) => ({
          name: item.name,
          code: item.code || "",
          category: item.category || "",
          uom: item.uom || "",
          projectName: item.projectName || editingPO.projectName || "",
          orderedQty: parseFloat(item.orderedQty),
          price: parseFloat(item.price) || 0,
          remarks: item.remarks || "",
        })),
      });

      const updatedId = editingPO._id;
      setEditingPO(null);
      setExpandedPo(updatedId);
      await load();

      // Refresh this PO's activity so the newly-logged change shows up
      // immediately in the expanded row.
      if (canViewActivity) {
        await fetchPoActivity(updatedId);
      }
    } catch (err) {
      alert("Failed to update purchase order: " + err.message);
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDeletePO(po) {
    if (!isAdmin) {
      alert("Only Admin can delete purchase orders.");
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete PO "${po.poNumber}"? This action cannot be undone.`,
    );
    if (!confirmed) return;

    setDeleteLoadingId(po._id);

    try {
      await deletePurchaseOrder(po._id);

      if (expandedPo === po._id) setExpandedPo(null);
      setPoActivityMap((prev) => {
        const next = { ...prev };
        delete next[po._id];
        return next;
      });

      await load();
    } catch (err) {
      alert("Failed to delete purchase order: " + err.message);
    } finally {
      setDeleteLoadingId(null);
    }
  }

  // ── Form PR change ────────────────────────────────────────────────────────
  async function handlePrChange(prId) {
    setSelectedPrId(prId);
    setPoItems([]);
    setPoProjectName("");
    setMsg({ text: "", ok: true });
    if (!prId) {
      setSelectedPr(null);
      return;
    }
    const pr = requests.find((r) => r._id === prId);
    setSelectedPr(pr);
    setPoProjectName(pr.projectName || "");
    setInitLoading(true);
    try {
      const existingPOs = await getPurchaseOrdersByPR(prId);
      const alreadyOrdered = buildAlreadyOrderedMap(existingPOs);

      const rows = [];
      for (const it of pr.items) {
        const already = alreadyForPrLine(alreadyOrdered, pr, it);
        const remaining = Math.max(
          0,
          parseFloat((it.qty - already).toFixed(6)),
        );
        if (remaining <= 0) continue;
        rows.push({
          _key: Math.random().toString(36).slice(2),
          name: it.name,
          code: it.code || "",
          category: it.category || "",
          uom: it.uom || "",
          remarks: it.remarks || "",
          projectName: resolveProject(it.projectName, pr.projectName),
          orderedQty: String(remaining),
          price: it.price ? String(it.price) : "",
          maxQty: remaining,
          prQty: it.qty,
          alreadyOrdered: already,
        });
      }
      setPoItems(rows);
    } catch (err) {
      setMsg({ text: "Failed to load PR data: " + err.message, ok: false });
    } finally {
      setInitLoading(false);
    }
  }

  function updatePoItem(key, patch) {
    setPoItems((list) =>
      list.map((it) => (it._key === key ? { ...it, ...patch } : it)),
    );
  }
  function removePoItem(key) {
    setPoItems((list) => list.filter((it) => it._key !== key));
  }

  function resetForm() {
    setShowForm(false);
    setSelectedPrId("");
    setSelectedPr(null);
    setPoNumber("");
    setVendorName("");
    setPoProjectName("");
    setPoDate(todayStr());
    setPoExpectedDate("");
    setPoItems([]);
    setMsg({ text: "", ok: true });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (initLoading) return;
    if (!selectedPr) {
      setMsg({ text: "Please select a PR.", ok: false });
      return;
    }
    if (!poNumber.trim()) {
      setMsg({ text: "PO number is required.", ok: false });
      return;
    }
    if (!vendorName.trim()) {
      setMsg({ text: "Vendor name is required.", ok: false });
      return;
    }
    if (!poDate) {
      setMsg({ text: "PO date is required.", ok: false });
      return;
    }
    if (!poItems.length) {
      setMsg({ text: "At least one item is required.", ok: false });
      return;
    }

    for (const it of poItems) {
      const qty = parseFloat(it.orderedQty);
      if (!qty || qty <= 0) {
        setMsg({ text: `"${it.name}": qty must be > 0.`, ok: false });
        return;
      }
      if (qty > it.maxQty + 0.00001) {
        setMsg({
          text: `"${it.name}": qty exceeds remaining (${it.maxQty}).`,
          ok: false,
        });
        return;
      }
      const price = parseFloat(it.price);
      if (!price || price <= 0) {
        setMsg({ text: `"${it.name}": unit price is required.`, ok: false });
        return;
      }
    }

    setFormLoading(true);
    try {
      const uniqueProjectNames = [
        ...new Set(poItems.map((it) => it.projectName).filter(Boolean)),
      ];
      const created = await createPurchaseOrder({
        poNumber: poNumber.trim(),
        prNumber: selectedPr.prNumber,
        prId: selectedPr._id,
        vendorName: vendorName.trim(),
        projectName: poProjectName || uniqueProjectNames.join(", "),
        poDate,
        poExpectedDate,
        items: poItems.map((it) => ({
          name: it.name,
          code: it.code,
          category: it.category,
          uom: it.uom,
          remarks: it.remarks,
          projectName: resolveProject(it.projectName, poProjectName),
          orderedQty: parseFloat(it.orderedQty),
          price: parseFloat(it.price) || 0,
        })),
      });
      const fullyCovered = !!created?.fullyCovered || created?.prStatus === "ordered";
      setMsg({
        text: fullyCovered
          ? `✓ ${poNumber} created. PR ${selectedPr.prNumber} is fully ordered and removed from Pending Create PO.`
          : `✓ ${poNumber} created. PR ${selectedPr.prNumber} still has remaining items, so it stays in Pending Create PO until all lines are ordered.`,
        ok: true,
      });
      setPrItemsMap({});
      setExpandedPr(null);
      await load();
      setTimeout(resetForm, fullyCovered ? 1500 : 3500);
    } catch (err) {
      setMsg({ text: "Error: " + err.message, ok: false });
    } finally {
      setFormLoading(false);
    }
  }

  // ── Export all pending-PO data to Excel ──────────────────────────────────
  async function exportPendingToExcel() {
    setExportLoading(true);
    try {
      const prHeaders = [
        "PR No",
        "Date",
        "Project",
        "Request From",
        "Requested by",
        "Items",
        "Status",
      ];
      const prRows = eligiblePRs.map((pr) => [
        pr.prNumber,
        toDDMMYYYY(pr.date),
        pr.projectName || "",
        pr.requestFrom || "",
        pr.requestedByName || "",
        remainingLinesCount(pr),
        STATUS_LABEL[pr.status] || pr.status,
      ]);

      const itemHeaders = [
        "PR No",
        "Project",
        "Material",
        "Code",
        "UOM",
        "PR Qty",
        "Already Ordered",
        "Remaining",
        "Current Stock",
      ];
      const itemRows = [];

      for (const pr of eligiblePRs) {
        let rows = prItemsMap[pr._id];
        if (!rows) {
          const existingPOs = await getPurchaseOrdersByPR(pr._id);
          const alreadyOrdered = buildAlreadyOrderedMap(existingPOs);

          rows = pr.items
            .map((it) => {
              const already = alreadyForPrLine(alreadyOrdered, pr, it);
              const remaining = Math.max(
                0,
                parseFloat((it.qty - already).toFixed(6)),
              );
              return { ...it, already, remaining };
            })
            .filter((it) => it.remaining > 0.00001);
        }

        rows.forEach((it) => {
          if (it.remaining <= 0.00001) return;
          const stock = stockMap[it.name];
          itemRows.push([
            pr.prNumber,
            it.projectName || pr.projectName || "",
            it.name,
            it.code || "",
            it.uom || "",
            it.qty,
            it.already > 0 ? it.already : 0,
            it.remaining,
            stock === undefined || stock === null ? "" : stock,
          ]);
        });
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([prHeaders, ...prRows]),
        "Pending PRs",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([itemHeaders, ...itemRows]),
        "Pending Items",
      );
      XLSX.writeFile(wb, `Pending_PO_Data_${todayStr()}.xlsx`);
    } catch (err) {
      alert("Export failed: " + err.message);
    } finally {
      setExportLoading(false);
    }
  }

  // ── Export All Purchase Orders table (+ line items) to Excel ─────────────
  function exportAllPOsToExcel() {
    if (!poList.length) {
      alert("No purchase orders to export.");
      return;
    }
    setPoExportLoading(true);
    try {
      const prMapLocal = Object.fromEntries(
        requests.map((r) => [r.prNumber, r]),
      );

      const poHeaders = [
        "PO No",
        "PO Date",
        "Expected Date",
        "PR No",
        "Vendor",
        "Project",
        "Items",
        "Total Value",
        "Created by",
      ];
      const poRows = poList.map((po) => {
        const totalValue = (po.items || []).reduce(
          (s, i) => s + (i.orderedQty || 0) * (i.price || 0),
          0,
        );
        const pr = prMapLocal[po.prNumber];
        return [
          po.poNumber || "",
          toDDMMYYYY(po.poDate) || "",
          po.poExpectedDate ? toDDMMYYYY(po.poExpectedDate) : "",
          po.prNumber || "",
          po.vendorName || "",
          po.projectName || pr?.projectName || "",
          po.items?.length || 0,
          totalValue > 0 ? Number(totalValue.toFixed(2)) : "",
          po.createdByName || "",
        ];
      });

      const itemHeaders = [
        "PO No",
        "PO Date",
        "PR No",
        "Vendor",
        "Material",
        "Code",
        "Category",
        "Project",
        "UOM",
        "Ordered Qty",
        "Unit Price",
        "Value",
        "Remarks",
      ];
      const itemRows = [];
      for (const po of poList) {
        const pr = prMapLocal[po.prNumber];
        for (const it of po.items || []) {
          const qty = it.orderedQty || 0;
          const price = it.price || 0;
          itemRows.push([
            po.poNumber || "",
            toDDMMYYYY(po.poDate) || "",
            po.prNumber || "",
            po.vendorName || "",
            it.name || "",
            it.code || "",
            it.category || "",
            it.projectName || po.projectName || pr?.projectName || "",
            it.uom || "",
            qty,
            price,
            Number((qty * price).toFixed(2)),
            it.remarks || "",
          ]);
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([poHeaders, ...poRows]),
        "Purchase Orders",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([itemHeaders, ...itemRows]),
        "PO Line Items",
      );
      XLSX.writeFile(wb, `All_Purchase_Orders_${todayStr()}.xlsx`);
    } catch (err) {
      alert("Export failed: " + err.message);
    } finally {
      setPoExportLoading(false);
    }
  }

  const prMap = Object.fromEntries(requests.map((r) => [r.prNumber, r]));

  const thStyle = {
    padding: "8px 10px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    borderBottom: "2px solid var(--line)",
    whiteSpace: "nowrap",
    background: "var(--paper-dim)",
  };
  const tdStyle = {
    padding: "7px 10px",
    verticalAlign: "middle",
    fontSize: 13,
  };

  return (
    <>
      <div className="pagehead">
        <div className="pagehead-text">
          <h2>Purchase Orders</h2>
          <p>
            Create and manage purchase orders against approved purchase
            requests.
          </p>
        </div>
        {!showForm && (
          <button className="btn btn-in" onClick={() => setShowForm(true)}>
            + Create PO
          </button>
        )}
      </div>

      {/* ── Create PO form ────────────────────────────────────────────────── */}
      {showForm && (
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <h3 style={{ margin: 0 }}>Create Purchase Order</h3>
            <button className="btn btn-ghost btn-sm" onClick={resetForm}>
              ✕ Cancel
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div
              className="formgrid"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 14,
                marginBottom: 4,
              }}
            >
              <div className="field" style={{ gridColumn: "1 / 3" }}>
                <label>
                  Select Purchase Request{" "}
                  <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <select
                  value={selectedPrId}
                  onChange={(e) => handlePrChange(e.target.value)}
                >
                  <option value="">— Select PR —</option>
                  {eligiblePRs.map((pr) => (
                    <option key={pr._id} value={pr._id}>
                      {pr.prNumber} — {toDDMMYYYY(pr.date)}
                      {pr.projectName ? ` · ${pr.projectName}` : ""}
                      {pr.requestFrom ? ` · From: ${pr.requestFrom}` : ""} (
                      {pr.items.length} item{pr.items.length !== 1 ? "s" : ""})
                      [{STATUS_LABEL[pr.status]}]
                    </option>
                  ))}
                </select>
                {eligiblePRs.length === 0 && (
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--red)",
                      margin: "4px 0 0",
                    }}
                  >
                    No approved or partially ordered PRs available.
                  </p>
                )}
              </div>

              <div className="field">
                <label>
                  PO Number <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  type="text"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder="Enter PO number"
                  style={{ fontWeight: 700 }}
                />
              </div>
              <div className="field">
                <label>
                  Vendor Name <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  type="text"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="e.g. ABC Suppliers Pvt. Ltd."
                />
              </div>
              <div className="field">
                <label>Project Name</label>
                <input
                  type="text"
                  value={poProjectName}
                  onChange={(e) => setPoProjectName(e.target.value)}
                  placeholder="e.g. Thailand - Damac & Stock"
                />
              </div>
              <div className="field">
                <label>
                  PO Date <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  type="date"
                  value={poDate}
                  min={todayStr()}
                  onChange={(e) => setPoDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Expected Delivery Date</label>
                <input
                  type="date"
                  value={poExpectedDate}
                  min={poDate || todayStr()}
                  onChange={(e) => setPoExpectedDate(e.target.value)}
                />
              </div>
            </div>

            {selectedPr && (
              <>
                <div
                  style={{
                    marginTop: 18,
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                  }}
                >
                  <strong style={{ fontSize: 13 }}>
                    Materials from {selectedPr.prNumber}
                  </strong>
                  {selectedPr.projectName && (
                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                      Project: {selectedPr.projectName}
                    </span>
                  )}
                  {selectedPr.requestFrom && (
                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                      From: {selectedPr.requestFrom}
                    </span>
                  )}
                </div>

                {initLoading ? (
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--text-3)",
                      margin: "10px 0",
                    }}
                  >
                    Loading items…
                  </p>
                ) : poItems.length === 0 ? (
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--red)",
                      margin: "10px 0",
                    }}
                  >
                    All items in this PR have already been fully ordered.
                  </p>
                ) : (
                  <div style={{ overflowX: "auto", marginBottom: 10 }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 13,
                      }}
                    >
                      <thead>
                        <tr style={{ background: "var(--paper-dim)" }}>
                          {[
                            "Material",
                            "Code",
                            "Project",
                            "UOM",
                            "PR Qty",
                            "Already Ordered",
                            "Remaining",
                            "Current Stock",
                            "PO Qty *",
                            "Unit Price *",
                            "",
                          ].map((h, i) => (
                            <th
                              key={i}
                              style={{
                                padding: "8px 10px",
                                textAlign: i >= 4 && i <= 8 ? "right" : "left",
                                fontSize: 11,
                                fontWeight: 700,
                                letterSpacing: "0.04em",
                                borderBottom: "2px solid var(--line)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {poItems.map((it) => (
                          <tr
                            key={it._key}
                            style={{ borderBottom: "1px solid var(--line)" }}
                          >
                            <td
                              style={{ padding: "7px 10px", fontWeight: 500 }}
                            >
                              {it.name}
                            </td>
                            <td
                              style={{
                                padding: "7px 10px",
                                fontFamily: "monospace",
                                fontSize: 12,
                              }}
                            >
                              {it.code || "—"}
                            </td>
                            <td style={{ padding: "7px 10px" }}>
                              <input
                                type="text"
                                value={it.projectName}
                                onChange={(e) =>
                                  updatePoItem(it._key, {
                                    projectName: e.target.value,
                                  })
                                }
                                placeholder={
                                  selectedPr?.projectName || "Project"
                                }
                                style={{ width: 110 }}
                              />
                            </td>
                            <td style={{ padding: "7px 10px" }}>
                              {it.uom || "—"}
                            </td>
                            <td
                              style={{
                                padding: "7px 10px",
                                textAlign: "right",
                                color: "var(--text-3)",
                              }}
                            >
                              {it.prQty}
                            </td>
                            <td
                              style={{
                                padding: "7px 10px",
                                textAlign: "right",
                                color:
                                  it.alreadyOrdered > 0
                                    ? "#2a9d8f"
                                    : "var(--text-3)",
                              }}
                            >
                              {it.alreadyOrdered > 0 ? it.alreadyOrdered : "0"}
                            </td>
                            <td
                              style={{
                                padding: "7px 10px",
                                textAlign: "right",
                                fontWeight: 600,
                              }}
                            >
                              {it.maxQty}
                            </td>
                            <td
                              style={{
                                padding: "7px 10px",
                                textAlign: "right",
                              }}
                            >
                              {(() => {
                                const stock = stockMap[it.name] ?? null;
                                if (stock === null)
                                  return (
                                    <span style={{ color: "var(--text-3)" }}>
                                      —
                                    </span>
                                  );
                                const isLow = stock < it.prQty;
                                const color =
                                  stock <= 0
                                    ? "var(--red)"
                                    : isLow
                                      ? "var(--amber)"
                                      : "var(--teal-dark)";
                                return (
                                  <strong style={{ color }}>
                                    {Number(stock).toLocaleString("en-IN", {
                                      maximumFractionDigits: 2,
                                    })}
                                  </strong>
                                );
                              })()}
                            </td>
                            <td style={{ padding: "7px 10px" }}>
                              <input
                                type="number"
                                min="0.0001"
                                step="any"
                                max={it.maxQty}
                                value={it.orderedQty}
                                onChange={(e) =>
                                  updatePoItem(it._key, {
                                    orderedQty: e.target.value,
                                  })
                                }
                                style={{ width: 80, textAlign: "right" }}
                              />
                            </td>
                            <td style={{ padding: "7px 10px" }}>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={it.price}
                                onChange={(e) =>
                                  updatePoItem(it._key, {
                                    price: e.target.value,
                                  })
                                }
                                placeholder="0.00"
                                style={{
                                  width: 90,
                                  textAlign: "right",
                                  borderColor:
                                    !it.price || parseFloat(it.price) <= 0
                                      ? "var(--red)"
                                      : undefined,
                                }}
                              />
                            </td>
                            <td style={{ padding: "7px 10px" }}>
                              <button
                                type="button"
                                className="btn-del btn-sm"
                                onClick={() => removePoItem(it._key)}
                                title="Skip in this PO"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p
                      style={{
                        fontSize: 11.5,
                        color: "var(--text-3)",
                        marginTop: 6,
                      }}
                    >
                      ✕ skips an item from <em>this PO only</em> — it can be
                      ordered in the next PO.
                    </p>
                  </div>
                )}
              </>
            )}

            {msg.text && (
              <p
                style={{
                  fontSize: 13,
                  color: msg.ok ? "#2a9d8f" : "var(--red)",
                  margin: "10px 0",
                }}
              >
                {msg.text}
              </p>
            )}

            <div className="actionrow" style={{ marginTop: 16 }}>
              <button
                className="btn btn-in"
                type="submit"
                disabled={
                  formLoading ||
                  initLoading ||
                  !selectedPr ||
                  poItems.length === 0
                }
              >
                {formLoading ? "Saving…" : "Save PO"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetForm}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Pending PRs section ───────────────────────────────────────────── */}
      <div className="card card-wide">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0 }}>
            Pending Create PO
            <span className="pill-count">{eligiblePRs.length}</span>
          </h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={exportPendingToExcel}
            disabled={exportLoading || eligiblePRs.length === 0}
          >
            {exportLoading ? "Exporting…" : "⭳ Export Excel"}
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: "-8px 0 14px" }}>
          Fully ordered lines are removed here. Only items with remaining qty stay — when remaining hits 0 for every line, the PR leaves this list.
        </p>
        {eligiblePRs.length === 0 ? (
          <div className="empty">
            No approved or partially ordered PRs available.
          </div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>PR No</th>
                  <th>Date</th>
                  <th>Project</th>
                  <th>Request From</th>
                  <th>Requested by</th>
                  <th>Pending items</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {prPageItems.map((pr) => (
                  <React.Fragment key={pr._id}>
                    <tr
                      style={{ cursor: "pointer" }}
                      onClick={() => loadPrItems(pr)}
                    >
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {pr.prNumber}
                      </td>
                      <td className="nowrap">{toDDMMYYYY(pr.date)}</td>
                      <td>{pr.projectName || "—"}</td>
                      <td>{pr.requestFrom || "—"}</td>
                      <td>{pr.requestedByName}</td>
                      <td>{remainingLinesCount(pr)}</td>
                      <td>
                        <span className={`tag ${pr.status}`}>
                          {STATUS_LABEL[pr.status]}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn btn-sm btn-in"
                          onClick={() => {
                            setShowForm(true);
                            setTimeout(() => handlePrChange(pr._id), 100);
                          }}
                        >
                          Pending Create PO
                        </button>
                      </td>
                    </tr>

                    {expandedPr === pr._id && (
                      <tr>
                        <td
                          colSpan={8}
                          style={{ background: "var(--paper-dim)", padding: 0 }}
                        >
                          <div style={{ padding: "14px 20px" }}>
                            {prItemsLoading[pr._id] ? (
                              <p
                                style={{ fontSize: 13, color: "var(--text-3)" }}
                              >
                                Loading items…
                              </p>
                            ) : (prItemsMap[pr._id] || []).length === 0 ? (
                              <p
                                style={{ fontSize: 13, color: "var(--text-3)" }}
                              >
                                No remaining items — all lines are fully ordered.
                              </p>
                            ) : (
                              <div className="tablewrap">
                                <table style={{ fontSize: 12 }}>
                                  <thead>
                                    <tr>
                                      <th style={thStyle}>Material</th>
                                      <th style={thStyle}>Code</th>
                                      <th style={thStyle}>Project</th>
                                      <th style={thStyle}>UOM</th>
                                      <th
                                        style={{
                                          ...thStyle,
                                          textAlign: "right",
                                        }}
                                      >
                                        PR Qty
                                      </th>
                                      <th
                                        style={{
                                          ...thStyle,
                                          textAlign: "right",
                                        }}
                                      >
                                        Already Ordered
                                      </th>
                                      <th
                                        style={{
                                          ...thStyle,
                                          textAlign: "right",
                                        }}
                                      >
                                        Remaining
                                      </th>
                                      <th
                                        style={{
                                          ...thStyle,
                                          textAlign: "right",
                                        }}
                                      >
                                        Current Stock
                                      </th>
                                      <th
                                        style={{
                                          ...thStyle,
                                          textAlign: "right",
                                        }}
                                      >
                                        Price
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(prItemsMap[pr._id] || []).map((it, i) => {
                                      const stock = stockMap[it.name] ?? null;
                                      const isLow =
                                        stock !== null && stock < it.qty;
                                      const stockColor =
                                        stock === null
                                          ? "var(--text-3)"
                                          : stock <= 0
                                            ? "var(--red)"
                                            : isLow
                                              ? "var(--amber)"
                                              : "var(--teal-dark)";
                                      return (
                                        <tr
                                          key={i}
                                          style={{
                                            borderBottom:
                                              "1px solid var(--line)",
                                          }}
                                        >
                                          <td style={tdStyle}>
                                            <strong>{it.name}</strong>
                                          </td>
                                          <td
                                            style={{
                                              ...tdStyle,
                                              fontFamily: "monospace",
                                              fontSize: 12,
                                            }}
                                          >
                                            {it.code || "—"}
                                          </td>
                                          <td style={tdStyle}>
                                            {it.projectName ||
                                              pr.projectName ||
                                              "—"}
                                          </td>
                                          <td style={tdStyle}>
                                            {it.uom || "—"}
                                          </td>
                                          <td
                                            style={{
                                              ...tdStyle,
                                              textAlign: "right",
                                              color: "var(--text-3)",
                                            }}
                                          >
                                            {it.qty}
                                          </td>
                                          <td
                                            style={{
                                              ...tdStyle,
                                              textAlign: "right",
                                              color:
                                                it.already > 0
                                                  ? "#2a9d8f"
                                                  : "var(--text-3)",
                                            }}
                                          >
                                            {it.already > 0 ? it.already : "0"}
                                          </td>
                                          <td
                                            style={{
                                              ...tdStyle,
                                              textAlign: "right",
                                              fontWeight: 600,
                                            }}
                                          >
                                            <span
                                              style={{
                                                color:
                                                  it.remaining <= 0
                                                    ? "var(--red)"
                                                    : "var(--teal-dark)",
                                              }}
                                            >
                                              {it.remaining}
                                            </span>
                                          </td>
                                          <td
                                            style={{
                                              ...tdStyle,
                                              textAlign: "right",
                                            }}
                                          >
                                            {stock === null ? (
                                              <span
                                                style={{
                                                  color: "var(--text-3)",
                                                }}
                                              >
                                                —
                                              </span>
                                            ) : (
                                              <strong
                                                style={{ color: stockColor }}
                                              >
                                                {Number(stock).toLocaleString(
                                                  "en-IN",
                                                  { maximumFractionDigits: 2 },
                                                )}
                                              </strong>
                                            )}
                                          </td>
                                          <td
                                            style={{
                                              ...tdStyle,
                                              textAlign: "right",
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <input
                                              type="number"
                                              min="0"
                                              step="any"
                                              value={it.price}
                                              onChange={(e) =>
                                                updatePrItemPrice(
                                                  pr._id,
                                                  i,
                                                  e.target.value,
                                                )
                                              }
                                              placeholder="0.00"
                                              style={{
                                                width: 90,
                                                textAlign: "right",
                                              }}
                                            />
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {!prItemsLoading[pr._id] &&
                              (prItemsMap[pr._id] || []).length > 0 && (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    marginTop: 10,
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="btn btn-in btn-sm"
                                    disabled={priceSaveLoading[pr._id]}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      savePrPrices(pr);
                                    }}
                                  >
                                    {priceSaveLoading[pr._id]
                                      ? "Saving…"
                                      : "Save Prices"}
                                  </button>
                                  {priceSaveMsg[pr._id]?.text && (
                                    <span
                                      style={{
                                        fontSize: 12.5,
                                        color: priceSaveMsg[pr._id].ok
                                          ? "#2a9d8f"
                                          : "var(--red)",
                                      }}
                                    >
                                      {priceSaveMsg[pr._id].text}
                                    </span>
                                  )}
                                </div>
                              )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {eligiblePRs.length > 0 && (
          <Pagination
            page={prPage}
            pageSize={prPageSize}
            total={prTotal}
            onPageChange={setPrPage}
            onPageSizeChange={setPrPageSize}
          />
        )}
      </div>

      {/* ── All POs list ──────────────────────────────────────────────────── */}
      <div className="card card-wide">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0 }}>
            All purchase orders{" "}
            <span className="pill-count">{poList.length}</span>
          </h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={exportAllPOsToExcel}
            disabled={poExportLoading || poList.length === 0}
          >
            {poExportLoading ? "Exporting…" : "⬇ Export Excel"}
          </button>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>PO No</th>
                <th>PO Date</th>
                <th>Expected Date</th>
                <th>PR No</th>
                <th>Vendor</th>
                <th>Project</th>
                <th>Items</th>
                <th className="num">Total Value</th>
                <th>Created by</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {poPageItems.map((po) => {
                const totalValue = (po.items || []).reduce(
                  (s, i) => s + i.orderedQty * (i.price || 0),
                  0,
                );
                const pr = prMap[po.prNumber];
                const isOpen = expandedPo === po._id;
                const activities = poActivityMap[po._id] || [];

                return (
                  <React.Fragment key={po._id}>
                    <tr
                      style={{ cursor: "pointer" }}
                      onClick={() => togglePoRow(po)}
                    >
                      <td className="mono" style={{ fontWeight: 700 }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              transition: "transform 150ms",
                              transform: isOpen
                                ? "rotate(90deg)"
                                : "rotate(0deg)",
                              fontSize: 10,
                              color: "var(--text-3)",
                            }}
                          >
                            ▶
                          </span>
                          {po.poNumber}
                        </span>
                      </td>
                      <td className="nowrap">{toDDMMYYYY(po.poDate)}</td>
                      <td>
                        {po.poExpectedDate ? (
                          toDDMMYYYY(po.poExpectedDate)
                        ) : (
                          <span style={{ color: "var(--text-3)" }}>—</span>
                        )}
                      </td>
                      <td className="mono">{po.prNumber}</td>
                      <td>{po.vendorName}</td>
                      <td>
                        {po.projectName || pr?.projectName || (
                          <span style={{ color: "var(--text-3)" }}>—</span>
                        )}
                      </td>
                      <td>{po.items?.length || 0}</td>
                      <td className="num">
                        {totalValue > 0
                          ? totalValue.toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                            })
                          : "—"}
                      </td>
                      <td>{po.createdByName}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          {canEditPO && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleEditPO(po)}
                              title="Edit purchase order"
                            >
                              ✎ Edit
                            </button>
                          )}
                          {canDeletePO && (
                            <button
                              type="button"
                              className="btn btn-del btn-sm"
                              onClick={() => handleDeletePO(po)}
                              disabled={deleteLoadingId === po._id}
                              title="Delete purchase order"
                            >
                              {deleteLoadingId === po._id ? "…" : "🗑"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td
                          colSpan={10}
                          style={{ background: "var(--paper-dim)", padding: 0 }}
                        >
                          <div style={{ padding: "14px 20px" }}>
                            {!po.items || po.items.length === 0 ? (
                              <p
                                style={{
                                  fontSize: 13,
                                  color: "var(--text-3)",
                                  margin: 0,
                                }}
                              >
                                No line items on this PO.
                              </p>
                            ) : (
                              <div className="tablewrap">
                                <table style={{ fontSize: 12 }}>
                                  <thead>
                                    <tr>
                                      <th style={thStyle}>Material</th>
                                      <th style={thStyle}>Code</th>
                                      <th style={thStyle}>Category</th>
                                      <th style={thStyle}>Project</th>
                                      <th style={thStyle}>UOM</th>
                                      <th
                                        style={{
                                          ...thStyle,
                                          textAlign: "right",
                                        }}
                                      >
                                        Ordered Qty
                                      </th>
                                      <th
                                        style={{
                                          ...thStyle,
                                          textAlign: "right",
                                        }}
                                      >
                                        Unit Price
                                      </th>
                                      <th
                                        style={{
                                          ...thStyle,
                                          textAlign: "right",
                                        }}
                                      >
                                        Value
                                      </th>
                                      <th style={thStyle}>Remarks</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {po.items.map((it, i) => (
                                      <tr
                                        key={i}
                                        style={{
                                          borderBottom: "1px solid var(--line)",
                                        }}
                                      >
                                        <td style={tdStyle}>
                                          <strong>{it.name}</strong>
                                        </td>
                                        <td
                                          style={{
                                            ...tdStyle,
                                            fontFamily: "monospace",
                                            fontSize: 12,
                                          }}
                                        >
                                          {it.code || "—"}
                                        </td>
                                        <td style={tdStyle}>
                                          {it.category || "—"}
                                        </td>
                                        <td style={tdStyle}>
                                          {it.projectName ||
                                            po.projectName ||
                                            pr?.projectName ||
                                            "—"}
                                        </td>
                                        <td style={tdStyle}>{it.uom || "—"}</td>
                                        <td
                                          style={{
                                            ...tdStyle,
                                            textAlign: "right",
                                          }}
                                        >
                                          {it.orderedQty}
                                        </td>
                                        <td
                                          style={{
                                            ...tdStyle,
                                            textAlign: "right",
                                          }}
                                        >
                                          {it.price
                                            ? Number(it.price).toLocaleString(
                                                "en-IN",
                                                { minimumFractionDigits: 2 },
                                              )
                                            : "—"}
                                        </td>
                                        <td
                                          style={{
                                            ...tdStyle,
                                            textAlign: "right",
                                            fontWeight: 600,
                                          }}
                                        >
                                          {(
                                            it.orderedQty * (it.price || 0)
                                          ).toLocaleString("en-IN", {
                                            minimumFractionDigits: 2,
                                          })}
                                        </td>
                                        <td style={tdStyle}>
                                          {it.remarks || "—"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {canViewActivity && (
                              <div style={{ marginTop: 18 }}>
                                <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>
                                  Activity
                                </h4>
                                {poActivityLoading[po._id] ? (
                                  <p
                                    style={{
                                      fontSize: 13,
                                      color: "var(--text-3)",
                                    }}
                                  >
                                    Loading activity…
                                  </p>
                                ) : activities.length === 0 ? (
                                  <p
                                    style={{
                                      fontSize: 13,
                                      color: "var(--text-3)",
                                    }}
                                  >
                                    No activity recorded.
                                  </p>
                                ) : (
                                  <div className="tablewrap">
                                    <table style={{ fontSize: 12.5 }}>
                                      <thead>
                                        <tr>
                                          <th style={thStyle}>Date & Time</th>
                                          <th style={thStyle}>User</th>
                                          <th style={thStyle}>Role</th>
                                          <th style={thStyle}>Action</th>
                                          <th style={thStyle}>Details</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {activities.map((a, i) => (
                                          <tr
                                            key={i}
                                            style={{
                                              borderBottom:
                                                "1px solid var(--line)",
                                            }}
                                          >
                                            <td style={tdStyle}>
                                              {a.timestamp
                                                ? new Date(
                                                    a.timestamp,
                                                  ).toLocaleString("en-IN")
                                                : "—"}
                                            </td>
                                            <td style={tdStyle}>
                                              {a.performedByName || "—"}
                                            </td>
                                            <td style={tdStyle}>
                                              {a.performedByRole || "—"}
                                            </td>
                                            <td style={tdStyle}>
                                              <strong>{a.action || "—"}</strong>
                                            </td>
                                            <td style={tdStyle}>
                                              {a.changes &&
                                              a.changes.length > 0 ? (
                                                <ul
                                                  style={{
                                                    margin: 0,
                                                    paddingLeft: 16,
                                                  }}
                                                >
                                                  {a.changes.map((c, ci) => (
                                                    <li
                                                      key={ci}
                                                      style={{
                                                        marginBottom: 2,
                                                      }}
                                                    >
                                                      <strong>
                                                        {c.field}:
                                                      </strong>{" "}
                                                      {c.from}{" "}
                                                      <span
                                                        style={{
                                                          color:
                                                            "var(--text-3)",
                                                        }}
                                                      >
                                                        →
                                                      </span>{" "}
                                                      {c.to}
                                                    </li>
                                                  ))}
                                                </ul>
                                              ) : (
                                                a.description || "—"
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            )}
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
          page={poPage}
          pageSize={poPageSize}
          total={poTotal}
          onPageChange={setPoPage}
          onPageSizeChange={setPoPageSize}
        />
        {!poList.length && (
          <div className="empty">
            No purchase orders yet.
            <p>
              Click <strong>+ Create PO</strong> above to raise your first
              order.
            </p>
          </div>
        )}
      </div>

      {/* ── Edit Purchase Order modal ─────────────────────────────────────── */}
      {editingPO && (
        <div
          className="modal-backdrop"
          onClick={() => !editLoading && setEditingPO(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1100px, 96vw)",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 18,
                gap: 10,
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>Edit Purchase Order</h3>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 12,
                    color: "var(--text-3)",
                  }}
                >
                  {editingPO.poNumber}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={editLoading}
                onClick={() => setEditingPO(null)}
              >
                ✕ Close
              </button>
            </div>

            <div
              className="formgrid"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 14,
              }}
            >
              <div className="field">
                <label>PO Number *</label>
                <input
                  type="text"
                  value={editingPO.poNumber || ""}
                  onChange={(e) =>
                    updateEditingPOField("poNumber", e.target.value)
                  }
                  disabled={editLoading}
                />
              </div>
              <div className="field">
                <label>Vendor Name *</label>
                <input
                  type="text"
                  value={editingPO.vendorName || ""}
                  onChange={(e) =>
                    updateEditingPOField("vendorName", e.target.value)
                  }
                  disabled={editLoading}
                />
              </div>
              <div className="field">
                <label>Project Name</label>
                <input
                  type="text"
                  value={editingPO.projectName || ""}
                  onChange={(e) =>
                    updateEditingPOField("projectName", e.target.value)
                  }
                  disabled={editLoading}
                />
              </div>
              <div className="field">
                <label>PO Date *</label>
                <input
                  type="date"
                  value={editingPO.poDate || ""}
                  onChange={(e) =>
                    updateEditingPOField("poDate", e.target.value)
                  }
                  disabled={editLoading}
                />
              </div>
              <div className="field">
                <label>Expected Delivery Date</label>
                <input
                  type="date"
                  value={editingPO.poExpectedDate || ""}
                  min={editingPO.poDate || undefined}
                  onChange={(e) =>
                    updateEditingPOField("poExpectedDate", e.target.value)
                  }
                  disabled={editLoading}
                />
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <h4 style={{ margin: "0 0 10px" }}>PO Items</h4>
              {!editingPO.items?.length ? (
                <div className="empty">No items available.</div>
              ) : (
                <div className="tablewrap">
                  <table style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Code</th>
                        <th>Project</th>
                        <th className="num">Ordered Qty</th>
                        <th className="num">Unit Price</th>
                        <th>Remarks</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editingPO.items.map((item, index) => (
                        <tr key={`${item.name}-${index}`}>
                          <td>
                            <strong>{item.name}</strong>
                          </td>
                          <td className="mono">{item.code || "—"}</td>
                          <td>
                            <input
                              type="text"
                              value={item.projectName || ""}
                              onChange={(e) =>
                                updateEditingPOItem(
                                  index,
                                  "projectName",
                                  e.target.value,
                                )
                              }
                              disabled={editLoading}
                              style={{ width: 130 }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0.0001"
                              step="any"
                              value={item.orderedQty}
                              onChange={(e) =>
                                updateEditingPOItem(
                                  index,
                                  "orderedQty",
                                  e.target.value,
                                )
                              }
                              disabled={editLoading}
                              style={{ width: 100, textAlign: "right" }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.price}
                              onChange={(e) =>
                                updateEditingPOItem(
                                  index,
                                  "price",
                                  e.target.value,
                                )
                              }
                              disabled={editLoading}
                              style={{ width: 100, textAlign: "right" }}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={item.remarks || ""}
                              onChange={(e) =>
                                updateEditingPOItem(
                                  index,
                                  "remarks",
                                  e.target.value,
                                )
                              }
                              disabled={editLoading}
                              style={{ width: 180 }}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-del btn-sm"
                              disabled={
                                editLoading || editingPO.items.length === 1
                              }
                              onClick={() => removeEditingPOItem(index)}
                              title="Remove item"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div
              className="actionrow"
              style={{ marginTop: 18, display: "flex", gap: 8 }}
            >
              <button
                type="button"
                className="btn btn-in"
                disabled={editLoading}
                onClick={handleUpdatePO}
              >
                {editLoading ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={editLoading}
                onClick={() => setEditingPO(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
