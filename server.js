// server.js - TallyUp expense tracker backend.
//
// Express app serving the REST API and the static frontend in public/.
// Run with: npm install && npm start   (PORT env var or 3002 default)

const express = require('express');
const path = require('path');
const db = require('./db');
const { hashPassword, verifyPassword, issueToken, requireAuth } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------- auth ----

// POST /api/register  { name, email, password } -> 201 { user, token }
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }
  if (db.getUserByEmail(email)) {
    return res.status(409).json({ error: 'an account with that email already exists' });
  }
  const { salt, hash } = hashPassword(password);
  try {
    const user = db.createUser(name.trim(), email.trim().toLowerCase(), salt, hash);
    const token = issueToken(user.id);
    res.status(201).json({ user: publicUser(user), token });
  } catch (err) {
    if (err.code === 'DUPLICATE') {
      return res.status(409).json({ error: 'an account with that email already exists' });
    }
    throw err;
  }
});

// POST /api/login  { email, password } -> 200 { user, token }
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  const user = db.getUserByEmail(email.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  const token = issueToken(user.id);
  res.json({ user: publicUser(user), token });
});

// POST /api/logout  (auth) -> 200 { ok: true }, token invalidated
app.post('/api/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization.slice('Bearer '.length);
  db.deleteSession(token);
  res.json({ ok: true });
});

// GET /api/me (auth) -> current user
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email };
}

// ---------------------------------------------------- transactions ----

const CATEGORIES = ['Food', 'Transport', 'Rent', 'Utilities', 'Entertainment', 'Salary', 'Freelance', 'Shopping', 'Health', 'Other'];

function validateTx(body) {
  const errors = [];
  if (!['income', 'expense'].includes(body.type)) errors.push('type must be income or expense');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push('amount must be a positive number');
  if (!body.category || !CATEGORIES.includes(body.category)) errors.push('category must be one of: ' + CATEGORIES.join(', '));
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || Number.isNaN(Date.parse(body.date))) {
    errors.push('date must be YYYY-MM-DD');
  }
  return errors;
}

// GET /api/transactions?type=&category=&from=&to=  (auth, own data only)
app.get('/api/transactions', requireAuth, (req, res) => {
  const filters = {};
  if (req.query.type) filters.type = req.query.type;
  if (req.query.category) filters.category = req.query.category;
  if (req.query.from) filters.from = req.query.from;
  if (req.query.to) filters.to = req.query.to;
  res.json({ transactions: db.listTransactions(req.user.id, filters) });
});

// POST /api/transactions  (auth)
app.post('/api/transactions', requireAuth, (req, res) => {
  const errors = validateTx(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const { type, amount, category, date, note } = req.body;
  const tx = db.createTransaction(req.user.id, {
    type, amount: Number(amount), category, date, note: (note || '').trim()
  });
  res.status(201).json({ transaction: tx });
});

// PUT /api/transactions/:id  (auth, own data only)
app.put('/api/transactions/:id', requireAuth, (req, res) => {
  const errors = validateTx(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const { type, amount, category, date, note } = req.body;
  const tx = db.updateTransaction(req.params.id, req.user.id, {
    type, amount: Number(amount), category, date, note: (note || '').trim()
  });
  if (!tx) return res.status(404).json({ error: 'transaction not found' });
  res.json({ transaction: tx });
});

// DELETE /api/transactions/:id  (auth, own data only)
app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const ok = db.deleteTransaction(req.params.id, req.user.id);
  if (!ok) return res.status(404).json({ error: 'transaction not found' });
  res.json({ ok: true });
});

// GET /api/categories (auth) -> the allowed category list
app.get('/api/categories', requireAuth, (req, res) => {
  res.json({ categories: CATEGORIES });
});

// ------------------------------------------------------ summary ----

// GET /api/summary (auth) -> totals, per-category, last 6 months
app.get('/api/summary', requireAuth, (req, res) => {
  res.json(db.getSummary(req.user.id));
});

