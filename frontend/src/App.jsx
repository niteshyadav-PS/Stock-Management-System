import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import MasterList from "./pages/MasterList";
import InwardEntry from "./pages/InwardEntry";
import OutwardEntry from "./pages/OutwardEntry";
import PriceEntry from "./pages/PriceEntry";
import StockOverview from "./pages/StockOverview";
import Users from "./pages/Users";
import Reports from "./pages/Reports";
import PurchaseRequest from "./pages/PurchaseRequest";
import Dashboard from "./pages/Dashboard";
import PoMatching from "./pages/PoMatching";
import PurchaseOrders from "./pages/PurchaseOrders";
import JobOrder from './pages/JobOrder';
import VendorQc from './pages/VendorQc';
import VendorDashboard from './pages/VendorDashboard';
import JobOrderDashboard from './pages/JobOrderDashboard';

const ROLE_ACCESS = {
  dashboard: ["admin", "store", "store_manager", "purchase", "vendor"],
  master: ["admin", "purchase", "viewer"],
  inward: ["admin", "store", "store_manager"],
  outward: ["admin", "store", "store_manager"],
  price: ["admin", "purchase"],
  stock: ["admin", "purchase", "store", "store_manager", "viewer", "accounts"],
  users: ["admin"],
  reports: ["admin", "purchase", "store", "store_manager", "viewer", "accounts"],
  purchaseRequests: ["admin", "store", "store_manager", "viewer"],
  purchaseOrders: ["admin", "purchase"],
  poMatching: ["admin", "purchase", "store", "store_manager"],
  jobOrders: ['admin', 'store_manager', 'store', 'viewer', 'purchase', 'vendor', 'quality'],
  jobOrderDashboard: ['admin', 'store_manager', 'store', 'viewer', 'purchase', 'quality'],
};

function getDefaultPath(role) {
  switch (role) {
    case "admin":
      return "/dashboard/admin";

    case "purchase":
      return "/dashboard/purchase";

    case "store":
    case "store_manager":
      return "/dashboard/store";

    case "accounts":
    case "viewer":
      return "/stock";

    case "vendor":
      return "/dashboard/vendor";

    case "quality":
      return "/job-orders";

    default:
      return "/stock";
  }
}

function ProtectedRoute({ page, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const allowed = ROLE_ACCESS[page] || [];
  if (!allowed.includes(user.role)) {
    return <Navigate to={getDefaultPath(user.role)} replace />;
  }
  return children;
}

function JobOrderGate({ jobType = "powder_coating" }) {
  const { user } = useAuth();
  // Vendor: always scoped to their assigned type (ignore route).
  if (user?.role === "vendor") return <VendorQc />;
  // QC: separate Powder Coating / Fabrication pages in the sidebar (same as store).
  if (user?.role === "quality") {
    return <VendorQc key={jobType} jobType={jobType} />;
  }
  return <JobOrder jobType={jobType} />;
}

function AppRoutes() {
  const { user } = useAuth();
  const defaultPath = user ? getDefaultPath(user.role) : "/login";
  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to={defaultPath} replace /> : <Login />}
      />
      <Route element={<Layout />}>
        <Route
          path="/dashboard/admin"
          element={
            <ProtectedRoute page="dashboard">
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/dashboard/store"
          element={
            <ProtectedRoute page="dashboard">
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/dashboard/purchase"
          element={
            <ProtectedRoute page="dashboard">
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/vendor"
          element={
            <ProtectedRoute page="dashboard">
              <VendorDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master"
          element={
            <ProtectedRoute page="master">
              <MasterList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/inward"
          element={
            <ProtectedRoute page="inward">
              <InwardEntry />
            </ProtectedRoute>
          }
        />
        <Route
          path="/outward"
          element={
            <ProtectedRoute page="outward">
              <OutwardEntry />
            </ProtectedRoute>
          }
        />
        <Route
          path="/price"
          element={
            <ProtectedRoute page="price">
              <PriceEntry />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock"
          element={
            <ProtectedRoute page="stock">
              <StockOverview />
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute page="users">
              <Users />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute page="reports">
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-requests"
          element={
            <ProtectedRoute page="purchaseRequests">
              <PurchaseRequest />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-orders"
          element={
            <ProtectedRoute page="purchaseOrders">
              <PurchaseOrders />
            </ProtectedRoute>
          }
        />
        <Route
          path="/po-matching"
          element={
            <ProtectedRoute page="poMatching">
              <PoMatching />
            </ProtectedRoute>
          }
        />
        <Route
          path="/job-orders/dashboard"
          element={
            <ProtectedRoute page="jobOrderDashboard">
              <JobOrderDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/job-orders"
          element={
            <ProtectedRoute page="jobOrders">
              <JobOrderGate jobType="powder_coating" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/job-orders/fabrication"
          element={
            <ProtectedRoute page="jobOrders">
              <JobOrderGate jobType="fabrication" />
            </ProtectedRoute>
          }
        />
      </Route>
      
      <Route path="*" element={<Navigate to={defaultPath} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}