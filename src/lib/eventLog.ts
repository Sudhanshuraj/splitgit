/**
 * Read and write the append-only expenses.json event log.
 * Uses IndexedDB cache for instant loads — fetches from GitHub only when
 * the file SHA has changed since last visit.
 */

import { Octokit } from 'octokit'
import type { Event, Expense, Settlement, ExpenseDeletion, TagConfig, LedgerMember } from '../types'
import { getExpensesFile, updateExpensesFile, getGroupConfig, saveGroupConfig } from './github'
import { hashExpense, hashSettlement, hashDeletion } from './hash'
import { getCachedEvents, setCachedEvents, invalidateCachedEvents, invalidateCachedConfig } from './cache'
import type { ImportExpenseRow, ImportSettlementRow } from './importCsv'

import { v4 as uuidv4 } from 'uuid'

// ─── NDJSON helpers ───────────────────────────────────────────────────────────

/** Parse NDJSON: one JSON object per non-empty line */
function parseNDJSON(content: string): Event[] {
  return content
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as Event)
}

/** Serialize events to NDJSON: one JSON object per line, trailing newline */
function serializeNDJSON(events: Event[]): string {
  if (events.length === 0) return ''
  return events.map(e => JSON.stringify(e)).join('\n') + '\n'
}

// Bust the event cache so the next readEvents() fetches fresh from GitHub
async function invalidateCachedEventsForRetry(owner: string, repo: string): Promise<void> {
  await invalidateCachedEvents(owner, repo)
}

// ─── Read with cache ──────────────────────────────────────────────────────────

export async function readEvents(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<{ events: Event[]; sha: string }> {
  // 1. Fetch from GitHub (we need SHA to detect changes)
  const { content, sha } = await getExpensesFile(octokit, owner, repo)

  // 2. Check if cached SHA matches
  const cached = await getCachedEvents(owner, repo)
  if (cached && cached.sha === sha) {
    return { events: cached.events, sha }
  }

  // 3. SHA changed or no cache — parse
  const events = parseNDJSON(content)

  // Guard against GitHub's read-after-write lag: the event log is append-only,
  // so it can only grow. If a fetch comes back SHORTER than what we already have
  // locally, GitHub simply hasn't caught up yet — keep the newer local copy and
  // don't clobber it. (A genuine change from another device has >= our length.)
  if (cached && events.length < cached.events.length) {
    return { events: cached.events, sha: cached.sha }
  }

  await setCachedEvents(owner, repo, sha, events)
  return { events, sha }
}

/**
 * Read events from cache only — returns null if nothing cached yet.
 * Used to show instant data on first render while the network fetch runs.
 */
export async function readEventsCached(
  owner: string,
  repo: string
): Promise<{ events: Event[]; sha: string } | null> {
  const cached = await getCachedEvents(owner, repo)
  if (!cached) return null
  return { events: cached.events, sha: cached.sha }
}

// ─── Append event ─────────────────────────────────────────────────────────────

export interface WriteResult { events: Event[]; sha: string }

/**
 * Append one event in a single commit.
 * Fast path: use the locally cached events + sha (no read round-trip). Only if
 * GitHub rejects the sha (someone else wrote concurrently) do we re-read and
 * retry. Returns the updated events + the NEW file sha so callers can refresh
 * their in-memory cache instantly instead of re-fetching (which can be stale).
 */
async function appendEvent(
  octokit: Octokit,
  owner: string,
  repo: string,
  newEvent: Event,
  retries = 5
): Promise<WriteResult> {
  for (let attempt = 0; attempt < retries; attempt++) {
    let events: Event[]
    let sha: string
    const cached = attempt === 0 ? await getCachedEvents(owner, repo) : null
    if (cached) { events = cached.events; sha = cached.sha }
    else { const r = await readEvents(octokit, owner, repo); events = r.events; sha = r.sha }

    // Idempotency: if this exact event id is already in the log, the write
    // already landed (e.g. a retry after a lost response) — do not duplicate.
    if (events.some(e => e.id === newEvent.id)) {
      return { events, sha }
    }

    const updated = [...events, newEvent]
    try {
      const message =
        newEvent.type === 'EXPENSE'
          ? `expense: ${(newEvent as Expense).description} — ${(newEvent as Expense).amount} ${(newEvent as Expense).currency}`
          : newEvent.type === 'EXPENSE_DELETION'
          ? `delete: expense ${(newEvent as ExpenseDeletion).deletedId.slice(0, 8)}`
          : `settle: ${(newEvent as Settlement).from} → ${(newEvent as Settlement).to} — ${(newEvent as Settlement).amount}`
      const newSha = await updateExpensesFile(octokit, owner, repo, serializeNDJSON(updated), sha, message)
      await setCachedEvents(owner, repo, newSha, updated)
      return { events: updated, sha: newSha }
    } catch (err: unknown) {
      // GitHub returns 409 for ref conflicts and 422 for SHA mismatches — both are retryable
      const msg = err instanceof Error ? err.message : ''
      const isRetryable = msg.includes('409') || msg.includes('422') || msg.includes('does not match')
      if (!isRetryable || attempt === retries - 1) throw err
      await invalidateCachedEventsForRetry(owner, repo)   // force fresh read next attempt
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)))
    }
  }
  throw new Error('appendEvent: exhausted retries')
}

