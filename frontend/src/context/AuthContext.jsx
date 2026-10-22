import React, { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

// sessionStorage is per-tab, so two tabs can stay logged in as different users.
// localStorage was shared across all tabs of this site (one login overwrote the other).
const authStore = sessionStorage;

function clearLegacyLocalAuth() {
  try {
    localStorage.removeItem('sy_user');
    localStorage.removeItem('sy_token');
  } catch {
    /* ignore */
  }
}

function readUser()  {
  try { return JSON.parse(authStore.getItem('sy_user')) || null; }
  catch { return null; }
}
function readToken() { return authStore.getItem('sy_token') || null; }

export function AuthProvider({ children }) {
  const [user,  setUser]  = useState(() => {
    clearLegacyLocalAuth();
    return readUser();
  });
  const [token, setToken] = useState(readToken);

  // Write to sessionStorage FIRST, then update React state.
  // This guarantees that when the Login page calls navigate() immediately
  // after login(), any subsequent API call triggered by the new route's
  // useEffect will find the token already in storage for this tab.
  function login(userData, jwt) {
    clearLegacyLocalAuth();
    authStore.setItem('sy_user',  JSON.stringify(userData));
    authStore.setItem('sy_token', jwt);
    setUser(userData);
    setToken(jwt);
  }

  function logout() {
    clearLegacyLocalAuth();
    authStore.removeItem('sy_user');
    authStore.removeItem('sy_token');
    setUser(null);
    setToken(null);
  }

  // Update a specific field on the current user (e.g. after profile change)
  function updateUser(patch) {
    const updated = { ...user, ...patch };
    authStore.setItem('sy_user', JSON.stringify(updated));
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
