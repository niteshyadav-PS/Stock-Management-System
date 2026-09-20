import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { getMaster, getInward, getOutward, unwrapList } from "../api/api";
import { useAuth } from "../context/AuthContext";
import { formatNum, formatINR, formatInt } from "../utils/helpers";
import * as XLSX from "xlsx";
import Pagination from "../components/Pagination";
import useClientPagination from "../hooks/useClientPagination";
import ColFilter from "../components/ColFilter";
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
  CartesianGrid,
} from "recharts";

// Route of the Purchase Request page. Adjust this to match whatever path
// your router uses for that page (e.g. the route in App.jsx / routes.js).
const PR_PAGE_ROUTE = "/purchase-requests";

// ── Chart colors ──────────────────────────────────────────────────────────────
const CHART_COLORS = [
  "#1f5c52",
  "#b5481f",
  "#c8861b",
  "#2a9d8f",
  "#264653",
  "#e9c46a",
  "#f4a261",
];

const shortName = (name) => (name.length > 16 ? name.slice(0, 16) + "…" : name);

// ── Custom tooltip ─────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        boxShadow: "0 4px 12px rgba(0,0,0,.1)",
        maxWidth: 220,
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
        {label}
      </div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>
          {p.name}:{" "}
          <strong>
            {typeof p.value === "number"
              ? p.value.toLocaleString("en-IN")
              : p.value}
          </strong>
        </div>
      ))}
    </div>
  );
}

