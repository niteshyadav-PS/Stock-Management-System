import React, { useState, useEffect, useCallback } from 'react';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import { getUsers, saveUser, deleteUser, recordUserPassword, unwrapList } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../utils/helpers';
import Pagination from '../components/Pagination';
import useClientPagination from '../hooks/useClientPagination';

const EMPTY = { name: '', username: '', password: '', role: 'viewer' };

const ROLE_COLORS = {
  admin:         { bg: '#e6f2f0', color: 'var(--teal-dark)' },
  store:         { bg: '#eef2ff', color: '#3730a3' },
  store_manager: { bg: '#f3e8ff', color: '#6b21a8' },
  purchase:      { bg: '#f8ede7', color: 'var(--rust-dark)' },
  viewer:        { bg: 'var(--paper-dim)', color: '#5a5444' },
};

export default function Users() {
  const { user: currentUser } = useAuth();

  const [users,        setUsers]        = useState([]);
  const [form,         setForm]         = useState(EMPTY);
  const [msg,          setMsg]          = useState({ text: '', ok: true });
  const [showPassword, setShowPassword] = useState(false);
  const [visiblePwds,  setVisiblePwds]  = useState({});
  const [recordingPwd, setRecordingPwd] = useState({});

  const load = useCallback(async () => {
    try { setUsers(unwrapList(await getUsers())); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg({ text: '', ok: true });
    if (!form.name || !form.username || !form.password) {
      setMsg({ text: 'Name, username and password are required.', ok: false });
      return;
    }
    try {
      await saveUser(form);
      setMsg({ text: 'User saved successfully.', ok: true });
      setForm(EMPTY);
      setShowPassword(false);
      load();
      setTimeout(() => setMsg({ text: '', ok: true }), 4000);
    } catch (err) {
      setMsg({ text: err.message, ok: false });
    }
  }

  async function handleDelete(username) {
    if (username === currentUser?.username) { alert("You can't remove your own account."); return; }
    if (!window.confirm(`Remove user "${username}"?`)) return;
    try { await deleteUser(username); load(); }
    catch (err) { alert(err.message); }
  }

  function togglePwdVisibility(username) {
    setVisiblePwds(prev => ({ ...prev, [username]: !prev[username] }));
  }

  function startRecording(username) {
    setRecordingPwd(prev => ({ ...prev, [username]: '' }));
  }

  function cancelRecording(username) {
    setRecordingPwd(prev => { const n = { ...prev }; delete n[username]; return n; });
  }

  async function saveRecorded(username) {
    const pwd = recordingPwd[username];
    if (!pwd?.trim()) return;
    try {
      await recordUserPassword(username, pwd.trim());
      cancelRecording(username);
      load();
    } catch (err) { alert(err.message); }
  }

  const roleStyle = (role) => ROLE_COLORS[role] || ROLE_COLORS.viewer;
  const { pageItems, page, pageSize, total, setPage, setPageSize } =
    useClientPagination(users, 25);

  return (
    <>
      <div className="pagehead">
        <div className="pagehead-text">
          <h2>Users</h2>
          <p>Manage team access. Each role controls which pages and data a user can see.</p>
        </div>
      </div>

      <div className="card">
        <h3>Add / Update User</h3>
        <form onSubmit={handleSubmit}>
          <div className="formgrid">
            <div className="field">
              <label>Display Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Priya Shah" />
            </div>
            <div className="field">
              <label>Username</label>
              <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="e.g. priya" />
            </div>
            <div className="field">
              <label>Password</label>
              <div style={{ position: 'relative', width: '100%' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Set a password"
                  style={{ width: '100%', paddingRight: '45px' }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  style={{ position: 'absolute', top: '50%', right: '12px', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
                </button>
              </div>
            </div>
            <div className="field">
              <label>Role</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="admin">Admin — Full Access</option>
                <option value="store">Store Team — Inward + Outward</option>
                <option value="store_manager">Store Manager — Approve Requests</option>
                <option value="purchase">Purchase Team</option>
                <option value="viewer">Viewer — Read Only</option>
              </select>
            </div>
          </div>
          <div className="actionrow">
            <button className="btn btn-in" type="submit">Save User</button>
            {msg.text && <span className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
          </div>
        </form>
      </div>

      <div className="card card-wide">
        <h3>Team Members <span className="pill-count">{users.length}</span></h3>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Display Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Password</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(u => {
                const rs         = roleStyle(u.role);
                const plain      = u.plainPassword;
                const isVisible  = !!visiblePwds[u.username];
                const isRecording = recordingPwd.hasOwnProperty(u.username);

                return (
                  <tr key={u.username}>
                    <td style={{ fontWeight: 500 }}>{u.name}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12.5px' }}>{u.username}</td>
                    <td>
                      <span className="role-pill" style={{ background: rs.bg, color: rs.color, borderColor: 'transparent' }}>
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </td>
                    <td>
                      {plain ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, letterSpacing: isVisible ? 0 : 2 }}>
                            {isVisible ? plain : '••••••••'}
                          </span>
                          <button type="button" onClick={() => togglePwdVisibility(u.username)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 0, display: 'flex', alignItems: 'center' }}
                            aria-label={isVisible ? 'Hide password' : 'Show password'}>
                            {isVisible ? <FaEyeSlash size={15} /> : <FaEye size={15} />}
                          </button>
                        </div>
                      ) : isRecording ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            autoFocus
                            type="text"
                            value={recordingPwd[u.username]}
                            onChange={e => setRecordingPwd(prev => ({ ...prev, [u.username]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveRecorded(u.username);
                              if (e.key === 'Escape') cancelRecording(u.username);
                            }}
                            placeholder="Enter password"
                            style={{ width: 140, padding: '4px 8px', fontSize: 12.5, border: '1.5px solid var(--teal)', borderRadius: 6, fontFamily: 'var(--mono)' }}
                          />
                          <button type="button" className="btn btn-in btn-sm" onClick={() => saveRecorded(u.username)} style={{ padding: '4px 10px', fontSize: 11 }}>Save</button>
                          <button type="button" className="btn-del btn-sm" onClick={() => cancelRecording(u.username)} style={{ padding: '4px 8px', fontSize: 11 }}>✕</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => startRecording(u.username)}
                          style={{ background: 'none', border: '1px dashed var(--line)', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit' }}>
                          + set new password
                        </button>
                      )}
                    </td>
                    <td>
                      {u.username !== currentUser?.username && (
                        <button className="btn-del btn-sm" onClick={() => handleDelete(u.username)} title="Delete user">🗑</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
        {!users.length && <div className="empty">No users found.</div>}
      </div>
    </>
  );
}
