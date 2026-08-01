import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { buildExpense } from '../lib/eventLog'
import { optimisticAppend } from '../lib/optimistic'
import { getGroupConfig } from '../lib/github'
import { formatAmount } from '../lib/balances'
import { memberName, memberInitial, myMemberId } from '../lib/members'
import { SplitEditor, computeSplits, splitsAreValid } from '../components/SplitEditor'
import type { SplitState } from '../components/SplitEditor'
import { Spinner } from '../components/Spinner'
import { DatePicker } from '../components/DatePicker'

const CURRENCY = 'INR'

export function AddExpense() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>()
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const currency = CURRENCY
  const [selectedTag, setSelectedTag] = useState<string>('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paidBy, setPaidBy] = useState<number | null>(null)
  const [multiPayer, setMultiPayer] = useState(false)
  const [payerAmounts, setPayerAmounts] = useState<Record<number, string>>({})
  const [split, setSplit] = useState<SplitState | null>(null)

  const { data: configData, isLoading } = useQuery({
    queryKey: ['config', owner, repo],
    queryFn: () => getGroupConfig(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo
  })

  const config = configData?.config
  const members = config?.members ?? []
  const tags = config?.tags ?? []

  // Defaults once config loads: pay = my slot (or first), split among everyone
  const defaultPaidBy = useMemo(() => myMemberId(config, user?.login) ?? members[0]?.id ?? null, [config, user, members])
  const effectivePaidBy = paidBy ?? defaultPaidBy
  const effectiveSplit: SplitState = split ?? {
    mode: 'equal', participants: new Set(members.map(m => m.id)), exactAmounts: {}, shareValues: {}
  }

  const parsedAmount = parseFloat(amount)

  // Multi-payer contributions: only entries with a positive parsed amount count.
  const payerSplits = useMemo(() => {
    return Object.entries(payerAmounts)
      .map(([id, v]) => ({ member: parseInt(id, 10), amount: parseFloat(v) }))
      .filter(p => !isNaN(p.amount) && p.amount > 0)
  }, [payerAmounts])
  const payerSum = parseFloat(payerSplits.reduce((s, p) => s + p.amount, 0).toFixed(2))
  const payerSumMatches = !isNaN(parsedAmount) && Math.abs(payerSum - parsedAmount) < 0.01

  function setPayerAmount(id: number, v: string) {
    setPayerAmounts(prev => ({ ...prev, [id]: v }))
  }

  const computedSplits = useMemo(() => computeSplits(effectiveSplit, parsedAmount), [effectiveSplit, parsedAmount])

  async function save() {
    if (!isValid) return
    const event = await buildExpense({
      description: description.trim(),
      amount: parsedAmount,
      currency,
      paidBy: multiPayer ? payerSplits : effectivePaidBy!,
      participants: computedSplits.map(s => s.member),
      splitType: effectiveSplit.mode === 'shares' ? 'shares' : effectiveSplit.mode === 'exact' ? 'exact' : 'equal',
      tags: selectedTag ? [selectedTag] : [],
      date
    }, undefined, computedSplits)
    optimisticAppend(qc, octokit!, owner!, repo!, event, description.trim() || 'expense')
    navigate(`/groups/${owner}/${repo}`)
  }

  const isValid =
    description.trim().length > 0 &&
    !isNaN(parsedAmount) && parsedAmount > 0 &&
    (multiPayer ? (payerSplits.length >= 1 && payerSumMatches) : effectivePaidBy != null) &&
    splitsAreValid(effectiveSplit, parsedAmount) &&
    (tags.length === 0 || selectedTag !== '')

  if (isLoading) return <Spinner className="py-16" />

  if (members.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <p className="text-4xl mb-3">👤</p>
        <p className="font-medium text-zinc-700">No members yet</p>
        <p className="text-sm mt-1">Add members in Group Settings first.</p>
      </div>
    )
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
          <input type="text" value={description} onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Dinner at Nobu" autoFocus
            className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base" />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Date</label>
          <DatePicker value={date} onChange={setDate} />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Amount (₹)</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00" min="0.01" step="0.01"
            className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base" />
        </div>

        {tags.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Tag <span className="text-red-400 text-xs">required</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => {
                const selected = selectedTag === tag.id
                return (
                  <button key={tag.id} type="button" onClick={() => setSelectedTag(selected ? '' : tag.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-all
                      ${selected ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-white border-zinc-300 text-zinc-600 hover:border-zinc-400'}`}>
                    {tag.emoji && <span>{tag.emoji}</span>}{tag.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-zinc-700">Paid by</label>
            {members.length > 1 && (
              <button type="button" onClick={() => setMultiPayer(v => !v)}
                className="text-xs font-medium text-emerald-600 hover:text-emerald-700">
                {multiPayer ? 'Single payer' : '+ Split between multiple people'}
              </button>
            )}
          </div>
          {!multiPayer ? (
            <div className="flex flex-wrap gap-2">
              {members.map(m => (
                <button key={m.id} onClick={() => setPaidBy(m.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors
                    ${effectivePaidBy === m.id ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-white border-zinc-300 text-zinc-600 hover:border-zinc-400'}`}>
                  <span className="w-5 h-5 rounded-full bg-zinc-200 text-zinc-600 text-[10px] font-bold flex items-center justify-center">{memberInitial(m.id, config)}</span>
                  {m.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl px-3 py-2">
                  <span className="w-6 h-6 rounded-full bg-zinc-200 text-zinc-600 text-[10px] font-bold flex items-center justify-center shrink-0">{memberInitial(m.id, config)}</span>
                  <span className="flex-1 text-sm text-zinc-800">{m.name}</span>
                  <input type="number" min="0" step="0.01" placeholder="0.00"
                    value={payerAmounts[m.id] ?? ''}
                    onChange={e => setPayerAmount(m.id, e.target.value)}
                    className="w-28 border border-zinc-300 rounded-lg px-2 py-1.5 text-sm text-right text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              ))}
              <p className={`text-xs ${payerSumMatches ? 'text-zinc-400' : 'text-amber-600'}`}>
                {formatAmount(payerSum, currency)} of {isNaN(parsedAmount) ? '—' : formatAmount(parsedAmount, currency)} assigned
                {!payerSumMatches && ' — must add up to the total amount'}
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Split between</label>
          <SplitEditor members={members} config={config} amount={parsedAmount} currency={currency}
            state={effectiveSplit} onChange={setSplit} />
        </div>

        {isValid && (
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-sm text-zinc-600">
            <span className="font-medium text-zinc-900">
              {multiPayer ? payerSplits.map(p => memberName(p.member, config)).join(' + ') : memberName(effectivePaidBy!, config)}
            </span> paid{' '}
            <span className="font-medium text-zinc-900">{formatAmount(parsedAmount, currency)}</span>
            {' '}for {computedSplits.length} people.
            {selectedTag && <span className="ml-1">Tagged: {tags.find(t => t.id === selectedTag)?.name ?? selectedTag}.</span>}
          </div>
        )}

        <button onClick={save} disabled={!isValid}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl text-base transition-colors flex items-center justify-center gap-2">
          Add Expense
        </button>
      </div>
    </div>
  )
}