// ── Responsive helper: track viewport width so we can adapt chart density ─────
function useViewportWidth() {
  const [width, setWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );
  useEffect(() => {
    function onResize() {
      setWidth(window.innerWidth);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

// ── A chart wrapper that scrolls horizontally instead of squashing/overflowing ─
function ChartScroller({ minWidth, height, children }) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        overflowX: "auto",
        overflowY: "hidden",
        boxSizing: "border-box",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div style={{ minWidth, width: "100%", height }}>{children}</div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function StockOverview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canSeePrice = user?.role === "admin" || user?.role === "purchase";

  const [master, setMaster] = useState([]);
  const [inward, setInward] = useState([]);
  const [outward, setOutward] = useState([]);
  const [search, setSearch] = useState("");
  const [activeCard, setActiveCard] = useState(null);
  const [activeChart, setActiveChart] = useState("top-balance"); // which chart to show

  const [cf, setCf] = useState({
    name: [],
    type: [],
    category: [],
    code: [],
    inQty: [],
    outQty: [],
    stock: [],
    minStock: [],
    uom: [],
    avgPrice: [],
    totalVal: [],
  });

  // ── Purchase Request selection state ──────────────────────────────────────
  // Selecting rows here doesn't create anything on this page anymore — it
  // just builds the list of items handed off to the Purchase Request page.
  const [prSelected, setPrSelected] = useState({}); // { [materialId]: true }

  const viewportWidth = useViewportWidth();
  const isMobile = viewportWidth < 640;
  const isNarrow = viewportWidth < 480;

  const load = useCallback(async () => {
    const [m, i, o] = await Promise.all([
      getMaster(),
      getInward(),
      getOutward(),
    ]);
    setMaster(unwrapList(m));
    setInward(unwrapList(i));
    setOutward(unwrapList(o));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const inTotals = {},
    outTotals = {},
    inValTotals = {};
  inward.forEach((e) => {
    inTotals[e.name] = (inTotals[e.name] || 0) + (parseFloat(e.qty) || 0);
    inValTotals[e.name] =
      (inValTotals[e.name] || 0) +
      (parseFloat(e.qty) || 0) * (parseFloat(e.price) || 0);
  });
  outward.forEach((e) => {
    outTotals[e.name] = (outTotals[e.name] || 0) + (parseFloat(e.qty) || 0);
  });

  const allRows = master.map((m) => {
    const inQty = inTotals[m.name] || 0;
    const outQty = outTotals[m.name] || 0;
    const stock = inQty - outQty;
    const avgPrice = inQty > 0 ? (inValTotals[m.name] || 0) / inQty : 0;
    const totalVal = avgPrice * Math.max(stock, 0);
    const minStock = parseFloat(m.minStock) || 0;
    return { ...m, inQty, outQty, stock, minStock, avgPrice, totalVal };
  });

  const totalIn = Object.values(inTotals).reduce((a, b) => a + b, 0);
  const totalOut = Object.values(outTotals).reduce((a, b) => a + b, 0);
  const totalVal = allRows.reduce((s, r) => s + r.totalVal, 0);
  const lowStockItems = allRows.filter(
    (r) => r.minStock > 0 && r.stock < r.minStock,
  );
  const zeroStockItems = allRows.filter((r) => r.stock <= 0);
  const lowCount = lowStockItems.length;
  const zeroCount = zeroStockItems.length;

  // A row qualifies for a Purchase Request when it's out of stock, or below
  // its configured minimum stock.
  function isPRCandidate(r) {
    return r.stock <= 0 || (r.minStock > 0 && r.stock < r.minStock);
  }

  // Suggested order qty: fill the gap to minStock when one is set, otherwise
  // default to 1 for zero-stock items with no minStock configured.
  function defaultPRQty(r) {
    if (r.minStock > 0 && r.stock < r.minStock) {
      return Math.max(1, Math.ceil(r.minStock - r.stock));
    }
    return r.stock <= 0 ? 1 : 0;
  }

  function togglePRSelect(id) {
    setPrSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }

  function selectAllFlagged(list) {
    setPrSelected((prev) => {
      const next = { ...prev };
      list.forEach((r) => {
        if (isPRCandidate(r)) next[r._id] = true;
      });
      return next;
    });
  }

  // Builds the item payload for the given ids and redirects to the Purchase
  // Request page with them attached as router state — works the same whether
  // it's a single item (row's own "Create PR" button) or several at once
  // (the floating bulk-selection bar).
  function goToPRPage(ids) {
    const items = ids
      .map((id) => allRows.find((x) => x._id === id))
      .filter(Boolean)
      .map((r) => ({
        materialId: r._id,
        name: r.name || "",
        code: r.code || "",
        category: r.category || "",
        uom: r.uom || "",
        currentStock: r.stock ?? 0,
        minStock: r.minStock ?? 0,
        qty: defaultPRQty(r),
      }));
    if (!items.length) return;
    navigate(PR_PAGE_ROUTE, { state: { prefillItems: items } });
  }

  const selectedIds = Object.keys(prSelected).filter((id) => prSelected[id]);
  const selectedCount = selectedIds.length;

  function toggleCard(key) {
    setActiveCard((prev) => (prev === key ? null : key));
  }

  const searched = allRows.filter(
    (r) =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.code || "").toLowerCase().includes(search.toLowerCase()),
  );

  const rows = searched
    .filter((r) => {
      if (activeCard === "low") return r.minStock > 0 && r.stock < r.minStock;
      if (activeCard === "zero") return r.stock <= 0;
      return true;
    })
    .filter(
      (r) =>
        (!cf.name.length || cf.name.includes(r.name)) &&
        (!cf.type.length || cf.type.includes(r.type)) &&
        (!cf.category.length || cf.category.includes(r.category)) &&
        (!cf.code.length || cf.code.includes(r.code)) &&
        (!cf.inQty.length || cf.inQty.includes(String(formatNum(r.inQty)))) &&
        (!cf.outQty.length ||
          cf.outQty.includes(String(formatNum(r.outQty)))) &&
        (!cf.stock.length || cf.stock.includes(String(formatNum(r.stock)))) &&
        (!cf.minStock.length ||
          cf.minStock.includes(String(formatNum(r.minStock)))) &&
        (!cf.uom.length || cf.uom.includes(r.uom)) &&
        (!cf.avgPrice.length ||
          cf.avgPrice.includes(String(formatINR(r.avgPrice)))) &&
        (!cf.totalVal.length ||
          cf.totalVal.includes(String(formatINR(r.totalVal)))),
    );

  const { pageItems, page, pageSize, total, setPage, setPageSize } =
    useClientPagination(rows, 25);

  // ── Excel export ──────────────────────────────────────────────────────────
  // Exports exactly what's currently visible in the table — respects the
  // search box, the active stat-card filter (low/zero stock), and every
  // column filter (cf.*), since it reads straight from `rows`.
  function exportToExcel() {
    if (!rows.length) return;

    const exportRows = rows.map((r) => {
      const base = {
        "Material Name": r.name || "",
        Type: r.type || "",
        Category: r.category || "",
        Code: r.code || "",
        Inward: Number(r.inQty.toFixed(2)),
        Outward: Number(r.outQty.toFixed(2)),
        Balance: Number(r.stock.toFixed(2)),
        "Min Stock": Number(r.minStock.toFixed(2)),
        UOM: r.uom || "",
      };
      if (canSeePrice) {
        base["Avg Price (₹)"] = Number(r.avgPrice.toFixed(2));
        base["Stock Value (₹)"] = Number(r.totalVal.toFixed(2));
      }
      return base;
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);

    // Auto-size columns so names/numbers aren't clipped when opened in Excel.
    const headers = Object.keys(exportRows[0]);
    ws["!cols"] = headers.map((h) => ({
      wch:
        Math.max(
          h.length,
          ...exportRows.map((r) => String(r[h] ?? "").length),
        ) + 2,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock Balance");

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `stock-balance-${dateStr}.xlsx`);
  }

  // ── Chart data ────────────────────────────────────────────────────────────
  // Top 10 by balance
  const topBalance = [...allRows]
    .sort((a, b) => b.stock - a.stock)
    .slice(0, 10)
    .map((r) => ({
      name: shortName(r.name),
      stock: Math.round(r.stock),
      inQty: Math.round(r.inQty),
      outQty: Math.round(r.outQty),
    }));

  // Top 10 by inward qty
  const topInward = [...allRows]
    .sort((a, b) => b.inQty - a.inQty)
    .slice(0, 10)
    .map((r) => ({ name: shortName(r.name), inQty: Math.round(r.inQty) }));

  // Top 10 by outward qty
  const topOutward = [...allRows]
    .sort((a, b) => b.outQty - a.outQty)
    .slice(0, 10)
    .map((r) => ({ name: shortName(r.name), outQty: Math.round(r.outQty) }));

  // Top 10 by value
  const topValue = [...allRows]
    .sort((a, b) => b.totalVal - a.totalVal)
    .slice(0, 10)
    .map((r) => ({ name: shortName(r.name), value: Math.round(r.totalVal) }));

  // Category distribution by stock qty
  const catMap = {};
  allRows.forEach((r) => {
    if (!r.category) return;
    catMap[r.category] = (catMap[r.category] || 0) + Math.max(r.stock, 0);
  });
  const categoryData = Object.entries(catMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => ({ name, value: Math.round(value) }));

  // Low stock items bar
  const lowStockChart = lowStockItems.slice(0, 10).map((r) => ({
    name: shortName(r.name),
    stock: Math.round(r.stock),
    minStock: Math.round(r.minStock),
  }));

  const chartTabs = [
    { key: "top-balance", label: "Top Balance" },
    { key: "top-inward", label: "Top Inward" },
    { key: "top-outward", label: "Top Outward" },
    { key: "category", label: "By Category" },
    ...(canSeePrice ? [{ key: "top-value", label: "By Value" }] : []),
    ...(lowCount > 0 ? [{ key: "low-stock", label: "Low Stock" }] : []),
  ];

  function statCardStyle(key, color) {
    const isActive = activeCard === key;
    return {
      cursor: "pointer",
      outline: isActive ? `2px solid ${color || "var(--teal)"}` : "none",
      outlineOffset: 2,
      userSelect: "none",
      minWidth: 0,
      boxSizing: "border-box",
      overflow: "hidden",
    };
  }

  const activeLabel = { low: "⚠ Low stock only", zero: "⊘ Zero stock only" }[
    activeCard
  ];

  // Per-bar width (bar + gap) so dense charts scroll horizontally on small
  // screens instead of squeezing labels/bars until they overflow their card.
  const barWidth = isMobile ? 74 : 92;
  const chartMinWidth = (n) => Math.max(340, n * barWidth);
  const chartHeight = isMobile ? 220 : 260;
  const xAxisFont = isMobile ? 9 : 10;
  const bottomMargin = isMobile ? 60 : 70;
  const barSize = isMobile ? 30 : 40;
  const groupedBarSize = isMobile ? 16 : 22;
  const barCategoryGap = "28%";

  // Shrinks a number's font size as it gets longer so it never has to wrap
  // mid-digit — a long total stays on one line and just gets smaller.
  function fitNumberFontSize(text, maxPx) {
    const len = String(text).length;
    const size = len <= 5 ? maxPx : maxPx - (len - 5) * (maxPx / 13);
    return Math.max(isMobile ? 12 : 13, Math.round(size));
  }

  // Abbreviates large axis numbers (1,20,000 -> 1.2L) so they never get
  // clipped by a fixed-width axis column, on any screen size.
  function shortQty(v) {
    const abs = Math.abs(v);
    if (abs >= 100000)
      return `${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L`;
    if (abs >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
    return v.toLocaleString("en-IN");
  }

  const flaggedInView = rows.filter(isPRCandidate);
  const allFlaggedInViewSelected =
    flaggedInView.length > 0 && flaggedInView.every((r) => prSelected[r._id]);

  return (
    <div
      className="stock-overview"
      style={{
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        overflowX: "hidden",
      }}
    >
      <style>{`
        .stock-overview * { box-sizing: border-box; }
        .stock-overview .statrow {
          display: grid;
          gap: 12px;
        }
        .stock-overview .stat .value {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: block;
        }
        .stock-overview .category-split {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 16px;
          align-items: center;
        }
        .stock-overview .chart-tabs {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        @media (max-width: 700px) {
          .stock-overview .category-split {
            grid-template-columns: minmax(0, 1fr);
          }
        }
        @media (max-width: 560px) {
          .stock-overview .statrow {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .stock-overview h2 { font-size: 20px; }
          .stock-overview .card { padding: 12px !important; }
        }
        @media (max-width: 380px) {
          .stock-overview .statrow {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="pagehead">
        <div className="pagehead-text">
          <h2>Live Stock</h2>
          <p>
            Monitor current stock availability with real-time balances
            calculated from inward and outward transactions.
          </p>{" "}
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div
        className="statrow"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          marginBottom: 20,
        }}
      >
        <div
          className="stat"
          style={{
            cursor: "default",
            minWidth: 0,
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          <div className="label">Materials tracked</div>
          <div className="value">{master.length}</div>
        </div>
        <div
          className="stat teal"
          style={statCardStyle("inward", "var(--teal)")}
          onClick={() => toggleCard("inward")}
          title="Click to filter"
        >
          <div className="label">Total inward qty</div>
          <div
            className="value"
            style={{
              fontSize: fitNumberFontSize(
                formatNum(totalIn),
                isMobile ? 20 : 26,
              ),
            }}
          >
            {formatNum(totalIn)}
          </div>
          {activeCard === "inward" && (
            <div
              style={{ fontSize: 10, color: "var(--teal-dark)", marginTop: 4 }}
            >
              ● Active
            </div>
          )}
        </div>
        <div
          className="stat rust"
          style={statCardStyle("outward", "var(--rust)")}
          onClick={() => toggleCard("outward")}
          title="Click to filter"
        >
          <div className="label">Total outward qty</div>
          <div
            className="value"
            style={{
              fontSize: fitNumberFontSize(
                formatInt(totalOut),
                isMobile ? 20 : 26,
              ),
            }}
          >
            {formatInt(totalOut)}
          </div>
          {activeCard === "outward" && (
            <div
              style={{ fontSize: 10, color: "var(--rust-dark)", marginTop: 4 }}
            >
              ● Active
            </div>
          )}
        </div>
        <div
          className="stat"
          style={statCardStyle("low", "var(--red)")}
          onClick={() => toggleCard("low")}
          title="Click to show low stock"
        >
          <div className="label">Low stock</div>
          <div
            className="value"
            style={{ color: lowCount > 0 ? "var(--red)" : "inherit" }}
          >
            {lowCount}
          </div>
          {activeCard === "low" && (
            <div style={{ fontSize: 10, color: "var(--red)", marginTop: 4 }}>
              ● Active
            </div>
          )}
        </div>
        <div
          className="stat"
          style={statCardStyle("zero", "var(--red)")}
          onClick={() => toggleCard("zero")}
          title="Click to show zero stock"
        >
          <div className="label">Zero stock</div>
          <div
            className="value"
            style={{ color: zeroCount > 0 ? "var(--red)" : "inherit" }}
          >
            {zeroCount}
          </div>
          {activeCard === "zero" && (
            <div style={{ fontSize: 10, color: "var(--red)", marginTop: 4 }}>
              ● Active
            </div>
          )}
        </div>
        {canSeePrice && (
          <div
            className="stat teal"
            style={{
              cursor: "default",
              minWidth: 0,
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            <div className="label">Total stock value</div>
            <div
              className="value"
              style={{
                fontSize: fitNumberFontSize(
                  "₹" + Math.round(totalVal).toLocaleString("en-IN"),
                  isMobile ? 16 : 22,
                ),
                lineHeight: 1.2,
              }}
            >
              {"₹" + Math.round(totalVal).toLocaleString("en-IN")}
            </div>
          </div>
        )}
      </div>

      {/* ── Charts section ── */}
      <div
        className="card"
        style={{ minWidth: 0, boxSizing: "border-box", overflow: "hidden" }}
      >
        {/* Chart tabs */}
        <div
          className="chart-tabs"
          style={{
            marginBottom: 16,
            borderBottom: "1px solid var(--line)",
            paddingBottom: 12,
          }}
        >
          {chartTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveChart(tab.key)}
              style={{
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                border: "none",
                borderRadius: 20,
                fontFamily: "Poppins, sans-serif",
                background:
                  activeChart === tab.key ? "var(--teal)" : "var(--paper-dim)",
                color: activeChart === tab.key ? "#fff" : "var(--ink)",
                transition: "background 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Chart content */}
        {activeChart === "top-balance" && (
          <>
            <div style={{ fontSize: 12, color: "#8a8270", marginBottom: 8 }}>
              Top 10 materials by current balance
            </div>
            <ChartScroller
              minWidth={chartMinWidth(topBalance.length)}
              height={chartHeight}
            >
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart
                  data={topBalance}
                  margin={{ top: 4, right: 10, left: 0, bottom: bottomMargin }}
                  barCategoryGap={barCategoryGap}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: xAxisFont }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={isMobile ? 42 : 48}
                    tickFormatter={shortQty}
                  />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: "rgba(31,92,82,0.08)" }}
                  />
                  <Bar
                    dataKey="stock"
                    name="Balance"
                    fill="var(--teal)"
                    radius={[4, 4, 0, 0]}
                    barSize={barSize}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartScroller>
          </>
        )}

        {activeChart === "top-inward" && (
          <>
            <div style={{ fontSize: 12, color: "#8a8270", marginBottom: 8 }}>
              Top 10 most received materials (inward qty)
            </div>
            <ChartScroller
              minWidth={chartMinWidth(topInward.length)}
              height={chartHeight}
            >
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart
                  data={topInward}
                  margin={{ top: 4, right: 10, left: 0, bottom: bottomMargin }}
                  barCategoryGap={barCategoryGap}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: xAxisFont }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={isMobile ? 42 : 48}
                    tickFormatter={shortQty}
                  />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: "rgba(42,157,143,0.08)" }}
                  />
                  <Bar
                    dataKey="inQty"
                    name="Inward Qty"
                    fill="#2a9d8f"
                    radius={[4, 4, 0, 0]}
                    barSize={barSize}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartScroller>
          </>
        )}

        {activeChart === "top-outward" && (
          <>
            <div style={{ fontSize: 12, color: "#8a8270", marginBottom: 8 }}>
              Top 10 most issued materials (outward qty)
            </div>
            <ChartScroller
              minWidth={chartMinWidth(topOutward.length)}
              height={chartHeight}
            >
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart
                  data={topOutward}
                  margin={{ top: 4, right: 10, left: 0, bottom: bottomMargin }}
                  barCategoryGap={barCategoryGap}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: xAxisFont }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={isMobile ? 42 : 48}
                    tickFormatter={shortQty}
                  />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: "rgba(181,72,31,0.08)" }}
                  />
                  <Bar
                    dataKey="outQty"
                    name="Outward Qty"
                    fill="var(--rust)"
                    radius={[4, 4, 0, 0]}
                    barSize={barSize}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartScroller>
          </>
        )}

        {activeChart === "category" && (
          <>
            <div style={{ fontSize: 12, color: "#8a8270", marginBottom: 8 }}>
              Stock balance distribution by category
            </div>
            <div className="category-split">
              <div style={{ minWidth: 0, width: "100%" }}>
                <ResponsiveContainer width="100%" height={isMobile ? 220 : 240}>
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      outerRadius={isMobile ? 75 : 90}
                      dataKey="value"
                      nameKey="name"
                    >
                      {categoryData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={CHART_COLORS[i % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    {!isMobile && <Legend />}
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ minWidth: 0 }}>
                {categoryData.map((c, i) => (
                  <div
                    key={c.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 0",
                      borderBottom: "1px solid var(--line)",
                      fontSize: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: CHART_COLORS[i % CHART_COLORS.length],
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        color: "var(--ink)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.name}
                    </span>
                    <strong style={{ flexShrink: 0 }}>
                      {c.value.toLocaleString("en-IN")}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeChart === "top-value" && canSeePrice && (
          <>
            <div style={{ fontSize: 12, color: "#8a8270", marginBottom: 8 }}>
              Top 10 materials by stock value (₹)
            </div>
            <ChartScroller
              minWidth={chartMinWidth(topValue.length)}
              height={chartHeight}
            >
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart
                  data={topValue}
                  margin={{ top: 4, right: 10, left: 10, bottom: bottomMargin }}
                  barCategoryGap={barCategoryGap}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: xAxisFont }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={isMobile ? 44 : 50}
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    content={<CustomTooltip />}
                    formatter={(v) => [
                      `₹${v.toLocaleString("en-IN")}`,
                      "Stock Value",
                    ]}
                    cursor={{ fill: "rgba(200,134,27,0.08)" }}
                  />
                  <Bar
                    dataKey="value"
                    name="Stock Value (₹)"
                    fill="var(--amber)"
                    radius={[4, 4, 0, 0]}
                    barSize={barSize}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartScroller>
          </>
        )}

        {activeChart === "low-stock" && (
          <>
            <div style={{ fontSize: 12, color: "#8a8270", marginBottom: 8 }}>
              Low stock items — current vs minimum stock
            </div>
            {lowStockChart.length === 0 ? (
              <div className="empty">
                No low stock items. All materials are above minimum levels.
              </div>
            ) : (
              <ChartScroller
                minWidth={chartMinWidth(lowStockChart.length)}
                height={chartHeight}
              >
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart
                    data={lowStockChart}
                    margin={{
                      top: 4,
                      right: 10,
                      left: 0,
                      bottom: bottomMargin,
                    }}
                    barCategoryGap={barCategoryGap}
                    barGap={4}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: xAxisFont }}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      width={isMobile ? 42 : 48}
                      tickFormatter={shortQty}
                    />
                    <Tooltip
                      content={<CustomTooltip />}
                      cursor={{ fill: "rgba(0,0,0,0.05)" }}
                    />
                    <Bar
                      dataKey="minStock"
                      name="Min Stock"
                      fill="var(--amber)"
                      radius={[4, 4, 0, 0]}
                      barSize={groupedBarSize}
                    />
                    <Bar
                      dataKey="stock"
                      name="Current Stock"
                      fill="var(--red)"
                      radius={[4, 4, 0, 0]}
                      barSize={groupedBarSize}
                    />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              </ChartScroller>
            )}
          </>
        )}
      </div>

      {/* ── Table ── */}
      <div
        className="card card-wide"
        style={{ minWidth: 0, boxSizing: "border-box", overflow: "hidden" }}
      >
        <h3
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            Current balance by material{" "}
            <span className="pill-count">{rows.length || 0}</span>
          </span>
          {activeLabel && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--red)",
                background: "var(--red-light)",
                padding: "3px 9px",
                borderRadius: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              {activeLabel}
              <button
                onClick={() => setActiveCard(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--red)",
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </span>
          )}
          {flaggedInView.length > 0 && (
            <button
              onClick={() => selectAllFlagged(rows)}
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 14,
                border: "1px solid var(--line)",
                background: "#fff",
                cursor: "pointer",
                color: "var(--ink)",
                whiteSpace: "nowrap",
              }}
            >
              Select all flagged ({flaggedInView.length})
            </button>
          )}
          <button
            onClick={exportToExcel}
            disabled={!rows.length}
            title="Export the currently filtered/searched results to Excel"
            style={{
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 14,
              border: "1px solid var(--line)",
              background: rows.length ? "var(--teal)" : "#fff",
              color: rows.length ? "#fff" : "var(--text-3)",
              cursor: rows.length ? "pointer" : "not-allowed",
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ⬇ Export Excel
          </button>
        </h3>
        <div className="searchbar">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code…"
            style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
          />
        </div>
        <div
          className="tablewrap"
          style={{
            overflowX: "auto",
            overflowY: "auto",
            maxHeight: "70vh",
            width: "100%",
            maxWidth: "100%",
            boxSizing: "border-box",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <table style={{ minWidth: isNarrow ? 980 : 0, width: "100%" }}>
            <thead
              style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                background: "var(--paper-dim)",
              }}
            >
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    title="Select all flagged items in view"
                    checked={allFlaggedInViewSelected}
                    disabled={!flaggedInView.length}
                    onChange={() => {
                      setPrSelected((prev) => {
                        const next = { ...prev };
                        flaggedInView.forEach((r) => {
                          if (allFlaggedInViewSelected) delete next[r._id];
                          else next[r._id] = true;
                        });
                        return next;
                      });
                    }}
                    style={{
                      cursor: flaggedInView.length ? "pointer" : "default",
                      accentColor: "var(--teal)",
                      width: 14,
                      height: 14,
                    }}
                  />
                </th>
                <th>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Material name{" "}
                    <ColFilter
                      values={searched.map((r) => r.name)}
                      selected={cf.name}
                      onChange={(v) => setCf((f) => ({ ...f, name: v }))}
                    />
                  </span>
                </th>
                <th>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Type{" "}
                    <ColFilter
                      values={searched.map((r) => r.type)}
                      selected={cf.type}
                      onChange={(v) => setCf((f) => ({ ...f, type: v }))}
                    />
                  </span>
                </th>
                <th>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Category{" "}
                    <ColFilter
                      values={searched.map((r) => r.category)}
                      selected={cf.category}
                      onChange={(v) => setCf((f) => ({ ...f, category: v }))}
                    />
                  </span>
                </th>
                <th>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Code{" "}
                    <ColFilter
                      values={searched.map((r) => r.code)}
                      selected={cf.code}
                      onChange={(v) => setCf((f) => ({ ...f, code: v }))}
                    />
                  </span>
                </th>
                <th className="num">
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    IN{" "}
                    <ColFilter
                      values={searched.map((r) => formatNum(r.inQty))}
                      selected={cf.inQty}
                      onChange={(v) => setCf((f) => ({ ...f, inQty: v }))}
                    />
                  </span>
                </th>
                <th className="num">
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Out{" "}
                    <ColFilter
                      values={searched.map((r) => formatNum(r.outQty))}
                      selected={cf.outQty}
                      onChange={(v) => setCf((f) => ({ ...f, outQty: v }))}
                    />
                  </span>
                </th>
                <th className="num">
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Bal.{" "}
                    <ColFilter
                      values={searched.map((r) => formatNum(r.stock))}
                      selected={cf.stock}
                      onChange={(v) => setCf((f) => ({ ...f, stock: v }))}
                    />
                  </span>
                </th>
                <th className="num">
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Min stock{" "}
                    <ColFilter
                      values={searched.map((r) => formatNum(r.minStock))}
                      selected={cf.minStock}
                      onChange={(v) => setCf((f) => ({ ...f, minStock: v }))}
                    />
                  </span>
                </th>
                <th>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    UOM{" "}
                    <ColFilter
                      values={searched.map((r) => r.uom)}
                      selected={cf.uom}
                      onChange={(v) => setCf((f) => ({ ...f, uom: v }))}
                    />
                  </span>
                </th>
                {canSeePrice && (
                  <>
                    <th className="num">
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        Avg price{" "}
                        <ColFilter
                          values={searched.map((r) => formatINR(r.avgPrice))}
                          selected={cf.avgPrice}
                          onChange={(v) =>
                            setCf((f) => ({ ...f, avgPrice: v }))
                          }
                        />
                      </span>
                    </th>
                    <th className="num">
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        Stock value{" "}
                        <ColFilter
                          values={searched.map((r) => formatINR(r.totalVal))}
                          selected={cf.totalVal}
                          onChange={(v) =>
                            setCf((f) => ({ ...f, totalVal: v }))
                          }
                        />
                      </span>
                    </th>
                  </>
                )}
                <th>PR</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => {
                const candidate = isPRCandidate(r);
                return (
                  <tr key={r._id}>
                    <td>
                      {candidate && (
                        <input
                          type="checkbox"
                          checked={!!prSelected[r._id]}
                          onChange={() => togglePRSelect(r._id)}
                          style={{
                            cursor: "pointer",
                            accentColor: "var(--teal)",
                            width: 14,
                            height: 14,
                          }}
                        />
                      )}
                    </td>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td>{r.type}</td>
                    <td>{r.category}</td>
                    <td className="mono">{r.code}</td>
                    <td className="num">{formatNum(r.inQty)}</td>
                    <td className="num">{formatNum(r.outQty)}</td>
                    <td className="num">
                      <strong
                        style={{
                          color:
                            r.stock <= 0
                              ? "var(--red)"
                              : r.stock < r.minStock
                                ? "var(--amber)"
                                : "var(--teal-dark)",
                        }}
                      >
                        {formatNum(r.stock)}
                      </strong>
                    </td>
                    <td className="num">
                      <span
                        style={{
                          color:
                            r.minStock > 0 && r.stock < r.minStock
                              ? "var(--red)"
                              : "inherit",
                        }}
                      >
                        {formatNum(r.minStock)}
                      </span>
                    </td>
                    <td>{r.uom}</td>
                    {canSeePrice && (
                      <>
                        <td className="num">{formatINR(r.avgPrice)}</td>
                        <td className="num">{formatINR(r.totalVal)}</td>
                      </>
                    )}
                    <td>
                      {candidate && (
                        <button
                          className="btn btn-sm btn-in"
                          onClick={() => goToPRPage([r._id])}
                          style={{ whiteSpace: "nowrap" }}
                        >
                          Create PR
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Reserves real scroll space so the last rows never end up
              hidden behind the fixed bulk-selection bar below. */}
          {selectedCount > 0 && <div style={{ height: 76 }} />}
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
        {!master.length && (
          <div className="empty">
            No materials yet.
            <p>Add materials to the master list to see stock balances.</p>
          </div>
        )}
        {master.length > 0 && !rows.length && (
          <div className="empty">No materials match your filters.</div>
        )}
      </div>

      {/* ── Floating bulk-selection bar ── */}
      {selectedCount > 0 &&
        createPortal(
          <div
            style={{
              position: "fixed",
              bottom: 22,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 9999,
              background: "var(--ink)",
              color: "#fff",
              padding: "10px 16px",
              borderRadius: 24,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              rowGap: 8,
              columnGap: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,.4)",
              border: "1px solid rgba(255,255,255,.08)",
              maxWidth: "calc(100vw - 24px)",
              boxSizing: "border-box",
            }}
          >
            <span
              style={{
                fontSize: 13,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {selectedCount} item{selectedCount > 1 ? "s" : ""} selected
            </span>
            <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
              <button
                onClick={() => goToPRPage(selectedIds)}
                style={{
                  background: "var(--teal)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 20,
                  padding: "6px 14px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  boxSizing: "border-box",
                }}
              >
                Create PR
              </button>
              <button
                onClick={() => setPrSelected({})}
                style={{
                  background: "none",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,.3)",
                  borderRadius: 20,
                  padding: "6px 12px",
                  fontSize: 12.5,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  boxSizing: "border-box",
                }}
              >
                Clear
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}