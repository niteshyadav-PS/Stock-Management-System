import React, { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../utils/helpers";

// ── Nav grouped by section ────────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    label: "Job Order",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
    items: [
      {
        label: "Vendor Dashboard",
        path: "/dashboard/vendor",
        roles: ["vendor"],
      },
      {
        label: "Job Order Dashboard",
        path: "/job-orders/dashboard",
        roles: ["admin", "store_manager", "store", "viewer", "purchase", "quality"],
      },
      {
        label: "Job Order Report",
        path: "/job-orders/report",
        roles: ["admin", "store_manager", "store", "viewer", "purchase", "quality"],
      },
      {
        label: "Powder Coating",
        path: "/job-orders",
        roles: ["admin", "store_manager", "store", "viewer", "purchase", "quality"],
      },
      {
        label: "Fabrication",
        path: "/job-orders/fabrication",
        roles: ["admin", "store_manager", "store", "viewer", "purchase", "quality"],
      },
      {
        label: "Vendor Master",
        path: "/vendor-master",
        roles: ["admin", "purchase"],
      },
      {
        label: "My Job Orders",
        path: "/job-orders",
        roles: ["vendor"],
      },
    ],
  },
  {
    label: "Store",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    items: [
      {
        label: "Store Dashboard",
        path: "/dashboard/store",
        roles: ["admin", "store", "store_manager"],
      },
      {
        label: "Live Stock",
        path: "/stock",
        roles: ["admin", "store", "store_manager", "viewer"],
      },
      {
        label: "Inward Entry",
        path: "/inward",
        roles: ["admin", "store", "store_manager"],
      },
      {
        label: "Outward Entry",
        path: "/outward",
        roles: ["admin", "store", "store_manager"],
      },
      {
        label: "PR Request",
        path: "/purchase-requests",
        roles: ["admin", "store", "store_manager", "viewer"],
      },
      {
        label: "PO Matching",
        path: "/po-matching",
        roles: ["admin", "store", "store_manager"],
      },
      
    ],
  },
  {
    label: "Purchase",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
    items: [
      {
        label: "Purchase Dashboard",
        path: "/dashboard/purchase",
        roles: ["admin", "purchase"],
      },
      { label: "Live Stock", path: "/stock", roles: ["admin", "purchase"] },
      {
        label: "Item Master",
        path: "/master",
        roles: ["admin", "purchase", "viewer"],
      },
      { label: "Price Entry", path: "/price", roles: ["admin", "purchase"] },
      {
        label: "Purchase Orders",
        path: "/purchase-orders",
        roles: ["admin", "purchase"],
      },
      {
        label: "PO Matching",
        path: "/po-matching",
        roles: ["admin", "purchase", "store_manager"],
      },
    ],
  },
  {
    label: "Accounts",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    ),
    items: [
      { label: "Live Stock", path: "/stock", roles: ["accounts"] },
      { label: "Reports", path: "/reports", roles: ["accounts"] },
    ],
  },
  {
    label: "Reports",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    items: [
      {
        label: "Reports",
        path: "/reports",
        roles: ["admin", "purchase", "store", "store_manager", "viewer"],
      },
    ],
  },
  {
    label: "Admin",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M20 21a8 8 0 1 0-16 0" />
      </svg>
    ),
    items: [{ label: "Users", path: "/users", roles: ["admin"] }],
  },
];

