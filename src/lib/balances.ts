/**
 * Derive balances by replaying the full event log.
 * Never stored — always computed at read time.
 */

import type { Event, Expense, Settlement, DebtEdge } from '../types'

/**
 * Compute net balance for each person.
 * Positive = this person is owed money by others.
 * Negative = this person owes money to others.
 */
export function computeNetBalances(events: Event[]): Map<string, number> {
  const balances = new Map<string, number>()

  const add = (user: string, amount: number) => {
    balances.set(user, (balances.get(user) ?? 0) + amount)
  }

  for (const event of events) {
    if (event.type === 'EXPENSE') {
      const e = event as Expense
      // Payer is credited the full amount
      add(e.paidBy, e.amount)
      // Each participant is debited their share
      for (const split of e.splits) {
        add(split.username, -split.amount)
      }
    } else {
      const s = event as Settlement
      // "from" paid "to", so "from" is credited and "to" is debited
      add(s.from, s.amount)
      add(s.to, -s.amount)
    }
  }

  return balances
}

/**
 * Minimum cash-flow greedy algorithm.
 * Takes net balances and returns the minimum number of transactions
 * needed to settle all debts.
 */
export function minimumTransactions(
  balances: Map<string, number>,
  currency: string
): DebtEdge[] {
  const result: DebtEdge[] = []

  // Copy into mutable arrays
  const creditors: { user: string; amount: number }[] = []
  const debtors: { user: string; amount: number }[] = []

  for (const [user, net] of balances) {
    const rounded = parseFloat(net.toFixed(2))
    if (rounded > 0.005) creditors.push({ user, amount: rounded })
    else if (rounded < -0.005) debtors.push({ user, amount: -rounded })
  }

  // Sort descending by amount
  creditors.sort((a, b) => b.amount - a.amount)
  debtors.sort((a, b) => b.amount - a.amount)

  let i = 0
  let j = 0

  while (i < creditors.length && j < debtors.length) {
    const credit = creditors[i]!
    const debt = debtors[j]!
    const amount = Math.min(credit.amount, debt.amount)
    const rounded = parseFloat(amount.toFixed(2))

    if (rounded > 0.005) {
      result.push({ from: debt.user, to: credit.user, amount: rounded, currency })
    }

    credit.amount -= amount
    debt.amount -= amount

    if (credit.amount < 0.005) i++
    if (debt.amount < 0.005) j++
  }

  return result
}

/**
 * Convenience: compute settlement suggestions from raw events.
 */
export function computeSettlements(events: Event[], currency = 'USD'): DebtEdge[] {
  const balances = computeNetBalances(events)
  return minimumTransactions(balances, currency)
}

// ─── Cross-group simplification ───────────────────────────────────────────────

export interface GroupEvents {
  owner: string
  name: string
  currency: string
  events: Event[]
}

/**
 * Merge net balances from multiple groups into a single map.
 * All amounts are treated as the same currency (the caller should filter
 * or convert if groups use different currencies).
 */
export function mergeGroupBalances(groups: GroupEvents[]): Map<string, number> {
  const merged = new Map<string, number>()

  for (const group of groups) {
    const groupBalances = computeNetBalances(group.events)
    for (const [user, net] of groupBalances) {
      merged.set(user, (merged.get(user) ?? 0) + net)
    }
  }

  return merged
}

export interface CrossGroupDebtEdge extends DebtEdge {
  /** Which group repo to suggest recording this settlement in */
  suggestedGroup: { owner: string; name: string } | null
}

/**
 * Compute globally simplified settlements across all groups.
 *
 * Strategy:
 *  1. Merge net balances across every group
 *  2. Run min-cash-flow → minimum transactions globally
 *  3. For each resulting edge, find the group where "from" and "to"
 *     share the most history together (most events) → suggest that repo
 *     for recording the settlement
 */
export function computeCrossGroupSettlements(
  groups: GroupEvents[],
  currency = 'USD'
): CrossGroupDebtEdge[] {
  const merged = mergeGroupBalances(groups)
  const edges = minimumTransactions(merged, currency)

  return edges.map(edge => {
    // Find the group with the most shared events between these two people
    let bestGroup: { owner: string; name: string } | null = null
    let bestScore = -1

    for (const group of groups) {
      const members = new Set<string>()
      for (const event of group.events) {
        if (event.type === 'EXPENSE') {
          const e = event as Expense
          members.add(e.paidBy)
          e.splits.forEach(s => members.add(s.username))
        } else {
          const s = event as Settlement
          members.add(s.from)
          members.add(s.to)
        }
      }
      if (members.has(edge.from) && members.has(edge.to)) {
        const score = group.events.length
        if (score > bestScore) {
          bestScore = score
          bestGroup = { owner: group.owner, name: group.name }
        }
      }
    }

    return { ...edge, suggestedGroup: bestGroup }
  })
}

/**
 * Format a balance amount for display.
 */
export function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(Math.abs(amount))
}
