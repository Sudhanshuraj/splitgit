/**
 * DatePicker — shows a button with the selected date.
 * Clicking opens a small calendar popup.
 * Clicking outside closes it.
 */
import { useState, useRef, useEffect } from 'react'

interface Props {
  value: string         // YYYY-MM-DD
  onChange: (v: string) => void
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

function toLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDisplay(iso: string): string {
  const d = toLocal(iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function DatePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const selected = toLocal(value)
  const [cursor, setCursor] = useState(new Date(selected.getFullYear(), selected.getMonth(), 1))
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  function prevMonth() {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
  }
  function nextMonth() {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
  }

  // Build calendar grid
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstDay = new Date(year, month, 1).getDay()   // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = toISO(new Date())

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ]
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null)

  function selectDay(day: number) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    onChange(iso)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => { setCursor(new Date(selected.getFullYear(), selected.getMonth(), 1)); setOpen(o => !o) }}
        className="w-full flex items-center gap-2 border border-zinc-300 rounded-xl px-4 py-3 bg-white text-zinc-800 text-sm hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
      >
        <svg className="w-4 h-4 text-zinc-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
        </svg>
        <span className="flex-1 text-left font-medium">{formatDisplay(value)}</span>
        <svg className="w-4 h-4 text-zinc-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Calendar popup */}
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white border border-zinc-200 rounded-2xl shadow-xl p-3 w-72">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-3 px-1">
            <button type="button" onClick={prevMonth}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800 transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
              </svg>
            </button>
            <span className="text-sm font-semibold text-zinc-800">
              {MONTHS[month]} {year}
            </span>
            <button type="button" onClick={nextMonth}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800 transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map(d => (
              <div key={d} className="text-center text-xs font-medium text-zinc-400 py-1">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => {
              if (day === null) return <div key={i} />
              const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const isSelected = iso === value
              const isToday = iso === today
              return (
                <button key={i} type="button" onClick={() => selectDay(day)}
                  className={`h-8 w-full rounded-lg text-sm font-medium transition-colors
                    ${isSelected
                      ? 'bg-emerald-600 text-white'
                      : isToday
                      ? 'bg-emerald-50 text-emerald-700 font-semibold'
                      : 'text-zinc-700 hover:bg-zinc-100'
                    }`}>
                  {day}
                </button>
              )
            })}
          </div>

          {/* Today shortcut */}
          <div className="mt-2 pt-2 border-t border-zinc-100 text-center">
            <button type="button" onClick={() => { onChange(today); setOpen(false) }}
              className="text-xs text-emerald-600 font-medium hover:text-emerald-700">
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
