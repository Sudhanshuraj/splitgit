/**
 * Read and write the append-only expenses.json event log.
 * Uses IndexedDB cache for instant loads — fetches from GitHub only when
 * the file SHA has changed since last visit.
 */

import { Octokit } from 'octokit'
import type { Event, Expense, Settlement } from '../types'
import { getExpensesFile, updateExpensesFile } from './github'
import { hashExpense, hashSettlement } from './hash'
import { getCachedEvents, setCachedEvents } from './cache'
import { v4 as uuidv4 } from 'uuid'

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

  // 3. SHA changed or no cache — parse and update cache
  const events = JSON.parse(content) as Event[]
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

async function appendEvent(
  octokit: Octokit,
  owner: string,
  repo: string,
  newEvent: Event,
  retries = 3
): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const { events, sha } = await readEvents(octokit, owner, repo)
    const updated = [...events, newEvent]
    try {
      const message =
        newEvent.type === 'EXPENSE'
          ? `expense: ${(newEvent as Expense).description} — ${(newEvent as Expense).amount} ${(newEvent as Expense).currency}`
          : `settle: ${(newEvent as Settlement).from} → ${(newEvent as Settlement).to} — ${(newEvent as Settlement).amount}`
      await updateExpensesFile(octokit, owner, repo, JSON.stringify(updated, null, 2), sha, message)
      await setCachedEvents(owner, repo, sha, updated)
      return
    } catch (err: unknown) {
      const isConflict = err instanceof Error && err.message.includes('409')
      if (!isConflict || attempt === retries - 1) throw err
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }
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
): Promise<Expense> {
  const id = uuidv4()
  const createdAt = new Date().toISOString()

  const splitAmount = parseFloat((input.amount / input.participants.length).toFixed(2))
  const remainder = parseFloat(
    (input.amount - splitAmount * input.participants.length).toFixed(2)
  )
  const splits = input.participants.map((username, i) => ({
    username,
    amount: i === 0 ? parseFloat((splitAmount + remainder).toFixed(2)) : splitAmount
  }))

  const base = {
    id,
    type: 'EXPENSE' as const,
    description: input.description,
    amount: input.amount,
    currency: input.currency,
    paidBy: input.paidBy,
    splits,
    splitType: input.splitType,
    tags: input.tags,
    supersedesId: originalId,  // links back to the original event in git history
    createdAt
  }

  const hash = await hashExpense(base)
  const expense: Expense = { ...base, hash }

  await appendEvent(octokit, owner, repo, expense)
  return expense
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CreateExpenseInput {
  description: string
  amount: number
  currency: string
  paidBy: string
  participants: string[]
  splitType: 'equal'
  tags: string[]
}

export async function addExpense(
  octokit: Octokit,
  owner: string,
  repo: string,
  input: CreateExpenseInput
): Promise<Expense> {
  const id = uuidv4()
  const createdAt = new Date().toISOString()

  const splitAmount = parseFloat((input.amount / input.participants.length).toFixed(2))
  const remainder = parseFloat(
    (input.amount - splitAmount * input.participants.length).toFixed(2)
  )
  const splits = input.participants.map((username, i) => ({
    username,
    amount: i === 0 ? parseFloat((splitAmount + remainder).toFixed(2)) : splitAmount
  }))

  const base = {
    id,
    type: 'EXPENSE' as const,
    description: input.description,
    amount: input.amount,
    currency: input.currency,
    paidBy: input.paidBy,
    splits,
    splitType: input.splitType,
    tags: input.tags,
    createdAt
  }

  const hash = await hashExpense(base)
  const expense: Expense = { ...base, hash }

  await appendEvent(octokit, owner, repo, expense)
  return expense
}

export interface CreateSettlementInput {
  from: string
  to: string
  amount: number
  currency: string
  note?: string
}

export async function addSettlement(
  octokit: Octokit,
  owner: string,
  repo: string,
  input: CreateSettlementInput
): Promise<Settlement> {
  const id = uuidv4()
  const createdAt = new Date().toISOString()

  const base = {
    id,
    type: 'SETTLEMENT' as const,
    from: input.from,
    to: input.to,
    amount: input.amount,
    currency: input.currency,
    note: input.note,
    createdAt
  }

  const hash = await hashSettlement(base)
  const settlement: Settlement = { ...base, hash }

  await appendEvent(octokit, owner, repo, settlement)
  return settlement
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the effective list of expenses after applying edits.
 * For each originalId, only the latest superseding version is shown.
 */
export function resolveExpenses(events: Event[]): Expense[] {
  const expenses = events.filter(e => e.type === 'EXPENSE') as Expense[]

  // Build a map from originalId → latest correction
  const supersededBy = new Map<string, string>()
  for (const e of expenses) {
    if (e.supersedesId) {
      supersededBy.set(e.supersedesId, e.id)
    }
  }

  // Filter out any expense that has been superseded
  return expenses.filter(e => !supersededBy.has(e.id) || supersededBy.get(e.id) === e.id)
}
