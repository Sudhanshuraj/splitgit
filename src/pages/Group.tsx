/**
 * Single group detail page.
 * Shows expense history, per-person balances, and allows adding members.
 */
import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { readEvents } from '../lib/eventLog'
import { computeNetBalances, minimumTransactions, formatAmount } from '../lib/balances'
import { listMembers, inviteMember } from '../lib/github'
import { Spinner } from '../components/Spinner'
import type { Event, Expense, Settlement } from '../types'

export function Group() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>()
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showInvite, setShowInvite] = useState(false)
  const [inviteUsername, setInviteUsername] = useState('')
  const [activeTab, setActiveTab] = useState<'balances' | 'history'>('balances')

  const { data: eventData, isLoading: eventsLoading } = useQuery({
    queryKey: ['events', owner, repo],
    queryFn: () => readEvents(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo,
    staleTime: 10_000,
    refetchOnWindowFocus: true
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

  if (!owner || !repo) {
    navigate('/groups')
    return null
  }

  const events = eventData?.events ?? []
  const balances = computeNetBalances(events)
  const defaultCurrency = events.find(e => e.type === 'EXPENSE')
    ? (events.find(e => e.type === 'EXPENSE') as Expense).currency
    : 'USD'
  const settlements = minimumTransactions(balances, defaultCurrency)

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
        <Link
          to={`/groups/${owner}/${repo}/add`}
          className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shrink-0"
        >
          + Add
        </Link>
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

      {/* Tabs */}
      <div className="flex bg-zinc-100 rounded-xl p-1 mb-4">
        {(['balances', 'history'] as const).map(tab => (
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

      {/* History tab */}
      {!eventsLoading && activeTab === 'history' && (
        <div className="space-y-2">
          {events.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <p className="text-sm">No events yet.</p>
            </div>
          ) : (
            [...events].reverse().map(event => (
              <EventRow key={event.id} event={event} />
            ))
          )}
        </div>
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

function EventRow({ event }: { event: Event }) {
  const date = new Date(event.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric'
  })

  if (event.type === 'EXPENSE') {
    const e = event as Expense
    return (
      <div className="bg-white border border-zinc-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-lg shrink-0">💸</div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-zinc-900 truncate">{e.description}</p>
          <p className="text-xs text-zinc-400">paid by @{e.paidBy} · {date}</p>
        </div>
        <p className="font-semibold text-zinc-900 shrink-0">{formatAmount(e.amount, e.currency)}</p>
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
