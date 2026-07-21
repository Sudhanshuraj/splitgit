/**
 * Rich analytics view for a group.
 * - Time range: This Month / Last Month / This Year / Last Year / Custom
 * - Summary stats (total, count, average, biggest)
 * - Tag breakdown pie + table; click a tag (or slice) to drill into its transactions
 * - Spending-over-time trend (daily for short ranges, monthly for long ones)
 * - Who paid / who consumed, per person
 * - Searchable transaction list
 */

import { useState, useMemo } from 'react'
import type { Event, Expense, TagConfig, GroupConfig } from '../types'
import { formatAmount } from '../lib/balances'
import { memberName } from '../lib/members'
import { resolveExpenses } from '../lib/eventLog'

// ─── Time range ───────────────────────────────────────────────────────────────

type RangePreset = 'this-month' | 'last-month' | 'this-year' | 'last-year' | 'all' | 'custom'
interface DateRange { from: Date; to: Date }

function getPresetRange(preset: Exclude<RangePreset, 'custom' | 'all'>): DateRange {
  const now = new Date()
  switch (preset) {
    case 'this-month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) }
    case 'last-month':
      return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59) }
    case 'this-year':
      return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59) }
    case 'last-year':
      return { from: new Date(now.getFullYear() - 1, 0, 1), to: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59) }
  }
}

const TAG_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16']
const UNTAGGED = '__untagged__'
const UNTAGGED_COLOR = '#94a3b8'

function txDate(e: Expense): Date {
  const iso = e.date ?? e.createdAt.slice(0, 10)
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}
function fmtShort(d: Date) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }

interface Slice { id: string; label: string; emoji?: string; amount: number; color: string; percentage: number; count: number }

// ─── Pie ────────────────────────────────────────────────────────────────────