// Fallback: SPA handles unknown routes under /, API 404s for unknown API.
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

// ------------------------------------------------------ seed ----
// On first run, create a demo account with ~25 realistic transactions
// across the past 3 months so the dashboard has something to show.

function seedDemo() {
  if (db.getUserByEmail('demo@example.com')) return;
  const { salt, hash } = hashPassword('demo123');
  const user = db.createUser('Demo User', 'demo@example.com', salt, hash);
  const id = user.id;

  const iso = d => d.toISOString().slice(0, 10);
  const monthsAgo = (m, day) => {
    const d = new Date();
    return iso(new Date(d.getFullYear(), d.getMonth() - m, Math.min(day, 28)));
  };

  const seed = [
    // Income
    ['income', 95000, 'Salary', monthsAgo(2, 5), 'Monthly salary'],
    ['income', 95000, 'Salary', monthsAgo(1, 5), 'Monthly salary'],
    ['income', 95000, 'Salary', monthsAgo(0, 5), 'Monthly salary'],
    ['income', 12000, 'Freelance', monthsAgo(2, 14), 'Logo design for a local bakery'],
    ['income', 8500, 'Freelance', monthsAgo(1, 21), 'Bug fixes on a client website'],
    ['income', 15000, 'Freelance', monthsAgo(0, 11), 'Landing page for a startup'],
    // Rent
    ['expense', 28000, 'Rent', monthsAgo(2, 1), 'Monthly apartment rent'],
    ['expense', 28000, 'Rent', monthsAgo(1, 1), 'Monthly apartment rent'],
    ['expense', 28000, 'Rent', monthsAgo(0, 1), 'Monthly apartment rent'],
    // Food / groceries
    ['expense', 3200, 'Food', monthsAgo(2, 8), 'Weekly groceries'],
    ['expense', 1450, 'Food', monthsAgo(2, 18), 'Dinner with friends'],
    ['expense', 3800, 'Food', monthsAgo(1, 9), 'Weekly groceries'],
    ['expense', 950, 'Food', monthsAgo(1, 23), 'Lunch at the office'],
    ['expense', 2900, 'Food', monthsAgo(0, 7), 'Weekly groceries'],
    ['expense', 1750, 'Food', monthsAgo(0, 16), 'Biryani night'],
    // Transport
    ['expense', 600, 'Transport', monthsAgo(2, 12), 'Careem ride to the market'],
    ['expense', 2400, 'Transport', monthsAgo(1, 6), 'Fuel refill'],
    ['expense', 500, 'Transport', monthsAgo(0, 9), 'Bus fare for the week'],
    // Utilities
    ['expense', 4100, 'Utilities', monthsAgo(2, 20), 'Electricity bill'],
    ['expense', 1800, 'Utilities', monthsAgo(1, 22), 'Internet bill'],
    ['expense', 3900, 'Utilities', monthsAgo(0, 19), 'Electricity bill'],
    // Entertainment, shopping, health
    ['expense', 2200, 'Entertainment', monthsAgo(1, 27), 'Cinema with family'],
    ['expense', 4500, 'Shopping', monthsAgo(0, 13), 'New pair of running shoes'],
    ['expense', 1200, 'Health', monthsAgo(2, 25), 'Pharmacy, flu medicine'],
    ['expense', 7500, 'Shopping', monthsAgo(1, 15), 'Winter jacket'],
    ['expense', 2000, 'Other', monthsAgo(0, 21), 'Gift for a cousin'],
  ];

  for (const [type, amount, category, date, note] of seed) {
    db.createTransaction(id, { type, amount, category, date, note });
  }
  console.log('[seed] demo user created: demo@example.com / demo123');
}
seedDemo();

// ------------------------------------------------------ start ----
app.listen(PORT, () => {
  console.log(`TallyUp running at http://localhost:${PORT} (db mode: ${db.mode})`);
});
