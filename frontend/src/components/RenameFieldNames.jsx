import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getInwardNameValues, renameInwardNames } from "../api/api";

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function groupValues(values) {
  const map = new Map();
  for (const row of values || []) {
    const key = normalizeName(row.value);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.values()]
    .map((items) => ({
      items: items.slice().sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
      total: items.reduce((sum, item) => sum + (item.count || 0), 0),
      mixed: items.length > 1,
    }))
    .sort((a, b) => {
      if (a.mixed !== b.mixed) return a.mixed ? -1 : 1;
      return b.total - a.total;
    });
}

export default function RenameFieldNames({ onClose, onRenamed }) {
  const [field, setField] = useState("vendor");
  const [values, setValues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [renameTo, setRenameTo] = useState("");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setErr("");
    setSelected(new Set());
    setRenameTo("");
    setNotice("");
    getInwardNameValues(field)
      .then((data) => {
        if (!cancel) setValues(Array.isArray(data?.values) ? data.values : []);
      })
      .catch((e) => {
        if (!cancel) setErr(e.message || "Could not load names");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [field]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const grouped = groupValues(values);
    if (!q) return grouped;
    return grouped.filter((group) =>
      group.items.some((item) => item.value.toLowerCase().includes(q))
    );
  }, [values, search]);

  const mixedCount = useMemo(
    () => groupValues(values).filter((group) => group.mixed).length,
    [values]
  );

  function toggle(value) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleGroup(group) {
    const names = group.items.map((item) => item.value);
    const allOn = names.every((name) => selected.has(name));
    setSelected((prev) => {
      const next = new Set(prev);
      names.forEach((name) => {
        if (allOn) next.delete(name);
        else next.add(name);
      });
      return next;
    });
  }

  async function rename() {
    const from = [...selected];
    const to = renameTo.trim().replace(/\s+/g, " ");
    if (!from.length) {
      setErr("Select the names you want to change.");
      return;
    }
    if (!to) {
      setErr("Type the correct name.");
      return;
    }
    const changing = from.filter((name) => name !== to);
    if (!changing.length) {
      setErr("The selected names are already that spelling.");
      return;
    }
    if (
      !window.confirm(
        `Rename ${changing.length} ${field} name${changing.length === 1 ? "" : "s"} to "${to}"?\n\nEvery inward entry using those names will be updated.`
      )
    ) {
      return;
    }
    setSaving(true);
    setErr("");
    setNotice("");
    try {
      const result = await renameInwardNames(field, changing, to);
      setNotice(
        `Updated ${result.updated || 0} inward entr${result.updated === 1 ? "y" : "ies"} to "${result.to || to}".`
      );
      setSelected(new Set());
      setRenameTo("");
      const data = await getInwardNameValues(field);
      setValues(Array.isArray(data?.values) ? data.values : []);
      if (onRenamed) await onRenamed();
    } catch (e) {
      setErr(e.message || "Could not rename");
    } finally {
      setSaving(false);
    }
  }

  const label = field === "vendor" ? "Vendor" : "Category";

  return createPortal(
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={head}>
          <div>
            <h3 style={{ margin: 0 }}>Fix duplicate names</h3>
            <p style={hint}>
              Tick every spelling that should be the same name, including capitals and small mistakes, then rename them together.
              {mixedCount > 0 && ` ${mixedCount} group${mixedCount === 1 ? "" : "s"} already match except for capital letters or spaces.`}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div style={tabs}>
          {["vendor", "category"].map((key) => (
            <button
              key={key}
              type="button"
              className={field === key ? "btn btn-in btn-sm" : "btn btn-ghost btn-sm"}
              onClick={() => setField(key)}
            >
              {key === "vendor" ? "Vendor" : "Category"}
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            style={{ ...inputStyle, flex: 1, minWidth: 160 }}
          />
        </div>

        {err && <div className="alert err" style={{ marginBottom: 10 }}>{err}</div>}
        {notice && <div className="alert ok" style={{ marginBottom: 10 }}>{notice}</div>}

        <div style={listBox}>
          {loading && <p style={hint}>Loading names…</p>}
          {!loading && !groups.length && <p style={hint}>No {label.toLowerCase()} names found.</p>}
          {!loading &&
            groups.map((group) => (
              <div
                key={group.items.map((item) => item.value).join("|")}
                style={{
                  ...groupBox,
                  borderColor: group.mixed ? "var(--amber, #c8861b)" : "var(--line, #e4e0d8)",
                }}
              >
                <div style={groupHead}>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                    {group.mixed
                      ? "Same name, different spelling"
                      : `${group.total} entr${group.total === 1 ? "y" : "ies"}`}
                    {group.mixed ? ` · ${group.total} entries` : ""}
                  </span>
                  {group.mixed && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleGroup(group)}>
                      {group.items.every((item) => selected.has(item.value))
                        ? "Clear group"
                        : "Select group"}
                    </button>
                  )}
                </div>
                {group.items.map((item) => (
                  <div key={item.value} style={rowStyle}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selected.has(item.value)}
                        onChange={() => toggle(item.value)}
                      />
                      <span style={{ flex: 1, fontWeight: 600 }}>{item.value}</span>
                      <span style={{ color: "var(--text-3)", fontSize: 12 }}>{item.count}</span>
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setRenameTo(item.value)}
                    >
                      Use this
                    </button>
                  </div>
                ))}
              </div>
            ))}
        </div>

        <div style={footer}>
          <input
            value={renameTo}
            onChange={(e) => setRenameTo(e.target.value)}
            placeholder={`Correct ${label.toLowerCase()} name`}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="button" className="btn btn-in" disabled={saving || !selected.size} onClick={rename}>
            {saving ? "Renaming…" : `Rename ${selected.size || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const overlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(20, 16, 12, 0.45)",
  zIndex: 80,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const panel = {
  width: "min(720px, 100%)",
  maxHeight: "min(86vh, 820px)",
  overflow: "auto",
  background: "var(--paper, #fff)",
  borderRadius: 12,
  padding: 18,
  boxShadow: "0 16px 50px rgba(0,0,0,0.18)",
};

const head = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
  marginBottom: 12,
};

const hint = {
  margin: "6px 0 0",
  fontSize: 13,
  color: "var(--text-3)",
  lineHeight: 1.45,
};

const tabs = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
  marginBottom: 12,
};

const listBox = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxHeight: "48vh",
  overflow: "auto",
  marginBottom: 12,
};

const groupBox = {
  border: "1px solid var(--line, #e4e0d8)",
  borderRadius: 8,
  padding: "8px 10px",
};

const groupHead = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  marginBottom: 4,
};

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "4px 0",
  cursor: "pointer",
};

const footer = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  position: "sticky",
  bottom: 0,
  background: "var(--paper, #fff)",
  paddingTop: 8,
};

const inputStyle = {
  height: 38,
  border: "1px solid var(--line, #d9d3c7)",
  borderRadius: 8,
  padding: "0 10px",
  font: "inherit",
  background: "var(--paper, #fff)",
};
