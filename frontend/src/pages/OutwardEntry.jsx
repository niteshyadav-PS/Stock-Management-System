import React, { useState, useEffect, useCallback } from "react";
import {
  getMaster,
  getOutward,
  getInward,
  addOutward,
  bulkOutward,
  updateOutward,
  deleteOutward,
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
import { ThFilter } from "../components/ColFilter";

const EMPTY_CF = {
  date: [],
  project: [],
  custpo: [],
  slip: [],
  dept: [],
  recby: [],
  by: [],
  name: [],
  type: [],
  code: [],
  category: [],
  reqty: [],
  qty: [],
  uom: [],
  remqty: [],
  remarks: [],
};

function sortNewestFirst(a, b) {
  const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (cb !== ca) return cb - ca;
  const da = a.date ? new Date(a.date).getTime() : 0;
  const db = b.date ? new Date(b.date).getTime() : 0;
  if (db !== da) return db - da;
  return String(b._id || "").localeCompare(String(a._id || ""));
}

function normalizeOutwardEntry(entry) {
  const reqty =
    entry.reqty ??
    entry.reqQty ??
    entry.requiredQty ??
    entry.requiredqty ??
    entry.reqqty ??
    null;
  return { ...entry, reqty };
}

function getMaterialBalance(materialName, inwardEntries, outwardEntries, extraQty = 0, excludeId = null) {
  const normalizedName = (materialName || "").trim().toLowerCase();
  if (!normalizedName) return 0;

  const totalInward = (inwardEntries || []).reduce((sum, item) => {
    const name = (item?.name || "").trim().toLowerCase();
    return name === normalizedName ? sum + (Number(item.qty) || 0) : sum;
  }, 0);

  const totalOutward = (outwardEntries || []).reduce((sum, item) => {
    const name = (item?.name || "").trim().toLowerCase();
    if (name !== normalizedName) return sum;
    if (excludeId && item?._id === excludeId) return sum;
    return sum + (Number(item.qty) || 0);
  }, 0);

  return totalInward - totalOutward - extraQty;
}

const EMPTY_HEADER = {
  date: todayStr(),
  project: "",
  custpo: "",
  slip: "",
  dept: "",
  recby: "",
  by: "",
};

const EMPTY_ITEM = {
  name: "",
  type: "",
  code: "",
  category: "",
  reqty: "",
  uom: "",
  qty: "",
  remarks: "",
};

const DEPARTMENT_OPTIONS = ["Production", "Site", "Maintenance"];
const ISSUED_BY_OPTIONS = ["Tanmay Patil", "Krishna Vishwakarma"];
const OTHER_VALUE = "__other__";

function getSelectValue(value, options) {
  if (!value || value === OTHER_VALUE) return "Other";
  return options.includes(value) ? value : "Other";
}

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
    entry?.project,
    entry?.custpo,
    entry?.slip,
    entry?.dept,
    entry?.recby,
    entry?.by,
    entry?.name,
    entry?.type,
    entry?.code,
    entry?.category,
    entry?.remarks,
    entry?.uom,
    entry?.qty,
    entry?.reqty,
    entry?.date,
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" ")
    .toLowerCase();

  return haystack.includes(text);
}

