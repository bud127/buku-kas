// ─── IndexedDB ────────────────────────────────────────────────
const DB_NAME = 'buku-kas-db';
const DB_VER  = 1;
let db;

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('transactions')) {
        const ts = d.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        ts.createIndex('date', 'date');
        ts.createIndex('type', 'type');
      }
      if (!d.objectStoreNames.contains('debts')) {
        d.createObjectStore('debts', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => { db = e.target.result; res(db); };
    req.onerror   = () => rej(req.error);
  });
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function dbAdd(store, item) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).add(item);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function dbPut(store, item) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(item);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function dbDelete(store, id) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(id);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

// ─── State ────────────────────────────────────────────────────
let txs   = [];
let debts = [];
let currentPage   = 'dashboard';
let txTypeFilter  = 'all';
let debtTypeFilter = 'all';
let viewMonth; // YYYY-MM string

// ─── Helpers ──────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);
const nowYM  = () => new Date().toISOString().slice(0, 7);
const fmt    = n  => 'Rp\u00A0' + Math.round(n).toLocaleString('id-ID');
const initials = s => (s || '?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.toISOString().slice(0, 7);
}

function toast(msg, dur = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), dur);
}

// ─── Navigation ───────────────────────────────────────────────
function navTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.getElementById('nav-' + page).classList.add('active');
  if (page === 'dashboard')   renderDashboard();
  if (page === 'history')     renderHistory();
  if (page === 'debt')        renderDebt();
}

// ─── Dashboard ────────────────────────────────────────────────
function renderDashboard() {
  const ym = nowYM();
  const monthTxs = txs.filter(t => t.date.startsWith(ym));
  const inc = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const exp = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const bal = inc - exp;

  document.getElementById('d-income').textContent  = fmt(inc);
  document.getElementById('d-expense').textContent = fmt(exp);
  const balEl = document.getElementById('d-balance');
  balEl.textContent  = fmt(Math.abs(bal));
  balEl.className    = 'metric-val ' + (bal >= 0 ? 'blue' : 'red');

  renderWeekChart();
  renderRecentList();
  renderCatChart();
  renderDebtSummary();
}

function renderWeekChart() {
  const days = [];
  let maxV = 0;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const lbl = d.toLocaleDateString('id-ID', { weekday: 'short' }).slice(0, 3);
    const dt = txs.filter(t => t.date === ds);
    const inc = dt.filter(t => t.type === 'income').reduce((s,t) => s+t.amount, 0);
    const exp = dt.filter(t => t.type === 'expense').reduce((s,t) => s+t.amount, 0);
    maxV = Math.max(maxV, inc, exp);
    days.push({ lbl, inc, exp });
  }
  maxV = maxV || 1;
  document.getElementById('week-chart').innerHTML = days.map(d => `
    <div class="bar-row">
      <div class="bar-lbl">${d.lbl}</div>
      <div class="bar-wrap">
        <div class="bar-track"><div class="bar-fill in" style="width:${(d.inc/maxV*100).toFixed(1)}%">
          <span>${d.inc>0?fmt(d.inc):''}</span></div></div>
        <div class="bar-track"><div class="bar-fill ex" style="width:${(d.exp/maxV*100).toFixed(1)}%">
          <span>${d.exp>0?fmt(d.exp):''}</span></div></div>
      </div>
    </div>`).join('');
}

