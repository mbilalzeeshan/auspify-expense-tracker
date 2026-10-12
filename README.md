# TallyUp - Personal Expense Tracker

TallyUp is a full stack expense tracking web app built for the **Auspify Technologies Full Stack Development internship** (task: expense-tracker). Users create an account, log income and expenses, filter their history, and see a dashboard with totals, a category breakdown, and monthly trends.

## Features

- **User authentication**: register and login. Passwords are hashed with salted scrypt (node:crypto, per-user random salt). Login issues a random session token stored server-side; protected routes require it as `Authorization: Bearer <token>`. A logout endpoint invalidates the token.
- **Transaction CRUD**: income/expense records with amount, category, date, and note. Users only ever see and change their own data.
- **Filters**: list transactions filtered by type, category, and date range.
- **Dashboard API and UI**: total income, total expenses, balance, per-category totals (CSS bar chart), and income vs expenses for the last 6 months (CSS grouped bars, no chart libraries).
- **Frontend SPA**: login/register screens, dashboard cards, transaction list with filters, add/edit modal. Token kept in localStorage. Works fully offline, no CDN or external dependencies.
- **Seeded demo data**: a demo account with 26 realistic transactions across the past 3 months on first run.

## Tech stack

- Backend: Node.js + Express (serves the REST API and the static frontend from `public/`)
- Persistence: SQLite via `better-sqlite3` (optional dependency). If the native module cannot build in the environment, the app automatically falls back to a clean JSON-file store (`tallyup-data.json`) with identical API behavior. This is what happens in restricted sandboxes where node-gyp cannot extract headers; see `db.js`.
- Frontend: vanilla HTML/CSS/JS, hand-written CSS, system fonts only, zero network dependencies.
- Auth: salted scrypt password hashing + random Bearer tokens stored server-side.

## Setup

Requires Node.js 16+.

```bash
npm install
npm start
```

The server listens on `process.env.PORT` or **3002** by default: http://localhost:3002

## Demo credentials

- Email: `demo@example.com`
- Password: `demo123`

The demo user is created automatically on first run with realistic seed data.

## API endpoints

All endpoints except register/login return 401 when the `Authorization: Bearer <token>` header is missing or invalid.

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | /api/register | Create account. Body: `{name, email, password}`. Returns `{user, token}` | No |
| POST | /api/login | Login. Body: `{email, password}`. Returns `{user, token}` | No |
| POST | /api/logout | Invalidate the current token | Yes |
| GET | /api/me | Current user `{user}` | Yes |
| GET | /api/categories | Allowed category list | Yes |
| GET | /api/transactions | List own transactions. Query filters: `type=income\|expense`, `category=`, `from=YYYY-MM-DD`, `to=YYYY-MM-DD` | Yes |
| POST | /api/transactions | Create transaction. Body: `{type, amount, category, date, note}` | Yes |
| PUT | /api/transactions/:id | Update own transaction | Yes |
| DELETE | /api/transactions/:id | Delete own transaction | Yes |
| GET | /api/summary | `{totalIncome, totalExpenses, balance, byCategory, monthly}` for the last 6 months | Yes |

Transaction validation: `type` must be `income` or `expense`; `amount` a positive number; `category` one of Food, Transport, Rent, Utilities, Entertainment, Salary, Freelance, Shopping, Health, Other; `date` in `YYYY-MM-DD` format.

## Project structure

```
expense-tracker/
  server.js          Express app: routes, seeding, static file serving
  db.js              Data layer: better-sqlite3, JSON fallback, queries
  auth.js            scrypt hashing, token sessions, requireAuth middleware
  package.json       Deps (express, better-sqlite3) and the npm start script
  README.md
  .gitignore         Ignores node_modules and the db files (*.db, *.sqlite*)
  public/
    index.html       SPA markup: auth screens, dashboard, modal
    styles.css       Custom CSS, pine green + gold identity, responsive
    app.js           Frontend logic: auth, dashboard render, CRUD, filters
```

## Notes

- Demo credentials are seeded for review purposes only; change them before any real deployment.
- The app is responsive down to 375px mobile width.