function PieChart({ slices, selected, onSelect }: { slices: Slice[]; selected: string | null; onSelect: (id: string) => void }) {
  const [hovered, setHovered] = useState<number | null>(null)
  if (slices.length === 0) return null
  const total = slices.reduce((s, sl) => s + sl.amount, 0)
  const cx = 100, cy = 100, r = 80

  if (slices.length === 1) {
    const s = slices[0]!
    return (
      <div className="flex justify-center">
        <svg viewBox="0 0 200 200" className="w-44 h-44" style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.08))' }}>
          <circle cx={cx} cy={cy} r={r} fill={s.color} className="cursor-pointer" onClick={() => onSelect(s.id)} />
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize="12" fill="white" fontFamily="system-ui">{s.emoji ?? s.label}</text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize="13" fontWeight="600" fill="white" fontFamily="system-ui">100%</text>
        </svg>
      </div>
    )
  }

  let ang = -Math.PI / 2
  const paths = slices.map((slice, i) => {
    const a = (slice.amount / total) * 2 * Math.PI
    const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang)
    const x2 = cx + r * Math.cos(ang + a), y2 = cy + r * Math.sin(ang + a)
    const large = a > Math.PI ? 1 : 0
    ang += a
    return { d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`, color: slice.color, i, id: slice.id }
  })
  const hv = hovered !== null ? slices[hovered] : (selected ? slices.find(s => s.id === selected) : null)

  return (
    <div className="flex justify-center">
      <svg viewBox="0 0 200 200" className="w-44 h-44" style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.08))' }}>
        {paths.map(({ d, color, i, id }) => (
          <path key={i} d={d} fill={color} stroke="white" strokeWidth="2"
            className="transition-opacity duration-150 cursor-pointer"
            opacity={(selected && selected !== id) ? 0.35 : (hovered === null || hovered === i ? 1 : 0.5)}
            onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
            onClick={() => onSelect(id)} />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fill="#64748b" fontFamily="system-ui">
          {hv ? (hv.emoji ?? hv.label) : 'Total'}
        </text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="13" fontWeight="600" fill="#0f172a" fontFamily="system-ui">
          {hv ? `${hv.percentage.toFixed(0)}%` : `${slices.length} tags`}
        </text>
      </svg>
    </div>
  )
}

// ─── Trend bars ───────────────────────────────────────────────────────────────

function TrendChart({ expenses, currency }: { expenses: Expense[]; currency: string }) {
  const { buckets, mode } = useMemo(() => {
    if (expenses.length === 0) return { buckets: [] as { key: string; label: string; amount: number }[], mode: 'day' as const }
    const dates = expenses.map(txDate)
    const min = new Date(Math.min(...dates.map(d => +d)))
    const max = new Date(Math.max(...dates.map(d => +d)))
    const days = (+max - +min) / 86400000
    const mode: 'day' | 'month' = days > 62 ? 'month' : 'day'
    const map = new Map<string, number>()
    for (const e of expenses) {
      const d = txDate(e)
      const key = mode === 'month'
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      map.set(key, (map.get(key) ?? 0) + e.amount)
    }
    const buckets = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, amount]) => {
      let label: string
      if (mode === 'month') {
        const [y, m] = key.split('-').map(Number)
        label = new Date(y!, m! - 1, 1).toLocaleDateString('en-US', { month: 'short' }) + (m === 1 ? ` '${String(y).slice(2)}` : '')
      } else {
        const [y, m, d] = key.split('-').map(Number)
        label = `${d}/${m}`
        void y
      }
      return { key, label, amount }
    })
    return { buckets, mode }
  }, [expenses])

  if (buckets.length < 2) return null
  const max = Math.max(...buckets.map(b => b.amount))
  const peak = buckets.reduce((a, b) => b.amount > a.amount ? b : a)

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-700">Spending over time</h3>
        <span className="text-xs text-zinc-400">peak {formatAmount(peak.amount, currency)}</span>
      </div>
      <div className="flex items-end gap-1 h-28 overflow-x-auto">
        {buckets.map(b => (
          <div key={b.key} className="flex flex-col items-center gap-1 flex-1 min-w-[18px]" title={`${b.label}: ${formatAmount(b.amount, currency)}`}>
            <div className="w-full rounded-t bg-emerald-500/80 hover:bg-emerald-600 transition-colors"
              style={{ height: `${Math.max(4, (b.amount / max) * 96)}px` }} />
            <span className="text-[9px] text-zinc-400 whitespace-nowrap">{b.label}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-zinc-400 mt-2">{mode === 'month' ? 'Monthly totals' : 'Daily totals'}</p>
    </div>
  )
}

// ─── Main ───────────────────────────────────────────────────────────────────

interface AnalyticsProps {
  events: Event[]
  tags: TagConfig[]
  currency: string
  config?: GroupConfig | null
}

export function Analytics({ events, tags, currency, config }: AnalyticsProps) {
  const [preset, setPreset] = useState<RangePreset>('this-month')
  const [customFrom, setCustomFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) })
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const range: DateRange = useMemo(() => {
    if (preset === 'all') return { from: new Date(2000, 0, 1), to: new Date(2999, 0, 1) }
    if (preset === 'custom') return { from: new Date(customFrom + 'T00:00:00'), to: new Date(customTo + 'T23:59:59') }
    return getPresetRange(preset)
  }, [preset, customFrom, customTo])

  const tagById = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags])

  const expenses = useMemo(() => {
    return resolveExpenses(events).filter(e => { const d = txDate(e); return d >= range.from && d <= range.to })
  }, [events, range])

  const slices: Slice[] = useMemo(() => {
    const byTag = new Map<string, { amount: number; count: number }>()
    let total = 0
    for (const e of expenses) {
      total += e.amount
      const id = e.tags[0] ?? UNTAGGED
      const cur = byTag.get(id) ?? { amount: 0, count: 0 }
      byTag.set(id, { amount: cur.amount + e.amount, count: cur.count + 1 })
    }
    return [...byTag.entries()].map(([id, v], i) => {
      const tag = tagById.get(id)
      return {
        id, label: tag?.name ?? (id === UNTAGGED ? 'Untagged' : id), emoji: tag?.emoji,
        amount: parseFloat(v.amount.toFixed(2)), count: v.count,
        color: id === UNTAGGED ? UNTAGGED_COLOR : TAG_COLORS[i % TAG_COLORS.length]!,
        percentage: total > 0 ? (v.amount / total) * 100 : 0
      }
    }).sort((a, b) => b.amount - a.amount)
  }, [expenses, tagById])

  // Per-person: paid (fronted) and share (consumed), keyed by member id
  const perPerson = useMemo(() => {
    const paid = new Map<number, number>(), share = new Map<number, number>()
    for (const e of expenses) {
      paid.set(e.paidBy, (paid.get(e.paidBy) ?? 0) + e.amount)
      for (const s of e.splits) share.set(s.member, (share.get(s.member) ?? 0) + s.amount)
    }
    const people = new Set<number>([...paid.keys(), ...share.keys()])
    return [...people].map(p => ({ person: p, paid: paid.get(p) ?? 0, share: share.get(p) ?? 0 }))
      .sort((a, b) => b.share - a.share)
  }, [expenses])

  const totalSpend = expenses.reduce((s, e) => s + e.amount, 0)
  const biggest = expenses.reduce<Expense | null>((a, e) => (!a || e.amount > a.amount) ? e : a, null)
  const avg = expenses.length ? totalSpend / expenses.length : 0

  // Transactions shown below: filtered by selected tag + search
  const shownTx = useMemo(() => {
    let list = expenses
    if (selectedTag) list = list.filter(e => (e.tags[0] ?? UNTAGGED) === selectedTag)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(e => e.description.toLowerCase().includes(q))
    return [...list].sort((a, b) => +txDate(b) - +txDate(a))
  }, [expenses, selectedTag, search])

  const presets: { key: RangePreset; label: string }[] = [
    { key: 'this-month', label: 'This Month' }, { key: 'last-month', label: 'Last Month' },
    { key: 'this-year', label: 'This Year' }, { key: 'last-year', label: 'Last Year' },
    { key: 'all', label: 'All Time' }, { key: 'custom', label: 'Custom' }
  ]

  return (
    <div className="space-y-5">
      {/* Range */}
      <div>
        <div className="flex flex-wrap gap-2">
          {presets.map(p => (
            <button key={p.key} onClick={() => { setPreset(p.key); setSelectedTag(null) }}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors
                ${preset === p.key ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex gap-3 mt-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-500 font-medium">From</label>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="border border-zinc-300 rounded-xl px-3 py-2 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-500 font-medium">To</label>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="border border-zinc-300 rounded-xl px-3 py-2 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>
        )}
      </div>

      {expenses.length === 0 ? (
        <div className="text-center py-10 text-zinc-500">
          <p className="text-3xl mb-2">📊</p>
          <p className="font-medium text-zinc-700">No expenses in this period</p>
          <p className="text-sm mt-1">Try a different time range.</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
              <p className="text-xs text-zinc-500 font-medium">Total spent</p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">{formatAmount(totalSpend, currency)}</p>
            </div>
            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
              <p className="text-xs text-zinc-500 font-medium">Expenses</p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">{expenses.length}</p>
            </div>
            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
              <p className="text-xs text-zinc-500 font-medium">Average</p>
              <p className="text-xl font-bold text-zinc-900 mt-1">{formatAmount(avg, currency)}</p>
            </div>
            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
              <p className="text-xs text-zinc-500 font-medium">Biggest</p>
              <p className="text-xl font-bold text-zinc-900 mt-1">{biggest ? formatAmount(biggest.amount, currency) : '—'}</p>
              {biggest && <p className="text-[11px] text-zinc-400 truncate mt-0.5">{biggest.description}</p>}
            </div>
          </div>

          {/* Pie */}
          {slices.length > 0 && (
            <PieChart slices={slices} selected={selectedTag}
              onSelect={id => setSelectedTag(cur => cur === id ? null : id)} />
          )}

          {/* By tag — click to drill in */}
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-700">By Tag</h3>
              <span className="text-xs text-zinc-400">tap to filter</span>
            </div>
            <div className="divide-y divide-zinc-100">
              {slices.map(slice => {
                const active = selectedTag === slice.id
                return (
                  <button key={slice.id} onClick={() => setSelectedTag(cur => cur === slice.id ? null : slice.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${active ? 'bg-emerald-50' : 'hover:bg-zinc-50'}`}>
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                    {slice.emoji && <span className="text-base">{slice.emoji}</span>}
                    <span className="text-sm text-zinc-800 flex-1 font-medium">{slice.label}</span>
                    <span className="text-xs text-zinc-400 mr-1">{slice.count}×</span>
                    <span className="text-xs text-zinc-400 mr-2">{slice.percentage.toFixed(1)}%</span>
                    <span className="text-sm font-semibold text-zinc-900">{formatAmount(slice.amount, currency)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Trend */}
          <TrendChart expenses={expenses} currency={currency} />

          {/* Who paid / consumed */}
          {perPerson.length > 0 && (
            <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-100"><h3 className="text-sm font-semibold text-zinc-700">Per person</h3></div>
              <div className="divide-y divide-zinc-100">
                <div className="flex items-center px-4 py-2 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">
                  <span className="flex-1">Member</span><span className="w-24 text-right">Paid</span><span className="w-24 text-right">Consumed</span>
                </div>
                {perPerson.map(p => (
                  <div key={p.person} className="flex items-center px-4 py-3 text-sm">
                    <span className="flex-1 font-medium text-zinc-800">{memberName(p.person, config)}</span>
                    <span className="w-24 text-right text-zinc-600">{formatAmount(p.paid, currency)}</span>
                    <span className="w-24 text-right text-zinc-900 font-semibold">{formatAmount(p.share, currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transactions (drill-down + search) */}
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-zinc-700">
                  {selectedTag
                    ? <>Transactions · {slices.find(s => s.id === selectedTag)?.emoji} {slices.find(s => s.id === selectedTag)?.label}</>
                    : 'Transactions'}
                  <span className="text-zinc-400 font-normal ml-1">({shownTx.length})</span>
                </h3>
                {selectedTag && (
                  <button onClick={() => setSelectedTag(null)} className="text-xs text-emerald-600 font-medium hover:text-emerald-700">Clear filter</button>
                )}
              </div>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search description…"
                className="w-full border border-zinc-200 rounded-xl px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-zinc-100">
              {shownTx.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-zinc-400">No matching transactions.</p>
              ) : shownTx.map((e, i) => {
                const tag = tagById.get(e.tags[0] ?? '')
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800 truncate">{e.description}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-zinc-400">{fmtShort(txDate(e))}</span>
                        <span className="text-xs text-zinc-400">· paid by {memberName(e.paidBy, config)}</span>
                        {tag && (
                          <span className="text-xs px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600 font-medium">
                            {tag.emoji && <span className="mr-0.5">{tag.emoji}</span>}{tag.name}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-zinc-900 shrink-0">{formatAmount(e.amount, currency)}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