/** Public wrapper: commit a pre-built event (used by optimistic writes). */
export async function appendOne(octokit: Octokit, owner: string, repo: string, event: Event): Promise<WriteResult> {
  return appendEvent(octokit, owner, repo, event)
}

// ─── Event builders (construct the event locally, incl. hash) ──────────────────

export async function buildExpense(input: CreateExpenseInput, supersedesId?: string): Promise<Expense> {
  const id = uuidv4()
  const createdAt = new Date().toISOString()
  const splitAmount = parseFloat((input.amount / input.participants.length).toFixed(2))
  const remainder = parseFloat((input.amount - splitAmount * input.participants.length).toFixed(2))
  const splits = input.participants.map((member, i) => ({
    member, amount: i === 0 ? parseFloat((splitAmount + remainder).toFixed(2)) : splitAmount
  }))
  const base = {
    id, type: 'EXPENSE' as const, description: input.description, amount: input.amount,
    currency: input.currency, paidBy: input.paidBy, splits, splitType: input.splitType,
    tags: input.tags, date: input.date, ...(supersedesId ? { supersedesId } : {}), createdAt
  }
  const hash = await hashExpense(base)
  return { ...base, hash }
}

export async function buildSettlement(input: CreateSettlementInput): Promise<Settlement> {
  const id = uuidv4()
  const createdAt = new Date().toISOString()
  const base = {
    id, type: 'SETTLEMENT' as const, from: input.from, to: input.to,
    amount: input.amount, currency: input.currency, note: input.note, createdAt
  }
  const hash = await hashSettlement(base)
  return { ...base, hash }
}

export async function buildDeletion(expenseId: string, deletedBy: string): Promise<ExpenseDeletion> {
  const id = uuidv4()
  const createdAt = new Date().toISOString()
  const base = { id, type: 'EXPENSE_DELETION' as const, deletedId: expenseId, deletedBy, createdAt }
  const hash = await hashDeletion(base)
  return { ...base, hash }
}

// ─── Edit event (append-only: adds an EDIT correction record) ─────────────────

/**
 * Editing in an append-only log works by appending a new corrected version
 * of the event and marking the original as superseded via `supersedesId`.
 * The UI always shows the latest version of each expense (by original id).
 * Git history still shows both commits — the original and the correction.
 */
