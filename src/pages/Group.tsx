/**
 * Single group detail page: balances, history (grouped by month, filterable),
 * and analytics. People are ledger members (numeric ids); a GitHub user claims
 * a slot in Settings.
 */
import { useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { readEvents, resolveExpenses, buildDeletion } from '../lib/eventLog'
import { optimisticAppend } from '../lib/optimistic'
import { computeNetBalances, minimumTransactions, formatAmount } from '../lib/balances'
import { inviteMember, getGroupConfig, getRepoArchived } from '../lib/github'
import { memberName, memberInitial, myMemberId, isPayer, payerLabel } from '../lib/members'
import { Spinner } from '../components/Spinner'
import { Analytics } from '../components/Analytics'
import { TransactionDetailModal } from '../components/TransactionDetailModal'
import type { Event, Expense, Settlement, ExpenseDeletion, ConfigChange, TagConfig, GroupConfig } from '../types'

type HistRange = 'all' | 'this-month' | 'last-month' | 'this-year'

function eventDate(e: Event): Date {
  if (e.type === 'EXPENSE') {
    const iso = (e as Expense).date ?? e.createdAt.slice(0, 10)
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y!, m! - 1, d!)
  }
  return new Date(e.createdAt)
}
function inRange(d: Date, range: HistRange): boolean {
  if (range === 'all') return true
  const now = new Date()
  if (range === 'this-month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  if (range === 'last-month') {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth()
  }
  return d.getFullYear() === now.getFullYear() // this-year
}

