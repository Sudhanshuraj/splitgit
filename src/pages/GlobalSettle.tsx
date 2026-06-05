/**
 * Global cross-group simplification page.
 *
 * Reads all groups the user is a member of, merges net balances,
 * and shows the minimum transactions needed to settle everything —
 * across ALL groups at once.
 *
 * Example: A owes B $20 in Hiking, C owes A $15 in Flatmates
 * → simplified: A owes B $5, C owes B $15  (C pays B directly)
 */

import { useState } from 'react'
import { useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { listGroups } from '../lib/github'
import { readEvents, addSettlement } from '../lib/eventLog'
import { computeCrossGroupSettlements, formatAmount } from '../lib/balances'
import type { CrossGroupDebtEdge, GroupEvents } from '../lib/balances'
import { Spinner } from '../components/Spinner'
import type { Group } from '../types'

export function GlobalSettle() {
  const { octokit, user } = useAuthStore()
  const qc = useQueryClient()

  const [settling, setSettling] = useState<CrossGroupDebtEdge | null>(null)
  const [chosenGroup, setChosenGroup] = useState<{ owner: string; name: string } | null>(null)
  const [note, setNote] = useState('')

  // Step 1: load all groups
  const groupsQuery = useQueries({
    queries: [
      {
        queryKey: ['groups'],
        queryFn: () => listGroups(octokit!),
        enabled: !!octokit,
        staleTime: 30_000
      }
    ]
  })[0]

  const groups: Group[] = groupsQuery.data ?? []

  // Step 2: load events for every group in parallel
  const eventQueries = useQueries({
    queries: groups.map(g => ({
      queryKey: ['events', g.owner, g.name],
      queryFn: () => readEvents(octokit!, g.owner, g.name),
      enabled: !!octokit && groups.length > 0,
      staleTime: 15_000
    }))
  })

  const allLoaded = eventQueries.length > 0 && eventQueries.every(q => !q.isLoading)

  // Step 3: build GroupEvents[] and compute cross-group settlements
  const groupEvents: GroupEvents[] = groups.map((g, i) => ({
    owner: g.owner,
    name: g.name,
    currency: 'USD', // default; real currency taken from first expense below
    events: eventQueries[i]?.data?.events ?? []
  }))

  // Detect dominant currency per group
  for (let i = 0; i < groupEvents.length; i++) {
    const firstExpense = groupEvents[i]!.events.find(e => e.type === 'EXPENSE')
    if (firstExpense && firstExpense.type === 'EXPENSE') {
      groupEvents[i]!.currency = firstExpense.currency
    }
  }

  const globalEdges = allLoaded ? computeCrossGroupSettlements(groupEvents) : []
  const myEdges = globalEdges.filter(e => e.from === user?.login || e.to === user?.login)
  const otherEdges = globalEdges.filter(e => e.from !== user?.login && e.to !== user?.login)

  // Settlement mutation
  const settleMutation = useMutation({
    mutationFn: async () => {
      if (!settling || !chosenGroup || !octokit || !user) return
      await addSettlement(octokit, chosenGroup.owner, chosenGroup.name, {
        from: user.login,
        to: settling.to,
        amount: settling.amount,
        currency: settling.currency,
        note: note.trim() || undefined
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      setSettling(null)
      setChosenGroup(null)
      setNote('')
    }
  })

  function openSettle(edge: CrossGroupDebtEdge) {
    setSettling(edge)
    setChosenGroup(edge.suggestedGroup)
    setNote('')
  }

  const isLoading = groupsQuery.isLoading || (groups.length > 0 && !allLoaded)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Settle Up</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Simplified across all your groups — minimum transactions to clear everything.
        </p>
      </div>

      {isLoading && <Spinner className="py-16" />}

      {!isLoading && groups.length === 0 && (
        <div className="text-center py-16 text-zinc-500">
          <p className="text-4xl mb-3">⑂</p>
          <p className="font-medium text-zinc-700">No groups yet</p>
          <p className="text-sm mt-1">Create a group first to see balances here.</p>
        </div>
      )}

      {!isLoading && groups.length > 0 && globalEdges.length === 0 && (
        <div className="text-center py-16 text-zinc-500">
          <p className="text-4xl mb-3">✅</p>
          <p className="font-medium text-zinc-700">All settled up!</p>
          <p className="text-sm mt-1">No outstanding balances across any of your groups.</p>
        </div>
      )}

      {!isLoading && globalEdges.length > 0 && (
        <div className="space-y-6">
          {/* How much simpler is it? */}
          {globalEdges.length < countNaiveTransactions(groupEvents) && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-sm text-emerald-800">
              <span className="font-semibold">
                {countNaiveTransactions(groupEvents) - globalEdges.length} fewer transactions
              </span>{' '}
              than settling each group separately. Cross-group simplification at work! 🎉
            </div>
          )}

          {/* My debts / credits */}
          {myEdges.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                Involving you
              </h2>
              <div className="space-y-3">
                {myEdges.map((edge, i) => (
                  <EdgeCard
                    key={i}
                    edge={edge}
                    currentUser={user?.login ?? ''}
                    onSettle={() => openSettle(edge)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Everyone else */}
          {otherEdges.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                Others in your groups
              </h2>
              <div className="space-y-3">
                {otherEdges.map((edge, i) => (
                  <EdgeCard
                    key={i}
                    edge={edge}
                    currentUser={user?.login ?? ''}
                    onSettle={() => {}} // can't settle on behalf of others
                  />
                ))}
              </div>
            </div>
          )}

          {/* Group-by-group breakdown */}
          <details className="bg-zinc-50 border border-zinc-200 rounded-2xl overflow-hidden">
            <summary className="px-4 py-3 text-sm font-medium text-zinc-600 cursor-pointer select-none hover:bg-zinc-100">
              Per-group breakdown
            </summary>
            <div className="divide-y divide-zinc-200">
              {groupEvents.map((g, i) => {
                const perGroupEdges = computeCrossGroupSettlements([g])
                return (
                  <div key={i} className="px-4 py-3">
                    <p className="text-sm font-semibold text-zinc-800 mb-2">
                      ⑂ {g.name}
                      <span className="text-zinc-400 font-normal ml-1">(@{g.owner})</span>
                    </p>
                    {perGroupEdges.length === 0 ? (
                      <p className="text-xs text-zinc-400">All settled</p>
                    ) : (
                      <div className="space-y-1">
                        {perGroupEdges.map((e, j) => (
                          <p key={j} className="text-xs text-zinc-600">
                            <span className="font-medium">@{e.from}</span> owes{' '}
                            <span className="font-medium">@{e.to}</span>{' '}
                            <span className="text-emerald-600 font-semibold">
                              {formatAmount(e.amount, e.currency)}
                            </span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </details>
        </div>
      )}

      {/* Settlement modal */}
      {settling && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-4 pb-safe">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-zinc-900 mb-1">Record Settlement</h2>
            <p className="text-sm text-zinc-500 mb-5">
              You are paying{' '}
              <span className="font-semibold text-zinc-800">@{settling.to}</span>{' '}
              <span className="font-semibold text-emerald-600">
                {formatAmount(settling.amount, settling.currency)}
              </span>
            </p>

            {/* Group picker */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-700 mb-2">
                Record this settlement in which group?
              </label>
              <div className="space-y-2">
                {groupEvents
                  .filter(g => {
                    // Only show groups where both people have activity
                    const members = new Set<string>()
                    g.events.forEach(e => {
                      if (e.type === 'EXPENSE') {
                        members.add(e.paidBy)
                        ;(e as import('../types').Expense).splits.forEach(s =>
                          members.add(s.username)
                        )
                      } else {
                        members.add((e as import('../types').Settlement).from)
                        members.add((e as import('../types').Settlement).to)
                      }
                    })
                    return members.has(settling.from) && members.has(settling.to)
                  })
                  .map((g, i) => (
                    <button
                      key={i}
                      onClick={() => setChosenGroup({ owner: g.owner, name: g.name })}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm transition-colors text-left
                        ${chosenGroup?.name === g.name && chosenGroup?.owner === g.owner
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                          : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'
                        }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center
                        ${chosenGroup?.name === g.name && chosenGroup?.owner === g.owner
                          ? 'border-emerald-500 bg-emerald-500'
                          : 'border-zinc-300'
                        }`}>
                        {chosenGroup?.name === g.name && chosenGroup?.owner === g.owner && (
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{g.name}</p>
                        <p className="text-xs text-zinc-400">@{g.owner}</p>
                      </div>
                      {settling.suggestedGroup?.name === g.name && (
                        <span className="ml-auto text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                          suggested
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            </div>

            {/* Note */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                Note <span className="text-zinc-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="e.g. Bank transfer"
                className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            {settleMutation.error && (
              <p className="text-red-600 text-sm mb-3">
                {settleMutation.error instanceof Error
                  ? settleMutation.error.message
                  : 'Failed to record'}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setSettling(null); setChosenGroup(null) }}
                className="flex-1 border border-zinc-300 text-zinc-700 font-medium py-3 rounded-xl hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => settleMutation.mutate()}
                disabled={!chosenGroup || settleMutation.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {settleMutation.isPending ? <Spinner /> : 'Record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EdgeCard({
  edge,
  currentUser,
  onSettle
}: {
  edge: CrossGroupDebtEdge
  currentUser: string
  onSettle: () => void
}) {
  const isMyDebt = edge.from === currentUser

  return (
    <div className={`bg-white border rounded-2xl p-4 flex items-center gap-3
      ${isMyDebt ? 'border-red-200' : 'border-zinc-200'}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2
        ${isMyDebt ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
        {edge.from[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-700">
          <span className="font-semibold text-zinc-900">
            {edge.from === currentUser ? 'You' : `@${edge.from}`}
          </span>
          {' '}owe{edge.from === currentUser ? '' : 's'}{' '}
          <span className="font-semibold text-zinc-900">
            {edge.to === currentUser ? 'you' : `@${edge.to}`}
          </span>
        </p>
        {edge.suggestedGroup && (
          <p className="text-xs text-zinc-400 mt-0.5">
            via {edge.suggestedGroup.name}
          </p>
        )}
      </div>
      <p className={`font-bold text-lg shrink-0 ${isMyDebt ? 'text-red-600' : 'text-emerald-600'}`}>
        {formatAmount(edge.amount, edge.currency)}
      </p>
      {isMyDebt && (
        <button
          onClick={onSettle}
          className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3 py-2 rounded-lg transition-colors shrink-0"
        >
          Pay
        </button>
      )}
    </div>
  )
}

/** Count how many transactions settling each group independently would require */
function countNaiveTransactions(groups: GroupEvents[]): number {
  let count = 0
  for (const g of groups) {
    count += computeCrossGroupSettlements([g]).length
  }
  return count
}
