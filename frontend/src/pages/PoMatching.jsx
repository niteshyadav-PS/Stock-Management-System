import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPoMatching, unwrapList } from '../api/api';
import {toDDMMYYYY} from '../utils/helpers';
import Pagination from '../components/Pagination';
import useClientPagination from '../hooks/useClientPagination';

const STATUS_LABEL = {
  received: 'Fully Received',
  partial: 'Partially Received',
  pending: 'Pending Inward Entry',
};
const STATUS_COLOR = { received: '#2a9d8f', partial: '#e9a44e', pending: '#c0392b' };

export default function PoMatching() {
  const navigate = useNavigate();
  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [err,         setErr]         = useState('');
  const [expanded,    setExpanded]    = useState(null);
  const [filter,      setFilter]      = useState('all'); // all | pending | partial | received
  const [search,      setSearch]      = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPoMatching();
      setRows(unwrapList(data));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Same hand-off shape the Purchase Request page uses when it sends
  // someone to Inward to receive against a PO: `presetPo` preselects the
  // PO dropdown there, `prNumber`/`prPoNumbers` drive the small banner.
  function goToInward(po) {
    navigate('/inward', {
      state: {
        presetPo: po.poNumber,
        prNumber: po.prNumber || undefined,
        prPoNumbers: [po.poNumber],
      },
    });
  }

  const counts = useMemo(
    () => rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {}),
    [rows],
  );

  const visible = useMemo(() => rows.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.poNumber.toLowerCase().includes(q) ||
             r.prNumber?.toLowerCase().includes(q) ||
             r.vendorName?.toLowerCase().includes(q);
    }
    return true;
  }), [rows, filter, search]);
  const { pageItems, page, pageSize, total, setPage, setPageSize } =
    useClientPagination(visible, 25);

  return (
    <>
      <div className="pagehead">
        <div className="pagehead-text">
          <h2>PO Matching</h2>
          <p>Match purchase orders against inward entries track what has been received and what is still pending.</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="statrow">
        {[['all','Total POs', rows.length, ''], ['pending','Pending Inward Entry', counts.pending||0,'var(--red)'],
          ['partial','Partially Received', counts.partial||0,'#e9a44e'],
          ['received','Fully Received', counts.received||0,'#2a9d8f']].map(([key, label, val, color]) => (
          <div key={key} className={`stat${filter === key ? ' teal' : ''}`}
            style={{ cursor: 'pointer' }} onClick={() => setFilter(key)}>
            <div className="label">{label}</div>
            <div className="value" style={{ color: color || 'inherit' }}>{val}</div>
          </div>
        ))}
      </div>

      <div className="card card-wide">
        {/* Search + filter bar */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center',  }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by PO number, PR number or vendor name…"
            style={{ flex: 1, minWidth: 200 }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all','pending','partial','received'].map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={`btn ${filter === s ? 'btn-in' : 'btn-ghost'} btn-sm`}
                style={{ textTransform: 'capitalize' }}>
                {s === 'all' ? 'All' : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {err && <p className="msg err">{err}</p>}

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>PO No</th>
                <th>PO Date</th>
                <th>Expected Date</th>
                <th>PR No</th>
                <th>Vendor</th>
                <th className="num">Items</th>
                <th className="num">Ordered Qty</th>
                <th className="num">Received Qty</th>
                <th className="num">Pending Qty</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(po => {
                const totalOrdered  = po.items.reduce((s, i) => s + i.orderedQty, 0);
                const totalReceived = po.items.reduce((s, i) => s + i.receivedQty, 0);
                const totalPending  = po.items.reduce((s, i) => s + i.pendingQty,  0);
                const isOpen = expanded === po._id;
                return (
                  <React.Fragment key={po._id}>
                    <tr
                      style={{ cursor: 'pointer', background: isOpen ? 'var(--paper-dim)' : undefined }}
                      onClick={() => setExpanded(isOpen ? null : po._id)}
                    >
                      <td className="mono" style={{ fontWeight: 700 }}>{po.poNumber}</td>
                      <td className="nowrap">{toDDMMYYYY(po.poDate)}</td>
                      <td className="nowrap">{toDDMMYYYY(po.poExpectedDate) || <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                      <td className="mono">{po.prNumber}</td>
                      <td>{po.vendorName}</td>
                      <td className="num">{po.items.length}</td>
                      <td className="num">{totalOrdered}</td>
                      <td className="num" style={{ color: '#2a9d8f', fontWeight: totalReceived > 0 ? 600 : 400 }}>
                        {totalReceived}
                      </td>
                      <td className="num" style={{ color: totalPending > 0 ? 'var(--red)' : '#2a9d8f', fontWeight: 600 }}>
                        {totalPending > 0 ? totalPending : '✓'}
                      </td>
                      <td>
                        <span style={{
                          fontSize: 11.5, fontWeight: 600, padding: '3px 10px',
                          borderRadius: 20, background: STATUS_COLOR[po.status] + '22',
                          color: STATUS_COLOR[po.status],
                        }}>
                          {po.statusLabel || STATUS_LABEL[po.status]}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {po.status !== 'received' && (
                          <button
                            className="btn btn-sm btn-in"
                            onClick={() => goToInward(po)}
                          >
                            Pending Inward Entry
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Expanded item breakdown */}
                    {isOpen && (
                      <tr>
                        <td colSpan={11} style={{ background: 'var(--paper-dim)', padding: 0 }}>
                          <div style={{ padding: '14px 24px 18px' }}>
                            <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 10, color: 'var(--text-2)' }}>
                              Item breakdown — {po.poNumber} / {po.vendorName}
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead>
                                <tr style={{ background: 'var(--paper)' }}>
                                  {['Material','Code','UOM','Unit Price','Ordered Qty','Received Qty','Pending Qty','Match %'].map(h => (
                                    <th key={h} style={{ padding: '7px 12px', textAlign: h.includes('Qty') || h === 'Unit Price' || h === 'Match %' ? 'right' : 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {po.items.map((it, idx) => {
                                  const pct = it.orderedQty > 0 ? Math.min(100, Math.round((it.receivedQty / it.orderedQty) * 100)) : 0;
                                  const rowColor = pct === 100 ? '#2a9d8f22' : pct > 0 ? '#e9a44e22' : undefined;
                                  return (
                                    <tr key={idx} style={{ borderBottom: '1px solid var(--line)', background: rowColor }}>
                                      <td style={{ padding: '7px 12px', fontWeight: 500 }}>{it.name}</td>
                                      <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontSize: 12 }}>{it.code || '—'}</td>
                                      <td style={{ padding: '7px 12px' }}>{it.uom || '—'}</td>
                                      <td style={{ padding: '7px 12px', textAlign: 'right' }}>{it.price > 0 ? it.price.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}</td>
                                      <td style={{ padding: '7px 12px', textAlign: 'right' }}>{it.orderedQty}</td>
                                      <td style={{ padding: '7px 12px', textAlign: 'right', color: '#2a9d8f', fontWeight: it.receivedQty > 0 ? 600 : 400 }}>{it.receivedQty}</td>
                                      <td style={{ padding: '7px 12px', textAlign: 'right', color: it.pendingQty > 0 ? 'var(--red)' : '#2a9d8f', fontWeight: 600 }}>
                                        {it.pendingQty > 0 ? it.pendingQty : '✓'}
                                      </td>
                                      <td style={{ padding: '7px 12px', textAlign: 'right' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                                          <div style={{ width: 60, height: 6, background: 'var(--line)', borderRadius: 4, overflow: 'hidden' }}>
                                            <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#2a9d8f' : '#e9a44e', borderRadius: 4, transition: 'width 0.3s' }} />
                                          </div>
                                          <span style={{ fontSize: 12, fontWeight: 600, color: pct === 100 ? '#2a9d8f' : pct > 0 ? '#e9a44e' : 'var(--red)' }}>{pct}%</span>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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

        {!loading && !visible.length && (
          <div className="empty">
            {rows.length === 0 ? 'No purchase orders found.' : 'No POs match the current filter.'}
          </div>
        )}
      </div>
    </>
  );
}