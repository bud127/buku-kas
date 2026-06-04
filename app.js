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
  if (page === 'quick')       initQuickPage();
  if (page === 'settings')    initSettingsPage();
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

// ─── Backup & Restore ─────────────────────────────────────────

function backupData() {
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions: txs,
    debts: debts
  };
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const date = today().replace(/-/g, '');
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: 'buku-kas-backup-' + date + '.json'
  });
  a.click();
  URL.revokeObjectURL(url);
  toast('✓ Backup berhasil diunduh');
}

function restoreFromFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.version || !Array.isArray(data.transactions)) {
        throw new Error('Format file tidak valid');
      }
      showRestorePreview(data);
    } catch (err) {
      toast('⚠ Gagal membaca file: ' + err.message);
    }
    input.value = ''; // reset so same file can be picked again
  };
  reader.readAsText(file);
}

function showRestorePreview(data) {
  const mode  = document.querySelector('input[name="restore-mode"]:checked').value;
  const txCount   = data.transactions.length;
  const debtCount = (data.debts || []).length;
  const expAt = new Date(data.exportedAt).toLocaleDateString('id-ID', {
    day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'
  });

  const preview = document.getElementById('restore-preview');
  preview.style.display = 'block';
  preview.innerHTML = `
    <div style="background:var(--blue-bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin-bottom:10px">
      <div style="font-size:12px;font-weight:600;color:var(--blue-text);margin-bottom:6px">📋 Info backup</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.8">
        Tanggal backup: <b>${expAt}</b><br>
        Transaksi: <b>${txCount} data</b><br>
        Hutang/Piutang: <b>${debtCount} data</b><br>
        Mode: <b>${mode === 'merge' ? 'Gabung ke data yang ada' : 'Ganti semua data lama'}</b>
      </div>
    </div>
    <button class="btn-primary" onclick="executeRestore(${JSON.stringify(data).replace(/"/g,'&quot;')}, '${mode}')">
      ✓ Restore Sekarang
    </button>
    <button class="btn-sm" style="width:100%;text-align:center;margin-top:8px" onclick="cancelRestore()">Batal</button>
  `;
}

function cancelRestore() {
  document.getElementById('restore-preview').style.display = 'none';
}

async function executeRestore(data, mode) {
  try {
    const incomingTxs   = data.transactions || [];
    const incomingDebts = data.debts || [];

    if (mode === 'replace') {
      // Clear existing
      const txStore = db.transaction('transactions', 'readwrite').objectStore('transactions');
      await new Promise((res, rej) => { const r = txStore.clear(); r.onsuccess=res; r.onerror=rej; });
      const debtStore = db.transaction('debts', 'readwrite').objectStore('debts');
      await new Promise((res, rej) => { const r = debtStore.clear(); r.onsuccess=res; r.onerror=rej; });
      txs   = [];
      debts = [];
    }

    // Get existing IDs to avoid duplicates on merge
    const existingTxIds   = new Set(txs.map(t => t.createdAt + '_' + t.amount));
    const existingDebtIds = new Set(debts.map(d => d.createdAt + '_' + d.amount));

    let addedTx = 0, addedDebt = 0, skipped = 0;

    for (const tx of incomingTxs) {
      const key = tx.createdAt + '_' + tx.amount;
      if (mode === 'merge' && existingTxIds.has(key)) { skipped++; continue; }
      const { id: _id, ...txData } = tx; // strip old id
      const newId = await dbAdd('transactions', txData);
      txs.unshift({ ...txData, id: newId });
      addedTx++;
    }

    for (const debt of incomingDebts) {
      const key = debt.createdAt + '_' + debt.amount;
      if (mode === 'merge' && existingDebtIds.has(key)) { skipped++; continue; }
      const { id: _id, ...debtData } = debt;
      const newId = await dbAdd('debts', debtData);
      debts.unshift({ ...debtData, id: newId });
      addedDebt++;
    }

    txs.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    debts.sort((a,b) => b.createdAt - a.createdAt);

    document.getElementById('restore-preview').style.display = 'none';
    renderDashboard();
    initSettingsPage();

    let msg = '✓ Restore selesai: ' + addedTx + ' transaksi, ' + addedDebt + ' hutang/piutang ditambahkan';
    if (skipped > 0) msg += ' (' + skipped + ' duplikat dilewati)';
    toast(msg, 3500);
  } catch (err) {
    toast('⚠ Restore gagal: ' + err.message);
  }
}