/* ── Edit Modal ──────────────────────────────────────────────────────────── */
function EditModal({ entry, master, inwardEntries, outwardEntries, onSave, onClose }) {
  const [form, setForm] = useState({
    date: entry.date || "",
    project: entry.project || "",
    custpo: entry.custpo || "",
    slip: entry.slip || "",
    dept: entry.dept || "",
    recby: entry.recby || "",
    by: entry.by || "",
    name: entry.name || "",
    type: entry.type || "",
    code: entry.code || "",
    category: entry.category || "",
    reqty: entry.reqty ?? "",
    uom: entry.uom || "",
    qty: entry.qty || "",
    remarks: entry.remarks || "",
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
    if (!form.reqty || parseFloat(form.reqty) <= 0) {
      setErr("Enter a valid required quantity.");
      return;
    }
    if (!form.qty || parseFloat(form.qty) <= 0) {
      setErr("Enter a valid quantity.");
      return;
    }

    const qty = parseFloat(form.qty);
    const available = getMaterialBalance(form.name, inwardEntries, outwardEntries, 0, entry._id);
    if (qty > available) {
      setErr(`Insufficient stock for ${form.name}. Available balance: ${available}`);
      return;
    }

    setSaving(true);
    try {
      await onSave(entry._id, {
        ...form,
        qty: parseFloat(form.qty),
        reqty: parseFloat(form.reqty),
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  const modalStyles = {
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
    },
    modal: {
      background: "var(--card)",
      border: "1px solid var(--line)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-lg)",
      width: "100%",
      maxWidth: "700px",
      height: "min(90vh,660px)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
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
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
            Edit Outward Entry
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              color: "#8a8270",
              padding: "4px 8px",
              borderRadius: 4,
            }}
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
          <div style={modalStyles.body}>
            <div className="formgrid">
              <div className="field">
                <label>Issue date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, date: e.target.value }))
                  }
                />
                {form.date && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-3, #8a8270)",
                      marginTop: 2,
                      display: "block",
                    }}
                  >
                    {formatDateDMY(form.date)}
                  </span>
                )}
              </div>
              <div className="field">
                <label>Project name</label>
                <input
                  value={form.project}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, project: e.target.value }))
                  }
                  placeholder="e.g. Project Alpha"
                />
              </div>
              <div className="field">
                <label>Customer PO details</label>
                <input
                  value={form.custpo}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, custpo: e.target.value }))
                  }
                  placeholder="e.g. CPO-2291"
                />
              </div>
              <div className="field">
                <label>Issue slip no</label>
                <input
                  value={form.slip}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, slip: e.target.value }))
                  }
                  placeholder="e.g. ISS-0087"
                />
              </div>
              <div className="field">
                <label>Department</label>
                <select
                  value={getSelectValue(form.dept, DEPARTMENT_OPTIONS)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      dept: e.target.value === "Other" ? OTHER_VALUE : e.target.value,
                    }))
                  }
                >
                  <option value="">— Select department —</option>
                  {DEPARTMENT_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  <option value="Other">Other</option>
                </select>
                {getSelectValue(form.dept, DEPARTMENT_OPTIONS) === "Other" && (
                  <input
                    value={form.dept === OTHER_VALUE ? "" : form.dept}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, dept: e.target.value }))
                    }
                    placeholder="Enter department"
                    style={{ marginTop: 8 }}
                  />
                )}
              </div>
              <div className="field">
                <label>Received by</label>
                <input
                  value={form.recby}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, recby: e.target.value }))
                  }
                  placeholder="Receiver's name"
                />
              </div>
              <div className="field">
                <label>Issued by (store)</label>
                <select
                  value={getSelectValue(form.by, ISSUED_BY_OPTIONS)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      by: e.target.value === "Other" ? OTHER_VALUE : e.target.value,
                    }))
                  }
                >
                  <option value="">— Select issued by —</option>
                  {ISSUED_BY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  <option value="Other">Other</option>
                </select>
                {getSelectValue(form.by, ISSUED_BY_OPTIONS) === "Other" && (
                  <input
                    value={form.by === OTHER_VALUE ? "" : form.by}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, by: e.target.value }))
                    }
                    placeholder="Enter issued by name"
                    style={{ marginTop: 8 }}
                  />
                )}
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
              <div className="field code">
                <label>Material type</label>
                <input readOnly value={form.type} />
              </div>
              <div className="field code">
                <label>Material code</label>
                <input readOnly value={form.code} />
              </div>
              <div className="field">
                <label>Category</label>
                <input readOnly value={form.category} />
              </div>
              <div className="field">
                <label>
                  Required Qty <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={form.reqty}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, reqty: e.target.value }))
                  }
                  placeholder="0"
                />
              </div>
              <div className="field">
                <label>
                  Qty <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={form.qty}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, qty: e.target.value }))
                  }
                  placeholder="0"
                />
              </div>
              <div className="field">
                <label>UOM</label>
                <input readOnly value={form.uom} />
              </div>
              <div className="field">
                <label>Remarks</label>
                <input
                  value={form.remarks}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, remarks: e.target.value }))
                  }
                  placeholder="Optional remarks"
                />
              </div>
            </div>
            {err && (
              <div className="alert err" style={{ marginTop: 14 }}>
                {err}
              </div>
            )}
          </div>
          <div style={modalStyles.footer}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-out" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function OutwardEntry() {
  const { user } = useAuth();
  const OUTWARD_EDIT_ROLES = ["admin", "store", "store_manager"];
  const BULK_DELETE_ROLES = ["admin", "store_manager"];
  const canEditDelete = OUTWARD_EDIT_ROLES.includes(user?.role);
  const canBulkDeleteFiltered = BULK_DELETE_ROLES.includes(user?.role);

  const [master, setMaster] = useState([]);
  const [entries, setEntries] = useState([]);
  const [inwardEntries, setInwardEntries] = useState([]);
  const [header, setHeader] = useState(EMPTY_HEADER);
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [msg, setMsg] = useState({ text: "", ok: true });
  const [bulkMsg, setBulkMsg] = useState({ text: "", ok: true });
  const [loading, setLoading] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [cf, setCf] = useState(EMPTY_CF);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = useCallback(async () => {
    const [m, e, i] = await Promise.all([getMaster(), getOutward(), getInward()]);
    setMaster(unwrapList(m));
    setEntries(unwrapList(e).map(normalizeOutwardEntry));
    setInwardEntries(unwrapList(i));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const searched = entries.filter((entry) => {
    return (
      isDateInRange(entry.date, fromDate, toDate) &&
      matchesSearchText(entry, searchText)
    );
  });
  const filteredEntries = searched
    .filter((e) => {
      const hasReqty =
        e.reqty !== undefined && e.reqty !== null && e.reqty !== "";
      const rem = hasReqty ? Number(e.reqty) - Number(e.qty) : null;
      return (
        (!cf.date.length || cf.date.includes(formatDateDMY(e.date))) &&
        (!cf.project.length || cf.project.includes(e.project || "—")) &&
        (!cf.custpo.length || cf.custpo.includes(e.custpo || "—")) &&
        (!cf.slip.length || cf.slip.includes(e.slip || "—")) &&
        (!cf.dept.length || cf.dept.includes(e.dept || "—")) &&
        (!cf.recby.length || cf.recby.includes(e.recby || "—")) &&
        (!cf.by.length || cf.by.includes(e.by || "—")) &&
        (!cf.name.length || cf.name.includes(e.name)) &&
        (!cf.type.length || cf.type.includes(e.type)) &&
        (!cf.code.length || cf.code.includes(e.code)) &&
        (!cf.category.length || cf.category.includes(e.category)) &&
        (!cf.reqty.length ||
          cf.reqty.includes(hasReqty ? String(formatNum(e.reqty)) : "—")) &&
        (!cf.qty.length || cf.qty.includes(String(formatNum(e.qty)))) &&
        (!cf.uom.length || cf.uom.includes(e.uom)) &&
        (!cf.remqty.length ||
          cf.remqty.includes(hasReqty ? String(formatNum(rem)) : "—")) &&
        (!cf.remarks.length || cf.remarks.includes(e.remarks || "—"))
      );
    })
    .slice()
    .sort(sortNewestFirst);
  const { pageItems, page, pageSize, total, setPage, setPageSize } =
    useClientPagination(filteredEntries, 25);

  const hasDateFilter = Boolean(fromDate || toDate);
  const showBulkSelect = canBulkDeleteFiltered && hasDateFilter;
  const allFilteredSelected =
    filteredEntries.length > 0 &&
    filteredEntries.every((e) => selectedIds.has(e._id));

  useEffect(() => {
    setSelectedIds(new Set());
  }, [fromDate, toDate, searchText, cf]);

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredEntries.map((e) => e._id)));
  }

  async function handleBulkDeleteSelected() {
    if (!selectedIds.size) return;
    if (
      !window.confirm(
        `Delete ${selectedIds.size} outward entr${selectedIds.size === 1 ? "y" : "ies"} from the filtered list?\n\nThis will affect the stock balance.`,
      )
    )
      return;
    setBulkDeleting(true);
    try {
      for (const id of selectedIds) {
        await deleteOutward(id);
      }
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleEditSave(id, data) {
    await updateOutward(id, data);
    setEditEntry(null);
    load();
  }

  async function handleDelete(e) {
    if (
      !window.confirm(
        `Delete outward entry for "${e.name}" (Qty: ${e.qty})?\n\nThis will affect the stock balance.`,
      )
    )
      return;
    try {
      await deleteOutward(e._id);
      load();
    } catch (err) {
      alert("Error: " + err.message);
    }
  }

  function autofillItem(idx, name) {
    const m = master.find((x) => x.name === name);
    setItems((list) =>
      list.map((it, i) =>
        i === idx
          ? {
              ...it,
              name,
              type: m?.type || "",
              code: m?.code || "",
              category: m?.category || "",
              uom: m?.uom || "",
            }
          : it,
      ),
    );
  }

  function updateItemQty(idx, qty) {
    setItems((list) => list.map((it, i) => (i === idx ? { ...it, qty } : it)));
  }

  function updateItemReqty(idx, reqty) {
    setItems((list) =>
      list.map((it, i) => (i === idx ? { ...it, reqty } : it)),
    );
  }

  function updateItemRemarks(idx, remarks) {
    setItems((list) =>
      list.map((it, i) => (i === idx ? { ...it, remarks } : it)),
    );
  }

  function addManualRow() {
    setItems((list) => [...list, { ...EMPTY_ITEM }]);
  }

  function removeItemRow(idx) {
    setItems((list) =>
      list.length === 1 ? list : list.filter((_, i) => i !== idx),
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg({ text: "", ok: true });
    if (!header.project.trim()) {
      setMsg({ text: "Please enter a project name.", ok: false });
      return;
    }
    if (!header.custpo.trim() && !header.slip.trim()) {
      setMsg({
        text: "Enter either Customer PO details or Issue slip no.",
        ok: false,
      });
      return;
    }
    if (!header.dept.trim()) {
      setMsg({ text: "Please enter a department.", ok: false });
      return;
    }
    if (!header.recby.trim()) {
      setMsg({ text: "Please enter who received the material.", ok: false });
      return;
    }
    if (!header.by.trim()) {
      setMsg({ text: "Please enter who issued the material.", ok: false });
      return;
    }

    const cleanItems = items.filter((it) => it.name || it.qty);
    if (!cleanItems.length) {
      setMsg({ text: "Please add at least one material.", ok: false });
      return;
    }
    const pendingByName = new Map();
    for (const it of cleanItems) {
      if (!it.name) {
        setMsg({ text: "Please select a material for every row.", ok: false });
        return;
      }
      if (!it.reqty || parseFloat(it.reqty) <= 0) {
        setMsg({
          text: `Enter a valid required quantity for ${it.name}.`,
          ok: false,
        });
        return;
      }
      if (!it.qty || parseFloat(it.qty) <= 0) {
        setMsg({ text: `Enter a valid quantity for ${it.name}.`, ok: false });
        return;
      }

      const name = it.name.trim();
      const qty = parseFloat(it.qty);
      const pendingBefore = pendingByName.get(name) || 0;
      const available = getMaterialBalance(name, inwardEntries, entries, pendingBefore);
      if (qty > available) {
        setMsg({
          text: `Insufficient stock for ${name}. Available balance: ${available}`,
          ok: false,
        });
        return;
      }
      pendingByName.set(name, pendingBefore + qty);
    }

    setLoading(true);
    try {
      const withNums = cleanItems.map((it) => ({
        ...it,
        qty: parseFloat(it.qty),
        reqty: parseFloat(it.reqty),
      }));
      if (withNums.length === 1) {
        await addOutward({ ...header, ...withNums[0] });
      } else {
        const batch = withNums.map((it) => ({ ...header, ...it }));
        await bulkOutward(batch);
      }
      setMsg({
        text: `Outward entr${cleanItems.length === 1 ? "y" : "ies"} saved successfully.`,
        ok: true,
      });
      setHeader({ ...EMPTY_HEADER, date: todayStr() });
      setItems([{ ...EMPTY_ITEM }]);
      load();
      setTimeout(() => setMsg({ text: "", ok: true }), 4000);
    } catch (err) {
      setMsg({ text: "Error: " + err.message, ok: false });
    } finally {
      setLoading(false);
    }
  }

  async function handleBulk(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBulkMsg({ text: "Reading file…", ok: true });
    try {
      const rows = await readSheetFile(file);
      if (!rows.length) {
        setBulkMsg({ text: "Sheet is empty.", ok: false });
        return;
      }
      const today = todayStr();
      const batch = [];
      let skipped = 0;
      for (const row of rows) {
        const matName = pickCol(row, [
          "materialname",
          "material",
          "name",
          "materialdescription",
          "description",
        ]);
        if (!matName) {
          skipped++;
          continue;
        }
        const m = master.find(
          (x) => x.name.toLowerCase() === matName.toLowerCase(),
        );
        if (!m) {
          skipped++;
          continue;
        }
        const qty = parseFloat(
          pickCol(row, ["qty", "quantity", "issuedqty", "issuedquantity"]),
        );
        if (!qty || qty <= 0) {
          skipped++;
          continue;
        }
        const reqtyRaw = pickCol(row, [
          "requiredqty",
          "reqqty",
          "requiredquantity",
        ]);
        const reqty = parseFloat(reqtyRaw);
        if (!reqty || reqty <= 0) {
          skipped++;
          continue;
        }

        const project = pickCol(row, ["projectname", "project"]);
        const custpo = pickCol(row, [
          "customerpodetails",
          "customerpo",
          "custpo",
        ]);
        const slip = pickCol(row, ["issueslipno", "slipno", "slip"]);
        const dept = pickCol(row, ["department", "dept"]);
        const recby = pickCol(row, [
          "materialreceivedby",
          "receivedby",
          "recby",
        ]);
        const by = pickCol(row, ["materialissuedby", "issuedby", "by"]);
        const remarks = pickCol(row, ["remarks", "remark", "notes", "note"]);
        batch.push({
          date:
            parseExcelDate(pickCol(row, ["date", "entrydate", "issuedate"])) ||
            today,
          project,
          custpo,
          slip,
          dept,
          recby,
          by,
          remarks,
          name: m.name,
          type: m.type,
          code: m.code,
          category: m.category,
          uom: m.uom,
          qty,
          reqty,
        });
      }
      if (!batch.length) {
        setBulkMsg({
          text: `No valid rows found. ${skipped} row(s) skipped.`,
          ok: false,
        });
        return;
      }
      const res = await bulkOutward(batch);
      setBulkMsg({
        text: `✓ ${res.inserted} entr${res.inserted === 1 ? "y" : "ies"} imported.${skipped ? ` ${skipped} skipped.` : ""}`,
        ok: true,
      });
      load();
    } catch (err) {
      setBulkMsg({ text: "Error: " + err.message, ok: false });
    }
    e.target.value = "";
  }

  function downloadTemplate() {
    exportXlsx(
      [
        "Date",
        "Project Name",
        "Customer PO Details",
        "Issue Slip No",
        "Department",
        "Received By",
        "Issued By",
        "Material Name",
        "Required Qty",
        "Qty",
        "Remarks",
      ],
      [
        [
          formatDateDMY(todayStr()),
          "Project Alpha",
          "CPO-3001",
          "ISS-0010",
          "Production",
          "Site Engineer",
          "Store Keeper",
          "[Material Name from master]",
          "10",
          "5",
          "",
        ],
      ],
      "Outward Template",
      "Stockyard_Outward_Template.xlsx",
    );
  }

  return (
    <>
      {/* Compact form layout overrides — scoped to this page */}
      <style>{`
        .compact-form .formgrid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px 14px;
        }
        .compact-form .field.full { grid-column: 1 / -1; }
        .compact-form .field { min-width: 0; }
        .compact-form .field label {
          font-size: 12px;
          margin-bottom: 3px;
          display: block;
        }
        .compact-form .field input,
        .compact-form .field select {
          padding: 6px 8px;
          font-size: 13px;
          height: 32px;
          width: 100%;
          box-sizing: border-box;
        }
        .compact-form .readonly-row {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px 14px;
        }
        .compact-form .actionrow {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
        }

        /* Item rows */
        .item-rows { grid-column: 1 / -1; display: flex; flex-direction: column; align-items: flex-start; gap: 10px; margin-top: 4px; }
        .item-rows .btn-ghost.btn-sm { width: auto; align-self: flex-start; }
        .item-row {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr 0.8fr 0.8fr 0.7fr 1.2fr auto;
          gap: 10px;
          align-items: end;
          padding: 10px;
          border: 1px solid var(--line, #e2e2e2);
          border-radius: 8px;
        }
        .item-row .field { min-width: 0; }
        .item-row .field label { font-size: 11px; margin-bottom: 3px; display: block; }
        .item-row .field input,
        .item-row .field select { padding: 6px 8px; font-size: 13px; height: 32px; width: 100%; box-sizing: border-box; }
        .item-row-remove {
          height: 32px; width: 32px; border-radius: 6px; border: 1px solid var(--line, #e2e2e2);
          background: transparent; cursor: pointer; color: var(--red, #c0392b); font-size: 16px; line-height: 1;
          flex-shrink: 0;
        }
        .item-row-remove:disabled { opacity: 0.35; cursor: not-allowed; }

        /* Recent outward entries — taller rows, taller section */
        .entries-section .tablewrap { max-height: 82vh !important; overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .entries-section table td,
        .entries-section table th { padding: 16px 14px; }

        /* ---------- Responsive breakpoints ---------- */
        @media (max-width: 1100px) {
          .compact-form .formgrid { grid-template-columns: repeat(3, 1fr); }
          .compact-form .readonly-row { grid-template-columns: repeat(4, 1fr); }
        }

        @media (max-width: 900px) {
          .compact-form .formgrid { grid-template-columns: repeat(2, 1fr); }
          .compact-form .readonly-row { grid-template-columns: repeat(2, 1fr); }
          .item-row { grid-template-columns: repeat(2, 1fr); position: relative; padding-bottom: 40px; }
          .item-row-remove { position: absolute; bottom: 8px; right: 10px; }
        }

        @media (max-width: 600px) {
          .pagehead { flex-direction: column; align-items: flex-start; gap: 8px; }
          .card { padding: 12px; }
          .compact-form .formgrid { grid-template-columns: 1fr; }
          .compact-form .readonly-row { grid-template-columns: repeat(2, 1fr); }
          .item-row { grid-template-columns: 1fr; padding-bottom: 44px; }
          .item-row-remove { bottom: 8px; right: 8px; }
          .actionrow { flex-direction: column; align-items: stretch; }
          .actionrow .btn { width: 100%; }
          .entries-section table { min-width: 900px; }
          .uploadbox { flex-direction: column; align-items: flex-start; }
        }

        @media (max-width: 420px) {
          .compact-form h3, .card h3 { font-size: 15px; }
          .pagehead-text h2 { font-size: 18px; }
        }
      `}</style>

      {editEntry && (
        <EditModal
          entry={editEntry}
          master={master}
          inwardEntries={inwardEntries}
          outwardEntries={entries}
          onSave={handleEditSave}
          onClose={() => setEditEntry(null)}
        />
      )}

      <div className="pagehead">
        <div className="pagehead-text">
          <h2>Outward Entry</h2>
          <p>
            Record materials issued out of stock. Details auto-fill from the
            master list.
          </p>
        </div>
      </div>

      {/* Bulk upload */}
      {canEditDelete && (
      <div className="card">
        <h3>Bulk upload</h3>
        <div className="uploadbox">
          <label htmlFor="outward-bulk">
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
            id="outward-bulk"
            accept=".xlsx,.xls,.csv"
            onChange={handleBulk}
          />
          <div className="hint">
            Required: <strong>Material Name, Required Qty, Qty</strong> — All
            other columns optional: Date (dd/mm/yyyy), Project Name, Customer PO
            Details, Issue Slip No, Department, Received By, Issued By, Remarks
            <br />
            Material Name must exactly match an entry in the master list.{" "}
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
        </div>
      </div>
      )}

      {/* Manual entry form */}
      {canEditDelete && (
      <div className="card compact-form">
        <h3>New outward entry</h3>
        <p
          style={{
            fontSize: 12,
            color: "var(--text-3)",
            margin: "-6px 0 12px",
          }}
        >
          <span style={{ color: "var(--red)" }}>*</span> required &nbsp;·&nbsp;
          <span style={{ color: "var(--red)" }}>*†</span> at least one of these
          two is required
        </p>
        <form onSubmit={handleSubmit}>
          <div className="formgrid">
            <div className="field">
              <label>Issue date</label>
              <input
                type="date"
                value={header.date}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, date: e.target.value }))
                }
              />
              {header.date && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-3, #8a8270)",
                    marginTop: 2,
                    display: "block",
                  }}
                >
                  {formatDateDMY(header.date)}
                </span>
              )}
            </div>
            <div className="field">
              <label>
                Project name <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <input
                required
                value={header.project}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, project: e.target.value }))
                }
                placeholder="e.g. Project Alpha"
              />
            </div>
            <div className="field">
              <label>
                Customer PO details{" "}
                <span style={{ color: "var(--red)" }}>*†</span>
              </label>
              <input
                value={header.custpo}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, custpo: e.target.value }))
                }
                placeholder="e.g. CPO-2291"
              />
            </div>
            <div className="field">
              <label>
                Issue slip no <span style={{ color: "var(--red)" }}>*†</span>
              </label>
              <input
                value={header.slip}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, slip: e.target.value }))
                }
                placeholder="e.g. ISS-0087"
              />
            </div>

            <div className="field">
              <label>
                Department <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <select
                required
                value={getSelectValue(header.dept, DEPARTMENT_OPTIONS)}
                onChange={(e) =>
                  setHeader((h) => ({
                    ...h,
                    dept: e.target.value === "Other" ? OTHER_VALUE : e.target.value,
                  }))
                }
              >
                <option value="">— Select department —</option>
                {DEPARTMENT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
                <option value="Other">Other</option>
              </select>
              {getSelectValue(header.dept, DEPARTMENT_OPTIONS) === "Other" && (
                <input
                  required
                  value={header.dept === OTHER_VALUE ? "" : header.dept}
                  onChange={(e) =>
                    setHeader((h) => ({ ...h, dept: e.target.value }))
                  }
                  placeholder="Enter department"
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
            <div className="field">
              <label>
                Material received by{" "}
                <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <input
                required
                value={header.recby}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, recby: e.target.value }))
                }
                placeholder="Receiver's name"
              />
            </div>
            <div className="field">
              <label>
                Issued by (store) <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <select
                required
                value={getSelectValue(header.by, ISSUED_BY_OPTIONS)}
                onChange={(e) =>
                  setHeader((h) => ({
                    ...h,
                    by: e.target.value === "Other" ? OTHER_VALUE : e.target.value,
                  }))
                }
              >
                <option value="">— Select issued by —</option>
                {ISSUED_BY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
                <option value="Other">Other</option>
              </select>
              {getSelectValue(header.by, ISSUED_BY_OPTIONS) === "Other" && (
                <input
                  required
                  value={header.by === OTHER_VALUE ? "" : header.by}
                  onChange={(e) =>
                    setHeader((h) => ({ ...h, by: e.target.value }))
                  }
                  placeholder="Enter issued by name"
                  style={{ marginTop: 8 }}
                />
              )}
            </div>

            {/* Item rows */}
            <div className="item-rows">
              {items.map((it, idx) => (
                <div className="item-row" key={idx}>
                  <div className="field">
                    <label>
                      Material description{" "}
                      <span style={{ color: "var(--red)" }}>*</span>
                    </label>
                    <select
                      value={it.name}
                      onChange={(e) => autofillItem(idx, e.target.value)}
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
                    <label>Type</label>
                    <input readOnly value={it.type} placeholder="Auto-filled" />
                  </div>
                  <div className="field">
                    <label>Code</label>
                    <input readOnly value={it.code} placeholder="Auto-filled" />
                  </div>
                  <div className="field">
                    <label>Category</label>
                    <input
                      readOnly
                      value={it.category}
                      placeholder="Auto-filled"
                    />
                  </div>
                  <div className="field">
                    <label>
                      Required Qty{" "}
                      <span style={{ color: "var(--red)" }}>*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={it.reqty}
                      onChange={(e) => updateItemReqty(idx, e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="field">
                    <label>
                      Qty <span style={{ color: "var(--red)" }}>*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={it.qty}
                      onChange={(e) => updateItemQty(idx, e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="field">
                    <label>UOM</label>
                    <input readOnly value={it.uom} placeholder="Auto-filled" />
                  </div>
                  <div className="field">
                    <label>Remarks</label>
                    <input
                      value={it.remarks}
                      onChange={(e) => updateItemRemarks(idx, e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <button
                    type="button"
                    className="item-row-remove"
                    onClick={() => removeItemRow(idx)}
                    disabled={items.length === 1}
                    title="Remove item"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={addManualRow}
                style={{ marginBottom: 8 }}
              >
                + Add item
              </button>
            </div>
          </div>

          <div className="actionrow">
            <button className="btn btn-out" type="submit" disabled={loading}>
              {loading
                ? "Saving…"
                : `Save outward entr${items.filter((it) => it.name || it.qty).length === 1 ? "y" : "ies"}`}
            </button>
            {msg.text && (
              <span className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</span>
            )}
          </div>
        </form>
      </div>
      )}

      {/* All entries table */}
      <div className="card card-wide entries-section">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", minWidth: 240, gap: "6px" }}>
            <span style={{ fontSize: 12, color: "#5a5444", fontWeight: 600, letterSpacing: "0.1px" }}>Search</span>
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Material / project / PO / slip / remarks"
              style={{
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
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--teal)";
                e.target.style.boxShadow = "0 0 0 3px rgba(31,92,82,.1)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "var(--line)";
                e.target.style.boxShadow = "none";
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", minWidth: 170, gap: "6px" }}>
            <span style={{ fontSize: 12, color: "#5a5444", fontWeight: 600, letterSpacing: "0.1px" }}>From date</span>
            <input 
              type="date" 
              value={fromDate} 
              onChange={(e) => setFromDate(e.target.value)}
              style={{
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
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--teal)";
                e.target.style.boxShadow = "0 0 0 3px rgba(31,92,82,.1)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "var(--line)";
                e.target.style.boxShadow = "none";
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", minWidth: 170, gap: "6px" }}>
            <span style={{ fontSize: 12, color: "#5a5444", fontWeight: 600, letterSpacing: "0.1px" }}>To date</span>
            <input 
              type="date" 
              value={toDate} 
              onChange={(e) => setToDate(e.target.value)}
              style={{
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
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--teal)";
                e.target.style.boxShadow = "0 0 0 3px rgba(31,92,82,.1)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "var(--line)";
                e.target.style.boxShadow = "none";
              }}
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
              setCf(EMPTY_CF);
              setSelectedIds(new Set());
            }}
          >
            Clear
          </button>
          {showBulkSelect && (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{
                  height: "var(--input-h)",
                  padding: "10px 14px",
                  fontSize: "13.5px",
                }}
                onClick={toggleSelectAllFiltered}
                disabled={!filteredEntries.length || bulkDeleting}
              >
                {allFilteredSelected ? "Clear selection" : `Select all filtered (${filteredEntries.length})`}
              </button>
              <button
                type="button"
                className="btn-del btn-sm"
                style={{
                  height: "var(--input-h)",
                  padding: "10px 14px",
                  fontSize: "13.5px",
                }}
                onClick={handleBulkDeleteSelected}
                disabled={!selectedIds.size || bulkDeleting}
                title="Delete the selected entries"
              >
                {bulkDeleting ? "…" : `🗑 (${selectedIds.size})`}
              </button>
            </>
          )}
        </div>
        {canBulkDeleteFiltered && !hasDateFilter && (
          <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: "0 0 10px" }}>
            Set a From and/or To date filter to select and delete matching outward entries.
          </p>
        )}
        <h3>
          All outward entries{" "}
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
                {showBulkSelect && (
                  <th style={{ width: 42 }}>
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAllFiltered}
                      disabled={!filteredEntries.length || bulkDeleting}
                      title="Select all filtered"
                      aria-label="Select all filtered"
                    />
                  </th>
                )}
                <ThFilter
                  label="Date"
                  values={searched.map((e) => formatDateDMY(e.date))}
                  selected={cf.date}
                  onChange={(v) => setCf((f) => ({ ...f, date: v }))}
                />
                <ThFilter
                  label="Project"
                  values={searched.map((e) => e.project || "—")}
                  selected={cf.project}
                  onChange={(v) => setCf((f) => ({ ...f, project: v }))}
                />
                <ThFilter
                  label="Cust. PO"
                  values={searched.map((e) => e.custpo || "—")}
                  selected={cf.custpo}
                  onChange={(v) => setCf((f) => ({ ...f, custpo: v }))}
                />
                <ThFilter
                  label="Slip no"
                  values={searched.map((e) => e.slip || "—")}
                  selected={cf.slip}
                  onChange={(v) => setCf((f) => ({ ...f, slip: v }))}
                />
                <ThFilter
                  label="Dept."
                  values={searched.map((e) => e.dept || "—")}
                  selected={cf.dept}
                  onChange={(v) => setCf((f) => ({ ...f, dept: v }))}
                />
                <ThFilter
                  label="Rec. By"
                  values={searched.map((e) => e.recby || "—")}
                  selected={cf.recby}
                  onChange={(v) => setCf((f) => ({ ...f, recby: v }))}
                />
                <ThFilter
                  label="Issued by"
                  values={searched.map((e) => e.by || "—")}
                  selected={cf.by}
                  onChange={(v) => setCf((f) => ({ ...f, by: v }))}
                />
                <ThFilter
                  label="Material"
                  values={searched.map((e) => e.name)}
                  selected={cf.name}
                  onChange={(v) => setCf((f) => ({ ...f, name: v }))}
                />
                <ThFilter
                  label="Type"
                  values={searched.map((e) => e.type)}
                  selected={cf.type}
                  onChange={(v) => setCf((f) => ({ ...f, type: v }))}
                />
                <ThFilter
                  label="Code"
                  values={searched.map((e) => e.code)}
                  selected={cf.code}
                  onChange={(v) => setCf((f) => ({ ...f, code: v }))}
                />
                <ThFilter
                  label="Category"
                  values={searched.map((e) => e.category)}
                  selected={cf.category}
                  onChange={(v) => setCf((f) => ({ ...f, category: v }))}
                />
                <ThFilter
                  className="num"
                  label="Req. Qty"
                  values={searched.map((e) =>
                    e.reqty !== undefined && e.reqty !== null && e.reqty !== ""
                      ? String(formatNum(e.reqty))
                      : "—",
                  )}
                  selected={cf.reqty}
                  onChange={(v) => setCf((f) => ({ ...f, reqty: v }))}
                />
                <ThFilter
                  className="num"
                  label="Qty"
                  values={searched.map((e) => String(formatNum(e.qty)))}
                  selected={cf.qty}
                  onChange={(v) => setCf((f) => ({ ...f, qty: v }))}
                />
                <ThFilter
                  label="UOM"
                  values={searched.map((e) => e.uom)}
                  selected={cf.uom}
                  onChange={(v) => setCf((f) => ({ ...f, uom: v }))}
                />
                <ThFilter
                  className="num"
                  label="Rem. Qty"
                  values={searched.map((e) => {
                    const hasReqty =
                      e.reqty !== undefined &&
                      e.reqty !== null &&
                      e.reqty !== "";
                    return hasReqty
                      ? String(formatNum(Number(e.reqty) - Number(e.qty)))
                      : "—";
                  })}
                  selected={cf.remqty}
                  onChange={(v) => setCf((f) => ({ ...f, remqty: v }))}
                />
                <ThFilter
                  label="Remarks"
                  values={searched.map((e) => e.remarks || "—")}
                  selected={cf.remarks}
                  onChange={(v) => setCf((f) => ({ ...f, remarks: v }))}
                />
                {canEditDelete && <th style={{ minWidth: 110 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pageItems.map((e) => {
                const hasReqty =
                  e.reqty !== undefined && e.reqty !== null && e.reqty !== "";
                const remaining = hasReqty
                  ? Number(e.reqty) - Number(e.qty)
                  : null;
                return (
                  <tr key={e._id}>
                    {showBulkSelect && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(e._id)}
                          onChange={() => toggleSelect(e._id)}
                          disabled={bulkDeleting}
                          aria-label={`Select ${e.name || e._id}`}
                        />
                      </td>
                    )}
                    <td className="nowrap">{formatDateDMY(e.date)}</td>
                    <td>
                      {e.project || (
                        <span style={{ color: "var(--text-3)" }}>—</span>
                      )}
                    </td>
                    <td>{e.custpo || "—"}</td>
                    <td>{e.slip || "—"}</td>
                    <td>{e.dept || "—"}</td>
                    <td>{e.recby || "—"}</td>
                    <td>{e.by || "—"}</td>
                    <td style={{ fontWeight: 500 }}>{e.name}</td>
                    <td>{e.type}</td>
                    <td className="mono">{e.code}</td>
                    <td>{e.category}</td>
                    <td className="num">
                      {hasReqty ? formatNum(e.reqty) : "—"}
                    </td>
                    <td className="num">{formatNum(e.qty)}</td>
                    <td>{e.uom}</td>
                    <td className="num">
                      {hasReqty ? formatNum(remaining) : "—"}
                    </td>
                    <td>{e.remarks || "—"}</td>
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
            No outward entries yet.
            <p>Use the form above to record your first issue.</p>
          </div>
        )}
        {entries.length > 0 && !filteredEntries.length && (
          <div className="empty">
            No outward entries match the current filters.
          </div>
        )}
      </div>
    </>
  );
}