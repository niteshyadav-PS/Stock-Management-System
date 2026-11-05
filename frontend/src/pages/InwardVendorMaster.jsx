import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  addInwardVendor,
  deleteInwardVendor,
  getInwardVendors,
  updateInwardVendor,
  unwrapList,
} from "../api/api";
import Pagination from "../components/Pagination";
import useClientPagination from "../hooks/useClientPagination";

const EMPTY = {
  name: "",
  address: "",
  active: true,
};

export default function InwardVendorMaster() {
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState({ text: "", ok: true });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = unwrapList(await getInwardVendors({ active: "all" }));
      setList(rows);
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
  }, [list, search, statusFilter]);

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
        active: form.active !== false,
      };
      if (editingId) {
        await updateInwardVendor(editingId, payload);
        setMsg({ text: "Vendor updated.", ok: true });
      } else {
        await addInwardVendor(payload);
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
        `Deactivate "${v.name}"? It stays in this list but hides from Inward entry.`,
      )
    )
      return;
    try {
      await deleteInwardVendor(v._id, false);
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
      await updateInwardVendor(v._id, {
        name: v.name,
        address: v.address || "",
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
        `Permanently delete "${v.name}"? Existing inward entries keep the name as text.`,
      )
    )
      return;
    try {
      await deleteInwardVendor(v._id, true);
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
          <h2>Inward Vendor Master</h2>
          <p>
            Add and manage suppliers used on Inward entry. Active vendors appear
            in the vendor dropdown.
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
                placeholder="e.g. Hindalco Industries Limited"
              />
            </div>
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
                placeholder="Optional supplier address"
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
                <th>Address</th>
                <th>Status</th>
                <th className="vm-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={4} className="vm-empty">
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
