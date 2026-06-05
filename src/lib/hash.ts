/**
 * SHA-256 tamper detection.
 * We hash all meaningful fields of an event and store the hash alongside it.
 * Any edit to the event data will produce a different hash.
 */

import type { Expense, Settlement, ExpenseDeletion } from '../types'

type HashableExpense = Omit<Expense, 'hash'>
type HashableSettlement = Omit<Settlement, 'hash'>

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function hashExpense(e: HashableExpense): Promise<string> {
  const canonical = JSON.stringify({
    id: e.id,
    type: e.type,
    description: e.description,
    amount: e.amount,
    currency: e.currency,
    paidBy: e.paidBy,
    splits: e.splits.slice().sort((a, b) => a.username.localeCompare(b.username)),
    splitType: e.splitType,
    tags: e.tags.slice().sort(),
    date: e.date,
    createdAt: e.createdAt
  })
  return sha256(canonical)
}

export async function hashSettlement(s: HashableSettlement): Promise<string> {
  const canonical = JSON.stringify({
    id: s.id,
    type: s.type,
    from: s.from,
    to: s.to,
    amount: s.amount,
    currency: s.currency,
    createdAt: s.createdAt
  })
  return sha256(canonical)
}

export async function hashDeletion(d: Omit<ExpenseDeletion, 'hash'>): Promise<string> {
  const canonical = JSON.stringify({
    id: d.id,
    type: d.type,
    deletedId: d.deletedId,
    deletedBy: d.deletedBy,
    createdAt: d.createdAt
  })
  return sha256(canonical)
}

export async function verifyEvent(event: Expense | Settlement): Promise<boolean> {
  if (event.type === 'EXPENSE') {
    const { hash: _hash, ...rest } = event
    const expected = await hashExpense(rest)
    return expected === event.hash
  } else {
    const { hash: _hash, ...rest } = event
    const expected = await hashSettlement(rest)
    return expected === event.hash
  }
}
