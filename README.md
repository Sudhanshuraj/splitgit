# ⑂ SplitGit

> Expense splitting powered entirely by GitHub. No servers, no database, no DevOps.

SplitGit is a PWA (installable on iPhone, Android, and desktop) that lets you split expenses with friends — like Splitwise, but your data lives in private GitHub repositories that you own.

**Live app → [sudhanshuraj.github.io/splitgit](https://sudhanshuraj.github.io/splitgit)**

---

## How it works

Every concept maps 1:1 to GitHub:

| GitHub | SplitGit |
|---|---|
| Repository | Expense Group |
| Collaborator | Group Member |
| File Commit | Add Expense / Settlement |
| Commit History | Audit Trail |
| Repo Invite | Add Member to Group |
| GitHub OAuth | App Login |

Each group is a **private GitHub repo**. Inside it lives one file — `expenses.json` — an append-only log of every expense and settlement. Balances are always derived by replaying this log. Nothing is ever deleted or modified, only appended.

---

## Features

- **GitHub OAuth login** — no new account needed
- **Create expense groups** — each becomes a private repo
- **Add expenses** — equal split, recorded as a git commit forever
- **View balances** — computed live from the event log
- **Settle up** — record settlements, clear debts
- **Cross-group simplification** — owes B in one group, C owes you in another? The app finds the minimum transactions to clear everything across all groups
- **Installable PWA** — add to home screen on iPhone or Android
- **Tamper-evident** — every event has a SHA-256 hash; edits are detectable
- **Offline-ready** — queue expenses when offline, sync when back online

---

## Architecture

```
┌─────────────────────────────────────┐
│         SplitGit PWA                │
│   React 19 + TypeScript + Vite      │
│   installable on Android/iOS/Web    │
└──────────────┬──────────────────────┘
               │ GitHub REST API
       ┌───────┴────────┐
       │                │
  GitHub Repos     Cloudflare Worker
  (data + auth     (OAuth token exchange
   + access ctrl)   only — ~50 lines)
```

The Cloudflare Worker is the only non-GitHub piece. It does exactly one thing: exchange the OAuth `code` for an access token so the client secret never touches the browser.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Language | TypeScript 5 |
| Framework | React 19 |
| Build tool | Vite 6 |
| Styling | Tailwind CSS v4 |
| GitHub API | Octokit.js |
| Data fetching | TanStack Query v5 |
| State | Zustand |
| Offline storage | IndexedDB (idb) |
| PWA | Vite PWA Plugin |
| Hosting | GitHub Pages |
| Auth backend | Cloudflare Worker |

---

## Running locally

**Prerequisites:** Node 22+, a GitHub OAuth App, a Cloudflare Worker

```bash
git clone https://github.com/Sudhanshuraj/splitgit.git
cd splitgit
npm install
cp .env.example .env
```

Fill in `.env`:
```env
VITE_GITHUB_CLIENT_ID=your_github_oauth_app_client_id
VITE_OAUTH_WORKER_URL=https://your-worker.workers.dev
```

```bash
npm run dev
# → http://localhost:5173
```

---

## Deploying your own instance

### 1. GitHub OAuth App

Go to [github.com/settings/developers](https://github.com/settings/developers) → New OAuth App:

- Homepage URL: `https://YOUR_USERNAME.github.io/splitgit`
- Callback URL: `https://YOUR_USERNAME.github.io/splitgit/auth/callback`

### 2. Cloudflare Worker

```bash
cd worker
# Edit wrangler.toml — set GITHUB_CLIENT_ID and ALLOWED_ORIGIN
wrangler login
wrangler secret put GITHUB_CLIENT_SECRET
wrangler deploy
```

### 3. GitHub repo secrets

Go to your repo → Settings → Secrets and variables → Actions:

- `VITE_GITHUB_CLIENT_ID` — your OAuth App client ID
- `VITE_OAUTH_WORKER_URL` — your Cloudflare Worker URL

### 4. Enable GitHub Pages

Repo → Settings → Pages → Source: **GitHub Actions**

Every push to `main` auto-deploys via the included workflow.

---

## Project structure

```
splitgit/
  src/
    pages/
      Home.tsx          ← login
      Groups.tsx        ← all groups
      Group.tsx         ← single group detail + history
      AddExpense.tsx    ← add expense form
      Settle.tsx        ← per-group settle
      GlobalSettle.tsx  ← cross-group simplified settle
    lib/
      github.ts         ← GitHub API wrapper
      eventLog.ts       ← read/write expenses.json
      balances.ts       ← compute balances + cross-group simplification
      hash.ts           ← SHA-256 tamper detection
      offline.ts        ← IndexedDB offline queue
    store/
      auth.ts           ← Zustand auth store
    types/
      index.ts          ← all TypeScript types
  worker/
    index.js            ← Cloudflare Worker (OAuth exchange)
    wrangler.toml       ← Worker config
  .github/
    workflows/
      deploy.yml        ← auto-deploy to GitHub Pages
```

---

## Roadmap

- [x] GitHub OAuth login
- [x] Create groups / invite members
- [x] Add expenses (equal split)
- [x] View balances
- [x] Settle up
- [x] Cross-group simplification
- [x] Installable PWA
- [ ] Exact + percentage splits
- [ ] Offline expense creation + background sync
- [ ] Tamper detection UI
- [ ] Push notifications for new expenses
- [ ] Multi-currency conversion

---

## License

MIT
