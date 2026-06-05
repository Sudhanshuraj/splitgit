# ⑂ SplitGit

> Split expenses with friends. Your data stays in your GitHub account — no third-party servers, no subscriptions, no ads.

**→ [Open SplitGit](https://sudhanshuraj.github.io/splitgit)**

---

# For Users

## What is it?

SplitGit is a free expense-splitting app (like Splitwise) that you log into with your existing GitHub account. Every expense is stored as a commit in a private repository that only you and your group members can see — no third-party database, no subscription, no ads.

## Getting started

1. Open the app at [sudhanshuraj.github.io/splitgit](https://sudhanshuraj.github.io/splitgit)
2. Click **Continue with GitHub** and authorize the app
3. Tap **New Group** and give it a name (e.g. "Goa Trip", "Flatmates")
4. **Invite members** by their GitHub username
5. Start adding expenses

## Features

**Expenses**
- Add an expense, pick who paid, split equally among any subset of the group
- Tag expenses (Food, Transport, Hotel, etc.) — tags are configurable per group, and you can make certain tags mandatory
- Edit any expense — the original is preserved in history, corrections are linked to it

**Balances & Settling**
- See who owes whom at a glance
- Record a settlement when someone pays back
- Cross-group simplification: if you share debts across multiple groups, SplitGit finds the minimum number of payments to clear everything globally

**Analytics**
- Pie chart of spend by category
- Filter by This Month / Last Month / This Year / Custom date range

**Offline & installable**
- Add expenses without internet — they sync automatically when you reconnect
- iPhone: tap Share → Add to Home Screen
- Android: tap the install prompt in Chrome

## Your data

Every group is a **private GitHub repository** in your own account. Expenses are stored as commits — you can browse the full history directly on GitHub at any time. Nothing is stored on any server other than GitHub.

The only requirement is a free GitHub account.

---

# For Developers

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

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript 5 |
| Framework | React 19 |
| Build tool | Vite 6 |
| Styling | Tailwind CSS v4 |
| GitHub API | Octokit.js |
| Data fetching | TanStack Query v5 |
| State | Zustand |
| Offline cache | IndexedDB (idb) |
| PWA | vite-plugin-pwa |
| Hosting | GitHub Pages |
| Auth backend | Cloudflare Worker |

## Running locally

Prerequisites: Node 22+, a GitHub OAuth App, a Cloudflare Worker

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

## Deploying your own instance

**1. GitHub OAuth App**

Go to [github.com/settings/developers](https://github.com/settings/developers) → New OAuth App:
- Homepage URL: `https://YOUR_USERNAME.github.io/splitgit`
- Callback URL: `https://YOUR_USERNAME.github.io/splitgit/auth/callback`

**2. Cloudflare Worker**

```bash
cd worker
# Edit wrangler.toml — set GITHUB_CLIENT_ID and ALLOWED_ORIGIN
wrangler login
wrangler secret put GITHUB_CLIENT_SECRET
wrangler deploy
```

**3. GitHub repo secrets**

Repo → Settings → Secrets and variables → Actions:
- `VITE_GITHUB_CLIENT_ID` — your OAuth App client ID
- `VITE_OAUTH_WORKER_URL` — your Cloudflare Worker URL

**4. Enable GitHub Pages**

Repo → Settings → Pages → Source: **GitHub Actions**

Every push to `main` auto-deploys via the included workflow.

## Project structure

```
splitgit/
  src/
    pages/
      Home.tsx            ← login
      Groups.tsx          ← all groups
      Group.tsx           ← single group: balances, history, analytics
      AddExpense.tsx      ← add expense form
      EditExpense.tsx     ← edit expense (append-only correction commit)
      Settle.tsx          ← per-group settle
      GlobalSettle.tsx    ← cross-group simplified settle
      GroupSettings.tsx   ← tag management (owner only)
    components/
      Analytics.tsx       ← SVG pie chart + time range selector
    lib/
      github.ts           ← GitHub API wrapper
      eventLog.ts         ← read/write expenses.json (with IndexedDB cache)
      balances.ts         ← compute balances + cross-group simplification
      cache.ts            ← IndexedDB persistent cache
      hash.ts             ← SHA-256 tamper detection
      offline.ts          ← offline queue
    store/
      auth.ts             ← Zustand auth store
    types/
      index.ts            ← all TypeScript types
  worker/
    index.js              ← Cloudflare Worker (OAuth exchange, ~50 lines)
    wrangler.toml         ← Worker config
  .github/
    workflows/
      deploy.yml          ← auto-deploy to GitHub Pages
```

## License

MIT
