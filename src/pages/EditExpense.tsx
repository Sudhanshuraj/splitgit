/**
 * Edit an existing expense.
 *
 * Append-only: creates a new corrected event with supersedesId pointing
 * to the original. Both commits are visible in git history.
 * The UI shows only the latest version.
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { readEvents, editExpense } from '../lib/eventLog'
import { listMembers, getGroupConfig } from '../lib/github'
import { formatAmount } from '../lib/balances'
import { Spinner } from '../components/Spinner'
import type { Expense } from '../types'

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD', 'JPY']

export function EditExpense() {
  const { owner, repo, expenseId } = useParams<{
    owner: string; repo: string; expenseId: string
  }>()
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [paidBy, setPaidBy] = useState('')
  const [participants, setParticipants] = useState<Set<string>>(new Set())
  const [selectedTag, setSelectedTag] = useState<string>('')
  const [loaded, setLoaded] = useState(false)

  // Load events to find the original expense
  const { data: eventData, isLoading: eventsLoading } = useQuery({
    queryKey: ['events', owner, repo],
    queryFn: () => readEvents(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo,
    staleTime: 10_000
  })

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['members', owner, repo],
    queryFn: () => listMembers(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo
  })

  const { data: configData } = useQuery({
    queryKey: ['config', owner, repo],
    queryFn: () => getGroupConfig(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo
  })

  // Find the expense and pre-fill form once loaded
  const original = eventData?.events
    .filter(e => e.type === 'EXPENSE')
    .find(e => e.id === expenseId) as Expense | undefined

  useEffect(() => {
    if (!original || loaded) return
    setDescription(original.description)
    setAmount(original.amount.toString())
    setCurrency(original.currency)
    setPaidBy(original.paidBy)
    setParticipants(new Set(original.splits.map(s => s.username)))
    setSelectedTag(original.tags?.[0] ?? '')
    setLoaded(true)
  }, [original, loaded])

  const tags = configData?.config.tags ?? []

  const mutation = useMutation({
    mutationFn: () =>
      editExpense(octokit!, owner!, repo!, expenseId!, {
        description: description.trim(),
        amount: parseFloat(amount),
        currency,
        paidBy,
        participants: Array.from(participants),
        splitType: 'equal',
        tags: selectedTag ? [selectedTag] : []
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events', owner, repo] })
      navigate(`/groups/${owner}/${repo}`)
    }
  })

  const parsedAmount = parseFloat(amount)
  const perPerson = participants.size > 0 && !isNaN(parsedAmount)
    ? parsedAmount / participants.size : 0

  const isValid =
    description.trim().length > 0 &&
    !isNaN(parsedAmount) && parsedAmount > 0 &&
    paidBy !== '' && participants.size > 0 &&
    (tags.length === 0 || selectedTag !== '')

  // Only the payer or group owner can edit
  const canEdit = user?.login === original?.paidBy || user?.login === owner

  function toggleParticipant(login: string) {
    setParticipants(prev => {
      const next = new Set(prev)
      if (next.has(login)) next.delete(login)
      else next.add(login)
      return next
    })
  }


  if (eventsLoading || membersLoading) {
    return <Spinner className="py-16" />
  }

  if (!original) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <p className="text-4xl mb-3">🔍</p>
        <p className="font-medium text-zinc-700">Expense not found</p>
      </div>
    )
  }

  if (!canEdit) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <p className="text-4xl mb-3">🔒</p>
        <p className="font-medium text-zinc-700">Only the payer or group owner can edit</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => navigate(`/groups/${owner}/${repo}`)} className="text-zinc-500 hover:text-zinc-900">
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-zinc-900">Edit Expense</h1>
      </div>

      {/* Audit note */}
      <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
        <span className="font-semibold">Append-only:</span> This saves a corrected version as a new git commit.
        The original is preserved in history and linked via{' '}
        <code className="bg-amber-100 px-1 rounded">supersedesId</code>.
      </div>

      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">What was it for?</label>
          <input type="text" value={description} onChange={e => setDescription(e.target.value)}
            className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base" />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Amount</label>
          <div className="flex gap-2">
            <select value={currency} onChange={e => setCurrency(e.target.value)}
              className="border border-zinc-300 rounded-xl px-3 py-3 text-zinc-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm">
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              min="0.01" step="0.01"
              className="flex-1 border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base" />
          </div>
        </div>

        {/* Tag — single required selection */}
        {tags.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Tag <span className="text-red-400 text-xs">required</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => {
                const selected = selectedTag === tag.name
                return (
                  <button key={tag.name} type="button"
                    onClick={() => setSelectedTag(selected ? '' : tag.name)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-all
                      ${selected
                        ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                        : 'bg-white border-zinc-300 text-zinc-600 hover:border-zinc-400'}`}>
                    {tag.emoji && <span>{tag.emoji}</span>}
                    {tag.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Paid by</label>
          <div className="flex flex-wrap gap-2">
            {(membersData ?? []).map(m => (
              <button key={m.login} onClick={() => setPaidBy(m.login)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors
                  ${paidBy === m.login ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-white border-zinc-300 text-zinc-600 hover:border-zinc-400'}`}>
                <img src={m.avatarUrl} alt={m.login} className="w-5 h-5 rounded-full" />
                @{m.login}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">
            Split between <span className="text-zinc-400 font-normal text-xs">(equal split)</span>
          </label>
          <div className="space-y-2">
            {(membersData ?? []).map(m => (
              <button key={m.login} onClick={() => toggleParticipant(m.login)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm transition-colors
                  ${participants.has(m.login) ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-zinc-200 hover:border-zinc-300'}`}>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                  ${participants.has(m.login) ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-300'}`}>
                  {participants.has(m.login) && (
                    <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                  )}
                </div>
                <img src={m.avatarUrl} alt={m.login} className="w-7 h-7 rounded-full" />
                <span className="font-medium text-zinc-800">@{m.login}</span>
                {participants.has(m.login) && perPerson > 0 && (
                  <span className="ml-auto text-emerald-600 font-semibold">{formatAmount(perPerson, currency)}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {isValid && (
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-sm text-zinc-600">
            <span className="font-medium text-zinc-900">@{paidBy}</span> paid{' '}
            <span className="font-medium text-zinc-900">{formatAmount(parsedAmount, currency)}</span>
            {' '}for {participants.size} people. Each owes{' '}
            <span className="font-medium text-emerald-600">{formatAmount(perPerson, currency)}</span>.
          </div>
        )}

        {mutation.error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
            {mutation.error instanceof Error ? mutation.error.message : 'Failed to save edit'}
          </div>
        )}

        <button onClick={() => mutation.mutate()} disabled={!isValid || mutation.isPending}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl text-base transition-colors flex items-center justify-center gap-2">
          {mutation.isPending ? <><Spinner /> Saving…</> : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
