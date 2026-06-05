import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { addExpense } from '../lib/eventLog'
import { listMembers, getGroupConfig } from '../lib/github'
import { formatAmount } from '../lib/balances'
import { Spinner } from '../components/Spinner'

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD', 'JPY']

export function AddExpense() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>()
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [paidBy, setPaidBy] = useState(user?.login ?? '')
  const [participants, setParticipants] = useState<Set<string>>(
    new Set(user ? [user.login] : [])
  )
  const [selectedTag, setSelectedTag] = useState<string>('')

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['members', owner, repo],
    queryFn: () => listMembers(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo
  })

  const { data: configData } = useQuery({
    queryKey: ['config', owner, repo],
    queryFn: () => getGroupConfig(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo
  })

  const tags = configData?.config.tags ?? []

  const mutation = useMutation({
    mutationFn: () =>
      addExpense(octokit!, owner!, repo!, {
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

  function toggleParticipant(login: string) {
    setParticipants(prev => {
      const next = new Set(prev)
      if (next.has(login)) next.delete(login)
      else next.add(login)
      return next
    })
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(`/groups/${owner}/${repo}`)} className="text-zinc-500 hover:text-zinc-900">
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-zinc-900">Add Expense</h1>
      </div>

      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">What was it for?</label>
          <input
            type="text" value={description} onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Dinner at Nobu"
            className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Amount</label>
          <div className="flex gap-2">
            <select value={currency} onChange={e => setCurrency(e.target.value)}
              className="border border-zinc-300 rounded-xl px-3 py-3 text-zinc-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm">
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00" min="0.01" step="0.01"
              className="flex-1 border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
            />
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
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all
                      ${selected ? 'border-transparent text-white' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 bg-white'}`}
                    style={selected ? { backgroundColor: tag.color } : {}}>
                    {tag.emoji && <span>{tag.emoji}</span>}
                    {tag.name}
                    {selected && (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2 7l4 4 6-6" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Paid by</label>
          {membersLoading ? <Spinner className="py-4" /> : (
            <div className="flex flex-wrap gap-2">
              {(members ?? []).map(m => (
                <button key={m.login} onClick={() => setPaidBy(m.login)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors
                    ${paidBy === m.login ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-white border-zinc-300 text-zinc-600 hover:border-zinc-400'}`}>
                  <img src={m.avatarUrl} alt={m.login} className="w-5 h-5 rounded-full" />
                  @{m.login}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">
            Split between <span className="text-zinc-400 font-normal text-xs">(equal split)</span>
          </label>
          {membersLoading ? <Spinner className="py-4" /> : (
            <div className="space-y-2">
              {(members ?? []).map(m => (
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
          )}
        </div>

        {isValid && (
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-sm text-zinc-600">
            <span className="font-medium text-zinc-900">@{paidBy}</span> paid{' '}
            <span className="font-medium text-zinc-900">{formatAmount(parsedAmount, currency)}</span>
            {' '}for {participants.size} people. Each owes{' '}
            <span className="font-medium text-emerald-600">{formatAmount(perPerson, currency)}</span>.
            {selectedTag && <span className="ml-1">Tagged: {selectedTag}.</span>}
          </div>
        )}

        {mutation.error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
            {mutation.error instanceof Error ? mutation.error.message : 'Failed to add expense'}
          </div>
        )}

        <button onClick={() => mutation.mutate()} disabled={!isValid || mutation.isPending}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl text-base transition-colors flex items-center justify-center gap-2">
          {mutation.isPending ? <><Spinner /> Saving…</> : 'Add Expense'}
        </button>
      </div>
    </div>
  )
}
