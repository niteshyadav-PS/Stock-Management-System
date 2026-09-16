import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { login as apiLogin } from "../api/api";
import { FaEye, FaEyeSlash } from "react-icons/fa";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    password: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await apiLogin(form.username, form.password);
      login(data.user, data.token);

      const role = data.user.role;
      const path =
        role === "viewer"
          ? "/stock"
          : ["admin", "inward", "outward", "manager", "purchase"].includes(role)
          ? "/dashboard"
          : "/stock";

      navigate(path, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 28,
            paddingBottom: 20,
            borderBottom: "1px solid var(--line)",
          }}
        >
          <img
            src="https://www.profile-solution.com/wp-content/uploads/PS-Logo-1-e1771321686738.png"
            alt="Profile Solutions Logo"
            height="34"
            style={{ objectFit: "contain", flexShrink: 0 }}
          />

          <div
            style={{
              borderLeft: "1px solid var(--line)",
              paddingLeft: 12,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: 13,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: "var(--ink)",
              }}
            >
              Stock Management System
            </div>

            <div
              style={{
                fontWeight: 400,
                fontSize: 11,
                color: "var(--text-3)",
                marginTop: 2,
              }}
            >
              Purchase &amp; Store Department
            </div>
          </div>
        </div>

        <h1>Welcome back</h1>
        <p className="sub">Sign in to your account</p>

        <form onSubmit={handleSubmit}>
          {/* Username */}
          <div className="field" style={{ marginBottom: 16 }}>
            <label>Username</label>

            <input
              type="text"
              autoComplete="username"
              value={form.username}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  username: e.target.value,
                }))
              }
              placeholder="Enter your username"
            />
          </div>

          {/* Password */}
         <div className="field" style={{ marginBottom: 16 }}>
  <label>Password</label>

  <div style={{ position: "relative" }}>
    <input
      type={showPassword ? "text" : "password"}
      autoComplete="current-password"
      value={form.password}
      onChange={(e) =>
        setForm((f) => ({
          ...f,
          password: e.target.value,
        }))
      }
      placeholder="Enter your password"
      style={{
        paddingRight: "45px",
      }}
    />

    <button
      type="button"
      onClick={() => setShowPassword(!showPassword)}
      style={{
        position: "absolute",
        top: "50%",
        right: "12px",
        transform: "translateY(-50%)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: "#6b7280",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
      aria-label={showPassword ? "Hide password" : "Show password"}
    >
      {showPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
    </button>
  </div>
</div>

          {/* Error */}
          {error && (
            <div className="alert err" style={{ marginBottom: 16 }}>
              <span>⚠</span> {error}
            </div>
          )}

          {/* Login Button */}
          <button className="btn-login" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}