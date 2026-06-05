/**
 * Analytics view for a group.
 * - Tag breakdown pie chart (SVG, no dependency)
 * - Time range selector: This Month / Last Month / This Year / Last Year / Custom
 * - Custom range opens an inline calendar picker
 */

import { useState, useMemo } from 'react'
import type { Event, TagConfig } from '../types'
import { formatAmount } from '../lib/balances'
import { resolveExpenses } from '../lib/eventLog'

// ─── Time range ───────────────────────────────────────────────────────────────

type RangePreset = 'this-month' | 'last-month' | 'this-year' | 'last-year' | 'custom'

interface DateRange {
  from: Date
  to: Date
}

function getPresetRange(preset: Exclude<RangePreset, 'custom'>): DateRange {
  const now = new Date()
  switch (preset) {
    case 'this-month':
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
      }
    case 'last-month':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
      }
    case 'this-year':
      return {
        from: new Date(now.getFullYear(), 0, 1),
        to: new Date(now.getFullYear(), 11, 31, 23, 59, 59)
      }
    case 'last-year':
      return {
        from: new Date(now.getFullYear() - 1, 0, 1),
        to: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59)
      }
  }
}

// ─── Pie chart ────────────────────────────────────────────────────────────────

// Fixed palette — no longer driven by TagConfig.color
const TAG_COLORS = [
  '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'
]
const UNTAGGED_COLOR = '#94a3b8'

interface Slice {
  label: string
  emoji?: string
  amount: number
  color: string
  percentage: number
}

