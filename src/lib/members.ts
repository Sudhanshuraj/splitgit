/**
 * Ledger member helpers. A member is a numeric slot in the group config that
 * transactions reference; a GitHub account "claims" a slot via `claimedBy`.
 */
import type { GroupConfig, LedgerMember } from '../types'

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
