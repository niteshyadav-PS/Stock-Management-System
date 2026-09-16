import axios from "axios";

// ── Base URL logic ────────────────────────────────────────────────────────────
const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, "")}/api`
  : "/api";

const client = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// ── Request interceptor — always attach JWT if present ────────────────────────
client.interceptors.request.use(
  (cfg) => {
    const token = localStorage.getItem("sy_token");
    if (token) {
      cfg.headers = cfg.headers || {};
      cfg.headers["Authorization"] = `Bearer ${token}`;
    }
    return cfg;
  },
  (err) => Promise.reject(err),
);

// ── Response interceptor — unwrap data, handle 401 globally ──────────────────
client.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const status = err.response?.status;
    const message = err.response?.data?.error || err.message;

    // Token expired or invalid → clear storage and reload to login
    if (status === 401) {
      localStorage.removeItem("sy_token");
      localStorage.removeItem("sy_user");
      // Only redirect if not already on login page
      if (!window.location.pathname.includes("/login")) {
        window.location.href = "/login";
      }
    }

    return Promise.reject(new Error(message));
  },
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login = (username, password) =>
  client.post("/auth/login", { username, password });

// ── Helpers — list APIs may return a bare array (legacy) or
// { items, total, page, limit } when ?page=&limit= is passed.
export function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export function listMeta(data, fallbackLen = 0) {
  if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.items)) {
    return {
      items: data.items,
      total: Number(data.total) || data.items.length,
      page: Number(data.page) || 1,
      limit: Number(data.limit) || data.items.length || 25,
    };
  }
  const items = Array.isArray(data) ? data : [];
  return {
    items,
    total: fallbackLen || items.length,
    page: 1,
    limit: items.length || 25,
  };
}

function withQuery(path, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

// ── Master list ───────────────────────────────────────────────────────────────
export const getMaster = (params) => client.get(withQuery("/master", params || {}));
export const addMaterial = (data) => client.post("/master", data);
export const updateMaterial = (id, data) => client.put(`/master/${id}`, data);
export const bulkMaster = (materials) =>
  client.post("/master/bulk", { materials });
export const deleteMaterial = (id) => client.delete(`/master/${id}`);

// ── Inward ────────────────────────────────────────────────────────────────────
export const getInward = (params) => client.get(withQuery("/inward", params || {}));
export const addInward = (data) => client.post("/inward", data);
export const bulkInward = (entries) => client.post("/inward/bulk", { entries });
export const updatePrice = (id, price) =>
  client.patch(`/inward/${id}`, { price });
export const updateInward = (id, data) => client.put(`/inward/${id}`, data);
export const deleteInward = (id) => client.delete(`/inward/${id}`);

// ── Outward ───────────────────────────────────────────────────────────────────
export const getOutward = (params) => client.get(withQuery("/outward", params || {}));
export const addOutward = (data) => client.post("/outward", data);
export const bulkOutward = (entries) =>
  client.post("/outward/bulk", { entries });
export const updateOutward = (id, data) => client.put(`/outward/${id}`, data);
export const deleteOutward = (id) => client.delete(`/outward/${id}`);

// ── Users ─────────────────────────────────────────────────────────────────────
export const getUsers = (params) => client.get(withQuery("/users", params || {}));
export const saveUser = (data) => client.post("/users", data);
export const deleteUser = (username) => client.delete(`/users/${username}`);
export const recordUserPassword = (username, plainPassword) =>
  client.patch(`/users/${username}/password`, { plainPassword });

// ── Purchase requests ────────────────────────────────────────────────────────
export const getPurchaseRequests = (params) =>
  client.get(withQuery("/purchase-requests", params || {}));
export const createPurchaseRequest = (data) =>
  client.post("/purchase-requests", data);
export const updatePurchaseRequest = (id, data) =>
  client.put(`/purchase-requests/${id}`, data);
export const deletePurchaseRequest = (id) =>
  client.delete(`/purchase-requests/${id}`);
export const setPurchaseRequestStatus = (id, data) =>
  client.patch(`/purchase-requests/${id}/status`, data);
export const savePrItemPrices = (id, items) =>
  client.patch(`/purchase-requests/${id}/item-prices`, { items });

// ── Purchase orders ──────────────────────────────────────────────────────────
export const getPONextNumber = () => client.get("/purchase-orders/next-number");

export const getPurchaseOrders = (params) =>
  client.get(withQuery("/purchase-orders", params || {}));

export const getPurchaseOrdersByPR = (prId) =>
  client.get(withQuery("/purchase-orders", { prId }));

export const getPurchaseOrderByNumber = (poNumber) =>
  client.get(`/purchase-orders/by-number/${encodeURIComponent(poNumber)}`);

export const getPendingInwardPOs = () => client.get("/purchase-orders/pending-inward");

export const getPoMatching = () => client.get("/purchase-orders/po-matching");

export const createPurchaseOrder = (data) => client.post("/purchase-orders", data);

export const resyncPrPoStatus = (prId) =>
  client.post(`/purchase-orders/resync-status/${prId}`);

export const healPendingCreatePOs = () =>
  client.post("/purchase-orders/heal-pending");

export const updatePurchaseOrder = (id, data) => client.patch(`/purchase-orders/${id}`, data);

export const deletePurchaseOrder = (id) => client.delete(`/purchase-orders/${id}`);

export const getPurchaseOrderActivity = (id) => client.get(`/purchase-orders/${id}/activity`);

// ── Job orders ───────────────────────────────────────────────────────────────
export const getJobOrders = (params) =>
  client.get(withQuery("/job-orders", params || {}));