function PieChart({ slices }: { slices: Slice[] }) {
  const [hovered, setHovered] = useState<number | null>(null)

  if (slices.length === 0) return null

  const total = slices.reduce((s, sl) => s + sl.amount, 0)
  const cx = 100
  const cy = 100
  const r = 80

  // Single-slice special case: arc path at exactly 360° is degenerate — use a circle instead
  if (slices.length === 1) {
    const slice = slices[0]!
    return (
      <div className="flex flex-col items-center">
        <svg viewBox="0 0 200 200" className="w-48 h-48"
          style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.08))' }}>
          <circle cx={cx} cy={cy} r={r} fill={slice.color} />
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize="11" fill="white" fontFamily="system-ui">
            {slice.emoji ?? slice.label}
          </text>
          <text x={cx} y={cy + 10} textAnchor="middle" fontSize="13" fontWeight="600" fill="white" fontFamily="system-ui">
            100%
          </text>
        </svg>
      </div>
    )
  }

  let cumulativeAngle = -Math.PI / 2
  const paths = slices.map((slice, i) => {
    const angle = (slice.amount / total) * 2 * Math.PI
    const startAngle = cumulativeAngle
    const endAngle = cumulativeAngle + angle
    cumulativeAngle = endAngle

    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    const largeArc = angle > Math.PI ? 1 : 0

    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`
    return { d, color: slice.color, i }
  })

  const hoveredSlice = hovered !== null ? slices[hovered] : null

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 200" className="w-48 h-48"
        style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.08))' }}>
        {paths.map(({ d, color, i }) => (
          <path key={i} d={d} fill={color} stroke="white" strokeWidth="2"
            className="transition-opacity duration-150 cursor-pointer"
            opacity={hovered === null || hovered === i ? 1 : 0.5}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="11" fill="#64748b" fontFamily="system-ui">
          {hoveredSlice ? (hoveredSlice.emoji ?? hoveredSlice.label) : 'Total'}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="13" fontWeight="600" fill="#0f172a" fontFamily="system-ui">
          {hoveredSlice
            ? `${hoveredSlice.percentage.toFixed(0)}%`
            : `${slices.length} tag${slices.length !== 1 ? 's' : ''}`}
        </text>
      </svg>
    </div>
  )
}

// ─── Mini calendar ────────────────────────────────────────────────────────────

function CalendarPicker({
  value,
  onChange,
  label
}: {
  value: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-zinc-500 font-medium">{label}</label>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="border border-zinc-300 rounded-xl px-3 py-2 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface AnalyticsProps {
  events: Event[]
  tags: TagConfig[]
  currency: string
}

export function Analytics({ events, tags, currency }: AnalyticsProps) {
  const [preset, setPreset] = useState<RangePreset>('this-month')
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d.toISOString().slice(0, 10)
  })
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10))

  const range: DateRange = useMemo(() => {
    if (preset === 'custom') {
      return {
        from: new Date(customFrom + 'T00:00:00'),
        to: new Date(customTo + 'T23:59:59')
      }
    }
    return getPresetRange(preset)
  }, [preset, customFrom, customTo])

  // Filter expenses to range
  const expenses = useMemo(() => {
    const resolved = resolveExpenses(events)
    return resolved.filter(e => {
      const d = new Date(e.createdAt)
      return d >= range.from && d <= range.to
    })
  }, [events, range])

  // Emoji lookup
  const tagEmojiMap = useMemo(() => {
    const map = new Map<string, string>()
    tags.forEach(t => { if (t.emoji) map.set(t.name, t.emoji) })
    return map
  }, [tags])

  // Aggregate spend by tag
  const slices: Slice[] = useMemo(() => {
    const byTag = new Map<string, number>()
    let total = 0

    for (const e of expenses) {
      total += e.amount
      const tag = e.tags[0] ?? 'Untagged'
      byTag.set(tag, (byTag.get(tag) ?? 0) + e.amount)
    }

    return Array.from(byTag.entries())
      .map(([label, amount], i) => ({
        label,
        emoji: tagEmojiMap.get(label),
        amount: parseFloat(amount.toFixed(2)),
        color: label === 'Untagged' ? UNTAGGED_COLOR : TAG_COLORS[i % TAG_COLORS.length]!,
        percentage: total > 0 ? (amount / total) * 100 : 0
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [expenses, tagEmojiMap])

  const totalSpend = expenses.reduce((s, e) => s + e.amount, 0)
  const expenseCount = expenses.length

  const presets: { key: RangePreset; label: string }[] = [
    { key: 'this-month', label: 'This Month' },
    { key: 'last-month', label: 'Last Month' },
    { key: 'this-year', label: 'This Year' },
    { key: 'last-year', label: 'Last Year' },
    { key: 'custom', label: 'Custom' }
  ]

  return (
    <div className="space-y-5">
      {/* Time range selector */}
      <div>
        <div className="flex flex-wrap gap-2">
          {presets.map(p => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors
                ${preset === p.key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex gap-3 mt-3">
            <CalendarPicker label="From" value={customFrom} onChange={setCustomFrom} />
            <CalendarPicker label="To" value={customTo} onChange={setCustomTo} />
          </div>
        )}
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-zinc-200 rounded-2xl p-4">
          <p className="text-xs text-zinc-500 font-medium">Total spent</p>
          <p className="text-2xl font-bold text-zinc-900 mt-1">{formatAmount(totalSpend, currency)}</p>
        </div>
        <div className="bg-white border border-zinc-200 rounded-2xl p-4">
          <p className="text-xs text-zinc-500 font-medium">Expenses</p>
          <p className="text-2xl font-bold text-zinc-900 mt-1">{expenseCount}</p>
        </div>
      </div>

      {expenses.length === 0 ? (
        <div className="text-center py-10 text-zinc-500">
          <p className="text-3xl mb-2">📊</p>
          <p className="font-medium text-zinc-700">No expenses in this period</p>
          <p className="text-sm mt-1">Try a different time range.</p>
        </div>
      ) : (
        <>
          {/* Pie chart */}
          {slices.length > 0 && <PieChart slices={slices} />}

          {/* Tag breakdown table */}
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100">
              <h3 className="text-sm font-semibold text-zinc-700">By Tag</h3>
            </div>
            <div className="divide-y divide-zinc-100">
              {slices.map((slice, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                  {slice.emoji && <span className="text-base">{slice.emoji}</span>}
                  <span className="text-sm text-zinc-800 flex-1 font-medium">{slice.label}</span>
                  <span className="text-xs text-zinc-400 mr-2">{slice.percentage.toFixed(1)}%</span>
                  <span className="text-sm font-semibold text-zinc-900">
                    {formatAmount(slice.amount, currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Top expenses */}
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100">
              <h3 className="text-sm font-semibold text-zinc-700">Top Expenses</h3>
            </div>
            <div className="divide-y divide-zinc-100">
              {[...expenses]
                .sort((a, b) => b.amount - a.amount)
                .slice(0, 5)
                .map((e, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800 truncate">{e.description}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-zinc-400">
                          {new Date(e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </p>
                        {e.tags.map(tag => (
                          <span key={tag} className="text-xs px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600 font-medium">
                            {tagEmojiMap.get(tag) && <span className="mr-0.5">{tagEmojiMap.get(tag)}</span>}
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-zinc-900 shrink-0">
                      {formatAmount(e.amount, currency)}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