export function Group() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>()
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showInvite, setShowInvite] = useState(false)
  const [inviteUsername, setInviteUsername] = useState('')
  const [activeTab, setActiveTab] = useState<'balances' | 'history' | 'activity' | 'analytics'>('balances')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [histRange, setHistRange] = useState<HistRange>('all')
  const [histTag, setHistTag] = useState<string>('all')
  const [histSearch, setHistSearch] = useState('')
  const [detailEvent, setDetailEvent] = useState<Event | null>(null)

  const { data: eventData, isLoading: eventsLoading } = useQuery({
    queryKey: ['events', owner, repo],
    queryFn: () => readEvents(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo,
    staleTime: 30_000,
    refetchOnWindowFocus: false
  })

  const { data: configData } = useQuery({
    queryKey: ['config', owner, repo],
    queryFn: () => getGroupConfig(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo,
    staleTime: 60_000
  })
  const config = configData?.config
  const ledger = config?.members ?? []

  const { data: isArchived = false } = useQuery({
    queryKey: ['repo-archived', owner, repo],
    queryFn: () => getRepoArchived(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo,
    staleTime: 300_000
  })

  const inviteMutation = useMutation({
    mutationFn: (username: string) => inviteMember(octokit!, owner!, repo!, username),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['members', owner, repo] }); setShowInvite(false); setInviteUsername('') }
  })

  async function doDelete(expenseId: string) {
    const event = await buildDeletion(expenseId, user!.login)
    optimisticAppend(qc, octokit!, owner!, repo!, event, 'deletion')
    setConfirmDeleteId(null)
  }

  const events = eventData?.events ?? []
  const myId = myMemberId(config, user?.login)

  const effectiveEvents = useMemo(() => [
    ...resolveExpenses(events),
    ...events.filter(e => e.type === 'SETTLEMENT')
  ] as Event[], [events])

  const balances = computeNetBalances(effectiveEvents)
  const lastExpense = [...events].reverse().find(e => e.type === 'EXPENSE') as Expense | undefined
  const defaultCurrency = lastExpense?.currency ?? 'INR'
  const settlements = minimumTransactions(balances, defaultCurrency)

  const deletedExpenseIds = new Set(
    events.filter(e => e.type === 'EXPENSE_DELETION').map(e => (e as ExpenseDeletion).deletedId)
  )
  const supersededIds = new Set(
    events.filter(e => e.type === 'EXPENSE' && (e as Expense).supersedesId).map(e => (e as Expense).supersedesId!)
  )
  const correctedIds = new Set(
    events.filter(e => e.type === 'EXPENSE' && (e as Expense).supersedesId).map(e => e.id)
  )

  const isOwner = owner === user?.login

  // History: filtered + grouped by month
  const monthGroups = useMemo(() => {
    const visible = [...events].reverse().filter(e =>
      (e.type === 'EXPENSE' || e.type === 'SETTLEMENT') && !supersededIds.has(e.id) && !deletedExpenseIds.has(e.id)
    )
    const q = histSearch.trim().toLowerCase()
    const filtered = visible.filter(e => {
      if (!inRange(eventDate(e), histRange)) return false
      if (histTag !== 'all') {
        if (e.type !== 'EXPENSE') return false
        if ((e as Expense).tags[0] !== histTag) return false
      }
      if (q) {
        if (e.type === 'EXPENSE') { if (!(e as Expense).description.toLowerCase().includes(q)) return false }
        else return false
      }
      return true
    })
    const groupsMap = new Map<string, { label: string; items: Event[] }>()
    for (const e of filtered) {
      const d = eventDate(e)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!groupsMap.has(key)) {
        groupsMap.set(key, { label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), items: [] })
      }
      groupsMap.get(key)!.items.push(e)
    }
    // Sort strictly by transaction date within each month — never by when it
    // was added. Same-day items fall back to createdAt only to keep the
    // order stable (deterministic), not to imply add-order matters.
    for (const g of groupsMap.values()) {
      g.items.sort((a, b) => {
        const byDate = +eventDate(b) - +eventDate(a)
        return byDate !== 0 ? byDate : b.createdAt.localeCompare(a.createdAt)
      })
    }
    return [...groupsMap.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, v]) => v)
  }, [events, histRange, histTag, histSearch, supersededIds, deletedExpenseIds])

  // Activity: every event (adds, edits, deletions, settlements, config
  // changes) in the exact order it was actually committed — unlike History,
  // nothing is resolved away or re-sorted by expense date. This is the "what
  // did I actually do, in order" view — useful when you're back-filling
  // expenses from a previous week and want to confirm what's already in.
  const expenseById = useMemo(() => {
    const m = new Map<string, Expense>()
    for (const e of events) if (e.type === 'EXPENSE') m.set(e.id, e as Expense)
    return m
  }, [events])

  const activityGroups = useMemo(() => {
    const sorted = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const groupsMap = new Map<string, { label: string; items: Event[] }>()
    for (const e of sorted) {
      const d = new Date(e.createdAt)
      const key = d.toISOString().slice(0, 10)
      if (!groupsMap.has(key)) {
        groupsMap.set(key, { label: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), items: [] })
      }
      groupsMap.get(key)!.items.push(e)
    }
    return [...groupsMap.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, v]) => v)
  }, [events])

  if (!owner || !repo) { navigate('/groups'); return null }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/groups')} className="text-zinc-500 hover:text-zinc-900">
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-zinc-900 truncate">{repo}</h1>
          <p className="text-xs text-zinc-400">@{owner}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/groups/${owner}/${repo}/settings`} className="text-zinc-400 hover:text-zinc-700 p-1.5 rounded-lg hover:bg-zinc-100 transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          </Link>
          {isArchived ? (
            <span className="text-xs bg-amber-100 text-amber-700 font-medium px-3 py-2 rounded-xl shrink-0">archived</span>
          ) : (
            <Link to={`/groups/${owner}/${repo}/add`} className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shrink-0">+ Add</Link>
          )}
        </div>
      </div>

      {/* Claim banner */}
      {config && ledger.length > 0 && myId == null && (
        <Link to={`/groups/${owner}/${repo}/settings`}
          className="block bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 text-sm text-blue-700 hover:bg-blue-100 transition-colors">
          👋 You haven't linked yourself to a member yet. <span className="font-semibold underline">Pick who you are →</span>
        </Link>
      )}

      {/* Members strip (ledger) */}
      {ledger.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-700">Members</h2>
            {isOwner && <button onClick={() => setShowInvite(true)} className="text-emerald-600 text-xs font-medium hover:text-emerald-700">+ Invite to repo</button>}
          </div>
          <div className="flex flex-wrap gap-2">
            {ledger.map(m => (
              <div key={m.id} className="flex items-center gap-1.5 bg-zinc-50 rounded-full pl-1.5 pr-3 py-1">
                <span className="w-5 h-5 rounded-full bg-zinc-200 text-zinc-600 text-[10px] font-bold flex items-center justify-center">{memberInitial(m.id, config)}</span>
                <span className="text-xs text-zinc-700 font-medium">{m.name}</span>
                {m.claimedBy && <span className="text-[10px] text-emerald-600">✓</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 pb-safe">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-zinc-900 mb-1">Invite to repo</h2>
            <p className="text-xs text-zinc-500 mb-4">Gives a GitHub user access. They then claim their member slot in Settings.</p>
            <input type="text" value={inviteUsername} onChange={e => setInviteUsername(e.target.value.trim())}
              placeholder="GitHub username" autoFocus
              className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            {inviteMutation.error && <p className="text-red-600 text-sm mt-2">{inviteMutation.error instanceof Error ? inviteMutation.error.message : 'Failed to invite'}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowInvite(false); setInviteUsername('') }} className="flex-1 border border-zinc-300 text-zinc-700 font-medium py-3 rounded-xl hover:bg-zinc-50 transition-colors">Cancel</button>
              <button onClick={() => inviteMutation.mutate(inviteUsername)} disabled={!inviteUsername || inviteMutation.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
                {inviteMutation.isPending ? <Spinner /> : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 pb-safe">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-zinc-900 mb-2">Delete Expense?</h2>
            <p className="text-sm text-zinc-500 mb-1">The expense will be hidden from balances and history.</p>
            <p className="text-xs text-zinc-400 mb-5">The original commit is preserved in git history.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDeleteId(null)} className="flex-1 border border-zinc-300 text-zinc-700 font-medium py-3 rounded-xl hover:bg-zinc-50 transition-colors">Cancel</button>
              <button onClick={() => doDelete(confirmDeleteId)}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-zinc-100 rounded-xl p-1 mb-4">
        {(['balances', 'history', 'activity', 'analytics'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg capitalize transition-colors ${activeTab === tab ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
            {tab}
          </button>
        ))}
      </div>

      {eventsLoading && <Spinner className="py-12" />}

      {/* Balances */}
      {!eventsLoading && activeTab === 'balances' && (
        <div className="space-y-3">
          {events.length === 0 ? (
            <div className="text-center py-12 text-zinc-500"><p className="text-4xl mb-3">💸</p><p className="font-medium text-zinc-700">No expenses yet</p><p className="text-sm mt-1">Add the first one to get started.</p></div>
          ) : settlements.length === 0 ? (
            <div className="text-center py-12 text-zinc-500"><p className="text-4xl mb-3">✅</p><p className="font-medium text-zinc-700">All settled up!</p><p className="text-sm mt-1">No outstanding balances.</p></div>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">Who owes who</h2>
              {settlements.map((s, i) => (
                <div key={i} className="bg-white border border-zinc-200 rounded-2xl p-4 flex items-center gap-3">
                  <span className="w-9 h-9 rounded-full bg-zinc-200 text-zinc-600 font-bold flex items-center justify-center border-2 border-zinc-100">{memberInitial(s.from, config)}</span>
                  <div className="flex-1">
                    <p className="text-sm text-zinc-700">
                      <span className="font-semibold text-zinc-900">{memberName(s.from, config)}</span> owes <span className="font-semibold text-zinc-900">{memberName(s.to, config)}</span>
                    </p>
                    <p className="text-lg font-bold text-emerald-600 mt-0.5">{formatAmount(s.amount, s.currency)}</p>
                  </div>
                  <span className="w-9 h-9 rounded-full bg-zinc-200 text-zinc-600 font-bold flex items-center justify-center border-2 border-zinc-100">{memberInitial(s.to, config)}</span>
                  {myId != null && myId === s.from && (
                    <Link to={`/groups/${owner}/${repo}/settle`} state={{ to: s.to, amount: s.amount }}
                      className="text-xs bg-emerald-50 text-emerald-700 font-semibold px-3 py-1.5 rounded-lg hover:bg-emerald-100 transition-colors">Settle</Link>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* History */}
      {!eventsLoading && activeTab === 'history' && (
        <div>
          {/* Search */}
          <div className="relative mb-3">
            <svg className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
            </svg>
            <input type="text" value={histSearch} onChange={e => setHistSearch(e.target.value)} placeholder="Search description…"
              className="w-full border border-zinc-200 rounded-xl pl-9 pr-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white" />
          </div>
          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-3">
            {([['all', 'All'], ['this-month', 'This Month'], ['last-month', 'Last Month'], ['this-year', 'This Year']] as [HistRange, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setHistRange(k)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${histRange === k ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>{label}</button>
            ))}
          </div>
          {(config?.tags.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              <button onClick={() => setHistTag('all')} className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${histTag === 'all' ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>All tags</button>
              {config!.tags.map(t => (
                <button key={t.id} onClick={() => setHistTag(t.id)} className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors flex items-center gap-1 ${histTag === t.id ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                  {t.emoji && <span>{t.emoji}</span>}{t.name}
                </button>
              ))}
            </div>
          )}

          {monthGroups.length === 0 ? (
            <div className="text-center py-12 text-zinc-500"><p className="text-sm">No events in this filter.</p></div>
          ) : (
            <div className="space-y-5">
              {monthGroups.map(group => {
                const monthTotal = group.items.filter(e => e.type === 'EXPENSE').reduce((s, e) => s + (e as Expense).amount, 0)
                return (
                  <div key={group.label}>
                    <div className="flex items-center justify-between mb-2 px-1">
                      <h3 className="text-sm font-bold text-zinc-700">{group.label}</h3>
                      <span className="text-xs text-zinc-400">{formatAmount(monthTotal, defaultCurrency)}</span>
                    </div>
                    <div className="space-y-2">
                      {group.items.map(event => (
                        <EventRow key={event.id} event={event} tags={config?.tags ?? []} config={config ?? null}
                          isEdited={correctedIds.has(event.id)}
                          onOpenDetail={() => setDetailEvent(event)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Activity — the raw, true-order log of everything done in this group */}
      {!eventsLoading && activeTab === 'activity' && (
        <div>
          {activityGroups.length === 0 ? (
            <div className="text-center py-12 text-zinc-500"><p className="text-sm">Nothing logged yet.</p></div>
          ) : (
            <div className="space-y-5">
              {activityGroups.map(group => (
                <div key={group.label}>
                  <h3 className="text-sm font-bold text-zinc-700 mb-2 px-1">{group.label}</h3>
                  <div className="space-y-2">
                    {group.items.map(event => (
                      <ActivityRow key={event.id} event={event} config={config ?? null} expenseById={expenseById}
                        onOpenDetail={(event.type === 'EXPENSE' || event.type === 'SETTLEMENT') ? () => setDetailEvent(event) : undefined} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Analytics */}
      {!eventsLoading && activeTab === 'analytics' && (
        <Analytics events={effectiveEvents} tags={config?.tags ?? []} currency={defaultCurrency} config={config ?? null}
          onSelectExpense={e => setDetailEvent(e)} />
      )}

      {/* Shared transaction detail modal — same view everywhere: History, Activity, Analytics */}
      {detailEvent && (
        <TransactionDetailModal
          event={detailEvent}
          config={config ?? null}
          tags={config?.tags ?? []}
          canEdit={detailEvent.type === 'EXPENSE' && ((myId != null && isPayer(detailEvent as Expense, myId)) || isOwner)}
          editUrl={`/groups/${owner}/${repo}/edit/${detailEvent.id}`}
          onDelete={detailEvent.type === 'EXPENSE' ? () => setConfirmDeleteId(detailEvent.id) : undefined}
          onClose={() => setDetailEvent(null)}
          originalExpense={detailEvent.type === 'EXPENSE_DELETION' ? expenseById.get((detailEvent as ExpenseDeletion).deletedId) ?? null : undefined}
        />
      )}
    </div>
  )
}

function EventRow({
  event, tags, config, isEdited = false, onOpenDetail
}: {
  event: Event
  tags: TagConfig[]
  config: GroupConfig | null
  isEdited?: boolean
  onOpenDetail: () => void
}) {
  const tagById = new Map(tags.map(t => [t.id, t]))
  const d = eventDate(event)
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  if (event.type === 'EXPENSE') {
    const e = event as Expense
    return (
      <button onClick={onOpenDetail}
        className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 flex items-center gap-3 text-left hover:border-emerald-300 hover:shadow-sm transition-all">
        <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-lg shrink-0">💸</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-zinc-900 truncate">{e.description}</p>
            {isEdited && <span className="shrink-0 text-xs bg-amber-100 text-amber-700 font-medium px-1.5 py-0.5 rounded-full">edited</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <p className="text-xs text-zinc-400">paid by {payerLabel(e, config)} · {dateStr}</p>
            {(e.tags ?? []).map(tagId => {
              const tag = tagById.get(tagId)
              return (
                <span key={tagId} className="text-xs px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600 font-medium">
                  {tag?.emoji && <span className="mr-0.5">{tag.emoji}</span>}{tag?.name ?? tagId}
                </span>
              )
            })}
          </div>
        </div>
        <p className="font-semibold text-zinc-900 shrink-0">{formatAmount(e.amount, e.currency)}</p>
      </button>
    )
  }
  const s = event as Settlement
  return (
    <button onClick={onOpenDetail}
      className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 flex items-center gap-3 text-left hover:border-emerald-300 hover:shadow-sm transition-all">
      <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-lg shrink-0">✅</div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-zinc-900 text-sm">{memberName(s.from, config)} → {memberName(s.to, config)}</p>
        <p className="text-xs text-zinc-400">Settlement · {dateStr}</p>
      </div>
      <p className="font-semibold text-emerald-600 shrink-0">{formatAmount(s.amount, s.currency)}</p>
    </button>
  )
}

/** One row in the Activity log — every event type, exactly as committed. */
function ActivityRow({ event, config, expenseById, onOpenDetail }: {
  event: Event
  config: GroupConfig | null
  expenseById: Map<string, Expense>
  onOpenDetail?: () => void
}) {
  const time = new Date(event.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const Row = onOpenDetail ? 'button' : 'div'

  if (event.type === 'EXPENSE') {
    const e = event
    const isEdit = !!e.supersedesId
    return (
      <Row onClick={onOpenDetail}
        className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 flex items-center gap-3 text-left hover:border-emerald-300 hover:shadow-sm transition-all">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0 ${isEdit ? 'bg-amber-50' : 'bg-blue-50'}`}>
          {isEdit ? '✏️' : '➕'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-900">
            <span className="font-medium">{isEdit ? 'Edited' : 'Added'} expense:</span>{' '}
            <span className="truncate">{e.description}</span>
          </p>
          <p className="text-xs text-zinc-400">paid by {payerLabel(e, config)} · dated {e.date} · {time}</p>
        </div>
        <p className="font-semibold text-zinc-900 shrink-0">{formatAmount(e.amount, e.currency)}</p>
      </Row>
    )
  }

  if (event.type === 'EXPENSE_DELETION') {
    const d = event as ExpenseDeletion
    const original = expenseById.get(d.deletedId)
    return (
      <div className="bg-white border border-zinc-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center text-lg shrink-0">🗑️</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-900">
            <span className="font-medium">Deleted expense:</span>{' '}
            {original ? original.description : '(unknown)'}
          </p>
          <p className="text-xs text-zinc-400">by @{d.deletedBy} · {time}</p>
        </div>
        {original && <p className="font-semibold text-zinc-400 line-through shrink-0">{formatAmount(original.amount, original.currency)}</p>}
      </div>
    )
  }

  if (event.type === 'CONFIG_CHANGE') {
    const c = event as ConfigChange
    return (
      <div className="bg-white border border-zinc-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-zinc-100 flex items-center justify-center text-lg shrink-0">🏷️</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-900">{c.summary}</p>
          <p className="text-xs text-zinc-400">by @{c.actor} · {time}</p>
        </div>
      </div>
    )
  }

  // SETTLEMENT
  const s = event as Settlement
  return (
    <Row onClick={onOpenDetail}
      className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 flex items-center gap-3 text-left hover:border-emerald-300 hover:shadow-sm transition-all">
      <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-lg shrink-0">💵</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-900">
          <span className="font-medium">Settlement:</span> {memberName(s.from, config)} → {memberName(s.to, config)}
        </p>
        <p className="text-xs text-zinc-400">{time}{s.note ? ` · ${s.note}` : ''}</p>
      </div>
      <p className="font-semibold text-emerald-600 shrink-0">{formatAmount(s.amount, s.currency)}</p>
    </Row>
  )
}
