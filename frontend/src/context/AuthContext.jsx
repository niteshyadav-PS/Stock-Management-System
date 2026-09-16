import React, { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

// ── Storage helpers ───────────────────────────────────────────────────────────
function readUser()  {
  try { return JSON.parse(localStorage.getItem('sy_user')) || null; }
  catch { return null; }
}
function readToken() { return localStorage.getItem('sy_token') || null; }

export function AuthProvider({ children }) {
  const [user,  setUser]  = useState(readUser);
  const [token, setToken] = useState(readToken);

  // Write to localStorage FIRST, then update React state.
  // This guarantees that when the Login page calls navigate() immediately
  // after login(), any subsequent API call triggered by the new route's
  // useEffect will find the token already in localStorage.
  function login(userData, jwt) {
    localStorage.setItem('sy_user',  JSON.stringify(userData));
    localStorage.setItem('sy_token', jwt);
    setUser(userData);
    setToken(jwt);
  }

  function logout() {
    localStorage.removeItem('sy_user');
    localStorage.removeItem('sy_token');
    setUser(null);
    setToken(null);
  }

  // Update a specific field on the current user (e.g. after profile change)
  function updateUser(patch) {
    const updated = { ...user, ...patch };
    localStorage.setItem('sy_user', JSON.stringify(updated));
    setUser(updated);
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