function renderRecentList() {
  const list = txs.slice(0, 6);
  const el = document.getElementById('recent-list');
  if (!list.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">📒</div>Belum ada transaksi</div>'; return; }
  el.innerHTML = list.map(t => txItemHTML(t, false)).join('');
}

function renderCatChart() {
  const ym = nowYM();
  const cats = {};
  txs.filter(t => t.type === 'expense' && t.date.startsWith(ym))
     .forEach(t => cats[t.category] = (cats[t.category]||0) + t.amount);
  const sorted = Object.entries(cats).sort((a,b) => b[1]-a[1]).slice(0,5);
  const el = document.getElementById('cat-chart');
  if (!sorted.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:4px 0">Belum ada pengeluaran bulan ini</div>'; return; }
  const maxV = sorted[0][1];
  el.innerHTML = sorted.map(([cat, amt]) => `
    <div class="bar-row">
      <div class="bar-lbl" style="width:60px;font-size:10px;text-align:right">${cat}</div>
      <div class="bar-track" style="flex:1"><div class="bar-fill ex" style="width:${(amt/maxV*100).toFixed(1)}%">
        <span>${fmt(amt)}</span></div></div>
    </div>`).join('');
}

function renderDebtSummary() {
  const piutang = debts.filter(d => d.type==='piutang').reduce((s,d) => s+(d.amount-d.paid),0);
  const hutang  = debts.filter(d => d.type==='hutang').reduce((s,d) => s+(d.amount-d.paid),0);
  document.getElementById('d-piutang').textContent = fmt(piutang);
  document.getElementById('d-hutang').textContent  = fmt(hutang);
}

// ─── Add Transaction ──────────────────────────────────────────
let selectedType = 'expense';

function setTxType(type) {
  selectedType = type;
  document.getElementById('type-income').className  = 'type-btn' + (type==='income'?' active-income':'');
  document.getElementById('type-expense').className = 'type-btn' + (type==='expense'?' active-expense':'');
  updateCatOptions();
}

function updateCatOptions() {
  const incomeCats  = ['Gaji','Usaha','Freelance','Investasi','Transfer masuk','Lainnya'];
  const expenseCats = ['Makanan','Transportasi','Belanja','Tagihan','Kesehatan','Hiburan','Pendidikan','Tabungan','Lainnya'];
  const sel = document.getElementById('f-category');
  const cats = selectedType === 'income' ? incomeCats : expenseCats;
  sel.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

async function submitTx() {
  const amount   = parseFloat(document.getElementById('f-amount').value);
  const category = document.getElementById('f-category').value;
  const date     = document.getElementById('f-date').value;
  const note     = document.getElementById('f-note').value.trim();

  if (!amount || amount <= 0) { toast('⚠ Masukkan jumlah yang valid'); return; }
  if (!date)                   { toast('⚠ Pilih tanggal'); return; }

  const item = { type: selectedType, amount, category, date, note: note || category, createdAt: Date.now() };
  const id = await dbAdd('transactions', item);
  item.id = id;
  txs.unshift(item);
  txs.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  document.getElementById('f-amount').value = '';
  document.getElementById('f-note').value   = '';
  document.getElementById('f-date').value   = today();

  toast('✓ ' + (selectedType==='income'?'Pemasukan':'Pengeluaran') + ' disimpan: ' + fmt(amount));
  renderDashboard();
}

// ─── History ──────────────────────────────────────────────────
function renderHistory() {
  const ym     = viewMonth;
  const search = (document.getElementById('h-search')?.value || '').toLowerCase();

  let list = txs.filter(t => {
    if (txTypeFilter !== 'all' && t.type !== txTypeFilter) return false;
    if (!t.date.startsWith(ym)) return false;
    if (search && !t.note.toLowerCase().includes(search) && !t.category.toLowerCase().includes(search)) return false;
    return true;
  });

  document.getElementById('h-month-label').textContent = monthLabel(ym);

  const inc = list.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const exp = list.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  document.getElementById('h-inc').textContent = fmt(inc);
  document.getElementById('h-exp').textContent = fmt(exp);

  const el = document.getElementById('history-list');
  if (!list.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div>Tidak ada transaksi</div>';
    return;
  }

  // Group by date
  const groups = {};
  list.forEach(t => { if (!groups[t.date]) groups[t.date] = []; groups[t.date].push(t); });
  const html = Object.entries(groups)
    .sort((a,b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => {
      const d = new Date(date + 'T00:00:00');
      const lbl = d.toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long' });
      return `<div style="font-size:11px;font-weight:600;color:var(--text3);margin:10px 0 6px;text-transform:uppercase;letter-spacing:0.05em">${lbl}</div>`
        + items.map(t => txItemHTML(t, true)).join('');
    }).join('');
  el.innerHTML = html;
}

function txItemHTML(t, showDelete) {
  return `<div class="tx-item">
    <div class="tx-icon ${t.type}">${t.type==='income'?'↑':'↓'}</div>
    <div class="tx-body">
      <div class="tx-name">${t.note}</div>
      <div class="tx-meta"><span class="badge badge-${t.type}">${t.category}</span></div>
    </div>
    <div style="text-align:right">
      <div class="tx-amount ${t.type}">${t.type==='income'?'+':'-'}${fmt(t.amount)}</div>
      ${showDelete ? `<button class="btn-sm btn-danger" style="margin-top:4px" onclick="deleteTx(${t.id})">Hapus</button>` : ''}
    </div>
  </div>`;
}

async function deleteTx(id) {
  if (!confirm('Hapus transaksi ini?')) return;
  await dbDelete('transactions', id);
  txs = txs.filter(t => t.id !== id);
  renderHistory();
  renderDashboard();
  toast('Transaksi dihapus');
}

function setTxFilter(type, btn) {
  txTypeFilter = type;
  document.querySelectorAll('#history-filters .ftab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  renderHistory();
}

function prevMonth() { viewMonth = shiftMonth(viewMonth, -1); renderHistory(); }
function nextMonth() {
  const next = shiftMonth(viewMonth, 1);
  if (next <= nowYM()) { viewMonth = next; renderHistory(); }
}

// ─── Debt/Piutang ─────────────────────────────────────────────
let debtSelectedType = 'piutang';

function setDebtType(type) {
  debtSelectedType = type;
  document.getElementById('dt-piutang').className = 'type-btn' + (type==='piutang'?' active-income':'');
  document.getElementById('dt-hutang').className  = 'type-btn' + (type==='hutang'?' active-expense':'');
}

async function submitDebt() {
  const name   = document.getElementById('d-name').value.trim();
  const amount = parseFloat(document.getElementById('d-amount').value);
  const date   = document.getElementById('d-date').value;
  const note   = document.getElementById('d-note').value.trim();
  if (!name)               { toast('⚠ Masukkan nama'); return; }
  if (!amount || amount<=0){ toast('⚠ Masukkan jumlah yang valid'); return; }

  const item = { type: debtSelectedType, name, amount, date, note, paid: 0, createdAt: Date.now() };
  const id = await dbAdd('debts', item);
  item.id = id;
  debts.unshift(item);

  document.getElementById('d-name').value   = '';
  document.getElementById('d-amount').value = '';
  document.getElementById('d-note').value   = '';

  toast('✓ Catatan disimpan');
  renderDebt();
  renderDebtSummary();
}

async function markPaid(id) {
  const d = debts.find(x => x.id === id);
  if (!d) return;
  d.paid = d.amount;
  await dbPut('debts', d);
  renderDebt();
  renderDebtSummary();
  toast('✓ Ditandai lunas');
}

async function deleteDebt(id) {
  if (!confirm('Hapus catatan ini?')) return;
  await dbDelete('debts', id);
  debts = debts.filter(d => d.id !== id);
  renderDebt();
  renderDebtSummary();
  toast('Catatan dihapus');
}

function setDebtFilter(type, btn) {
  debtTypeFilter = type;
  document.querySelectorAll('#debt-filters .ftab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  renderDebt();
}

function renderDebt() {
  const piutangTotal = debts.filter(d=>d.type==='piutang').reduce((s,d)=>s+(d.amount-d.paid),0);
  const hutangTotal  = debts.filter(d=>d.type==='hutang').reduce((s,d)=>s+(d.amount-d.paid),0);
  document.getElementById('dbt-piutang').textContent = fmt(piutangTotal);
  document.getElementById('dbt-hutang').textContent  = fmt(hutangTotal);

  let list = debts;
  if (debtTypeFilter === 'piutang') list = debts.filter(d => d.type==='piutang');
  else if (debtTypeFilter === 'hutang') list = debts.filter(d => d.type==='hutang');
  else if (debtTypeFilter === 'unpaid') list = debts.filter(d => d.paid < d.amount);

  const el = document.getElementById('debt-list');
  if (!list.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🤝</div>Tidak ada catatan</div>';
    return;
  }
  el.innerHTML = list.map(d => {
    const sisa   = d.amount - d.paid;
    const lunas  = sisa === 0;
    const pct    = Math.round(d.paid / d.amount * 100);
    return `<div class="debt-item">
      <div class="avatar ${d.type}">${initials(d.name)}</div>
      <div class="debt-body">
        <div class="debt-name">${d.name} <span class="badge badge-${d.type}">${d.type==='piutang'?'Piutang':'Hutang'}</span></div>
        <div class="debt-note">${d.date}${d.note?' · '+d.note:''}</div>
        <div class="debt-actions">
          <span class="badge ${lunas?'badge-lunas':'badge-pending'}">${lunas?'Lunas':sisa===d.amount?'Belum lunas':'Sebagian'}</span>
          ${!lunas ? `<button class="btn-sm btn-success" onclick="markPaid(${d.id})">Lunas</button>` : ''}
          <button class="btn-sm btn-danger" onclick="deleteDebt(${d.id})">Hapus</button>
        </div>
        ${!lunas && d.paid > 0 ? `<div class="progress-wrap"><div class="progress-fill high" style="width:${pct}%"></div></div>` : ''}
      </div>
      <div class="debt-right">
        <div class="debt-amount ${d.type}">${fmt(d.amount)}</div>
        ${!lunas ? `<div class="debt-sisa">Sisa ${fmt(sisa)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ─── Export ───────────────────────────────────────────────────
function exportCSV() {
  if (!txs.length && !debts.length) { toast('⚠ Belum ada data'); return; }
  let csv = 'Jenis,Tanggal,Kategori,Keterangan,Jumlah\n';
  txs.forEach(t => {
    csv += `"${t.type==='income'?'Pemasukan':'Pengeluaran'}","${t.date}","${t.category}","${t.note}",${t.amount}\n`;
  });
  if (debts.length) {
    csv += '\nHutang/Piutang\nJenis,Nama,Tanggal,Keterangan,Jumlah,Terbayar,Sisa\n';
    debts.forEach(d => {
      csv += `"${d.type==='piutang'?'Piutang':'Hutang'}","${d.name}","${d.date}","${d.note}",${d.amount},${d.paid},${d.amount-d.paid}\n`;
    });
  }
  const blob = new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `buku-kas-${nowYM()}.csv` });
  a.click();
  URL.revokeObjectURL(url);
  toast('✓ File CSV berhasil diunduh');
}

// ─── PWA Install ──────────────────────────────────────────────
let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('install-banner').style.display = 'flex';
});

window.addEventListener('appinstalled', () => {
  document.getElementById('install-banner').style.display = 'none';
  toast('✓ Aplikasi berhasil dipasang!');
});

function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(r => {
    if (r.outcome === 'accepted') toast('✓ Memasang aplikasi…');
    deferredPrompt = null;
  });
}

// ─── Service Worker ───────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  viewMonth = nowYM();
  await openDB();

  const [allTxs, allDebts] = await Promise.all([
    dbGetAll('transactions'),
    dbGetAll('debts')
  ]);

  txs   = allTxs.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  debts = allDebts.sort((a,b) => b.createdAt - a.createdAt);

  // Set defaults
  document.getElementById('f-date').value = today();
  document.getElementById('d-date').value = today();
  updateCatOptions();
  setTxType('expense');
  setDebtType('piutang');

  // Header date
  document.getElementById('header-date').textContent =
    new Date().toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });

  navTo('dashboard');
}

init();
