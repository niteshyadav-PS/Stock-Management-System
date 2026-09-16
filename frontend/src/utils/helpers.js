import * as XLSX from 'xlsx';

export function formatNum(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// Integer format — no decimal points (for qty totals and whole-number values)
export function formatInt(n) {
  if (n == null || isNaN(n)) return '0';
  return Math.round(Number(n)).toLocaleString('en-IN');
}

// Indian currency format with ₹ symbol — e.g. ₹2,59,30,099.42
export function formatINR(n) {
  if (n == null || isNaN(n)) return '₹0';
  const rounded = Math.round(Number(n));
  return '₹' + rounded.toLocaleString('en-IN');
}

// Local calendar date as yyyy-mm-dd. Built from the local parts, not
// toISOString(), so IST users before 05:30 don't get yesterday's date.
export function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Display a stored date as dd/mm/yyyy.
// Regex-based (no `new Date()`) so "2026-08-03" can never be misread as
// month/day by locale quirks. Handles ISO datetimes ("2026-08-03T...") too.
export function formatDateDMY(dateStr) {
  if (!dateStr) return '—';
  const s = String(dateStr).split('T')[0].trim();

  // Stored ISO format: yyyy-mm-dd
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[1]}`;

  // Already dd/mm/yyyy or dd-mm-yyyy (legacy rows saved as raw strings)
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;

  return s; // unknown format — show as-is rather than break
}

// Backward-compatible alias: any page still calling toDDMMYYYY now gets
// dd/mm/yyyy automatically (previously dd-mm-yyyy).
export const toDDMMYYYY = formatDateDMY;

// Loose header normaliser
export function normHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function pickCol(row, candidates) {
  const keys = Object.keys(row);
  for (const k of keys) {
    if (candidates.includes(normHeader(k))) return String(row[k] || '').trim();
  }
  for (const k of keys) {
    const n = normHeader(k);
    if (candidates.some(c => n.includes(c))) return String(row[k] || '').trim();
  }
  return '';
}

// Parse Excel date serial or string → YYYY-MM-DD (what the app STORES).
// Now also converts dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy strings to ISO,
// instead of storing the raw string (which broke sorting and dd/mm display).
export function parseExcelDate(raw) {
  if (!raw) return '';

  // Excel serial number (e.g. 45870)
  if (!isNaN(Number(raw)) && String(raw).trim() !== '') {
    const d = XLSX.SSF.parse_date_code(Number(raw));
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }

  const s = String(raw).trim();

  // Already ISO: yyyy-mm-dd
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy → ISO
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

  // Fallback: text dates like "Aug 3, 2026"
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }

  return s; // last resort — keep old behaviour
}

// Read a File object → array of row objects
export function readSheetFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const data = new Uint8Array(evt.target.result);
        const wb   = XLSX.read(data, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { defval: '' }));
      } catch (e) { reject(e); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// Download a worksheet as .xlsx
export function exportXlsx(headers, rows, sheetName, fileName) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

export const ROLE_LABELS = {
  admin:         'Admin',
  store:         'Store Team',
  store_manager: 'Store Manager',
  purchase:      'Purchase Team',
  viewer:        'Viewer',
};