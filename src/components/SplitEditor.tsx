/**
 * Three split modes, shared by AddExpense and EditExpense:
 *  - equal:  tap members on/off, amount divided evenly among the on ones
 *  - exact:  type an amount per person; footer shows how much is still
 *            unassigned out of the total
 *  - shares: type a share count per person (e.g. 1 and 2); amount is
 *            distributed proportionally (1/3 and 2/3 of the total)
 */
import { formatAmount } from '../lib/balances'
import { memberInitial } from '../lib/members'
import { computeEqualSplits, computeExactSplits, computeShareSplits, sumSplits, round2 } from '../lib/splitCalc'
import type { GroupConfig, LedgerMember, Split } from '../types'

export type SplitMode = 'equal' | 'exact' | 'shares'

export interface SplitState {
  mode: SplitMode
  participants: Set<number>              // used in 'equal' mode
  exactAmounts: Record<number, string>    // used in 'exact' mode
  shareValues: Record<number, string>     // used in 'shares' mode
}

export function computeSplits(state: SplitState, amount: number): Split[] {
  if (state.mode === 'equal') return computeEqualSplits(amount, Array.from(state.participants))
  if (state.mode === 'exact') return computeExactSplits(state.exactAmounts)
  return computeShareSplits(amount, state.shareValues)
}

export function splitsAreValid(state: SplitState, amount: number): boolean {
  if (isNaN(amount) || amount <= 0) return false
  if (state.mode === 'equal') return state.participants.size > 0
  if (state.mode === 'exact') {
    const splits = computeExactSplits(state.exactAmounts)
    return splits.length > 0 && Math.abs(sumSplits(splits) - round2(amount)) < 0.01
  }
  return Object.values(state.shareValues).some(v => { const n = parseFloat(v); return !isNaN(n) && n > 0 })
}

const TABS: { mode: SplitMode; label: string }[] = [
  { mode: 'equal', label: 'Equal' },
  { mode: 'exact', label: 'Unequal' },
  { mode: 'shares', label: 'By shares' }
]

export function SplitEditor({ members, config, amount, currency, state, onChange }: {
  members: LedgerMember[]
  config: GroupConfig | null | undefined
  amount: number
  currency: string
  state: SplitState
  onChange: (next: SplitState) => void
}) {
  function toggleParticipant(id: number) {
    const next = new Set(state.participants)
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange({ ...state, participants: next })
  }
  function setExact(id: number, v: string) {
    onChange({ ...state, exactAmounts: { ...state.exactAmounts, [id]: v } })
  }
  function setShare(id: number, v: string) {
    onChange({ ...state, shareValues: { ...state.shareValues, [id]: v } })
  }

  const exactSplits = computeExactSplits(state.exactAmounts)
  const exactSum = sumSplits(exactSplits)
  const exactPending = round2((isNaN(amount) ? 0 : amount) - exactSum)

  const shareSplits = !isNaN(amount) ? computeShareSplits(amount, state.shareValues) : []
  const shareAmountByMember = new Map(shareSplits.map(s => [s.member, s.amount]))

  const equalParticipants = Array.from(state.participants)
  const equalSplits = !isNaN(amount) ? computeEqualSplits(amount, equalParticipants) : []
  const equalAmountByMember = new Map(equalSplits.map(s => [s.member, s.amount]))

  return (
    <div>
      <div className="flex gap-1.5 mb-3">
        {TABS.map(t => (
          <button key={t.mode} type="button" onClick={() => onChange({ ...state, mode: t.mode })}
            className={`flex-1 text-xs font-semibold py-2 rounded-lg border transition-colors
              ${state.mode === t.mode ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-zinc-300 text-zinc-600 hover:border-zinc-400'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {state.mode === 'equal' && (
        <div className="space-y-2">
          {members.map(m => {
            const on = state.participants.has(m.id)
            return (
              <button key={m.id} type="button" onClick={() => toggleParticipant(m.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm transition-colors
                  ${on ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-zinc-200 hover:border-zinc-300'}`}>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                  ${on ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-300'}`}>
                  {on && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>}
                </div>
                <span className="w-7 h-7 rounded-full bg-zinc-200 text-zinc-600 text-xs font-bold flex items-center justify-center">{memberInitial(m.id, config)}</span>
                <span className="font-medium text-zinc-800">{m.name}</span>
                {on && equalAmountByMember.get(m.id) != null && (
                  <span className="ml-auto text-emerald-600 font-semibold">{formatAmount(equalAmountByMember.get(m.id)!, currency)}</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {state.mode === 'exact' && (
        <div className="space-y-2">
          {members.map(m => (
            <div key={m.id} className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl px-3 py-2">
              <span className="w-6 h-6 rounded-full bg-zinc-200 text-zinc-600 text-[10px] font-bold flex items-center justify-center shrink-0">{memberInitial(m.id, config)}</span>
              <span className="flex-1 text-sm text-zinc-800">{m.name}</span>
              <input type="number" min="0" step="0.01" placeholder="0.00"
                value={state.exactAmounts[m.id] ?? ''}
                onChange={e => setExact(m.id, e.target.value)}
                className="w-28 border border-zinc-300 rounded-lg px-2 py-1.5 text-sm text-right text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          ))}
          <p className={`text-xs pt-1 ${Math.abs(exactPending) < 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}>
            {formatAmount(exactSum, currency)} added
            {!isNaN(amount) && (
              exactPending > 0.005
                ? <> · {formatAmount(exactPending, currency)} pending out of {formatAmount(amount, currency)}</>
                : exactPending < -0.005
                  ? <> · {formatAmount(Math.abs(exactPending), currency)} over the {formatAmount(amount, currency)} total</>
                  : <> · fully assigned</>
            )}
          </p>
        </div>
      )}

      {state.mode === 'shares' && (
        <div className="space-y-2">
          {members.map(m => (
            <div key={m.id} className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl px-3 py-2">
              <span className="w-6 h-6 rounded-full bg-zinc-200 text-zinc-600 text-[10px] font-bold flex items-center justify-center shrink-0">{memberInitial(m.id, config)}</span>
              <span className="flex-1 text-sm text-zinc-800">{m.name}</span>
              {shareAmountByMember.has(m.id) && (
                <span className="text-xs text-emerald-600 font-medium">{formatAmount(shareAmountByMember.get(m.id)!, currency)}</span>
              )}
              <input type="number" min="0" step="1" placeholder="shares"
                value={state.shareValues[m.id] ?? ''}
                onChange={e => setShare(m.id, e.target.value)}
                className="w-20 border border-zinc-300 rounded-lg px-2 py-1.5 text-sm text-right text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          ))}
          <p className="text-xs text-zinc-400 pt-1">e.g. 1 for Sudhanshu and 2 for Amit splits it 1/3 – 2/3</p>
        </div>
      )}
    </div>
  )
}
