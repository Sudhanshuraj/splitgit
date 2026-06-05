/**
 * Settle up page — records a settlement between two people in a group.
 * Can be reached from the Group page with prefilled state.
 */
import { useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { addSettlement } from '../lib/eventLog'
import { formatAmount } from '../lib/balances'
import { Spinner } from '../components/Spinner'

const CURRENCY = 'INR'

export function Settle() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>()
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()

  // Prefill from navigation state (coming from Group page)
  const prefill = location.state as { to?: string; amount?: number; currency?: string } | null

  const [to, setTo] = useState(prefill?.to ?? '')
  const [amount, setAmount] = useState(prefill?.amount?.toFixed(2) ?? '')
  const currency = CURRENCY
  const [note, setNote] = useState('')

  const parsedAmount = parseFloat(amount)
  const isValid =
    to.trim().length > 0 &&
    !isNaN(parsedAmount) &&
    parsedAmount > 0 &&
    to !== user?.login

  const mutation = useMutation({
    mutationFn: () =>
      addSettlement(octokit!, owner!, repo!, {
        from: user!.login,
        to: to.trim(),
        amount: parsedAmount,
        currency,
        note: note.trim() || undefined
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events', owner, repo] })
      navigate(`/groups/${owner}/${repo}`)
    }
  })

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(`/groups/${owner}/${repo}`)}
          className="text-zinc-500 hover:text-zinc-900"
        >
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-zinc-900">Record Settlement</h1>
      </div>

      <div className="space-y-5">
        {/* From (always current user) */}
        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 flex items-center gap-3">
          {user && (
            <img src={user.avatarUrl} alt={user.login} className="w-10 h-10 rounded-full" />
          )}
          <div>
            <p className="text-xs text-zinc-400 font-medium uppercase tracking-wide">From (you)</p>
            <p className="font-semibold text-zinc-900">@{user?.login}</p>
          </div>
        </div>

        {/* To */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">
            Paying to
          </label>
          <input
            type="text"
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="GitHub username"
            className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
          />
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Amount (₹)</label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            min="0.01"
            step="0.01"
            className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
          />
        </div>

        {/* Note */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">
            Note <span className="text-zinc-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Bank transfer on 28 May"
            className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
          />
        </div>

        {/* Summary */}
        {isValid && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-zinc-600">
            Recording that <span className="font-semibold text-zinc-900">you</span> paid{' '}
            <span className="font-semibold text-emerald-600">{formatAmount(parsedAmount, currency)}</span>
            {' '}to <span className="font-semibold text-zinc-900">@{to}</span>.
          </div>
        )}

        {mutation.error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
            {mutation.error instanceof Error ? mutation.error.message : 'Failed to record settlement'}
          </div>
        )}

        <button
          onClick={() => mutation.mutate()}
          disabled={!isValid || mutation.isPending}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl text-base transition-colors flex items-center justify-center gap-2"
        >
          {mutation.isPending ? <><Spinner /> Saving…</> : 'Record Settlement'}
        </button>
      </div>
    </div>
  )
}