async function clearAllData() {
  if (!confirm('Yakin hapus SEMUA data? Aksi ini tidak bisa dibatalkan.\n\nPastikan sudah backup dulu!')) return;
  if (!confirm('Konfirmasi sekali lagi: hapus semua transaksi dan hutang/piutang?')) return;

  const txStore = db.transaction('transactions', 'readwrite').objectStore('transactions');
  await new Promise((res, rej) => { const r = txStore.clear(); r.onsuccess=res; r.onerror=rej; });
  const debtStore = db.transaction('debts', 'readwrite').objectStore('debts');
  await new Promise((res, rej) => { const r = debtStore.clear(); r.onsuccess=res; r.onerror=rej; });

  txs   = [];
  debts = [];
  renderDashboard();
  initSettingsPage();
  toast('Semua data dihapus');
}

function initSettingsPage() {
  // Stats
  const now = nowYM();
  const monthTxs = txs.filter(t => t.date.startsWith(now));
  const stats = document.getElementById('data-stats');
  const totalInc  = txs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const totalExp  = txs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const oldestTx  = txs.length ? txs[txs.length-1].date : '-';
  stats.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--text2)">Total transaksi</span>
      <span style="font-weight:500">${txs.length} data</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--text2)">Total catatan hutang/piutang</span>
      <span style="font-weight:500">${debts.length} data</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--text2)">Total pemasukan (semua)</span>
      <span style="font-weight:500;color:var(--green)">${fmt(totalInc)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--text2)">Total pengeluaran (semua)</span>
      <span style="font-weight:500;color:var(--red)">${fmt(totalExp)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0">
      <span style="color:var(--text2)">Transaksi pertama</span>
      <span style="font-weight:500">${oldestTx}</span>
    </div>
  `;

  // Drag-drop on drop zone
  const dz = document.getElementById('restore-drop-zone');
  if (dz && !dz._dzInit) {
    dz._dzInit = true;
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.background = 'var(--bg3)'; });
    dz.addEventListener('dragleave', () => { dz.style.background = ''; });
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.style.background = '';
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.json')) {
        const fakeInput = { files: [file] };
        restoreFromFile(fakeInput);
      } else {
        toast('⚠ Pilih file .json yang valid');
      }
    });
  }
}


// ─── Rule-Based NLP Parser ────────────────────────────────────

// Nominal: parse "25rb", "1.5jt", "dua ratus ribu", dll
const ANGKA_KATA = {
  'nol':0,'satu':1,'dua':2,'tiga':3,'empat':4,'lima':5,
  'enam':6,'tujuh':7,'delapan':8,'sembilan':9,'sepuluh':10,
  'sebelas':11,'dua belas':12,'tiga belas':13,'empat belas':14,
  'lima belas':15,'enam belas':16,'tujuh belas':17,'delapan belas':18,
  'sembilan belas':19,'dua puluh':20,'tiga puluh':30,'empat puluh':40,
  'lima puluh':50,'enam puluh':60,'tujuh puluh':70,'delapan puluh':80,
  'sembilan puluh':90,'seratus':100,'dua ratus':200,'tiga ratus':300,
  'empat ratus':400,'lima ratus':500,'enam ratus':600,'tujuh ratus':700,
  'delapan ratus':800,'sembilan ratus':900,'seribu':1000,'dua ribu':2000,
  'lima ribu':5000,'sepuluh ribu':10000,'dua puluh ribu':20000,
  'lima puluh ribu':50000,'seratus ribu':100000,'dua ratus ribu':200000,
  'lima ratus ribu':500000,'satu juta':1000000,'dua juta':2000000,
  'lima juta':5000000,'sepuluh juta':10000000
};

function parseAmount(text) {
  const t = text.toLowerCase().trim();

  // numeric: 1.500.000 / 1,500,000 / 1500000
  const numClean = t.replace(/[.,]/g, '');
  // pattern: angka + satuan
  const m = t.match(/(\d+(?:[.,]\d+)*)\s*(rb|ribu|k|jt|juta|m|miliar|ratus\s*ribu)?/);
  if (m) {
    let val = parseFloat(m[1].replace(/[.,]/g, ''));
    const sat = (m[2] || '').trim().toLowerCase();
    if (sat === 'rb' || sat === 'ribu' || sat === 'k') val *= 1000;
    else if (sat === 'jt' || sat === 'juta' || sat === 'm') val *= 1000000;
    else if (sat === 'miliar') val *= 1000000000;
    else if (sat === 'ratus ribu') val *= 100000;
    if (val > 0) return val;
  }

  // kata-kata
  for (const [kata, angka] of Object.entries(ANGKA_KATA).sort((a,b) => b[0].length - a[0].length)) {
    if (t.includes(kata)) return angka;
  }
  return null;
}

// Keyword maps
const EXPENSE_VERBS = [
  'beli','bayar','bayarin','bayarkan','belanja','makan','minum','jajan',
  'isi','nge','top up','topup','charge','beli','transfer ke','kirim ke',
  'cas','ngecas','bensin','parkir','tol','naik','grab','gojek','ojek',
  'servis','service','cicil','angsur','kredit','bayar hutang'
];
const INCOME_VERBS = [
  'terima','dapat','gaji','salary','dapet','masuk','transfer masuk',
  'dibayar','dibayarin','dikasih','untung','profit','hasil','jual',
  'bonus','thr','dividen','cashback','refund','kembalian'
];
const DEBT_HUTANG = ['hutang ke','pinjam ke','pinjam dari','bayar ke','kasih pinjam ke','minjemin','minjemin ke','utang ke'];
const DEBT_PIUTANG = ['piutang','dipinjam','pinjemin','pinjem ke','minjemin ke si','tagih','belum dibayar','nunggak'];

const CAT_RULES = {
  expense: [
    { cat:'Makanan',     kw:['makan','minum','kopi','coffee','bakso','nasi','ayam','warteg','warung','resto','restoran','caffe','cafe','boba','teh','juice','jus','sarapan','makan siang','makan malam','snack','jajan','camilan','indomie','grab food','gofood','shopee food'] },
    { cat:'Transportasi',kw:['bensin','pertamax','solar','pertalite','parkir','tol','grab','gojek','ojek','angkot','busway','transjakarta','kereta','krl','lrt','mrt','bus','taksi','taxi','uber','indriver','maxim','tiket','bbm','isi bensin'] },
    { cat:'Belanja',     kw:['beli','belanja','shopee','tokopedia','lazada','alfamart','indomaret','minimarket','supermarket','hypermart','carrefour','giant','baju','celana','sepatu','tas','pakaian','fashion','elektronik','hp','handphone','laptop'] },
    { cat:'Tagihan',     kw:['listrik','pln','air','pdam','internet','wifi','indihome','firstmedia','biznet','telkom','pulsa','kuota','token','iuran','cicilan','kredit','kpr','angsuran','bpjs','asuransi','sewa','kos','kontrakan','bayar tagihan'] },
    { cat:'Kesehatan',   kw:['obat','apotek','apotik','dokter','klinik','rumah sakit','rs','puskesmas','bidan','beli obat','vitamin','suplemen','periksa','kontrol','cek kesehatan','laboratorium','lab','resep','covid','tes'] },
    { cat:'Hiburan',     kw:['nonton','bioskop','cinema','netflix','spotify','youtube','game','steam','main','hiburan','rekreasi','wisata','liburan','hotel','villa','airbnb','karaoke','bowling','futsal','gym','fitness'] },
    { cat:'Pendidikan',  kw:['sekolah','kuliah','les','kursus','buku','belajar','spp','ukt','uang sekolah','pendidikan','training','seminar','workshop','udemy','coursera'] },
    { cat:'Tabungan',    kw:['nabung','tabung','investasi','saham','reksadana','emas','deposito','transfer ke tabungan'] },
  ],
  income: [
    { cat:'Gaji',         kw:['gaji','salary','upah','thr','bonus gaji','payroll','gajian'] },
    { cat:'Usaha',        kw:['usaha','dagangan','jualan','omzet','pendapatan','hasil jualan','penjualan','laba','profit','untung','warung','toko'] },
    { cat:'Freelance',    kw:['freelance','project','proyek','jasa','honor','honorarium','fee','bayaran proyek','kerja sampingan'] },
    { cat:'Investasi',    kw:['dividen','bunga','return','keuntungan saham','untung saham','hasil investasi','cashback'] },
    { cat:'Transfer masuk',kw:['transfer','kirim','dikirim','masuk','terima transfer','dapet transfer','refund','kembalian'] },
  ]
};

function guessCategory(text, txType) {
  const t = text.toLowerCase();
  const rules = CAT_RULES[txType] || CAT_RULES.expense;
  for (const rule of rules) {
    if (rule.kw.some(k => t.includes(k))) return rule.cat;
  }
  return txType === 'income' ? 'Lainnya' : 'Lainnya';
}

function extractName(text) {
  // "pinjam ke Budi 50rb" → "Budi"
  const patterns = [
    /(?:ke|dari|sama|dengan|si|buat)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
    /(?:ke|dari|sama|dengan|si|buat)\s+([a-zA-Z]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1);
  }
  // fallback: ambil kata kapital
  const words = text.split(/\s+/);
  for (const w of words) {
    if (/^[A-Z][a-z]{1,}$/.test(w) && !['Rp','Bayar','Beli','Pinjam','Hutang','Terima'].includes(w)) return w;
  }
  return 'Seseorang';
}

function cleanNote(text, amount) {
  let t = text.toLowerCase();
  // hapus nominal
  t = t.replace(/\d+(?:[.,]\d+)*\s*(?:rb|ribu|k|jt|juta|m|miliar)?/g, '').trim();
  // hapus kata trigger
  const stopwords = ['beli','bayar','bayarkan','terima','dapat','dapet','gaji','masuk',
    'transfer','hutang','ke','pinjam','dari','sebesar','senilai','sejumlah','rp','rupiah','tadi','tuh','nih'];
  t = t.split(/\s+/).filter(w => !stopwords.includes(w.toLowerCase())).join(' ').trim();
  // judul case
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

function parseTransactionRuleBase(raw) {
  const text = raw.trim();
  const lower = text.toLowerCase();

  // 1. Parse nominal
  const amount = parseAmount(lower);
  if (!amount || amount <= 0) {
    return { type:'unknown', message:'Jumlah tidak ditemukan. Contoh: "beli makan 25rb" atau "terima gaji 5 juta".' };
  }

  // 2. Cek hutang/piutang dulu
  const isHutang   = DEBT_HUTANG.some(k => lower.includes(k));
  const isPiutang  = DEBT_PIUTANG.some(k => lower.includes(k));
  if (isHutang || isPiutang) {
    const debtType = isPiutang ? 'piutang' : 'hutang';
    const name = extractName(text);
    const note = cleanNote(text, amount);
    return { type:'debt', debtType, name, amount, note };
  }

  // 3. Tentukan income/expense
  const hasIncome  = INCOME_VERBS.some(k => lower.includes(k));
  const hasExpense = EXPENSE_VERBS.some(k => lower.includes(k));
  let txType = 'expense'; // default
  if (hasIncome && !hasExpense) txType = 'income';
  else if (hasExpense) txType = 'expense';
  else if (hasIncome) txType = 'income';

  // 4. Kategori
  const category = guessCategory(lower, txType);

  // 5. Note bersih
  let note = cleanNote(text, amount);
  if (!note) note = category;

  return { type:'transaction', txType, amount, category, note };
}

// ─── Quick Entry (Chat + Voice) ───────────────────────────────

let isRecording = false;
let recognition = null;

function initQuickPage() {
  const hist = document.getElementById('chat-history');
  if (hist.children.length === 0) {
    addBotBubble('Halo! Ketik atau bicara untuk mencatat transaksi.\n\nContoh:\n• "beli makan siang 25 ribu"\n• "terima gaji 5 juta"\n• "bayar listrik 150rb"\n• "pinjam ke Budi 200 ribu"');
  }
}

function autoResizeTA(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 80) + 'px';
}

function useSuggestion(btn) {
  document.getElementById('chat-input').value = btn.textContent;
  sendChat();
}

function addUserBubble(text) {
  const el = document.createElement('div');
  el.className = 'chat-bubble user';
  el.textContent = text;
  document.getElementById('chat-history').appendChild(el);
  scrollChat();
}

function addBotBubble(text, html) {
  const el = document.createElement('div');
  el.className = 'chat-bubble bot';
  if (html) el.innerHTML = html;
  else { el.style.whiteSpace = 'pre-line'; el.textContent = text; }
  document.getElementById('chat-history').appendChild(el);
  scrollChat();
  return el;
}

function addErrorBubble(text) {
  const el = document.createElement('div');
  el.className = 'chat-bubble error';
  el.textContent = text;
  document.getElementById('chat-history').appendChild(el);
  scrollChat();
}

function scrollChat() {
  const h = document.getElementById('chat-history');
  setTimeout(() => h.scrollTop = h.scrollHeight, 50);
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  addUserBubble(text);

  // Sedikit delay biar berasa natural
  setTimeout(() => {
    const result = parseTransactionRuleBase(text);
    if (result.type === 'transaction') {
      showTxConfirmation(result);
    } else if (result.type === 'debt') {
      showDebtConfirmation(result);
    } else {
      addErrorBubble(result.message || 'Tidak bisa memahami. Coba: "beli makan 20rb" atau "terima transfer 1jt".');
    }
  }, 180);
}

function showTxConfirmation(result) {
  const typeLabel = result.txType === 'income' ? 'Pemasukan' : 'Pengeluaran';
  const sign      = result.txType === 'income' ? '+' : '-';
  const resultJSON = JSON.stringify(result).replace(/"/g, '&quot;');
  const html = `
    <div style="font-size:13px;margin-bottom:6px">Saya tangkap transaksi ini:</div>
    <div class="chat-tx-card">
      <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em">${typeLabel}</div>
      <div class="amount ${result.txType}">${sign}${fmt(result.amount)}</div>
      <div style="font-size:12px;color:var(--text2)">📁 ${result.category}</div>
      <div style="font-size:12px;color:var(--text2);margin-top:2px">📝 ${result.note}</div>
      <div style="font-size:12px;color:var(--text3);margin-top:2px">📅 ${today()}</div>
      <div class="chat-confirm-row">
        <button class="btn-confirm-yes" onclick="confirmTx(${resultJSON})">✓ Simpan</button>
        <button class="btn-confirm-no" onclick="cancelTx()">✗ Batal</button>
      </div>
    </div>`;
  addBotBubble('', html);
}

function showDebtConfirmation(result) {
  const typeLabel = result.debtType === 'piutang' ? 'Piutang (orang hutang ke saya)' : 'Hutang (saya hutang ke orang)';
  const resultJSON = JSON.stringify(result).replace(/"/g, '&quot;');
  const html = `
    <div style="font-size:13px;margin-bottom:6px">Saya tangkap hutang/piutang:</div>
    <div class="chat-tx-card">
      <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em">${typeLabel}</div>
      <div class="amount ${result.debtType === 'piutang' ? 'income' : 'expense'}">${fmt(result.amount)}</div>
      <div style="font-size:12px;color:var(--text2)">👤 ${result.name}</div>
      <div style="font-size:12px;color:var(--text2);margin-top:2px">📝 ${result.note || '-'}</div>
      <div class="chat-confirm-row">
        <button class="btn-confirm-yes" onclick="confirmDebt(${resultJSON})">✓ Simpan</button>
        <button class="btn-confirm-no" onclick="cancelTx()">✗ Batal</button>
      </div>
    </div>`;
  addBotBubble('', html);
}

async function confirmTx(result) {
  const item = {
    type: result.txType, amount: result.amount, category: result.category,
    date: today(), note: result.note, createdAt: Date.now()
  };
  const id = await dbAdd('transactions', item);
  item.id = id;
  txs.unshift(item);
  txs.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  addBotBubble('✓ Tersimpan! ' + (result.txType==='income'?'Pemasukan':'Pengeluaran') + ' ' + fmt(result.amount) + ' dicatat.');
  renderDashboard();
  disableLastConfirmButtons();
}

async function confirmDebt(result) {
  const item = {
    type: result.debtType, name: result.name, amount: result.amount,
    date: today(), note: result.note || '', paid: 0, createdAt: Date.now()
  };
  const id = await dbAdd('debts', item);
  item.id = id;
  debts.unshift(item);
  addBotBubble('✓ Tersimpan! ' + (result.debtType==='piutang'?'Piutang':'Hutang') + ' dengan ' + result.name + ' ' + fmt(result.amount) + ' dicatat.');
  renderDebtSummary();
  disableLastConfirmButtons();
}

function cancelTx() {
  disableLastConfirmButtons();
  addBotBubble('Oke, dibatalkan. Coba ketik ulang ya.');
}

function disableLastConfirmButtons() {
  const rows = document.querySelectorAll('.chat-confirm-row');
  if (rows.length) {
    const last = rows[rows.length - 1];
    last.querySelectorAll('button').forEach(b => { b.disabled = true; b.style.opacity = '0.4'; });
  }
}

// ─── Voice Input ──────────────────────────────────────────────
function toggleVoice() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    toast('⚠ Voice input butuh Chrome / browser berbasis Chromium.');
    return;
  }
  isRecording ? stopRecording() : startRecording();
}

function startRecording() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'id-ID';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    isRecording = true;
    document.getElementById('voice-btn').classList.add('voice-recording');
    toast('🎙 Sedang mendengarkan…', 8000);
  };
  recognition.onresult = e => {
    const transcript = e.results[0][0].transcript;
    document.getElementById('chat-input').value = transcript;
    stopRecording();
    sendChat();
  };
  recognition.onerror = e => {
    stopRecording();
    if (e.error !== 'aborted') toast('⚠ ' + e.error);
  };
  recognition.onend = () => stopRecording();
  recognition.start();
}

function stopRecording() {
  isRecording = false;
  document.getElementById('voice-btn').classList.remove('voice-recording');
  if (recognition) { try { recognition.stop(); } catch(e){} recognition = null; }
}
