/**
 * Compute Split[] for each of the three split modes: equal, exact (unequal
 * amounts typed per person), and shares (ratio-based, e.g. 1:2).
 */
import type { Split } from '../types'

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Equal split among participants, remainder placed on the first for exactness. */
export function computeEqualSplits(amount: number, participants: number[]): Split[] {
  if (participants.length === 0 || isNaN(amount)) return []
  const each = round2(amount / participants.length)
  const remainder = round2(amount - each * participants.length)
  return participants.map((member, i) => ({ member, amount: i === 0 ? round2(each + remainder) : each }))
}

/** Exact splits from raw per-member amount strings; only positive entries count. */
export function computeExactSplits(amounts: Record<number, string>): Split[] {
  return Object.entries(amounts)
    .map(([id, v]) => ({ member: parseInt(id, 10), amount: round2(parseFloat(v)) }))
    .filter(s => !isNaN(s.amount) && s.amount > 0)
}

/**
 * Share-based split: amount distributed proportional to each member's share
 * count (e.g. Sudhanshu:1, Amit:2 → 1/3 and 2/3 of the total). The last
 * entry absorbs the rounding remainder so amounts always sum exactly.
 */
export function computeShareSplits(amount: number, shares: Record<number, string>): Split[] {
  if (isNaN(amount)) return []
  const entries = Object.entries(shares)
    .map(([id, v]) => ({ member: parseInt(id, 10), share: parseFloat(v) }))
    .filter(s => !isNaN(s.share) && s.share > 0)
  const totalShares = entries.reduce((s, e) => s + e.share, 0)
  if (totalShares <= 0) return []
  let allocated = 0
  return entries.map((e, i) => {
    if (i === entries.length - 1) {
      return { member: e.member, amount: round2(amount - allocated) }
    }
    const amt = round2(amount * (e.share / totalShares))
    allocated = round2(allocated + amt)
    return { member: e.member, amount: amt }
  })
}

export function sumSplits(splits: Split[]): number {
  return round2(splits.reduce((s, x) => s + x.amount, 0))
}