export async function editExpense(
  octokit: Octokit,
  owner: string,
  repo: string,
  originalId: string,
  input: CreateExpenseInput
): Promise<WriteResult & { expense: Expense }> {
  const expense = await buildExpense(input, originalId)
  const res = await appendEvent(octokit, owner, repo, expense)
  return { ...res, expense }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CreateExpenseInput {
  description: string
  amount: number
  currency: string
  paidBy: number          // ledger member id
  participants: number[]  // ledger member ids
  splitType: 'equal'
  tags: string[]
  date: string  // YYYY-MM-DD
}

export async function addExpense(
  octokit: Octokit,
  owner: string,
  repo: string,
  input: CreateExpenseInput
): Promise<WriteResult & { expense: Expense }> {
  const expense = await buildExpense(input)
  const res = await appendEvent(octokit, owner, repo, expense)
  return { ...res, expense }
}

export interface CreateSettlementInput {
  from: number          // ledger member id (payer)
  to: number            // ledger member id (payee)
  amount: number
  currency: string
  note?: string
}

export async function addSettlement(
  octokit: Octokit,
  owner: string,
  repo: string,
  input: CreateSettlementInput
): Promise<WriteResult & { settlement: Settlement }> {
  const settlement = await buildSettlement(input)
  const res = await appendEvent(octokit, owner, repo, settlement)
  return { ...res, settlement }
}

// ─── Delete event (append-only: adds an EXPENSE_DELETION record) ──────────────

export async function deleteExpense(
  octokit: Octokit,
  owner: string,
  repo: string,
  expenseId: string,
  deletedBy: string
): Promise<WriteResult> {
  const deletion = await buildDeletion(expenseId, deletedBy)
  return appendEvent(octokit, owner, repo, deletion)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the effective list of expenses after applying edits and deletions.
 * - Deleted expenses are excluded entirely.
 * - For edited expenses, only the latest version is shown.
 */
// ─── Batch append (one commit for many events) ────────────────────────────────

async function appendEvents(
  octokit: Octokit,
  owner: string,
  repo: string,
  events: Event[],
  retries = 5
): Promise<WriteResult> {
  if (events.length === 0) { const r = await readEvents(octokit, owner, repo); return r }
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await invalidateCachedEventsForRetry(owner, repo)
    const { events: existing, sha } = await readEvents(octokit, owner, repo)
    const updated = [...existing, ...events]
    try {
      const newSha = await updateExpensesFile(
        octokit, owner, repo, serializeNDJSON(updated), sha,
        `import: ${events.length} event${events.length === 1 ? '' : 's'}`
      )
      await setCachedEvents(owner, repo, newSha, updated)
      return { events: updated, sha: newSha }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      const isRetryable = msg.includes('409') || msg.includes('422') || msg.includes('does not match')
      if (!isRetryable || attempt === retries - 1) throw err
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  throw new Error('appendEvents: exhausted retries')
}

// ─── CSV import ────────────────────────────────────────────────────────────────

export interface ImportPlan {
  expenses: ImportExpenseRow[]
  settlements: ImportSettlementRow[]
}

/**
 * Import parsed CSV rows into the group in a single commit.
 * Missing tags are created in config.json first (one config write), then all
 * expense + settlement events are appended chronologically in one commit.
 */
export async function importEvents(
  octokit: Octokit,
  owner: string,
  repo: string,
  plan: ImportPlan
): Promise<{ added: number; tagsCreated: string[]; membersCreated: string[] }> {
  const { config, sha: configSha } = await getGroupConfig(octokit, owner, repo)

  // 1a. Resolve / create tags by name
  const tags: TagConfig[] = [...config.tags]
  const tagByName = new Map(tags.map(t => [t.name.toLowerCase(), t]))
  const tagsCreated: string[] = []
  function tagId(name: string): string | undefined {
    const key = name.trim().toLowerCase()
    if (!key) return undefined
    let t = tagByName.get(key)
    if (!t) { t = { id: uuidv4(), name: name.trim() }; tags.push(t); tagByName.set(key, t); tagsCreated.push(t.name) }
    return t.id
  }
  for (const e of plan.expenses) if (e.tag) tagId(e.tag)

  // 1b. Resolve / create ledger members by name
  const members: LedgerMember[] = [...config.members]
  const memByName = new Map(members.map(m => [m.name.toLowerCase(), m]))
  const membersCreated: string[] = []
  let nextId = members.reduce((mx, m) => Math.max(mx, m.id), 0) + 1
  function memberId(name: string): number {
    const key = name.trim().toLowerCase()
    let m = memByName.get(key)
    if (!m) { m = { id: nextId++, name: name.trim() }; members.push(m); memByName.set(key, m); membersCreated.push(m.name) }
    return m.id
  }
  for (const e of plan.expenses) { memberId(e.paidBy); e.splits.forEach(s => memberId(s.username)) }
  for (const s of plan.settlements) { memberId(s.from); memberId(s.to) }

  if (tagsCreated.length > 0 || membersCreated.length > 0) {
    await saveGroupConfig(octokit, owner, repo, { version: 3, tags, members }, configSha)
    await invalidateCachedConfig(owner, repo)
  }

  // 2. Build events with numeric member ids
  const newEvents: Event[] = []
  for (const e of plan.expenses) {
    const id = uuidv4()
    const createdAt = `${e.date}T12:00:00.000Z`  // stable, date-preserving
    const tid = e.tag ? tagId(e.tag) : undefined
    const base = {
      id, type: 'EXPENSE' as const, description: e.description, amount: e.amount, currency: 'INR',
      paidBy: memberId(e.paidBy),
      splits: e.splits.map(s => ({ member: memberId(s.username), amount: s.amount })),
      splitType: e.splitType, tags: tid ? [tid] : [], date: e.date, createdAt
    }
    const hash = await hashExpense(base)
    newEvents.push({ ...base, hash })
  }
  for (const s of plan.settlements) {
    const id = uuidv4()
    const createdAt = `${s.date}T12:00:00.000Z`
    const base = {
      id, type: 'SETTLEMENT' as const, from: memberId(s.from), to: memberId(s.to),
      amount: s.amount, currency: 'INR', note: s.note || undefined, createdAt
    }
    const hash = await hashSettlement(base)
    newEvents.push({ ...base, hash })
  }

  newEvents.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  await appendEvents(octokit, owner, repo, newEvents)
  return { added: newEvents.length, tagsCreated, membersCreated }
}

export function resolveExpenses(events: Event[]): Expense[] {
  const expenses = events.filter(e => e.type === 'EXPENSE') as Expense[]

  // Build set of deleted expense IDs
  const deletedIds = new Set(
    events
      .filter(e => e.type === 'EXPENSE_DELETION')
      .map(e => (e as ExpenseDeletion).deletedId)
  )

  // Build map from originalId → latest correction id (for edits)
  const supersededBy = new Map<string, string>()
  for (const e of expenses) {
    if (e.supersedesId) supersededBy.set(e.supersedesId, e.id)
  }

  return expenses.filter(e =>
    !deletedIds.has(e.id) &&               // not deleted
    (!supersededBy.has(e.id) || supersededBy.get(e.id) === e.id) // latest version
  )
}
