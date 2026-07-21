/**
 * Display-name resolution. Identity is now the numeric ledger member id;
 * the display name lives on the member slot in config.
 */
import type { GroupConfig } from '../types'
import { memberName } from './members'

/** Display name for a ledger member id. */
export function handleOf(memberIdVal: number, config?: GroupConfig | null): string {
  return memberName(memberIdVal, config)
}
