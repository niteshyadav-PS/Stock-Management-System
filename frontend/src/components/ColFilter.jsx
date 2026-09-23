import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";

/** Excel-style multi-select column filter (same UX as Live Stock). */
export default function ColFilter({ values, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState([]);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef();
  const panelRef = useRef();

  useEffect(() => {
    if (open) setPending(selected);
  }, [open]); // eslint-disable-line

  useEffect(() => {
    function handler(e) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        btnRef.current &&
        !btnRef.current.contains(e.target)
      )
        setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleOpen() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const panelH = 360;
      const panelW = Math.min(320, window.innerWidth - 16);
      const spaceBelow = window.innerHeight - rect.bottom;
      let left = rect.left + window.scrollX;
      if (left + panelW > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - panelW - 8);
      }
      setPos({
        top:
          spaceBelow < panelH
            ? rect.top - panelH + window.scrollY
            : rect.bottom + window.scrollY + 2,
        left,
      });
    }
    setOpen((v) => !v);
  }

  const unique = useMemo(() => {
    const list = [...new Set((values || []).filter(Boolean))];
    const toNum = (v) => {
      const c = String(v).replace(/[^0-9.\-]/g, "");
      return c === "" || c === "-" ? NaN : parseFloat(c);
    };
    const isNum = list.length > 0 && list.every((v) => !isNaN(toNum(v)));
    list.sort((a, b) =>
      isNum ? toNum(a) - toNum(b) : String(a).localeCompare(String(b)),
    );
    return list;
  }, [values]);

  const filtered = unique.filter((v) =>
    String(v).toLowerCase().includes(search.toLowerCase()),
  );
  const allSelected = pending.length === unique.length && unique.length > 0;
  const someSelected = pending.length > 0 && pending.length < unique.length;

  function toggle(val) {
    setPending((prev) =>
      prev.includes(val) ? prev.filter((s) => s !== val) : [...prev, val],
    );
  }
  function toggleAll() {
    if (pending.length === unique.length) setPending([]);
    else setPending(unique);
  }
  function handleApply() {
    onChange(pending);
    setOpen(false);
  }
  function handleClear() {
    setPending([]);
    onChange([]);
    setOpen(false);
  }

  const hasChanges =
    JSON.stringify(pending.slice().sort()) !==
    JSON.stringify(selected.slice().sort());

  const panel = (
    <div
      ref={panelRef}
      style={{
        position: "absolute",
        top: pos.top,
        left: pos.left,
        zIndex: 99999,
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        width: "min(320px, calc(100vw - 16px))",
        maxWidth: 320,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <input
          autoFocus
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "7px 10px",
            fontSize: 13,
            border: "1.5px solid var(--line)",
            borderRadius: 6,
            fontFamily: "Inter, Poppins, sans-serif",
            outline: "none",
            background: "#fafaf8",
            color: "var(--ink)",
            boxSizing: "border-box",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--teal)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--line)")}
        />
        <button
          onClick={() => setOpen(false)}
          style={{
            flexShrink: 0,
            width: 26,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 15,
            color: "#8a8270",
            borderRadius: 5,
          }}
        >
          ✕
        </button>
      </div>
      <div
        onClick={toggleAll}
        style={{
          padding: "8px 14px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          background: someSelected
            ? "#fffbf0"
            : allSelected
              ? "var(--teal-light)"
              : undefined,
        }}
      >
        <input
          type="checkbox"
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          checked={allSelected}
          onChange={toggleAll}
          style={{
            cursor: "pointer",
            accentColor: "var(--teal)",
            width: 14,
            height: 14,
            flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        />
        <span
          style={{
            fontSize: 12.5,
            fontStyle: "italic",
            color: "var(--text-3)",
            fontFamily: "Inter, Poppins, sans-serif",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {someSelected
            ? `${pending.length} of ${unique.length} selected`
            : allSelected
              ? "All selected"
              : "(Select all)"}
        </span>
        {pending.length > 0 && (
          <span
            style={{
              marginLeft: "auto",
              flexShrink: 0,
              fontSize: 11,
              background: someSelected ? "var(--amber)" : "var(--teal)",
              color: "#fff",
              borderRadius: 10,
              padding: "1px 7px",
              fontWeight: 600,
            }}
          >
            {pending.length}
          </span>
        )}
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {filtered.map((v) => (
          <div
            key={v}
            onClick={() => toggle(v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 14px",
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "Inter, Poppins, sans-serif",
              background: pending.includes(v) ? "var(--teal-light)" : undefined,
              transition: "background 100ms",
            }}
          >
            <input
              type="checkbox"
              checked={pending.includes(v)}
              onChange={() => toggle(v)}
              style={{
                cursor: "pointer",
                accentColor: "var(--teal)",
                width: 14,
                height: 14,
                flexShrink: 0,
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {v}
            </span>
          </div>
        ))}
        {!filtered.length && (
          <div
            style={{
              padding: "12px 14px",
              fontSize: 12.5,
              color: "var(--text-3)",
              textAlign: "center",
            }}
          >
            No results
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "10px 12px",
          borderTop: "1px solid var(--line)",
          background: "var(--paper-dim)",
        }}
      >
        <button
          onClick={handleClear}
          style={{
            flex: 1,
            fontSize: 12.5,
            padding: "7px 0",
            border: "1.5px solid var(--line)",
            borderRadius: 6,
            cursor: "pointer",
            background: "#fff",
            fontFamily: "Inter, Poppins, sans-serif",
            color: "var(--ink)",
          }}
        >
          Clear
        </button>
        <button
          onClick={handleApply}
          style={{
            flex: 2,
            fontSize: 12.5,
            padding: "7px 0",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            background: hasChanges ? "var(--teal)" : "var(--paper-dim)",
            color: hasChanges ? "#fff" : "var(--text-3)",
            fontFamily: "Inter, Poppins, sans-serif",
            fontWeight: 600,
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={{
          background: selected.length > 0 ? "var(--teal)" : "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 6px",
          borderRadius: 4,
          fontSize: 10,
          color: selected.length > 0 ? "#fff" : "#8a8270",
          lineHeight: 1,
          flexShrink: 0,
        }}
        title={
          selected.length > 0 ? `${selected.length} filter(s) active` : "Filter"
        }
      >
        ▼
      </button>
      {open && createPortal(panel, document.body)}
    </>
  );
}

/** Table header cell with label + ColFilter. */
export function ThFilter({ label, values, selected, onChange, className, style }) {
  return (
    <th className={className} style={style}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {label}{" "}
        <ColFilter values={values} selected={selected} onChange={onChange} />
      </span>
    </th>
  );
}
