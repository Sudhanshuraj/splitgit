/**
 * Read and write the append-only expenses.json event log.
 * Handles optimistic concurrency: if the SHA has changed since we read,
 * we fetch again and retry the append.
 */

import { Octokit } from 'octokit'
import type { Event, Expense, Settlement } from '../types'
import { getExpensesFile, updateExpensesFile } from './github'
import { hashExpense, hashSettlement } from './hash'
import { v4 as uuidv4 } from 'uuid'

export async function readEvents(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<{ events: Event[]; sha: string }> {
  const { content, sha } = await getExpensesFile(octokit, owner, repo)
  const events = JSON.parse(content) as Event[]
  return { events, sha }
}

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
      return
    } catch (err: unknown) {
      const isConflict = err instanceof Error && err.message.includes('409')
      if (!isConflict || attempt === retries - 1) throw err
      // SHA conflict: retry (another collaborator wrote simultaneously)
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CreateExpenseInput {
  description: string
  amount: number
  currency: string
  paidBy: string
  participants: string[]
  splitType: 'equal'
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
  // Distribute rounding remainder to first participant
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
