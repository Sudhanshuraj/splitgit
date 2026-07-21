/**
 * Derive balances by replaying the full event log.
 * Never stored — always computed at read time.
 *
 * Within a group, everyone is a numeric ledger member id.
 * Across groups, the same real person is keyed by the GitHub login that
 * claimed their slot (unclaimed slots stay group-local and never merge).
 */

import type { Event, Expense, Settlement, DebtEdge, LedgerMember } from '../types'

/**
 * Net balance for each ledger member (by id).
 * Positive = is owed money by others. Negative = owes money.
 */
export function computeNetBalances(events: Event[]): Map<number, number> {
  const balances = new Map<number, number>()
  const add = (m: number, amount: number) => balances.set(m, (balances.get(m) ?? 0) + amount)

  for (const event of events) {
    if (event.type === 'EXPENSE') {
      const e = event as Expense
      add(e.paidBy, e.amount)
      for (const split of e.splits) add(split.member, -split.amount)
    } else if (event.type === 'SETTLEMENT') {
      const s = event as Settlement
      add(s.from, s.amount)
      add(s.to, -s.amount)
    }
  }
  return balances
}

/** Generic min-cash-flow greedy settle. */
function minFlow<K>(balances: Map<K, number>, currency: string): { from: K; to: K; amount: number; currency: string }[] {
  const result: { from: K; to: K; amount: number; currency: string }[] = []
  const creditors: { k: K; amount: number }[] = []
  const debtors: { k: K; amount: number }[] = []
  for (const [k, net] of balances) {
    const r = parseFloat(net.toFixed(2))
    if (r > 0.005) creditors.push({ k, amount: r })
    else if (r < -0.005) debtors.push({ k, amount: -r })
  }
  creditors.sort((a, b) => b.amount - a.amount)
  debtors.sort((a, b) => b.amount - a.amount)
  let i = 0, j = 0
  while (i < creditors.length && j < debtors.length) {
    const c = creditors[i]!, d = debtors[j]!
    const amount = Math.min(c.amount, d.amount)
    const r = parseFloat(amount.toFixed(2))
    if (r > 0.005) result.push({ from: d.k, to: c.k, amount: r, currency })
    c.amount -= amount; d.amount -= amount
    if (c.amount < 0.005) i++
    if (d.amount < 0.005) j++
  }
  return result
}

export function minimumTransactions(balances: Map<number, number>, currency: string): DebtEdge[] {
  return minFlow<number>(balances, currency)
}

export function computeSettlements(events: Event[], currency = 'INR'): DebtEdge[] {
  return minimumTransactions(computeNetBalances(events), currency)
}

// ─── Cross-group simplification ───────────────────────────────────────────────

export interface GroupEvents {
  owner: string
  name: string
  currency: string
  events: Event[]
  members: LedgerMember[]
}

/** Cross-group identity key for a member id: their claimed login, or a group-local slot key. */
function memberKey(g: GroupEvents, id: number): string {
  const m = g.members.find(x => x.id === id)
  return m?.claimedBy ? `login:${m.claimedBy}` : `slot:${g.owner}/${g.name}#${id}`
}
function memberName(g: GroupEvents, id: number): string {
  return g.members.find(x => x.id === id)?.name ?? `#${id}`
}
/** All member keys that appear anywhere in a group's events. */
function keysInGroup(g: GroupEvents): Set<string> {
  const ks = new Set<string>()
  for (const e of g.events) {
    if (e.type === 'EXPENSE') {
      const ex = e as Expense
      ks.add(memberKey(g, ex.paidBy))
      ex.splits.forEach(s => ks.add(memberKey(g, s.member)))
    } else if (e.type === 'SETTLEMENT') {
      const s = e as Settlement
      ks.add(memberKey(g, s.from)); ks.add(memberKey(g, s.to))
    }
  }
  return ks
}

export function mergeGroupBalances(groups: GroupEvents[]): Map<string, number> {
  const merged = new Map<string, number>()
  for (const g of groups) {
    for (const [id, net] of computeNetBalances(g.events)) {
      const key = memberKey(g, id)
      merged.set(key, (merged.get(key) ?? 0) + net)
    }
  }
  return merged
}

export interface CrossGroupDebtEdge {
  from: string           // cross-group key (login:xxx or slot:...)
  to: string
  fromLabel: string      // human display name
  toLabel: string
  fromLogin: string | null   // GitHub login if claimed, else null
  toLogin: string | null
  amount: number
  currency: string
  suggestedGroup: { owner: string; name: string } | null
}

export function computeCrossGroupSettlements(groups: GroupEvents[], currency = 'INR'): CrossGroupDebtEdge[] {
  const merged = mergeGroupBalances(groups)
  const edges = minFlow<string>(merged, currency)

  const label = new Map<string, string>()
  for (const g of groups) {
    for (const e of g.events) {
      if (e.type === 'EXPENSE') {
        const ex = e as Expense
        label.set(memberKey(g, ex.paidBy), memberName(g, ex.paidBy))
        ex.splits.forEach(s => label.set(memberKey(g, s.member), memberName(g, s.member)))
      } else if (e.type === 'SETTLEMENT') {
        const s = e as Settlement
        label.set(memberKey(g, s.from), memberName(g, s.from))
        label.set(memberKey(g, s.to), memberName(g, s.to))
      }
    }
  }
  const loginOf = (key: string) => key.startsWith('login:') ? key.slice('login:'.length) : null

  return edges.map(edge => {
    let best: { owner: string; name: string } | null = null
    let bestScore = -1
    for (const g of groups) {
      const ks = keysInGroup(g)
      if (ks.has(edge.from) && ks.has(edge.to) && g.events.length > bestScore) {
        bestScore = g.events.length
        best = { owner: g.owner, name: g.name }
      }
    }
    return {
      ...edge,
      fromLabel: label.get(edge.from) ?? edge.from,
      toLabel: label.get(edge.to) ?? edge.to,
      fromLogin: loginOf(edge.from),
      toLogin: loginOf(edge.to),
      suggestedGroup: best
    }
  })
}

/** Format a balance amount for display. */
export function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(Math.abs(amount))
}
