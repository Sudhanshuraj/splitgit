/**
 * Optimistic write: show the new event in the UI immediately, commit to GitHub
 * in the background, reconcile the real sha on success, and roll back + toast
 * (with retry) on failure. Safe for real money because appendOne is idempotent
 * (the event id dedupes), so a retry can never double-write.
 */
import type { QueryClient } from '@tanstack/react-query'
import { Octokit } from 'octokit'
import type { Event } from '../types'
import { appendOne } from './eventLog'
import { useToast } from '../store/toast'

interface CachedEvents { events: Event[]; sha: string }

export function optimisticAppend(
  qc: QueryClient,
  octokit: Octokit,
  owner: string,
  repo: string,
  event: Event,
  label: string
): void {
  const key = ['events', owner, repo]
  const prev = qc.getQueryData<CachedEvents>(key)

  // 1. Show it instantly
  qc.setQueryData<CachedEvents>(key, prev
    ? { events: [...prev.events, event], sha: prev.sha }
    : { events: [event], sha: '' })

  // 2. Commit in the background
  appendOne(octokit, owner, repo, event)
    .then(res => {
      // Reconcile with the authoritative events + new sha
      qc.setQueryData<CachedEvents>(key, { events: res.events, sha: res.sha })
    })
    .catch(() => {
      // Roll back and let the user retry (idempotent, so it's safe)
      if (prev) qc.setQueryData<CachedEvents>(key, prev)
      else qc.invalidateQueries({ queryKey: key })
      useToast.getState().show(
        `Couldn't save ${label}`,
        () => optimisticAppend(qc, octokit, owner, repo, event, label)
      )
    })
}
