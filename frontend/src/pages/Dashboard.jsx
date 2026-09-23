import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import {
  getPurchaseRequests,
  getPurchaseOrders,
  getMaster,
  getInward,
  getOutward,
  unwrapList,
} from "../api/api";
import { useAuth } from "../context/AuthContext";
import { formatNum, formatINR, toDDMMYYYY } from "../utils/helpers";
import { buildQtyMaps } from "../utils/stockMaps";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

const STATUS_LABEL = {
  pending: "Pending",
  approved: "Approved",
  partial: "Partially Ordered",
  rejected: "Rejected",
  ordered: "Ordered",
  received: "Received",
};

const COLORS = [
  "#1f5c52",
  "#b5481f",
  "#c8861b",
  "#a3322a",
  "#2a9d8f",
  "#264653",
];

// ── Shared helpers ─────────────────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const h = (hex || "#1f5c52").replace("#", "");
  const bigint = parseInt(h.length === 6 ? h : "1f5c52", 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function shortQty(v) {
  const abs = Math.abs(v);
  if (abs >= 100000)
    return `${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L`;
  if (abs >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return v.toLocaleString("en-IN");
}

// ── Auto-fit stat number: measures the card's real width via ResizeObserver
// and shrinks the number to fit exactly, instead of guessing from character
// count. Never truncates — it keeps shrinking until the full value fits. ────
function StatValue({ value, color, maxFontSize = 26, minFontSize = 9 }) {
  const wrapRef = useRef(null);
  const textRef = useRef(null);
  const [fontSize, setFontSize] = useState(maxFontSize);
  const RIGHT_PADDING = 10;

  useEffect(() => {
    const wrap = wrapRef.current;
    const text = textRef.current;
    if (!wrap || !text) return;

    function fit() {
      const available = wrap.clientWidth - RIGHT_PADDING;
      if (available <= 0) return;

      let size = maxFontSize;
      text.style.fontSize = `${size}px`;

      while (text.scrollWidth > available && size > minFontSize) {
        size -= 1;
        text.style.fontSize = `${size}px`;
      }
      setFontSize(size);
    }

    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    fit();

    return () => ro.disconnect();
  }, [value, maxFontSize, minFontSize]);

  return (
    <div
      ref={wrapRef}
      style={{ width: "100%", minWidth: 0, paddingRight: RIGHT_PADDING }}
    >
      <div
        ref={textRef}
        className="value"
        style={{
          color: color || "inherit",
          fontSize,
          whiteSpace: "nowrap",
          lineHeight: 1.2,
          display: "inline-block",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, cls, active, onClick, sub }) {
  return (
    <div
      className={`stat ${cls || ""}`}
      style={{
        cursor: onClick ? "pointer" : "default",
        outline: active ? "2px solid var(--teal)" : "none",
        outlineOffset: 2,
        minWidth: 0,
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onClick={onClick}
      title={
        onClick
          ? active
            ? "Click to clear filter"
            : `Filter by ${label}`
          : undefined
      }
    >
      <div className="label">{label}</div>
      <StatValue value={value} color={color} />
      {sub && (
        <div style={{ fontSize: 11, color: "#8a8270", marginTop: 4 }}>
          {sub}
        </div>
      )}
      {active && (
        <div
          style={{
            fontSize: 10,
            color: "var(--teal)",
            fontWeight: 600,
            marginTop: 4,
          }}
        >
          FILTERED ✓
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, count, onClear, activeFilter }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 14,
        flexWrap: "wrap",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "1px",
          color: "#8a8270",
        }}
      >
        {title}
      </h3>
      {count !== undefined && <span className="pill-count">{count}</span>}
      {activeFilter && (
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginLeft: "auto", fontSize: 11 }}
          onClick={onClear}
        >
          ✕ Clear filter
        </button>
      )}
    </div>
  );
}

// ── Chart components ───────────────────────────────────────────────────────────
function PRStatusPie({ data }) {
  const RADIAN = Math.PI / 180;
  const renderLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    value,
  }) => {
    // Places the label inside the slice (55% of the radius) instead of
    // projecting it outward — the default "outside" label math breaks when
    // there's a single 100%-full slice and pushes the text off the card.
    const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text
        x={x}
        y={y}
        fill="#fff"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={13}
        fontWeight={700}
      >
        {value}
      </text>
    );
  };

  return (
    <div
      style={{
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <ResponsiveContainer width="100%" height={220}>
        <PieChart tabIndex={-1}>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            outerRadius={80}
            dataKey="value"
            label={renderLabel}
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function TopItemsBar({ data, xKey, yKey, color, label, valuePrefix }) {
  const barColor = color || "var(--teal)";

  function FullNameTooltip({ active, payload }) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 12,
          boxShadow: "0 4px 12px rgba(0,0,0,.1)",
          maxWidth: 240,
        }}
      >
        <div
          style={{
            fontWeight: 600,
            marginBottom: 4,
            color: "var(--ink)",
            overflowWrap: "break-word",
          }}
        >
          {row.fullName || row[xKey]}
        </div>
        <div style={{ color: barColor }}>
          {label}:{" "}
          <strong>
            {valuePrefix || ""}
            {typeof payload[0].value === "number"
              ? payload[0].value.toLocaleString("en-IN")
              : payload[0].value}
          </strong>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 10, left: 0, bottom: 60 }}
          barCategoryGap="38%"
          tabIndex={-1}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 10 }}
            angle={-40}
            textAnchor="end"
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            width={46}
            tickFormatter={(v) => `${valuePrefix || ""}${shortQty(v)}`}
          />
          <Tooltip
            content={<FullNameTooltip />}
            cursor={{ fill: hexToRgba(color, 0.08) }}
          />
          <Bar
            dataKey={yKey}
            name={label}
            fill={barColor}
            radius={[4, 4, 0, 0]}
            maxBarSize={38}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function InwardTrendLine({ data }) {
  return (
    <div
      style={{
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <ResponsiveContainer width="100%" height={180}>
        <LineChart
          data={data}
          margin={{ top: 4, right: 10, left: 0, bottom: 0 }}
          tabIndex={-1}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 11 }} width={46} tickFormatter={shortQty} />
          <Tooltip formatter={(v) => [v.toLocaleString("en-IN"), "Qty"]} />
          <Line
            type="monotone"
            dataKey="qty"
            stroke="var(--teal)"
            strokeWidth={2}
            dot={false}
            name="Qty"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Admin Dashboard ────────────────────────────────────────────────────────────
function AdminDashboard({
  requests,
  pos,
  master,
  inward,
  outward,
  stockMap,
  lowStockItems,
  counts,
  posByPrId,
  navigate,
}) {
  const [activeFilter, setActiveFilter] = useState(null);
  const [expanded, setExpanded] = useState(null);

  function itemsToOrderCount(pr) {
    const prPos = posByPrId[String(pr._id)] || [];
    const ordered = {};
    for (const po of prPos)
      for (const it of po.items || []) {
        const key = `${String(it.name || "").trim()}||${String(it.projectName || po.projectName || "").trim()}`;
        ordered[key] = (ordered[key] || 0) + (it.orderedQty || 0);
      }
    return pr.items.filter((it) => {
      const key = `${String(it.name || "").trim()}||${String(it.projectName || pr.projectName || "").trim()}`;
      return it.qty - (ordered[key] || 0) > 0.00001;
    }).length;
  }

  const remainingItemsCount = requests
    .filter((r) => ["partial", "approved"].includes(r.status))
    .reduce((sum, pr) => sum + itemsToOrderCount(pr), 0);

  const prStatusData = Object.entries(counts).map(([k, v]) => ({
    name: STATUS_LABEL[k] || k,
    value: v,
  }));

  // Top 10 items by inward qty
  const inTotals = {};
  inward.forEach((e) => {
    inTotals[e.name] = (inTotals[e.name] || 0) + (parseFloat(e.qty) || 0);
  });
  const topInward = Object.entries(inTotals)
    .map(([name, qty]) => ({
      name: name.length > 12 ? name.slice(0, 12) + "…" : name,
      fullName: name,
      qty,
    }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  // Top 10 items by outward qty
  const outTotals = {};
  outward.forEach((e) => {
    outTotals[e.name] = (outTotals[e.name] || 0) + (parseFloat(e.qty) || 0);
  });
  const topOutward = Object.entries(outTotals)
    .map(([name, qty]) => ({
      name: name.length > 12 ? name.slice(0, 12) + "…" : name,
      fullName: name,
      qty,
    }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  // PO total value
  const totalPOValue = pos.reduce(
    (s, po) =>
      s +
      (po.items || []).reduce((a, i) => a + i.orderedQty * (i.price || 0), 0),
    0,
  );

  // ── Pricing insight: weighted avg unit price + current stock valuation
  // per material, computed the same way Live Stock does (avg cost from
  // inward entries × current balance). Drives both the "Pending Item
  // Price" stat card and the two charts below — admin-only. ────────────────
  const inValTotals = {};
  inward.forEach((e) => {
    inValTotals[e.name] =
      (inValTotals[e.name] || 0) +
      (parseFloat(e.qty) || 0) * (parseFloat(e.price) || 0);
  });
  const itemValuation = master.map((m) => {
    const inQty = inTotals[m.name] || 0;
    const outQty = outTotals[m.name] || 0;
    const avgPrice = inQty > 0 ? (inValTotals[m.name] || 0) / inQty : 0;
    const stock = inQty - outQty;
    const totalVal = avgPrice * Math.max(stock, 0);
    return { name: m.name, avgPrice, totalVal };
  });

  const topUnitPrice = [...itemValuation]
    .filter((it) => it.avgPrice > 0)
    .sort((a, b) => b.avgPrice - a.avgPrice)
    .slice(0, 10)
    .map((it) => ({
      name: it.name.length > 12 ? it.name.slice(0, 12) + "…" : it.name,
      fullName: it.name,
      price: Math.round(it.avgPrice),
    }));

  const topValuation = [...itemValuation]
    .filter((it) => it.totalVal > 0)
    .sort((a, b) => b.totalVal - a.totalVal)
    .slice(0, 10)
    .map((it) => ({
      name: it.name.length > 12 ? it.name.slice(0, 12) + "…" : it.name,
      fullName: it.name,
      value: Math.round(it.totalVal),
    }));

  // Inward entries where a price was never entered (0 or blank) — same
  // check used on the Purchase dashboard, surfaced here for admin too.
  const pendingPriceItems = inward.filter(
    (e) => !e.price || parseFloat(e.price) === 0,
  );
  const pendingPriceCount = pendingPriceItems.length;

  function getFilteredPRs() {
    if (!activeFilter || activeFilter === "low-stock") return requests;
    if (activeFilter === "items-to-order")
      return requests.filter(
        (r) =>
          ["approved", "partial"].includes(r.status) &&
          itemsToOrderCount(r) > 0,
      );
    return requests.filter((r) => r.status === activeFilter);
  }

  const filteredPRs = getFilteredPRs();

  const cards = [
    {
      key: "pending",
      label: "PR Approval",
      value: counts.pending || 0,
      color: (counts.pending || 0) > 0 ? "var(--red)" : undefined,
      cls: "",
    },
    {
      key: "approved",
      label: "PR Request",
      value: counts.approved || 0,
      cls: "teal",
    },
    {
      key: "partial",
      label: "Partially Ordered",
      value: counts.partial || 0,
      cls: "rust",
    },
    {
      key: "items-to-order",
      label: "Items to Order",
      value: remainingItemsCount,
      color: remainingItemsCount > 0 ? "var(--red)" : undefined,
      cls: "",
    },
    {
      key: "ordered",
      label: "Order in Process",
      value: counts.ordered || 0,
      cls: "teal",
    },
    {
      key: "low-stock",
      label: "Low Stock Qty",
      value: lowStockItems.length,
      color: lowStockItems.length > 0 ? "var(--red)" : undefined,
      cls: "rust",
    },
    {
      key: "received",
      label: "Received",
      value: counts.received || 0,
      color: "var(--teal-dark)",
      cls: "teal",
    },
    {
      key: "pending-price",
      label: "Pending Item Price",
      value: pendingPriceCount,
      color: pendingPriceCount > 0 ? "var(--amber)" : undefined,
      cls: "",
    },
    {
      key: "total-pos",
      label: "Total POs",
      value: pos.length,
      cls: "",
    },
  ];

  return (
    <>
      {/* Stat cards */}
      <div
        className="statrow"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 12,
        }}
      >
        {cards.map((c, i) => (
          <StatCard
            key={i}
            label={c.label}
            value={c.value}
            color={c.color}
            cls={c.cls}
            active={activeFilter === c.key}
            onClick={
              c.key
                ? () => setActiveFilter((p) => (p === c.key ? null : c.key))
                : c.onClick
            }
          />
        ))}
      </div>

      {/* Charts row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 20,
          minWidth: 0,
        }}
      >
        <div className="card" style={{ marginBottom: 0 }}>
          <SectionHeader title="PR Status Distribution" />
          <PRStatusPie data={prStatusData} />
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <SectionHeader title="Top 10 Inward Items (Qty)" />
          <TopItemsBar
            data={topInward}
            xKey="name"
            yKey="qty"
            color="#1f5c52"
            label="Inward Qty"
          />
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <SectionHeader title="Top 10 Outward Items (Qty)" />
          <TopItemsBar
            data={topOutward}
            xKey="name"
            yKey="qty"
            color="#b5481f"
            label="Outward Qty"
          />
        </div>
      </div>

      {/* Pricing charts row — admin only */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 20,
          minWidth: 0,
        }}
      >
        <div className="card" style={{ marginBottom: 0 }}>
          <SectionHeader title="Top 10 Items by Unit Price (₹)" />
          {topUnitPrice.length ? (
            <TopItemsBar
              data={topUnitPrice}
              xKey="name"
              yKey="price"
              color="#c8861b"
              label="Unit Price"
              valuePrefix="₹"
            />
          ) : (
            <div className="empty">No priced inward entries yet.</div>
          )}
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <SectionHeader title="Top 10 Items by Stock Valuation (₹)" />
          {topValuation.length ? (
            <TopItemsBar
              data={topValuation}
              xKey="name"
              yKey="value"
              color="#1f5c52"
              label="Stock Valuation"
              valuePrefix="₹"
            />
          ) : (
            <div className="empty">No stock valuation to show yet.</div>
          )}
        </div>
      </div>

      {/* PR table — filterable */}
      {activeFilter === "low-stock" ? (
        <div className="card">
          <SectionHeader
            title="Low Stock Items"
            count={lowStockItems.length}
            activeFilter={activeFilter}
            onClear={() => setActiveFilter(null)}
          />
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Code</th>
                  <th className="num">Stock</th>
                  <th className="num">Min Stock</th>
                  <th>UOM</th>
                </tr>
              </thead>
              <tbody>
                {lowStockItems.map((item) => (
                  <tr key={item._id}>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td className="mono">{item.code || "—"}</td>
                    <td
                      className="num"
                      style={{ color: "var(--red)", fontWeight: 700 }}
                    >
                      {formatNum(item.stock)}
                    </td>
                    <td className="num" style={{ color: "var(--amber)" }}>
                      {formatNum(item.minStock)}
                    </td>
                    <td>{item.uom || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeFilter === "pending-price" ? (
        <div className="card">
          <SectionHeader
            title="Inward Entries Missing a Price"
            count={pendingPriceItems.length}
            activeFilter={activeFilter}
            onClear={() => setActiveFilter(null)}
          />
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Material</th>
                  <th>Code</th>
                  <th>Vendor</th>
                  <th className="num">Qty</th>
                  <th>UOM</th>
                </tr>
              </thead>
              <tbody>
                {pendingPriceItems.map((e) => (
                  <tr key={e._id}>
                    <td className="nowrap">{toDDMMYYYY(e.date)}</td>
                    <td style={{ fontWeight: 600 }}>{e.name}</td>
                    <td className="mono">{e.code || "—"}</td>
                    <td>{e.vendor || "—"}</td>
                    <td className="num">{formatNum(e.qty)}</td>
                    <td>{e.uom || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!pendingPriceItems.length && (
            <div className="empty">Every inward entry has a price set.</div>
          )}
        </div>
      ) : activeFilter === "total-pos" ? (
        <div className="card">
          <SectionHeader
            title="All Purchase Orders"
            count={pos.length}
            activeFilter={activeFilter}
            onClear={() => setActiveFilter(null)}
          />
          <POTable pos={pos} />
        </div>
      ) : (
        <div className="card">
          <SectionHeader
            title={
              activeFilter
                ? `${STATUS_LABEL[activeFilter] || activeFilter} — Purchase Requests`
                : "Purchase Requests"
            }
            count={filteredPRs.length}
            activeFilter={activeFilter}
            onClear={() => setActiveFilter(null)}
          />
          <PRTable
            prs={filteredPRs}
            expanded={expanded}
            setExpanded={setExpanded}
            stockMap={stockMap}
            showActions
            navigate={navigate}
            canApprove
            canCreatePO
          />
        </div>
      )}

      {/* Recent POs — hidden while "Total POs" is already showing the full list above */}
      {activeFilter !== "total-pos" && (
        <div className="card">
          <SectionHeader title="Recent Purchase Orders" count={pos.length} />
          <POTable pos={pos.slice(0, 8)} />
        </div>
      )}
    </>
  );
}

// ── Purchase Dashboard ─────────────────────────────────────────────────────────
function PurchaseDashboard({
  requests,
  pos,
  master,
  inward,
  outward,
  stockMap,
  lowStockItems,
  counts,
  posByPrId,
  navigate,
}) {
  const [activeFilter, setActiveFilter] = useState(null);
  const [expanded, setExpanded] = useState(null);

  function itemsToOrderCount(pr) {
    const prPos = posByPrId[String(pr._id)] || [];
    const ordered = {};
    for (const po of prPos)
      for (const it of po.items || []) {
        const key = `${String(it.name || "").trim()}||${String(it.projectName || po.projectName || "").trim()}`;
        ordered[key] = (ordered[key] || 0) + (it.orderedQty || 0);
      }
    return pr.items.filter((it) => {
      const key = `${String(it.name || "").trim()}||${String(it.projectName || pr.projectName || "").trim()}`;
      return it.qty - (ordered[key] || 0) > 0.00001;
    }).length;
  }

  const remainingItemsCount = requests
    .filter((r) => ["partial", "approved"].includes(r.status))
    .reduce((sum, pr) => sum + itemsToOrderCount(pr), 0);

  const totalPOValue = pos.reduce(
    (s, po) =>
      s +
      (po.items || []).reduce((a, i) => a + i.orderedQty * (i.price || 0), 0),
    0,
  );

  // Pending item prices — inward with price = 0
  const pendingPriceItems = inward.filter(
    (e) => !e.price || parseFloat(e.price) === 0,
  );
  const pendingPriceCount = pendingPriceItems.length;

  // Top items by value
  const inValMap = {};
  inward.forEach((e) => {
    inValMap[e.name] =
      (inValMap[e.name] || 0) +
      (parseFloat(e.qty) || 0) * (parseFloat(e.price) || 0);
  });
  const topByValue = Object.entries(inValMap)
    .map(([name, val]) => ({
      name: name.length > 12 ? name.slice(0, 12) + "…" : name,
      fullName: name,
      val: Math.round(val),
    }))
    .sort((a, b) => b.val - a.val)
    .slice(0, 10);

  // Top items by qty (outward)
  const outTotals = {};
  outward.forEach((e) => {
    outTotals[e.name] = (outTotals[e.name] || 0) + (parseFloat(e.qty) || 0);
  });
  const topOutward = Object.entries(outTotals)
    .map(([name, qty]) => ({
      name: name.length > 12 ? name.slice(0, 12) + "…" : name,
      fullName: name,
      qty,
    }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  const prStatusData = Object.entries(counts).map(([k, v]) => ({
    name: STATUS_LABEL[k] || k,
    value: v,
  }));

  function getFilteredPRs() {
    if (!activeFilter) return requests;
    if (activeFilter === "items-to-order")
      return requests.filter(
        (r) =>
          ["approved", "partial"].includes(r.status) &&
          itemsToOrderCount(r) > 0,
      );
    if (activeFilter === "low-stock") return [];
    return requests.filter((r) => r.status === activeFilter);
  }

  const filteredPRs = getFilteredPRs();

  const cards = [
    {
      key: "approved",
      label: "PR Request",
      value: counts.approved || 0,
      cls: "teal",
    },
    {
      key: "items-to-order",
      label: "Items to Order",
      value: remainingItemsCount,
      color: remainingItemsCount > 0 ? "var(--red)" : undefined,
      cls: "",
    },
    {
      key: "partial",
      label: "PR in Process",
      value: counts.partial || 0,
      cls: "rust",
    },
    {
      key: "low-stock",
      label: "Low Stock Qty",
      value: lowStockItems.length,
      color: lowStockItems.length > 0 ? "var(--red)" : undefined,
      cls: "rust",
    },
    {
      key: "pending-price",
      label: "Pending Item Price",
      value: pendingPriceCount,
      color: pendingPriceCount > 0 ? "var(--amber)" : undefined,
      cls: "",
    },
    {
      key: "ordered",
      label: "PO Pending",
      value: counts.ordered || 0,
      cls: "teal",
      onClick: () => navigate("/purchase-orders"),
    },
    {
      key: "total-pos",
      label: "Total PO Value",
      value: `₹${Math.round(totalPOValue).toLocaleString("en-IN")}`,
      cls: "teal",
      sub: "all time",
    },
  ];

  return (
    <>
      <div
        className="statrow"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}
      >
        {cards.map((c, i) => (
          <StatCard
            key={i}
            label={c.label}
            value={c.value}
            color={c.color}
            cls={c.cls}
            sub={c.sub}
            active={activeFilter === c.key}
            onClick={
              c.key
                ? () => setActiveFilter((p) => (p === c.key ? null : c.key))
                : c.onClick
            }
          />
        ))}
      </div>

      {/* Charts */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 20,
          minWidth: 0,
        }}
      >
        <div className="card" style={{ marginBottom: 0 }}>
          <SectionHeader title="PR Status Distribution" />
          <PRStatusPie data={prStatusData} />
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <SectionHeader title="Top 10 Items by Value (₹)" />
          <TopItemsBar
            data={topByValue}
            xKey="name"
            yKey="val"
            color="#1f5c52"
            label="Value (₹)"
          />
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <SectionHeader title="Top 10 Items by Outward Qty" />
          <TopItemsBar
            data={topOutward}
            xKey="name"
            yKey="qty"
            color="#b5481f"
            label="Outward Qty"
          />
        </div>
      </div>

      {/* Low stock */}
      {activeFilter === "low-stock" && (
        <div className="card">
          <SectionHeader
            title="Low Stock Items"
            count={lowStockItems.length}
            activeFilter={activeFilter}
            onClear={() => setActiveFilter(null)}
          />
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Code</th>
                  <th className="num">Stock</th>
                  <th className="num">Min Stock</th>
                  <th>UOM</th>
                </tr>
              </thead>
              <tbody>
                {lowStockItems.map((item) => (
                  <tr key={item._id}>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td className="mono">{item.code || "—"}</td>
                    <td
                      className="num"
                      style={{ color: "var(--red)", fontWeight: 700 }}
                    >
                      {formatNum(item.stock)}
                    </td>
                    <td className="num" style={{ color: "var(--amber)" }}>
                      {formatNum(item.minStock)}
                    </td>
                    <td>{item.uom || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pending item price */}
      {activeFilter === "pending-price" && (
        <div className="card">
          <SectionHeader
            title="Inward Entries Missing a Price"
            count={pendingPriceItems.length}
            activeFilter={activeFilter}
            onClear={() => setActiveFilter(null)}
          />
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Material</th>
                  <th>Code</th>
                  <th>Vendor</th>
                  <th className="num">Qty</th>
                  <th>UOM</th>
                </tr>
              </thead>
              <tbody>
                {pendingPriceItems.map((e) => (
                  <tr key={e._id}>
                    <td className="nowrap">{toDDMMYYYY(e.date)}</td>
                    <td style={{ fontWeight: 600 }}>{e.name}</td>
                    <td className="mono">{e.code || "—"}</td>
                    <td>{e.vendor || "—"}</td>
                    <td className="num">{formatNum(e.qty)}</td>
                    <td>{e.uom || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!pendingPriceItems.length && (
            <div className="empty">Every inward entry has a price set.</div>
          )}
        </div>
      )}

      {/* Total PO value — full PO list */}
      {activeFilter === "total-pos" && (
        <div className="card">
          <SectionHeader
            title="All Purchase Orders"
            count={pos.length}
            activeFilter={activeFilter}
            onClear={() => setActiveFilter(null)}
          />
          <POTable pos={pos} />
        </div>
      )}

      {/* PR table */}
      {activeFilter !== "low-stock" &&
        activeFilter !== "pending-price" &&
        activeFilter !== "total-pos" && (
          <div className="card">
            <SectionHeader
              title={
                activeFilter
                  ? `${STATUS_LABEL[activeFilter] || activeFilter} — PRs`
                  : "Purchase Requests"
              }
              count={filteredPRs.length}
              activeFilter={activeFilter}
              onClear={() => setActiveFilter(null)}
            />
            <PRTable
              prs={filteredPRs}
              expanded={expanded}
              setExpanded={setExpanded}
              stockMap={stockMap}
              showActions
              navigate={navigate}
              canCreatePO
            />
          </div>
        )}

      {/* Recent POs — hidden while "Total PO Value" is already showing the full list above */}
      {activeFilter !== "total-pos" && (
        <div className="card">
          <SectionHeader title="Recent Purchase Orders" count={pos.length} />
          <POTable pos={pos.slice(0, 8)} />
        </div>
      )}
    </>
  );
}

// ── Store Dashboard ────────────────────────────────────────────────────────────
function StoreDashboard({
  requests,
  pos,
  master,
  inward,
  outward,
  stockMap,
  lowStockItems,
  counts,
  posByPrId,
  navigate,
}) {
  const [activeFilter, setActiveFilter] = useState(null);
  const [expanded, setExpanded] = useState(null);

  function itemsToOrderCount(pr) {
    const prPos = posByPrId[String(pr._id)] || [];
    const ordered = {};
    for (const po of prPos)
      for (const it of po.items || []) {
        const key = `${String(it.name || "").trim()}||${String(it.projectName || po.projectName || "").trim()}`;
        ordered[key] = (ordered[key] || 0) + (it.orderedQty || 0);
      }
    return pr.items.filter((it) => {
      const key = `${String(it.name || "").trim()}||${String(it.projectName || pr.projectName || "").trim()}`;
      return it.qty - (ordered[key] || 0) > 0.00001;
    }).length;
  }

  const remainingItemsCount = requests
    .filter((r) => ["partial", "approved"].includes(r.status))
    .reduce((sum, pr) => sum + itemsToOrderCount(pr), 0);

  // Inward trend — last 14 days
  const today = new Date();
  const trendData = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (13 - i));
    const dateStr = d.toISOString().slice(0, 10);
    const qty = inward
      .filter((e) => e.date === dateStr)
      .reduce((s, e) => s + (parseFloat(e.qty) || 0), 0);
    return { date: dateStr.slice(5), qty };
  });

  // Top outward by qty
  const outTotals = {};
  outward.forEach((e) => {
    outTotals[e.name] = (outTotals[e.name] || 0) + (parseFloat(e.qty) || 0);
  });
  const topOutward = Object.entries(outTotals)
    .map(([name, qty]) => ({
      name: name.length > 12 ? name.slice(0, 12) + "…" : name,
      fullName: name,
      qty,
    }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  const prStatusData = Object.entries(counts).map(([k, v]) => ({
    name: STATUS_LABEL[k] || k,
    value: v,
  }));

  function getFilteredPRs() {
    if (!activeFilter || activeFilter === "low-stock") return requests;
    if (activeFilter === "items-to-order")
      return requests.filter(
        (r) =>
          ["approved", "partial"].includes(r.status) &&
          itemsToOrderCount(r) > 0,
      );
    return requests.filter((r) => r.status === activeFilter);
  }

  const filteredPRs = getFilteredPRs();
  const unmatchedPOs = pos.filter((p) => p.status !== "matched");

  // Full item list (with current balance) for the "Live Stock Items" card —
  // store role doesn't see pricing, so no value column here.
  const allStockRows = master.map((m) => ({
    ...m,
    stock: stockMap[m.name] ?? 0,
    minStock: parseFloat(m.minStock) || 0,
  }));

  const cards = [
    {
      key: "live-stock",
      label: "Live Stock Items",
      value: master.length,
      cls: "teal",
    },
    {
      key: "total-inward",
      label: "Total Inward",
      value: formatNum(
        inward.reduce((s, e) => s + (parseFloat(e.qty) || 0), 0),
      ),
      cls: "teal",
    },
    {
      key: "total-outward",
      label: "Total Outward",
      value: formatNum(
        outward.reduce((s, e) => s + (parseFloat(e.qty) || 0), 0),
      ),
      cls: "rust",
    },
    {
      key: "pending",
      label: "PR Approval",
      value: counts.pending || 0,
      color: (counts.pending || 0) > 0 ? "var(--red)" : undefined,
      cls: "",
    },
    {
      key: "items-to-order",
      label: "PR in Process",
      value: remainingItemsCount,
      color: remainingItemsCount > 0 ? "var(--amber)" : undefined,
      cls: "",
    },
    {
      key: "low-stock",
      label: "Low Stock Qty",
      value: lowStockItems.length,
      color: lowStockItems.length > 0 ? "var(--red)" : undefined,
      cls: "rust",
    },
    {
      key: "po-matching",
      label: "PO Matching",
      value: pos.length,
      cls: "",
    },
  ];

  return (
    <>
      <div
        className="statrow"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}
      >
        {cards.map((c, i) => (
          <StatCard
            key={i}
            label={c.label}
            value={c.value}
            color={c.color}
            cls={c.cls}
            active={!!c.key && activeFilter === c.key}
            onClick={
              c.key
                ? () => setActiveFilter((p) => (p === c.key ? null : c.key))
                : c.onClick
            }
          />
        ))}
      </div>
      {/* Charts */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 20,
          minWidth: 0,
        }}
      >
        <div className="card" style={{ marginBottom: 0 }}>
          <SectionHeader title="Inward Trend (Last 14 Days)" />
          <InwardTrendLine data={trendData} />
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <SectionHeader title="Top 10 Outward Items (Qty)" />
          <TopItemsBar
            data={topOutward}
            xKey="name"
            yKey="qty"
            color="#b5481f"
            label="Outward Qty"
          />
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <SectionHeader title="PR Status" />
          <PRStatusPie data={prStatusData} />
        </div>
      </div>

      {/* Low stock */}
      {activeFilter === "low-stock" && (
        <div className="card">
          <SectionHeader
            title="Low Stock Items"
            count={lowStockItems.length}
            activeFilter={activeFilter}
            onClear={() => setActiveFilter(null)}
          />
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Code</th>
                  <th className="num">Stock</th>
                  <th className="num">Min Stock</th>
                  <th>UOM</th>
                </tr>
              </thead>
              <tbody>
                {lowStockItems.map((item) => (
                  <tr key={item._id}>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td className="mono">{item.code || "—"}</td>
                    <td
                      className="num"
                      style={{ color: "var(--red)", fontWeight: 700 }}
                    >
                      {formatNum(item.stock)}
                    </td>
                    <td className="num" style={{ color: "var(--amber)" }}>
                      {formatNum(item.minStock)}
                    </td>
                    <td>{item.uom || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeFilter === "po-matching" && (
        <div className="card">
          <SectionHeader
            title="Purchase Orders Pending Match"
            count={unmatchedPOs.length}
            activeFilter={activeFilter}
            onClear={() => setActiveFilter(null)}
          />
          <POTable pos={unmatchedPOs} />
        </div>
      )}

      {activeFilter === "live-stock" && (
        <div className="card">
          <SectionHeader
            title="Live Stock Items"
            count={allStockRows.length}
            activeFilter={activeFilter}
            onClear={() => setActiveFilter(null)}
          />
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Code</th>
                  <th className="num">Stock</th>
                  <th className="num">Min Stock</th>
                  <th>UOM</th>
                </tr>
              </thead>
              <tbody>
                {allStockRows.map((item) => (
                  <tr key={item._id}>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td className="mono">{item.code || "—"}</td>
                    <td
                      className="num"
                      style={{
                        color:
                          item.stock <= 0
                            ? "var(--red)"
                            : item.minStock > 0 && item.stock < item.minStock
                              ? "var(--amber)"
                              : "inherit",
                        fontWeight: 600,
                      }}
                    >
                      {formatNum(item.stock)}
                    </td>
                    <td className="num">{formatNum(item.minStock)}</td>
                    <td>{item.uom || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeFilter === "total-inward" && (
        <div className="card">
          <SectionHeader
            title="All Inward Entries"
            count={inward.length}
            activeFilter={activeFilter}
            onClear={() => setActiveFilter(null)}
          />
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Material</th>
                  <th>Code</th>
                  <th>Vendor</th>
                  <th className="num">Qty</th>
                  <th>UOM</th>
                </tr>
              </thead>
              <tbody>
                {inward.map((e) => (
                  <tr key={e._id}>
                    <td className="nowrap">{toDDMMYYYY(e.date)}</td>
                    <td style={{ fontWeight: 600 }}>{e.name}</td>
                    <td className="mono">{e.code || "—"}</td>
                    <td>{e.vendor || "—"}</td>
                    <td className="num">{formatNum(e.qty)}</td>
                    <td>{e.uom || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeFilter === "total-outward" && (
        <div className="card">
          <SectionHeader
            title="All Outward Entries"
            count={outward.length}
            activeFilter={activeFilter}
            onClear={() => setActiveFilter(null)}
          />
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Material</th>
                  <th>Code</th>
                  <th className="num">Qty</th>
                  <th>UOM</th>
                </tr>
              </thead>
              <tbody>
                {outward.map((e) => (
                  <tr key={e._id}>
                    <td className="nowrap">{toDDMMYYYY(e.date)}</td>
                    <td style={{ fontWeight: 600 }}>{e.name}</td>
                    <td className="mono">{e.code || "—"}</td>
                    <td className="num">{formatNum(e.qty)}</td>
                    <td>{e.uom || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PR table */}
      {activeFilter !== "low-stock" &&
        activeFilter !== "po-matching" &&
        activeFilter !== "live-stock" &&
        activeFilter !== "total-inward" &&
        activeFilter !== "total-outward" && (
          <div className="card">
            <SectionHeader
              title={
                activeFilter
                  ? `${STATUS_LABEL[activeFilter] || activeFilter} — PRs`
                  : "Purchase Requests"
              }
              count={filteredPRs.length}
              activeFilter={activeFilter}
              onClear={() => setActiveFilter(null)}
            />
            <PRTable
              prs={filteredPRs}
              expanded={expanded}
              setExpanded={setExpanded}
              stockMap={stockMap}
              showActions={false}
              navigate={navigate}
            />
          </div>
        )}
    </>
  );
}

// ── Shared PR Table ────────────────────────────────────────────────────────────
function PRTable({
  prs,
  expanded,
  setExpanded,
  stockMap,
  showActions,
  navigate,
  canApprove,
  canCreatePO,
}) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>PR No</th>
            <th>Date</th>
            <th>Project</th>
            <th>Request From</th>
            <th>Requested by</th>
            <th>Items</th>
            <th>Status</th>
            {showActions && <th></th>}
          </tr>
        </thead>
        <tbody>
          {prs.map((pr) => (
            <React.Fragment key={pr._id}>
              <tr
                style={{ cursor: "pointer" }}
                onClick={() =>
                  setExpanded((x) => (x === pr._id ? null : pr._id))
                }
              >
                <td className="mono" style={{ fontWeight: 600 }}>
                  {pr.prNumber}
                </td>
                <td className="nowrap">{toDDMMYYYY(pr.date)}</td>
                <td>{pr.projectName || "—"}</td>
                <td>{pr.requestFrom || "—"}</td>
                <td>{pr.requestedByName}</td>
                <td>{pr.items.length}</td>
                <td>
                  <span className={`tag ${pr.status}`}>
                    {STATUS_LABEL[pr.status] || pr.status}
                  </span>
                </td>
                {showActions && (
                  <td onClick={(e) => e.stopPropagation()}>
                    {canCreatePO &&
                      ["approved", "partial"].includes(pr.status) && (
                        <button
                          className="btn btn-sm btn-in"
                          onClick={() => navigate("/purchase-orders")}
                        >
                          Pending Create PO
                        </button>
                      )}
                    {canApprove && pr.status === "pending" && (
                      <button
                        className="btn btn-sm btn-in"
                        onClick={() => navigate("/purchase-requests")}
                      >
                        Approve
                      </button>
                    )}
                  </td>
                )}
              </tr>
              {expanded === pr._id && (
                <tr>
                  <td
                    colSpan={showActions ? 8 : 7}
                    style={{ background: "var(--paper-dim)" }}
                  >
                    <div style={{ padding: "14px 6px" }}>
                      <div className="tablewrap" style={{ marginBottom: 10 }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Material</th>
                              <th>Code</th>
                              <th>Category</th>
                              <th>UOM</th>
                              <th className="num">Qty</th>
                              <th className="num">Current Stock</th>
                              <th>Remarks</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pr.items.map((it, i) => {
                              const stock = stockMap[it.name] ?? null;
                              const isLow = stock !== null && stock < it.qty;
                              return (
                                <tr key={i}>
                                  <td>{it.name}</td>
                                  <td className="mono">{it.code || "—"}</td>
                                  <td>{it.category || "—"}</td>
                                  <td>{it.uom || "—"}</td>
                                  <td className="num">{formatNum(it.qty)}</td>
                                  <td className="num">
                                    {stock !== null ? (
                                      <strong
                                        style={{
                                          color:
                                            stock <= 0
                                              ? "var(--red)"
                                              : isLow
                                                ? "var(--amber)"
                                                : "var(--teal-dark)",
                                        }}
                                      >
                                        {formatNum(stock)}
                                      </strong>
                                    ) : (
                                      <span style={{ color: "var(--text-3)" }}>
                                        —
                                      </span>
                                    )}
                                  </td>
                                  <td>{it.remarks || "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {pr.status === "rejected" && pr.rejectReason && (
                        <p style={{ fontSize: 12.5, color: "var(--red)" }}>
                          <strong>Rejection reason:</strong> {pr.rejectReason}
                        </p>
                      )}
                      {Array.isArray(pr.history) && pr.history.length > 0 && (
                        <div
                          style={{
                            fontSize: 11.5,
                            color: "#8a8270",
                            lineHeight: 1.7,
                            marginTop: 8,
                          }}
                        >
                          {pr.history.map((h, i) => (
                            <div key={i}>
                              • {STATUS_LABEL[h.status] || h.status} by{" "}
                              {h.byName} —{" "}
                              {new Date(h.at).toLocaleString("en-IN")}
                              {h.note ? ` — ${h.note}` : ""}
                            </div>
                          ))}
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
      {!prs.length && <div className="empty">No purchase requests found.</div>}
    </div>
  );
}

// ── Shared PO Table ────────────────────────────────────────────────────────────
function POTable({ pos }) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>PO No</th>
            <th>PO Date</th>
            <th>Expected Date</th>
            <th>PR No</th>
            <th>Vendor</th>
            <th>Items</th>
            <th className="num">Total Value</th>
            <th>Created by</th>
          </tr>
        </thead>
        <tbody>
          {pos.map((po) => {
            const totalValue = (po.items || []).reduce(
              (s, i) => s + i.orderedQty * (i.price || 0),
              0,
            );
            return (
              <tr key={po._id}>
                <td className="mono" style={{ fontWeight: 600 }}>
                  {po.poNumber}
                </td>
                <td className="nowrap">{toDDMMYYYY(po.poDate)}</td>
                <td className="nowrap">
                  {po.poExpectedDate ? toDDMMYYYY(po.poExpectedDate) : "—"}
                </td>
                <td className="mono">{po.prNumber}</td>
                <td>{po.vendorName}</td>
                <td>{po.items?.length || 0}</td>
                <td className="num">
                  {totalValue > 0
                    ? totalValue.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })
                    : "—"}
                </td>
                <td>{po.createdByName}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!pos.length && <div className="empty">No purchase orders yet.</div>}
    </div>
  );
}

// ── Main Dashboard wrapper ─────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const dashboardType =
    location.pathname === "/dashboard/admin"
      ? "admin"
      : location.pathname === "/dashboard/purchase"
        ? "purchase"
        : "store";

  const [requests, setRequests] = useState([]);
  const [pos, setPos] = useState([]);
  const [master, setMaster] = useState([]);
  const [inward, setInward] = useState([]);
  const [outward, setOutward] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [r, p, m, i, o] = await Promise.all([
        getPurchaseRequests(),
        getPurchaseOrders(),
        getMaster(),
        getInward(),
        getOutward(),
      ]);
      setRequests(unwrapList(r));
      setPos(unwrapList(p));
      setMaster(unwrapList(m));
      setInward(unwrapList(i));
      setOutward(unwrapList(o));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Shared computed values — memoized so role dashboards don't re-scan
  // ~15k transaction rows on every render.
  const { counts, posByPrId, stockMap, lowStockItems } = useMemo(() => {
    const counts = requests.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    const posByPrId = pos.reduce((acc, po) => {
      const key = String(po.prId);
      if (!acc[key]) acc[key] = [];
      acc[key].push(po);
      return acc;
    }, {});

    const { inMap, outMap } = buildQtyMaps(inward, outward);
    const stockMap = {};
    const lowStockItems = [];
    for (const m of master) {
      const k = (m.name || "").trim().toLowerCase();
      const stock = (inMap.get(k) || 0) - (outMap.get(k) || 0);
      stockMap[m.name] = stock;
      const minStock = parseFloat(m.minStock) || 0;
      if (minStock > 0 && stock < minStock) {
        lowStockItems.push({ ...m, stock, minStock });
      }
    }

    return { counts, posByPrId, stockMap, lowStockItems };
  }, [requests, pos, master, inward, outward]);

  const sharedProps = {
    requests,
    pos,
    master,
    inward,
    outward,
    stockMap,
    lowStockItems,
    counts,
    posByPrId,
    navigate,
  };

  const roleLabel = { admin: "Admin", purchase: "Purchase", store: "Store" }[
    dashboardType
  ];

  return (
    <>
      <style>{`
  .stat .label {
    font-size: 10px !important;
    line-height: 1.3 !important;
    word-break: break-word !important;
    white-space: normal !important;
  }
  .stat {
    min-width: 0 !important;
    padding: 14px 12px !important;
  }
  @media (max-width: 600px) {
    .statrow {
      grid-template-columns: repeat(2, 1fr) !important;
    }
  }
  @media (max-width: 400px) {
    .statrow {
      grid-template-columns: 1fr 1fr !important;
      gap: 8px !important;
    }
  }
`}</style>

      <div className="pagehead">
        <div className="pagehead-text">
          <h2>{roleLabel} Dashboard</h2>
          <p>
            {dashboardType === "admin" &&
              "Full overview of purchase requests, orders, stock and alerts."}
            {dashboardType === "purchase" &&
              "Purchase team view of orders, pricing, vendor and stock value."}
            {dashboardType === "store" &&
              "Store team view of inward, outward, PR and live stock."}
          </p>
        </div>
      </div>

      {err && (
        <p className="msg err" style={{ marginBottom: 16 }}>
          Error loading data: {err}
        </p>
      )}
      {loading && (
        <p style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</p>
      )}

      {!loading && (
        <>
          {dashboardType === "admin" && <AdminDashboard {...sharedProps} />}

          {dashboardType === "purchase" && (
            <PurchaseDashboard {...sharedProps} />
          )}

          {dashboardType === "store" && <StoreDashboard {...sharedProps} />}
        </>
      )}
    </>
  );
}