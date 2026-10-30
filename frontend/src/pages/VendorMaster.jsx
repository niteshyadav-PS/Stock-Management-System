import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  addJobOrderVendor,
  deleteJobOrderVendor,
  getJobOrderVendors,
  updateJobOrderVendor,
  unwrapList,
} from "../api/api";
import Pagination from "../components/Pagination";
import useClientPagination from "../hooks/useClientPagination";
import {
  jobTypeLabel,
  setJobOrderVendorsCache,
  VENDOR_MATERIAL_CATEGORIES,
} from "../utils/jobOrderVendors";

const EMPTY = {
  name: "",
  address: "",
  jobType: "powder_coating",
  materialCategory: "",
  active: true,
};

export default function VendorMaster() {
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  // all | active | inactive — inactive vendors stay visible so they can be reactivated
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState({ text: "", ok: true });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = unwrapList(await getJobOrderVendors({ active: "all" }));
      setList(rows);
      // Challan / user dropdowns only use active vendors
      setJobOrderVendorsCache(rows.filter((v) => v.active !== false));
    } catch (err) {
      setMsg({ text: err.message || "Failed to load vendors.", ok: false });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((v) => {
      if (typeFilter !== "all" && v.jobType !== typeFilter) return false;
      if (statusFilter === "active" && v.active === false) return false;
      if (statusFilter === "inactive" && v.active !== false) return false;
      if (!q) return true;
      return (
        String(v.name || "")
          .toLowerCase()
          .includes(q) ||
        String(v.address || "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [list, search, typeFilter, statusFilter]);

  const { pageItems, page, pageSize, total, setPage, setPageSize } =
    useClientPagination(filtered, 25);

  function resetForm() {
    setForm(EMPTY);
    setEditingId(null);
  }

  function startEdit(v) {
    setEditingId(v._id);
    setForm({
      name: v.name || "",
      address: v.address || "",
      jobType: v.jobType === "fabrication" ? "fabrication" : "powder_coating",
      materialCategory: v.materialCategory || "",
      active: v.active !== false,
    });
    setMsg({ text: "", ok: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg({ text: "", ok: true });
    if (!form.name.trim()) {
      setMsg({ text: "Vendor name is required.", ok: false });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address.trim(),
        jobType: form.jobType,
        materialCategory:
          form.jobType === "powder_coating" ? form.materialCategory : "",
        active: form.active !== false,
      };
      if (editingId) {
        await updateJobOrderVendor(editingId, payload);
        setMsg({ text: "Vendor updated.", ok: true });
      } else {
        await addJobOrderVendor(payload);
        setMsg({ text: "Vendor added.", ok: true });
      }
      resetForm();
      await load();
    } catch (err) {
      setMsg({ text: err.message || "Save failed.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(v) {
    if (
      !window.confirm(
        `Deactivate "${v.name}"? It will stay in this list (Inactive) but hide from new challans.`,
      )
    )
      return;
    try {
      await deleteJobOrderVendor(v._id, false);
      setMsg({
        text: `"${v.name}" deactivated. Use Activate to turn it back on.`,
        ok: true,
      });
      await load();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleReactivate(v) {
    try {
      await updateJobOrderVendor(v._id, {
        name: v.name,
        address: v.address || "",
        jobType: v.jobType,
        materialCategory: v.materialCategory || "",
        active: true,
      });
      setMsg({ text: `"${v.name}" is active again.`, ok: true });
      await load();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleHardDelete(v) {
    if (
      !window.confirm(
        `Permanently delete "${v.name}"? Existing challans keep the name as text.`,
      )
    )
      return;
    try {
      await deleteJobOrderVendor(v._id, true);
      if (editingId === v._id) resetForm();
      await load();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="vm-page">
      <div className="pagehead">
        <div className="pagehead-text">
          <h2>Vendor Master</h2>
          <p>
            Add and manage powder coating and fabrication vendors used on job
            orders and user accounts.
          </p>
        </div>
      </div>

      <div className="card">
        <h3>{editingId ? "Edit vendor" : "Add vendor"}</h3>
        <form onSubmit={handleSubmit}>
          <div className="formgrid">
            <div className="field">
              <label>
                Vendor name <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="e.g. G.K Powder Coating"
              />
            </div>
            <div className="field">
              <label>
                Job type <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <select
                value={form.jobType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    jobType: e.target.value,
                    materialCategory:
                      e.target.value === "powder_coating"
                        ? f.materialCategory
                        : "",
                  }))
                }
              >
                <option value="powder_coating">Powder Coating</option>
                <option value="fabrication">Fabrication</option>
              </select>
            </div>
            {form.jobType === "powder_coating" && (
              <div className="field">
                <label>Material category</label>
                <select
                  value={form.materialCategory}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      materialCategory: e.target.value,
                    }))
                  }
                >
                  <option value="">— Not set —</option>
                  {VENDOR_MATERIAL_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Status</label>
              <select
                value={form.active ? "active" : "inactive"}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    active: e.target.value === "active",
                  }))
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="field full">
              <label>Address</label>
              <textarea
                rows={2}
                value={form.address}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address: e.target.value }))
                }
                placeholder="Delivery / plant address"
              />
            </div>
          </div>
          {msg.text && (
            <div
              className={`alert ${msg.ok ? "ok" : "err"}`}
              style={{ marginTop: 12 }}
            >
              {msg.text}
            </div>
          )}
          <div className="vm-form-actions">
            <button type="submit" className="btn btn-in" disabled={saving}>
              {saving
                ? "Saving…"
                : editingId
                  ? "Update vendor"
                  : "Add vendor"}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={resetForm}
                disabled={saving}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card card-wide">
        <div className="vm-toolbar">
          <h3 style={{ margin: 0 }}>
            Vendors <span className="pill-count">{filtered.length}</span>
          </h3>
          <div className="vm-toolbar-controls">
            <input
              className="vm-search"
              placeholder="Search name or address…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            <select
              className="vm-type-filter"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All types</option>
              <option value="powder_coating">Powder Coating</option>
              <option value="fabrication">Fabrication</option>
            </select>
            <select
              className="vm-type-filter"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All status</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>
        </div>

        <div className="tablewrap vm-tablewrap">
          <table className="vm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Category</th>
                <th>Address</th>
                <th>Status</th>
                <th className="vm-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="vm-empty">
                    No vendors found.
                  </td>
                </tr>
              )}
              {pageItems.map((v) => (
                <tr
                  key={v._id}
                  className={[
                    v.active === false ? "vm-row-inactive" : "",
                    editingId === v._id ? "vm-row-editing" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined}
                >
                  <td className="vm-name">{v.name}</td>
                  <td className="nowrap">{jobTypeLabel(v.jobType)}</td>
                  <td className="nowrap">
                    {v.jobType === "powder_coating"
                      ? VENDOR_MATERIAL_CATEGORIES.find(
                          (c) => c.id === v.materialCategory,
                        )?.label || "—"
                      : "—"}
                  </td>
                  <td className="vm-address">{v.address || "—"}</td>
                  <td className="nowrap">
                    <button
                      type="button"
                      className={
                        v.active === false ? "vm-badge off" : "vm-badge on"
                      }
                      title={
                        v.active === false
                          ? "Click to activate"
                          : "Click to deactivate"
                      }
                      onClick={() =>
                        v.active === false
                          ? handleReactivate(v)
                          : handleDeactivate(v)
                      }
                    >
                      {v.active === false ? "Inactive" : "Active"}
                    </button>
                  </td>
                  <td className="vm-actions-col">
                    <div className="vm-row-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => startEdit(v)}
                      >
                        Edit
                      </button>
                      {v.active === false ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-in"
                          onClick={() => handleReactivate(v)}
                        >
                          Activate
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => handleDeactivate(v)}
                        >
                          Deactivate
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-del btn-sm"
                        onClick={() => handleHardDelete(v)}
                        title="Delete vendor"
                      >
                        🗑
                      </button>
                    </div>
                  </td>
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
      </div>
    </div>
  );
}
