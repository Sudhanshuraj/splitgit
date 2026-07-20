/**
 * Display-name resolution for group members.
 *
 * Each group can assign a nickname to any GitHub login (stored in config.json).
 * The UI should show the nickname where set, otherwise fall back to @login.
 */

import type { GroupConfig } from '../types'

/** Nickname if one is set for this login, else the raw login (no @ prefix). */
export function nameOf(login: string, config?: GroupConfig | null): string {
  const nick = config?.nicknames?.[login]?.trim()
  return nick && nick.length > 0 ? nick : login
}

/** Display form with a leading @ only when falling back to the login. */
export function handleOf(login: string, config?: GroupConfig | null): string {
  const nick = config?.nicknames?.[login]?.trim()
  return nick && nick.length > 0 ? nick : `@${login}`
}
