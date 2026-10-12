// db.js - data layer for TallyUp.
//
// Uses better-sqlite3 if the native module is available. If it cannot be
// loaded (for example on a machine without a compiler), we fall back to a
// JSON-file data layer with identical behavior. The rest of the app only
// talks to the exported helper functions, so either backend works.
//
// Tables:
//
//   users(id, name, email UNIQUE, salt, hash, created_at)
//   sessions(token UNIQUE, user_id, created_at)      - server-side tokens
//   transactions(id, user_id, type, amount, category, date, note, created_at)

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'tallyup.db');
const JSON_FILE = path.join(__dirname, 'tallyup-data.json');

let mode = 'json';       // 'sqlite' or 'json'
let db = null;           // better-sqlite3 instance
let store = null;        // JSON fallback store

// ---------- Try SQLite first ----------
try {
  const Database = require('better-sqlite3');
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('income','expense')),
      amount REAL NOT NULL CHECK (amount > 0),
      category TEXT NOT NULL,
      date TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
  `);
  mode = 'sqlite';
} catch (err) {
  console.warn('[db] better-sqlite3 unavailable (%s); using JSON file store.', err.message);
}

// ---------- JSON fallback ----------
function loadJson() {
  if (!fs.existsSync(JSON_FILE)) {
    store = { users: [], sessions: [], transactions: [], seq: { user: 1, tx: 1 } };
    saveJson();
  } else {
    store = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  }
}
function saveJson() {
  fs.writeFileSync(JSON_FILE, JSON.stringify(store, null, 2));
}
if (mode === 'json') loadJson();

const now = () => new Date().toISOString();

// ---------- Users ----------
function createUser(name, email, salt, hash) {
  if (mode === 'sqlite') {
    const info = db.prepare(
      'INSERT INTO users (name, email, salt, hash, created_at) VALUES (?,?,?,?,?)'
    ).run(name, email, salt, hash, now());
    return getUserById(info.lastInsertRowid);
  }
  if (store.users.some(u => u.email === email)) {
    const e = new Error('duplicate'); e.code = 'DUPLICATE'; throw e;
  }
  const user = { id: store.seq.user++, name, email, salt, hash, created_at: now() };
  store.users.push(user); saveJson();
  return { ...user };
}
function getUserByEmail(email) {
  if (mode === 'sqlite') return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
  return store.users.find(u => u.email === email) || null;
}
function getUserById(id) {
  if (mode === 'sqlite') return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  return store.users.find(u => u.id === id) || null;
}

// ---------- Sessions ----------
function createSession(userId, token) {
  if (mode === 'sqlite') {
    db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)')
      .run(token, userId, now());
    return;
  }
  store.sessions.push({ token, user_id: userId, created_at: now() }); saveJson();
}
function getSession(token) {
  if (mode === 'sqlite') return db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) || null;
  return store.sessions.find(s => s.token === token) || null;
}
function deleteSession(token) {
  if (mode === 'sqlite') {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token); return;
  }
  store.sessions = store.sessions.filter(s => s.token !== token); saveJson();
}

// ---------- Transactions ----------
function createTransaction(userId, { type, amount, category, date, note }) {
  if (mode === 'sqlite') {
    const info = db.prepare(
      'INSERT INTO transactions (user_id, type, amount, category, date, note, created_at) VALUES (?,?,?,?,?,?,?)'
    ).run(userId, type, amount, category, date, note || '', now());
    return getTransaction(info.lastInsertRowid, userId);
  }
  const tx = {
    id: store.seq.tx++, user_id: userId, type, amount, category,
    date, note: note || '', created_at: now()
  };
  store.transactions.push(tx); saveJson();
  return { ...tx };
}
function listTransactions(userId, filters = {}) {
  if (mode === 'sqlite') {
    let sql = 'SELECT * FROM transactions WHERE user_id = ?';
    const params = [userId];
    if (filters.type) { sql += ' AND type = ?'; params.push(filters.type); }
    if (filters.category) { sql += ' AND category = ?'; params.push(filters.category); }
    if (filters.from) { sql += ' AND date >= ?'; params.push(filters.from); }
    if (filters.to) { sql += ' AND date <= ?'; params.push(filters.to); }
    sql += ' ORDER BY date DESC, id DESC';
    return db.prepare(sql).all(...params);
  }
  return store.transactions
    .filter(t => t.user_id === userId)
    .filter(t => !filters.type || t.type === filters.type)
    .filter(t => !filters.category || t.category === filters.category)
    .filter(t => !filters.from || t.date >= filters.from)
    .filter(t => !filters.to || t.date <= filters.to)
    .sort((a, b) => (b.date.localeCompare(a.date) || b.id - a.id))
    .map(t => ({ ...t }));
}
function getTransaction(id, userId) {
  if (mode === 'sqlite') {
    return db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(id, userId) || null;
  }
  return store.transactions.find(t => t.id === Number(id) && t.user_id === userId) || null;
}
function updateTransaction(id, userId, { type, amount, category, date, note }) {
  if (mode === 'sqlite') {
    const info = db.prepare(
      'UPDATE transactions SET type=?, amount=?, category=?, date=?, note=? WHERE id=? AND user_id=?'
    ).run(type, amount, category, date, note || '', id, userId);
    if (!info.changes) return null;
    return getTransaction(id, userId);
  }
  const tx = store.transactions.find(t => t.id === Number(id) && t.user_id === userId);
  if (!tx) return null;
  Object.assign(tx, { type, amount, category, date, note: note || '' });
  saveJson(); return { ...tx };
}
function deleteTransaction(id, userId) {
  if (mode === 'sqlite') {
    return db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  }
  const before = store.transactions.length;
  store.transactions = store.transactions.filter(t => !(t.id === Number(id) && t.user_id === userId));
  if (store.transactions.length !== before) saveJson();
  return store.transactions.length !== before;
}

// ---------- Summary / dashboard ----------
function getSummary(userId) {
  const txs = listTransactions(userId);
  let totalIncome = 0, totalExpenses = 0;
  const byCategory = {};
  const monthly = {}; // 'YYYY-MM' -> { income, expense }

  for (const t of txs) {
    if (t.type === 'income') totalIncome += t.amount; else totalExpenses += t.amount;
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    const month = t.date.slice(0, 7);
    if (!monthly[month]) monthly[month] = { income: 0, expense: 0 };
    monthly[month][t.type === 'income' ? 'income' : 'expense'] += t.amount;
  }

  // Last 6 calendar months, oldest first.
  const months = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = m.toISOString().slice(0, 7);
    months.push({ month: key, income: monthly[key] ? monthly[key].income : 0, expense: monthly[key] ? monthly[key].expense : 0 });
  }

  const round = n => Math.round(n * 100) / 100;
  return {
    totalIncome: round(totalIncome),
    totalExpenses: round(totalExpenses),
    balance: round(totalIncome - totalExpenses),
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, round(v)])),
    monthly: months.map(m => ({ ...m, income: round(m.income), expense: round(m.expense) }))
  };
}

module.exports = {
  mode,
  createUser, getUserByEmail, getUserById,
  createSession, getSession, deleteSession,
  createTransaction, listTransactions, getTransaction, updateTransaction, deleteTransaction,
  getSummary
};
