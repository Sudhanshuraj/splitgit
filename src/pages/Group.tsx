/**
 * Single group detail page.
 * Shows expense history, per-person balances, and allows adding members.
 */
import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { readEvents, resolveExpenses, deleteExpense } from '../lib/eventLog'
import { computeNetBalances, minimumTransactions, formatAmount } from '../lib/balances'
import { listMembers, inviteMember, getGroupConfig } from '../lib/github'
import { Spinner } from '../components/Spinner'
import { Analytics } from '../components/Analytics'
import type { Event, Expense, Settlement, TagConfig } from '../types'

export function Group() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>()
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showInvite, setShowInvite] = useState(false)
  const [inviteUsername, setInviteUsername] = useState('')
  const [activeTab, setActiveTab] = useState<'balances' | 'history' | 'analytics'>('balances')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const { data: eventData, isLoading: eventsLoading } = useQuery({
    queryKey: ['events', owner, repo],
    queryFn: () => readEvents(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo,
    staleTime: 10_000,
    refetchOnWindowFocus: true
  })

  const { data: configData } = useQuery({
    queryKey: ['config', owner, repo],
    queryFn: () => getGroupConfig(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo,
    staleTime: 60_000
  })

  const { data: members } = useQuery({
    queryKey: ['members', owner, repo],
    queryFn: () => listMembers(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo,
    staleTime: 60_000
  })

  const inviteMutation = useMutation({
    mutationFn: (username: string) => inviteMember(octokit!, owner!, repo!, username),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', owner, repo] })
      setShowInvite(false)
      setInviteUsername('')
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (expenseId: string) =>
      deleteExpense(octokit!, owner!, repo!, expenseId, user!.login),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events', owner, repo] })
      setConfirmDeleteId(null)
    }
  })

  if (!owner || !repo) {
    navigate('/groups')
    return null
  }

  const events = eventData?.events ?? []

  // Resolve events: apply edits + deletions before computing balances
  const effectiveEvents = [
    ...resolveExpenses(events),
    ...events.filter(e => e.type === 'SETTLEMENT')
  ] as Event[]

  const balances = computeNetBalances(effectiveEvents)
  const defaultCurrency = events.find(e => e.type === 'EXPENSE')
    ? (events.find(e => e.type === 'EXPENSE') as Expense).currency
    : 'USD'
  const settlements = minimumTransactions(balances, defaultCurrency)

  // Build set of expense IDs that have been superseded (have a newer version)
  const supersededIds = new Set(
    events
      .filter(e => e.type === 'EXPENSE' && (e as Expense).supersedesId)
      .map(e => (e as Expense).supersedesId!)
  )
  // Build set of IDs that ARE corrections (they supersede something)
  const correctedIds = new Set(
    events
      .filter(e => e.type === 'EXPENSE' && (e as Expense).supersedesId)
      .map(e => e.id)
  )

  const isOwner = owner === user?.login

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
          {isOwner && (
            <Link to={`/groups/${owner}/${repo}/settings`}
              className="text-zinc-400 hover:text-zinc-700 p-1.5 rounded-lg hover:bg-zinc-100 transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            </Link>
          )}
          <Link to={`/groups/${owner}/${repo}/add`}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shrink-0">
            + Add
          </Link>
        </div>
      </div>

      {/* Members strip */}
      {members && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-700">Members</h2>
            {isOwner && (
              <button
                onClick={() => setShowInvite(true)}
                className="text-emerald-600 text-xs font-medium hover:text-emerald-700"
              >
                + Invite
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {members.map(m => (
              <div key={m.login} className="flex items-center gap-1.5 bg-zinc-50 rounded-full px-3 py-1">
                <img src={m.avatarUrl} alt={m.login} className="w-5 h-5 rounded-full" />
                <span className="text-xs text-zinc-700 font-medium">@{m.login}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-4 pb-safe">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-zinc-900 mb-4">Invite Member</h2>
            <input
              type="text"
              value={inviteUsername}
              onChange={e => setInviteUsername(e.target.value.trim())}
              placeholder="GitHub username"
              className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              autoFocus
            />
            {inviteMutation.error && (
              <p className="text-red-600 text-sm mt-2">
                {inviteMutation.error instanceof Error ? inviteMutation.error.message : 'Failed to invite'}
              </p>
            )}
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setShowInvite(false); setInviteUsername('') }}
                className="flex-1 border border-zinc-300 text-zinc-700 font-medium py-3 rounded-xl hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => inviteMutation.mutate(inviteUsername)}
                disabled={!inviteUsername || inviteMutation.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {inviteMutation.isPending ? <Spinner /> : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-4 pb-safe">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-zinc-900 mb-2">Delete Expense?</h2>
            <p className="text-sm text-zinc-500 mb-1">
              The expense will be hidden from balances and history.
            </p>
            <p className="text-xs text-zinc-400 mb-5">
              The original commit is preserved in git history.
            </p>
            {deleteMutation.error && (
              <p className="text-red-600 text-sm mb-3">
                {deleteMutation.error instanceof Error ? deleteMutation.error.message : 'Failed to delete'}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmDeleteId(null); deleteMutation.reset() }}
                className="flex-1 border border-zinc-300 text-zinc-700 font-medium py-3 rounded-xl hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(confirmDeleteId)}
                disabled={deleteMutation.isPending}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-zinc-300 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {deleteMutation.isPending ? <Spinner /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-zinc-100 rounded-xl p-1 mb-4">
        {(['balances', 'history', 'analytics'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg capitalize transition-colors
              ${activeTab === tab ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {eventsLoading && <Spinner className="py-12" />}

      {/* Balances tab */}
      {!eventsLoading && activeTab === 'balances' && (
        <div className="space-y-3">
          {events.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <p className="text-4xl mb-3">💸</p>
              <p className="font-medium text-zinc-700">No expenses yet</p>
              <p className="text-sm mt-1">Add the first one to get started.</p>
            </div>
          ) : settlements.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <p className="text-4xl mb-3">✅</p>
              <p className="font-medium text-zinc-700">All settled up!</p>
              <p className="text-sm mt-1">No outstanding balances.</p>
            </div>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">Who owes who</h2>
              {settlements.map((s, i) => (
                <div key={i} className="bg-white border border-zinc-200 rounded-2xl p-4 flex items-center gap-3">
                  <MemberAvatar login={s.from} members={members ?? []} />
                  <div className="flex-1">
                    <p className="text-sm text-zinc-700">
                      <span className="font-semibold text-zinc-900">@{s.from}</span>
                      {' '}owes{' '}
                      <span className="font-semibold text-zinc-900">@{s.to}</span>
                    </p>
                    <p className="text-lg font-bold text-emerald-600 mt-0.5">
                      {formatAmount(s.amount, s.currency)}
                    </p>
                  </div>
                  <MemberAvatar login={s.to} members={members ?? []} />
                  {user?.login === s.from && (
                    <Link
                      to={`/groups/${owner}/${repo}/settle`}
                      state={{ to: s.to, amount: s.amount, currency: s.currency }}
                      className="text-xs bg-emerald-50 text-emerald-700 font-semibold px-3 py-1.5 rounded-lg hover:bg-emerald-100 transition-colors"
                    >
                      Settle
                    </Link>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* History tab — shows all events; superseded expenses are hidden (greyed) */}
      {!eventsLoading && activeTab === 'history' && (
        <div className="space-y-2">
          {events.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <p className="text-sm">No events yet.</p>
            </div>
          ) : (
            [...events].reverse()
              // Hide superseded versions — they exist in git but not in the UI
              .filter(e => !supersededIds.has(e.id))
              .map(event => (
                <EventRow
                  key={event.id}
                  event={event}
                  tags={configData?.config.tags ?? []}
                  isEdited={correctedIds.has(event.id)}
                  canEdit={
                    event.type === 'EXPENSE' &&
                    (user?.login === (event as Expense).paidBy || user?.login === owner)
                  }
                  editUrl={`/groups/${owner}/${repo}/edit/${event.id}`}
                  onDelete={
                    event.type === 'EXPENSE' &&
                    (user?.login === (event as Expense).paidBy || user?.login === owner)
                      ? () => setConfirmDeleteId(event.id)
                      : undefined
                  }
                />
              ))
          )}
        </div>
      )}

      {/* Analytics tab */}
      {!eventsLoading && activeTab === 'analytics' && (
        <Analytics
          events={events}
          tags={configData?.config.tags ?? []}
          currency={defaultCurrency}
        />
      )}
    </div>
  )
}

function MemberAvatar({ login, members }: { login: string; members: { login: string; avatarUrl: string }[] }) {
  const member = members.find(m => m.login === login)
  return member
    ? <img src={member.avatarUrl} alt={login} title={`@${login}`} className="w-9 h-9 rounded-full border-2 border-zinc-200" />
    : <div className="w-9 h-9 rounded-full bg-zinc-200 flex items-center justify-center text-zinc-500 text-xs font-bold border-2 border-zinc-300">{login[0]?.toUpperCase()}</div>
}

function EventRow({
  event, tags, isEdited = false, canEdit = false, editUrl = '', onDelete
}: {
  event: Event
  tags: TagConfig[]
  isEdited?: boolean
  canEdit?: boolean
  editUrl?: string
  onDelete?: () => void
}) {
  const date = new Date(event.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric'
  })
  const tagEmojiMap = new Map(tags.filter(t => t.emoji).map(t => [t.name, t.emoji!]))

  if (event.type === 'EXPENSE') {
    const e = event as Expense
    return (
      <div className="bg-white border border-zinc-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-lg shrink-0">💸</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-zinc-900 truncate">{e.description}</p>
            {isEdited && (
              <span className="shrink-0 text-xs bg-amber-100 text-amber-700 font-medium px-1.5 py-0.5 rounded-full">
                edited
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <p className="text-xs text-zinc-400">paid by @{e.paidBy} · {date}</p>
            {(e.tags ?? []).map(tag => (
              <span key={tag} className="text-xs px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600 font-medium">
                {tagEmojiMap.get(tag) && <span className="mr-0.5">{tagEmojiMap.get(tag)}</span>}
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <p className="font-semibold text-zinc-900">{formatAmount(e.amount, e.currency)}</p>
          {canEdit && (
            <Link to={editUrl}
              className="text-zinc-400 hover:text-zinc-700 p-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
              title="Edit expense">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </Link>
          )}
          {onDelete && (
            <button onClick={onDelete}
              className="text-zinc-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
              title="Delete expense">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>
    )
  } else {
    const s = event as Settlement
    return (
      <div className="bg-white border border-zinc-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-lg shrink-0">✅</div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-zinc-900 text-sm">
            @{s.from} → @{s.to}
          </p>
          <p className="text-xs text-zinc-400">Settlement · {date}</p>
        </div>
        <p className="font-semibold text-emerald-600 shrink-0">{formatAmount(s.amount, s.currency)}</p>
      </div>
    )
  }
}
