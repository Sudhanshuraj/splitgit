/**
 * Global cross-group simplification.
 * Merges balances across all groups by the GitHub login that claimed each
 * member slot, then shows the minimum transactions to settle everything.
 * (Unclaimed members stay group-local and don't merge across groups.)
 */

import { useState } from 'react'
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { listGroups, getGroupConfig } from '../lib/github'
import { readEvents, addSettlement, resolveExpenses } from '../lib/eventLog'
import { computeCrossGroupSettlements, formatAmount } from '../lib/balances'
import { myMemberId } from '../lib/members'
import type { CrossGroupDebtEdge, GroupEvents } from '../lib/balances'
import { Spinner } from '../components/Spinner'
import type { Group, GroupConfig } from '../types'

export function GlobalSettle() {
  const { octokit, user } = useAuthStore()
  const qc = useQueryClient()

  const [settling, setSettling] = useState<CrossGroupDebtEdge | null>(null)
  const [chosenGroup, setChosenGroup] = useState<{ owner: string; name: string } | null>(null)
  const [note, setNote] = useState('')

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: () => listGroups(octokit!),
    enabled: !!octokit,
    staleTime: 30_000
  })
  const groups: Group[] = (groupsQuery.data ?? []).filter(g => !g.archived)

  const eventQueries = useQueries({
    queries: groups.map(g => ({
      queryKey: ['events', g.owner, g.name],
      queryFn: () => readEvents(octokit!, g.owner, g.name),
      enabled: !!octokit && groups.length > 0,
      staleTime: 15_000
    }))
  })
  const configQueries = useQueries({
    queries: groups.map(g => ({
      queryKey: ['config', g.owner, g.name],
      queryFn: () => getGroupConfig(octokit!, g.owner, g.name),
      enabled: !!octokit && groups.length > 0,
      staleTime: 60_000
    }))
  })

  const allLoaded = eventQueries.length > 0 && eventQueries.every(q => !q.isLoading) && configQueries.every(q => !q.isLoading)

  const groupEvents: GroupEvents[] = groups.map((g, i) => {
    const raw = eventQueries[i]?.data?.events ?? []
    const config = configQueries[i]?.data?.config as GroupConfig | undefined
    const firstExpense = raw.find(e => e.type === 'EXPENSE')
    // Apply edits + deletions before computing balances (same as the group tab)
    const events = [...resolveExpenses(raw), ...raw.filter(e => e.type === 'SETTLEMENT')]
    return {
      owner: g.owner,
      name: g.name,
      currency: firstExpense && firstExpense.type === 'EXPENSE' ? firstExpense.currency : 'INR',
      events,
      members: config?.members ?? []
    }
  })

  const globalEdges = allLoaded ? computeCrossGroupSettlements(groupEvents) : []
  const myEdges = globalEdges.filter(e => e.fromLogin === user?.login || e.toLogin === user?.login)
  const otherEdges = globalEdges.filter(e => e.fromLogin !== user?.login && e.toLogin !== user?.login)

  const settleMutation = useMutation({
    mutationFn: async () => {
      if (!settling || !chosenGroup || !octokit || !user) return null
      const cfg = configQueries[groups.findIndex(g => g.owner === chosenGroup.owner && g.name === chosenGroup.name)]?.data?.config as GroupConfig | undefined
      const fromId = myMemberId(cfg ?? null, user.login)
      const toId = cfg?.members.find(m => m.claimedBy === settling.toLogin)?.id
      if (fromId == null || toId == null) throw new Error('Both people must have claimed a member slot in that group')
      const res = await addSettlement(octokit, chosenGroup.owner, chosenGroup.name, {
        from: fromId, to: toId, amount: settling.amount, currency: settling.currency, note: note.trim() || undefined
      })
      return { res, owner: chosenGroup.owner, name: chosenGroup.name }
    },
    onSuccess: (data) => {
      if (data) qc.setQueryData(['events', data.owner, data.name], { events: data.res.events, sha: data.res.sha })
      setSettling(null); setChosenGroup(null); setNote('')
    }
  })

  function openSettle(edge: CrossGroupDebtEdge) {
    setSettling(edge); setChosenGroup(edge.suggestedGroup); setNote('')
  }

  const isLoading = groupsQuery.isLoading || (groups.length > 0 && !allLoaded)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Settle Up</h1>
        <p className="text-sm text-zinc-500 mt-1">Simplified across all your groups — minimum transactions to clear everything.</p>
      </div>

      {isLoading && <Spinner className="py-16" />}

      {!isLoading && groups.length === 0 && (
        <div className="text-center py-16 text-zinc-500"><p className="text-4xl mb-3">⑂</p><p className="font-medium text-zinc-700">No groups yet</p></div>
      )}

      {!isLoading && groups.length > 0 && globalEdges.length === 0 && (
        <div className="text-center py-16 text-zinc-500"><p className="text-4xl mb-3">✅</p><p className="font-medium text-zinc-700">All settled up!</p></div>
      )}

      {!isLoading && globalEdges.length > 0 && (
        <div className="space-y-6">
          {myEdges.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">Involving you</h2>
              <div className="space-y-3">
                {myEdges.map((edge, i) => (
                  <EdgeCard key={i} edge={edge} currentLogin={user?.login ?? ''} onSettle={() => openSettle(edge)} />
                ))}
              </div>
            </div>
          )}
          {otherEdges.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">Others in your groups</h2>
              <div className="space-y-3">
                {otherEdges.map((edge, i) => (
                  <EdgeCard key={i} edge={edge} currentLogin={user?.login ?? ''} onSettle={() => {}} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Settlement modal */}
      {settling && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-4 pb-safe">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-zinc-900 mb-1">Record Settlement</h2>
            <p className="text-sm text-zinc-500 mb-5">
              You are paying <span className="font-semibold text-zinc-800">{settling.toLabel}</span>{' '}
              <span className="font-semibold text-emerald-600">{formatAmount(settling.amount, settling.currency)}</span>
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-700 mb-2">Record in which group?</label>
              <div className="space-y-2">
                {groups.map((g, i) => (
                  <button key={i} onClick={() => setChosenGroup({ owner: g.owner, name: g.name })}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm transition-colors text-left
                      ${chosenGroup?.name === g.name && chosenGroup?.owner === g.owner ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'}`}>
                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${chosenGroup?.name === g.name && chosenGroup?.owner === g.owner ? 'border-emerald-500 bg-emerald-500' : 'border-zinc-300'}`}>
                      {chosenGroup?.name === g.name && chosenGroup?.owner === g.owner && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <div>
                      <p className="font-medium">{g.name}</p>
                      <p className="text-xs text-zinc-400">@{g.owner}</p>
                    </div>
                    {settling.suggestedGroup?.name === g.name && <span className="ml-auto text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">suggested</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-5">
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">Note <span className="text-zinc-400 font-normal">(optional)</span></label>
              <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Bank transfer"
                className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
            </div>
            {settleMutation.error && <p className="text-red-600 text-sm mb-3">{settleMutation.error instanceof Error ? settleMutation.error.message : 'Failed to record'}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setSettling(null); setChosenGroup(null) }} className="flex-1 border border-zinc-300 text-zinc-700 font-medium py-3 rounded-xl hover:bg-zinc-50 transition-colors">Cancel</button>
              <button onClick={() => settleMutation.mutate()} disabled={!chosenGroup || settleMutation.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
                {settleMutation.isPending ? <Spinner /> : 'Record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EdgeCard({ edge, currentLogin, onSettle }: { edge: CrossGroupDebtEdge; currentLogin: string; onSettle: () => void }) {
  const isMyDebt = edge.fromLogin === currentLogin
  const isMine = isMyDebt || edge.toLogin === currentLogin
  return (
    <div className={`bg-white border rounded-2xl p-4 flex items-center gap-3 ${isMyDebt ? 'border-red-200' : 'border-zinc-200'}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 ${isMyDebt ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
        {edge.fromLabel[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-700">
          <span className="font-semibold text-zinc-900">{isMyDebt ? 'You' : edge.fromLabel}</span>
          {' '}owe{isMyDebt ? '' : 's'}{' '}
          <span className="font-semibold text-zinc-900">{edge.toLogin === currentLogin ? 'you' : edge.toLabel}</span>
        </p>
        {edge.suggestedGroup && <p className="text-xs text-zinc-400 mt-0.5">via {edge.suggestedGroup.name}</p>}
      </div>
      <p className={`font-bold text-lg shrink-0 ${isMyDebt ? 'text-red-600' : 'text-emerald-600'}`}>{formatAmount(edge.amount, edge.currency)}</p>
      {isMyDebt && (
        <button onClick={onSettle} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3 py-2 rounded-lg transition-colors shrink-0">Pay</button>
      )}
      {!isMine && null}
    </div>
  )
}
