/**
 * Shared "tap a transaction to see details" modal — used from History,
 * Analytics, and Activity so the interaction is identical everywhere:
 * click a row → see full details → Edit button (if you're allowed) takes
 * you to the edit page. Settlements, deletions, and config-change log
 * entries are view-only (nothing to edit).
 */
import { Link } from 'react-router-dom'
import { formatAmount } from '../lib/balances'
import { memberName, contributionsOf, payerLabel } from '../lib/members'
import type { Event, Expense, Settlement, ExpenseDeletion, ConfigChange, TagConfig, GroupConfig } from '../types'

export function TransactionDetailModal({
  event, config, tags, canEdit = false, editUrl, onDelete, onClose, originalExpense
}: {
  event: Event
  config: GroupConfig | null
  tags: TagConfig[]
  canEdit?: boolean
  editUrl?: string
  onDelete?: () => void
  onClose: () => void
  originalExpense?: Expense | null   // for EXPENSE_DELETION rows, the expense that was deleted
}) {
  const tagById = new Map(tags.map(t => [t.id, t]))

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 pb-safe" onClick={onClose}>
      <div className="bg-solid rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold text-zinc-900">
            {event.type === 'EXPENSE' && 'Expense'}
            {event.type === 'SETTLEMENT' && 'Settlement'}
            {event.type === 'EXPENSE_DELETION' && 'Deleted expense'}
            {event.type === 'CONFIG_CHANGE' && 'Change log entry'}
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 p-1 rounded-lg hover:bg-zinc-100 transition-colors shrink-0">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {event.type === 'EXPENSE' && (() => {
          const e = event as Expense
          const tag = tagById.get(e.tags[0] ?? '')
          const contributions = contributionsOf(e)
          return (
            <div className="space-y-4">
              <div>
                <p className="text-2xl font-bold text-zinc-900">{formatAmount(e.amount, e.currency)}</p>
                <p className="text-sm text-zinc-600 mt-0.5">{e.description}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="px-2 py-1 rounded-lg bg-zinc-100 text-zinc-600 font-medium">{e.date}</span>
                {tag && (
                  <span className="px-2 py-1 rounded-lg bg-zinc-100 text-zinc-600 font-medium">
                    {tag.emoji && <span className="mr-0.5">{tag.emoji}</span>}{tag.name}
                  </span>
                )}
                {e.supersedesId && <span className="px-2 py-1 rounded-lg bg-amber-100 text-amber-700 font-medium">edited</span>}
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">Paid by</p>
                <div className="space-y-1">
                  {contributions.map((c, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-zinc-700">{memberName(c.member, config)}</span>
                      <span className="font-medium text-zinc-900">{formatAmount(c.amount, e.currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">Owed by</p>
                <div className="space-y-1">
                  {e.splits.map((s, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-zinc-700">{memberName(s.member, config)}</span>
                      <span className="font-medium text-zinc-900">{formatAmount(s.amount, e.currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {(canEdit || onDelete) && (
                <div className="flex gap-3 pt-2">
                  {canEdit && editUrl && (
                    <Link to={editUrl} onClick={onClose}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-xl text-sm text-center transition-colors">
                      Edit
                    </Link>
                  )}
                  {canEdit && onDelete && (
                    <button onClick={() => { onDelete(); onClose() }}
                      className="flex-1 border border-red-300 text-red-600 font-semibold py-2.5 rounded-xl text-sm hover:bg-red-50 transition-colors">
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {event.type === 'SETTLEMENT' && (() => {
          const s = event as Settlement
          return (
            <div className="space-y-3">
              <p className="text-2xl font-bold text-zinc-900">{formatAmount(s.amount, s.currency)}</p>
              <p className="text-sm text-zinc-700">
                <span className="font-semibold">{memberName(s.from, config)}</span> paid{' '}
                <span className="font-semibold">{memberName(s.to, config)}</span>
              </p>
              <p className="text-xs text-zinc-400">{new Date(s.createdAt).toLocaleString()}</p>
              {s.note && <p className="text-sm text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">{s.note}</p>}
            </div>
          )
        })()}

        {event.type === 'EXPENSE_DELETION' && (() => {
          const d = event as ExpenseDeletion
          return (
            <div className="space-y-3">
              {originalExpense ? (
                <>
                  <p className="text-2xl font-bold text-zinc-400 line-through">{formatAmount(originalExpense.amount, originalExpense.currency)}</p>
                  <p className="text-sm text-zinc-600">{originalExpense.description}</p>
                  <p className="text-sm text-zinc-700">paid by {payerLabel(originalExpense, config)}</p>
                </>
              ) : <p className="text-sm text-zinc-500">Original expense details unavailable.</p>}
              <p className="text-xs text-zinc-400">Deleted by @{d.deletedBy} · {new Date(d.createdAt).toLocaleString()}</p>
            </div>
          )
        })()}

        {event.type === 'CONFIG_CHANGE' && (() => {
          const c = event as ConfigChange
          return (
            <div className="space-y-3">
              <p className="text-sm text-zinc-800">{c.summary}</p>
              <p className="text-xs text-zinc-400">by @{c.actor} · {new Date(c.createdAt).toLocaleString()}</p>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
