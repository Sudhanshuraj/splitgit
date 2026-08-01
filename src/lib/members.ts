/**
 * Ledger member helpers. A member is a numeric slot in the group config that
 * transactions reference; a GitHub account "claims" a slot via `claimedBy`.
 */
import type { GroupConfig, LedgerMember, Expense, Split } from '../types'

export function memberName(id: number, config?: GroupConfig | null): string {
  return config?.members.find(m => m.id === id)?.name ?? `#${id}`
}

export function memberInitial(id: number, config?: GroupConfig | null): string {
  return memberName(id, config).trim()[0]?.toUpperCase() ?? '?'
}

export function allMembers(config?: GroupConfig | null): LedgerMember[] {
  return config?.members ?? []
}

export function unclaimedMembers(config?: GroupConfig | null): LedgerMember[] {
  return allMembers(config).filter(m => !m.claimedBy)
}

/** The member id claimed by this GitHub login, if any. */
export function myMemberId(config: GroupConfig | null | undefined, login: string | undefined): number | null {
  if (!config || !login) return null
  return config.members.find(m => m.claimedBy === login)?.id ?? null
}

export function nextMemberId(config: GroupConfig | null | undefined): number {
  const ids = (config?.members ?? []).map(m => m.id)
  return ids.length ? Math.max(...ids) + 1 : 1
}

/**
 * Normalize an expense's `paidBy` into a list of {member, amount} contributions.
 * Old data (and the common case) is a single number — that means "this one
 * person paid the full amount." New data can be a Split[] when more than one
 * person fronted the expense. Always go through this instead of touching
 * `expense.paidBy` directly.
 */
export function contributionsOf(e: Pick<Expense, 'paidBy' | 'amount'>): Split[] {
  return typeof e.paidBy === 'number' ? [{ member: e.paidBy, amount: e.amount }] : e.paidBy
}

/** True if this ledger member id contributed (fully or partially) to paying this expense. */
export function isPayer(e: Pick<Expense, 'paidBy' | 'amount'>, memberId: number): boolean {
  return contributionsOf(e).some(c => c.member === memberId)
}

/** Human label for who paid, e.g. "Sudhanshu" or "Sudhanshu + Amit". */
export function payerLabel(e: Pick<Expense, 'paidBy' | 'amount'>, config?: GroupConfig | null): string {
  return contributionsOf(e).map(c => memberName(c.member, config)).join(' + ')
}
