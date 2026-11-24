import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { assignSubCategory } from "../api/api";
import {
  MATERIAL_TYPES,
  categoriesForType,
  formatSubCategory,
  getItemGroup,
  getSubCategory,
} from "../constants/materialTypeGroups";

/**
 * Assign display-only Sub Category (Type · Category).
 * Does NOT change material type/category or stock history.
 */
export default function GroupTypeModal({ materials = [], onClose, onSaved }) {
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [newType, setNewType] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  const activeMaterials = useMemo(
    () => (materials || []).filter((m) => m?.active !== false),
    [materials],
  );

  const existingCategories = useMemo(() => {
    const map = new Map();
    activeMaterials.forEach((m) => {
      const raw = String(m.category || "").trim();
      if (!raw) return;
      const key = raw.toLowerCase();
      if (!map.has(key)) map.set(key, raw);
    });
    return [...map.values()].sort((a, b) => a.localeCompare(b));
  }, [activeMaterials]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const catKey = filterCategory.trim().toLowerCase();
    return activeMaterials
      .filter((m) => {
        if (
          catKey &&
          String(m.category || "").trim().toLowerCase() !== catKey
        ) {
          return false;
        }
        if (!q) return true;
        return (
          String(m.name || "")
            .toLowerCase()
            .includes(q) ||
          String(m.code || "")
            .toLowerCase()
            .includes(q) ||
          String(m.type || "")
            .toLowerCase()
            .includes(q) ||
          String(m.category || "")
            .toLowerCase()
            .includes(q) ||
          getSubCategory(m).toLowerCase().includes(q) ||
          getItemGroup(m).toLowerCase().includes(q)
        );
      })
      .slice()
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || "")),
      );
  }, [activeMaterials, search, filterCategory]);

  const newCategoryOptions = useMemo(
    () => categoriesForType(newType),
    [newType],
  );

  const previewGroup = formatSubCategory(newType, newCategory);
  const hasSelection = selected.size > 0;

  function onNewTypeChange(nextType) {
    setNewType(nextType);
    const cats = categoriesForType(nextType);
    setNewCategory(cats[0] || "");
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setErr("");
    setNotice("");
  }

  function selectVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((m) => next.add(m._id));
      return next;
    });
    setErr("");
    setNotice("");
  }

  function selectWholeCategory(cat) {
    if (!cat) return;
    const key = cat.trim().toLowerCase();
    setSelected((prev) => {
      const next = new Set(prev);
      activeMaterials.forEach((m) => {
        if (String(m.category || "").trim().toLowerCase() === key) {
          next.add(m._id);
        }
      });
      return next;
    });
    setFilterCategory(cat);
    setErr("");
    setNotice("");
  }

  function clearSelection() {
    setSelected(new Set());
    setNewType("");
    setNewCategory("");
    setErr("");
  }

  async function apply(subCategory) {
    setErr("");
    setNotice("");
    if (!selected.size) {
      setErr("Select items first, then choose Sub Category.");
      return;
    }
    setSaving(true);
    try {
      const res = await assignSubCategory([...selected], subCategory);
      const label = subCategory || "(cleared)";
      setNotice(
        `Sub Category set on ${res?.materialsUpdated || selected.size} item(s) → ${label}. Type and Category were not changed.`,
      );
      setSelected(new Set());
      setNewType("");
      setNewCategory("");
      onSaved?.();
    } catch (e) {
      setErr(e.message || "Could not set Sub Category.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div style={overlay} onClick={onClose}>
      <div
        style={panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={head}>
          <div>
            <h3 style={{ margin: 0 }}>Set Sub Category</h3>
            <p style={hint}>
              Select items, then assign a Sub Category from your Type / Category
              chart. This only fills the <strong>Sub Category</strong> column —
              it does <strong>not</strong> change real Type or Category.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div style={controls}>
          <label style={{ ...field, flex: 1.3 }}>
            <span style={label}>Search items</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, code, type, category, sub category…"
              style={inputStyle}
            />
          </label>
          <label style={field}>
            <span style={label}>Filter by current category</span>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              style={inputStyle}
            >
              <option value="">All categories</option>
              {existingCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={toolbar}>
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            {selected.size} selected · {filtered.length} shown
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {filterCategory && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => selectWholeCategory(filterCategory)}
              >
                Select all in “{filterCategory}”
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={selectVisible}
            >
              Select shown
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={clearSelection}
              disabled={!selected.size}
            >
              Clear
            </button>
          </div>
        </div>

        {err && (
          <div className="alert err" style={{ margin: "0 18px 10px" }}>
            {err}
          </div>
        )}
        {notice && (
          <div className="alert ok" style={{ margin: "0 18px 10px" }}>
            {notice}
          </div>
        )}

        <div style={listBox}>
          <div style={listHead}>
            <span style={{ width: 28 }} />
            <span style={{ flex: 1.5 }}>Material</span>
            <span style={{ flex: 1 }}>Item Group</span>
            <span style={{ flex: 1.2 }}>Sub Category</span>
          </div>
          {!filtered.length && (
            <p style={{ ...hint, padding: "12px" }}>No materials match.</p>
          )}
          {filtered.map((m) => {
            const id = m._id;
            const checked = selected.has(id);
            return (
              <label
                key={id}
                style={{
                  ...rowStyle,
                  background: checked
                    ? "rgba(46, 125, 50, 0.08)"
                    : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(id)}
                />
                <span style={{ flex: 1.5, fontWeight: 600 }}>{m.name}</span>
                <span style={meta}>{getItemGroup(m) || "—"}</span>
                <span style={meta}>{getSubCategory(m) || "—"}</span>
              </label>
            );
          })}
        </div>

        <div
          style={{
            ...footer,
            flexDirection: "column",
            alignItems: "stretch",
            gap: 10,
            opacity: hasSelection ? 1 : 0.55,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            Assign Sub Category to {selected.size || 0} selected item
            {selected.size === 1 ? "" : "s"}
          </div>
          {!hasSelection ? (
            <p style={{ ...hint, margin: 0 }}>
              Select items above first. Then pick Type + Category for the Sub
              Category column.
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "flex-end",
              }}
            >
              <label style={{ ...field, minWidth: 180 }}>
                <span style={label}>Group type</span>
                <select
                  value={newType}
                  onChange={(e) => onNewTypeChange(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select type…</option>
                  {MATERIAL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...field, minWidth: 200 }}>
                <span style={label}>Group category</span>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  style={inputStyle}
                  disabled={!newType}
                >
                  <option value="">
                    {newType ? "Select category…" : "Pick type first"}
                  </option>
                  {newCategoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-in"
                disabled={saving || !previewGroup}
                onClick={() => apply(previewGroup)}
                style={{ height: 38 }}
              >
                {saving
                  ? "Saving…"
                  : `Set sub category (${selected.size})`}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={saving}
                onClick={() => apply("")}
                style={{ height: 38 }}
                title="Remove Sub Category from selected items"
              >
                Clear sub category
              </button>
            </div>
          )}
          {hasSelection && previewGroup && (
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>
              Will set Item Group: <strong>{newType}</strong>
              {" · "}
              Sub Category: <strong>{newCategory}</strong>
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const overlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(20, 24, 20, 0.45)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const panel = {
  width: "min(960px, 100%)",
  maxHeight: "min(90vh, 860px)",
  background: "var(--surface, #fff)",
  borderRadius: 12,
  border: "1px solid var(--line, #e4e0d8)",
  boxShadow: "0 18px 48px rgba(0,0,0,0.18)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const head = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
  padding: "16px 18px 10px",
  borderBottom: "1px solid var(--line, #e4e0d8)",
};

const hint = {
  margin: "6px 0 0",
  fontSize: 13,
  color: "var(--text-3)",
  lineHeight: 1.45,
};

const controls = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  padding: "12px 18px 0",
};

const field = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  flex: 1,
  minWidth: 160,
};

const label = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-3)",
};

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--line, #e4e0d8)",
  background: "var(--bg, #fff)",
  fontSize: 14,
};

const toolbar = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  padding: "10px 18px",
  flexWrap: "wrap",
};

const listBox = {
  margin: "0 18px",
  border: "1px solid var(--line, #e4e0d8)",
  borderRadius: 10,
  overflow: "auto",
  flex: 1,
  minHeight: 220,
  background: "var(--bg, #faf9f6)",
};

const listHead = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 12px",
  borderBottom: "1px solid var(--line, #e4e0d8)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-3)",
  position: "sticky",
  top: 0,
  background: "var(--surface, #fff)",
  zIndex: 1,
};

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 12px",
  borderBottom: "1px solid var(--line, #ece8e0)",
  cursor: "pointer",
  fontSize: 13,
};

const meta = {
  flex: 1,
  color: "var(--text-3)",
  fontSize: 12,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const footer = {
  display: "flex",
  padding: "12px 18px 16px",
  borderTop: "1px solid var(--line, #e4e0d8)",
  marginTop: 12,
  background: "var(--surface, #fff)",
};
