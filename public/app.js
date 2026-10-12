// app.js - TallyUp frontend logic.
//
// The token returned by login/register is kept in localStorage and sent as
// "Authorization: Bearer <token>" on every protected API call. 401 responses
// always bounce the user back to the login screen.

const TOKEN_KEY = 'tallyup_token';
const USER_KEY = 'tallyup_user';

const $ = id => document.getElementById(id);

const state = {
  categories: [],
  filters: { type: '', category: '', from: '', to: '' },
  modalType: 'expense',
};

// ----------------------------- API helpers -----------------------------
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
  };
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401) {
    // Token missing, invalid, or logged out elsewhere.
    logoutLocal();
    return { _unauthorized: true };
  }
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Public (unauthenticated) call for login/register.
async function apiPublic(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ----------------------------- Auth flow -----------------------------
function enterApp(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
  const badge = $('userBadge');
  badge.textContent = user.name;
  badge.classList.remove('hidden');
  refresh();
}

function logoutLocal() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  $('authView').classList.remove('hidden');
  $('appView').classList.add('hidden');
  $('logoutBtn').classList.add('hidden');
  $('userBadge').classList.add('hidden');
}

async function handleLogout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (_) {
    // Even if the request fails, clear local state.
  }
  logoutLocal();
}

$('tabLogin').addEventListener('click', () => switchTab(true));
$('tabRegister').addEventListener('click', () => switchTab(false));

function switchTab(toLogin) {
  $('tabLogin').classList.toggle('active', toLogin);
  $('tabRegister').classList.toggle('active', !toLogin);
  $('loginForm').classList.toggle('hidden', !toLogin);
  $('registerForm').classList.toggle('hidden', toLogin);
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    const data = await apiPublic('/api/login', {
      email: $('loginEmail').value.trim(),
      password: $('loginPassword').value,
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    enterApp(data.user);
  } catch (err) {
    $('loginError').textContent = err.message;
  }
});

$('registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('regError').textContent = '';
  try {
    const data = await apiPublic('/api/register', {
      name: $('regName').value.trim(),
      email: $('regEmail').value.trim(),
      password: $('regPassword').value,
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    enterApp(data.user);
  } catch (err) {
    $('regError').textContent = err.message;
  }
});

$('logoutBtn').addEventListener('click', handleLogout);

// ----------------------------- Data loading -----------------------------
async function refresh() {
  const [summary, cats, list] = await Promise.all([
    api('/api/summary'),
    api('/api/categories'),
    api('/api/transactions' + buildQuery()),
  ]);
  if (summary._unauthorized) return;
  state.categories = cats.categories;
  fillCategorySelects();
  renderSummary(summary);
  renderTransactions(list.transactions);
}

function buildQuery() {
  const p = new URLSearchParams();
  if (state.filters.type) p.set('type', state.filters.type);
  if (state.filters.category) p.set('category', state.filters.category);
  if (state.filters.from) p.set('from', state.filters.from);
  if (state.filters.to) p.set('to', state.filters.to);
  const q = p.toString();
  return q ? '?' + q : '';
}

function fillCategorySelects() {
  const opts = state.categories.map(c => `<option value="${c}">${c}</option>`).join('');
  $('filterCategory').innerHTML = '<option value="">All categories</option>' + opts;
  $('filterCategory').value = state.filters.category;
  $('txCategory').innerHTML = opts;
}

const fmt = n => 'Rs ' + Number(n).toLocaleString('en-PK', { maximumFractionDigits: 2 });

function renderSummary(s) {
  $('totalIncome').textContent = fmt(s.totalIncome);
  $('totalExpenses').textContent = fmt(s.totalExpenses);
  $('balance').textContent = fmt(s.balance);

  // Category breakdown, biggest first.
  const entries = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 0;
  $('categoryBars').innerHTML = entries.length
    ? entries.map(([name, total]) => `
        <div class="bar-row">
          <div class="bar-head"><span class="bar-name">${escapeHtml(name)}</span><span class="bar-amt">${fmt(total)}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${max ? Math.round((total / max) * 100) : 0}%"></div></div>
        </div>`).join('')
    : '<p class="muted">No data yet.</p>';

  // Monthly bars: last 6 months, income vs expense per month.
  const maxM = Math.max(1, ...s.monthly.map(m => Math.max(m.income, m.expense)));
  $('monthlyBars').innerHTML = s.monthly.map(m => {
    const label = new Date(m.month + '-01').toLocaleString('en', { month: 'short' });
    return `
      <div class="month-col">
        <div class="month-pair" title="${label}: income ${fmt(m.income)}, expenses ${fmt(m.expense)}">
          <div class="month-bar in" style="height:${Math.round((m.income / maxM) * 100)}%"></div>
          <div class="month-bar out" style="height:${Math.round((m.expense / maxM) * 100)}%"></div>
        </div>
        <div class="month-label">${label}</div>
      </div>`;
  }).join('');
}

function renderTransactions(txs) {
  const list = $('txList');
  $('txEmpty').classList.toggle('hidden', txs.length > 0);
  list.innerHTML = txs.map(t => `
    <div class="tx-row" data-id="${t.id}">
      <span class="tx-dot ${t.type}" aria-hidden="true"></span>
      <div class="tx-main">
        <div class="tx-title">${escapeHtml(t.category)}${t.note ? ' - ' + escapeHtml(t.note) : ''}</div>
        <div class="tx-sub">${escapeHtml(t.date)} &middot; ${t.type === 'income' ? 'Income' : 'Expense'}</div>
      </div>
      <div class="tx-amount ${t.type}">${t.type === 'income' ? '+' : '-'} ${fmt(t.amount)}</div>
      <div class="tx-actions">
        <button class="btn btn-ghost" data-act="edit">Edit</button>
        <button class="btn btn-ghost" data-act="del">Delete</button>
      </div>
    </div>`).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// Edit / delete use event delegation on the list.
$('txList').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const row = btn.closest('.tx-row');
  const id = row.dataset.id;
  if (btn.dataset.act === 'del') {
    if (!confirm('Delete this transaction?')) return;
    try {
      await api('/api/transactions/' + id, { method: 'DELETE' });
      refresh();
    } catch (err) { alert(err.message); }
  } else {
    openModalForEdit(id);
  }
});

