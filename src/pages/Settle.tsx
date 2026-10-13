/**
 * Record or edit a settlement / loan between two members.
 *
 * - Settlement: a payment that clears (part of) a debt.
 * - Loan: new money handed over. Balances move exactly the same way, but it is
 *   labelled as a loan. Neither is ever an expense (no tag, no spend totals).
 *
 * Route /settle        → new (From defaults to you; pick anyone as To)
 * Route /settlement/:settlementId/edit → edit; saves a correction that
 * supersedes the latest version (never forks), amount/date prefilled.
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { buildSettlement, readEvents, findLatestSettlement } from '../lib/eventLog'
import { optimisticAppend } from '../lib/optimistic'
import { getGroupConfig } from '../lib/github'
import { formatAmount } from '../lib/balances'
import { memberName, memberInitial, myMemberId } from '../lib/members'
import { Spinner } from '../components/Spinner'
import { DatePicker } from '../components/DatePicker'

const CURRENCY = 'INR'
const today = () => new Date().toISOString().slice(0, 10)

export function Settle() {
  const { owner, repo, settlementId } = useParams<{ owner: string; repo: string; settlementId?: string }>()
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const isEdit = !!settlementId

  const prefill = location.state as { from?: number; to?: number; amount?: number } | null

  const [kind, setKind] = useState<'settlement' | 'loan'>('settlement')
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(prefill?.to ?? null)
  const [amount, setAmount] = useState(prefill?.amount?.toFixed(2) ?? '')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  const currency = CURRENCY

  const { data: configData, isLoading } = useQuery({
    queryKey: ['config', owner, repo],
    queryFn: () => getGroupConfig(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo,
    staleTime: 60_000
  })
  const { data: eventData, isLoading: eventsLoading } = useQuery({
    queryKey: ['events', owner, repo],
    queryFn: () => readEvents(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo && isEdit,
    staleTime: 10_000
  })
  const config = configData?.config
  const members = config?.members ?? []
  const myId = myMemberId(config, user?.login)

  // Edit: resolve to the latest version of this settlement, never a stale one.
  const original = isEdit && eventData ? findLatestSettlement(eventData.events, settlementId!) : null

  useEffect(() => {
    if (loaded) return
    if (isEdit) {
      if (!original) return
      setKind(original.kind ?? 'settlement')
      setFrom(original.from); setTo(original.to)
      setAmount(original.amount.toString())
      setDate(original.date ?? original.createdAt.slice(0, 10))
      setNote(original.note ?? '')
      setLoaded(true)
    } else if (config) {
      setFrom(prefill?.from ?? myId)
      setLoaded(true)
    }
  }, [loaded, isEdit, original, config, myId, prefill])

  // Any member can be on either side — the only rule is they can't be the
  // same person. (Picking the same person on both sides just shows a warning.)
  const pickFrom = (id: number) => setFrom(id)
  const pickTo = (id: number) => setTo(id)
  const sameMember = from != null && from === to

  const parsedAmount = parseFloat(amount)
  const isValid = from != null && to != null && from !== to && !isNaN(parsedAmount) && parsedAmount > 0

  const canEdit = !isEdit || (original != null && ((myId != null && (myId === original.from || myId === original.to)) || user?.login === owner))

  async function save() {
    if (!isValid) return
    const event = await buildSettlement(
      { from: from!, to: to!, amount: parsedAmount, currency, note: note.trim() || undefined, date, kind },
      isEdit ? original!.id : undefined
    )
    optimisticAppend(qc, octokit!, owner!, repo!, event, kind)
    navigate(`/groups/${owner}/${repo}`)
  }

  if (isLoading || (isEdit && eventsLoading)) return <Spinner className="py-16" />

  if (isEdit && !original) {
    return <div className="text-center py-16 text-zinc-500"><p className="font-medium text-zinc-700">Settlement not found</p></div>
  }
  if (!canEdit) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <p className="text-4xl mb-3">🔒</p>
        <p className="font-medium text-zinc-700">Only the two people involved or the group owner can edit this</p>
      </div>
    )
  }

  const MemberPicker = ({ value, onPick }: { value: number | null; onPick: (id: number) => void }) => (
    <div className="flex flex-wrap gap-2">
      {members.map(m => (
        <button key={m.id} type="button" onClick={() => onPick(m.id)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors
            ${value === m.id ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-white border-zinc-300 text-zinc-600 hover:border-zinc-400'}`}>
          <span className="w-5 h-5 rounded-full bg-zinc-200 text-zinc-600 text-[10px] font-bold flex items-center justify-center">{memberInitial(m.id, config)}</span>
          {m.name}
        </button>
      ))}
    </div>
  )

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(`/groups/${owner}/${repo}`)} className="text-zinc-500 hover:text-zinc-900">
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-zinc-900">{isEdit ? 'Edit' : 'Record'} {kind === 'loan' ? 'Loan' : 'Settlement'}</h1>
      </div>

      <div className="space-y-5">
        <div className="flex gap-1.5">
          {(['settlement', 'loan'] as const).map(k => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`flex-1 text-sm font-semibold py-2 rounded-lg border transition-colors capitalize
                ${kind === k ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-zinc-300 text-zinc-600 hover:border-zinc-400'}`}>
              {k}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-400 -mt-3">
          {kind === 'loan'
            ? 'A loan is new money handed over. It changes balances but is not an expense.'
            : 'A settlement is a payment towards what is owed. It is not an expense.'}
        </p>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">{kind === 'loan' ? 'Lent by' : 'Paid by'}</label>
          <MemberPicker value={from} onPick={pickFrom} />
          {from == null && <p className="text-xs text-amber-600 mt-1">Pick who paid. (Claim your slot in Settings to have this default to you.)</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">{kind === 'loan' ? 'Lent to' : 'Paid to'}</label>
          <MemberPicker value={to} onPick={pickTo} />
          {sameMember && <p className="text-xs text-amber-600 mt-1">Payer and receiver can't be the same person.</p>}
          {from != null && to != null && !sameMember && (
            <button type="button" onClick={() => { setFrom(to); setTo(from) }}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700 mt-2">⇄ Swap direction</button>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Amount (₹)</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00" min="0.01" step="0.01"
            className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base" />
          {prefill?.amount != null && !isEdit && (
            <p className="text-xs text-zinc-400 mt-1">
              Full balance is {formatAmount(prefill.amount, currency)} — enter less for a partial settlement.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Date</label>
          <DatePicker value={date} onChange={setDate} />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">
            Note <span className="text-zinc-400 font-normal">(optional)</span>
          </label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="e.g. Bank transfer"
            className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base" />
        </div>

        {isValid && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-zinc-600">
            <span className="font-semibold text-zinc-900">{memberName(from!, config)}</span>{' '}
            {kind === 'loan' ? 'lent' : 'paid'}{' '}
            <span className="font-semibold text-emerald-600">{formatAmount(parsedAmount, currency)}</span>
            {' '}to <span className="font-semibold text-zinc-900">{memberName(to!, config)}</span>.
          </div>
        )}

        <button onClick={save} disabled={!isValid}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl text-base transition-colors flex items-center justify-center gap-2">
          {isEdit ? 'Save Changes' : `Record ${kind === 'loan' ? 'Loan' : 'Settlement'}`}
        </button>
      </div>
    </div>
  )
}