// Top-level links (above all sections) — visible to admin only
const TOP_LINKS = [
  {
    label: "Admin Dashboard",
    path: "/dashboard/admin",
    roles: ["admin"],
  },
  {
    label: "Live Stock",
    path: "/stock",
    roles: ["admin"],
  },
];
export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Which sections are expanded (by label)
  const [expanded, setExpanded] = useState(() => {
    // Auto-expand the section that contains the current path
    return NAV_SECTIONS.reduce((acc, s) => {
      acc[s.label] = s.items.some((i) => i.path === location.pathname);
      return acc;
    }, {});
  });

  // Close sidebar on navigation
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Expand section containing the current active link
  useEffect(() => {
    NAV_SECTIONS.forEach((s) => {
      if (s.items.some((i) => i.path === location.pathname)) {
        setExpanded((prev) => ({ ...prev, [s.label]: true }));
      }
    });
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleLogout = () => {
    setUserMenuOpen(false);
    logout();
    navigate("/login", { replace: true });
  };

  function handleHomeClick() {
    switch (user?.role) {
      case "admin":
        navigate("/dashboard/admin");
        break;

      case "purchase":
        navigate("/dashboard/purchase");
        break;

      case "store":
      case "store_manager":
        navigate("/dashboard/store");
        break;

      case "accounts":
        navigate("/stock");
        break;

      case "vendor":
        navigate("/dashboard/vendor");
        break;

      case "quality":
        navigate("/job-orders");
        break;

      default:
        navigate("/stock");
    }
  }

  useEffect(() => {
    const handler = (event) => {
      if (!event.target.closest(".topbar-user-menu")) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggleSection(label) {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  const role = user?.role;
  const initials = (user?.name || user?.username || "U")
    .slice(0, 2)
    .toUpperCase();

  // Current page label for topbar
  let currentPage = "Dashboard";
  const topMatch = TOP_LINKS.find(
    (l) => l.path === location.pathname && l.roles.includes(role),
  );
  if (topMatch) currentPage = topMatch.label;
  for (const s of NAV_SECTIONS) {
    const found = s.items.find((i) => i.path === location.pathname);
    if (found) {
      currentPage = found.label;
      break;
    }
  }

  return (
    <>
      {/* ── Topbar (always visible — hamburger on left) ─────────────────── */}
      <div className="topbar">
        <button
          className="nav-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-label="Open menu"
        >
          {open ? "✕" : "☰"}
        </button>
        <button className="topbar-title-btn" onClick={handleHomeClick}>
          <span className="topbar-title">{currentPage}</span>
        </button>
        <div className="topbar-user-menu">
          <button
            className="topbar-user-btn"
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-label="User menu"
          >
            <span className="topbar-user-avatar">{initials}</span>
          </button>
          {userMenuOpen && (
            <div className="topbar-user-dropdown">
              <div className="topbar-user-info">
                <div className="topbar-user-name">
                  {user?.name || user?.username}
                </div>
                <div className="topbar-user-role">
                  {ROLE_LABELS[role] || role}
                </div>
              </div>
              <button className="topbar-user-logout" onClick={handleLogout}>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Overlay ─────────────────────────────────────────────────────── */}
      <div
        className={`nav-overlay${open ? " open" : ""}`}
        onClick={() => setOpen(false)}
      />

      <div className="shell">
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <nav className={`nav${open ? " open" : ""}`}>
          {/* Brand */}
          <div className="brand">
            <div className="brand-text">
              <div
                className="brand-logo-row"
                onClick={handleHomeClick}
                style={{ cursor: "pointer" }}
                title="Go to home"
              >
                <div
                  className="brand-icon"
                  style={{ background: "none", boxShadow: "none" }}
                >
                  <img
                    src="https://www.profile-solution.com/wp-content/uploads/2023/10/favicon-removebg-preview.png"
                    alt="Logo"
                    width="30"
                    height="30"
                    style={{ objectFit: "contain" }}
                  />
                </div>
                <span className="brand-name">Purchase & Store Deparment</span>
              </div>
            </div>
            <button
              className="nav-toggle"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Nav list */}
          <ul className="navlist">
            {/* Top-level links — Dashboard + Live Stock (admin only, above all sections) */}
            {TOP_LINKS.filter((l) => l.roles.includes(role)).map((link) => (
              <li key={link.path}>
                <NavLink
                  to={link.path}
                  className={({ isActive }) =>
                    isActive ? "active" : undefined
                  }
                >
                  <span className="nav-sub-dot" />
                  {link.label}
                </NavLink>
              </li>
            ))}

            {/* Grouped sections */}
            {NAV_SECTIONS.map((section) => {
              const visibleItems = section.items.filter((i) =>
                i.roles.includes(role),
              );
              if (!visibleItems.length) return null;
              const isExpanded = !!expanded[section.label];

              return (
                <li key={section.label} className="nav-section">
                  {/* Section header — clickable to expand/collapse */}
                  <button
                    className="nav-section-header"
                    onClick={() => toggleSection(section.label)}
                    aria-expanded={isExpanded}
                  >
                    <span className="nav-item-icon">{section.icon}</span>
                    <span className="nav-section-label">{section.label}</span>
                    <span className={`nav-chevron${isExpanded ? " open" : ""}`}>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </span>
                  </button>

                  {/* Section items */}
                  <ul
                    className={`nav-section-items${isExpanded ? " open" : ""}`}
                  >
                    {visibleItems.map((item) => (
                      <li key={`${item.path}-${item.label}`}>
                        <NavLink
                          to={item.path}
                          end={item.path === "/job-orders"}
                          className={({ isActive }) =>
                            isActive ? "active" : undefined
                          }
                        >
                          <span className="nav-sub-dot" />
                          {item.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>

          {/* User bar */}
          <div className="userbar">
            <div className="userbar-inner">
              <div className="userbar-avatar">{initials}</div>
              <div>
                <span className="uname">{user?.name || user?.username}</span>
                <span className="urole">{ROLE_LABELS[role] || role}</span>
              </div>
            </div>
            <button className="logout" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </nav>

        <main className="main">
          <Outlet />
        </main>
      </div>
    </>
  );
}