// ----------------------------- Filters -----------------------------
$('filterType').addEventListener('change', e => { state.filters.type = e.target.value; refresh(); });
$('filterCategory').addEventListener('change', e => { state.filters.category = e.target.value; refresh(); });
$('filterFrom').addEventListener('change', e => { state.filters.from = e.target.value; refresh(); });
$('filterTo').addEventListener('change', e => { state.filters.to = e.target.value; refresh(); });
$('clearFilters').addEventListener('click', () => {
  state.filters = { type: '', category: '', from: '', to: '' };
  $('filterType').value = '';
  $('filterCategory').value = '';
  $('filterFrom').value = '';
  $('filterTo').value = '';
  refresh();
});

// ----------------------------- Add/edit modal -----------------------------
function setModalType(kind) {
  state.modalType = kind;
  $('typeExpense').classList.toggle('active', kind === 'expense');
  $('typeIncome').classList.toggle('active', kind === 'income');
}
$('typeExpense').addEventListener('click', () => setModalType('expense'));
$('typeIncome').addEventListener('click', () => setModalType('income'));

$('addBtn').addEventListener('click', () => {
  $('modalTitle').textContent = 'Add transaction';
  $('txForm').reset();
  $('txId').value = '';
  $('txDate').value = new Date().toISOString().slice(0, 10);
  $('txError').textContent = '';
  setModalType('expense');
  $('modal').classList.remove('hidden');
});

async function openModalForEdit(id) {
  try {
    const list = await api('/api/transactions' + buildQuery());
    const tx = list.transactions.find(t => String(t.id) === String(id));
    if (!tx) { alert('Transaction not found'); return; }
    $('modalTitle').textContent = 'Edit transaction';
    $('txId').value = tx.id;
    $('txAmount').value = tx.amount;
    $('txCategory').value = tx.category;
    $('txDate').value = tx.date;
    $('txNote').value = tx.note || '';
    $('txError').textContent = '';
    setModalType(tx.type);
    $('modal').classList.remove('hidden');
  } catch (err) { alert(err.message); }
}

$('modalClose').addEventListener('click', () => $('modal').classList.add('hidden'));
$('modal').addEventListener('click', e => {
  if (e.target === $('modal')) $('modal').classList.add('hidden');
});

$('txForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('txError').textContent = '';
  const payload = {
    type: state.modalType,
    amount: Number($('txAmount').value),
    category: $('txCategory').value,
    date: $('txDate').value,
    note: $('txNote').value.trim(),
  };
  try {
    if ($('txId').value) {
      await api('/api/transactions/' + $('txId').value, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/transactions', { method: 'POST', body: JSON.stringify(payload) });
    }
    $('modal').classList.add('hidden');
    refresh();
  } catch (err) {
    $('txError').textContent = err.message;
  }
});

// ----------------------------- Init -----------------------------
(function init() {
  const token = localStorage.getItem(TOKEN_KEY);
  const user = localStorage.getItem(USER_KEY);
  if (token && user) {
    try {
      enterApp(JSON.parse(user));
    } catch (_) {
      logoutLocal();
    }
  }
})();
