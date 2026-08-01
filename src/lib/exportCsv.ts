/**
 * Export the live ledger to CSV, mirroring the import format exactly:
 *   expenses:    date,description,tag,paid_<Member1>,...,owed_<Member1>,...
 *   settlements: date,from,to,amount,note
 *
 * One column pair per group member — a row shows exactly who paid what and
 * who owed what, with blanks for anyone not involved. `amount` is not a
 * separate column; it's the sum of the paid_ columns.
 *
 * Uses resolveExpenses() so edited/deleted events are collapsed to their
 * current, correct state — this is a snapshot of what the app shows today,
 * not the raw append-only log.
 */
import { resolveExpenses } from './eventLog'
import { contributionsOf } from './members'
import type { Event, GroupConfig, LedgerMember } from '../types'

function csvField(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function tagNameFor(id: string, config: GroupConfig | null | undefined): string {
  return config?.tags.find(t => t.id === id)?.name ?? id
}

export function buildExpensesCsv(events: Event[], config: GroupConfig | null | undefined): string {
  const expenses = resolveExpenses(events)
  const members: LedgerMember[] = config?.members ?? []

  const header = [
    'date', 'description', 'tag',
    ...members.map(m => `paid_${m.name}`),
    ...members.map(m => `owed_${m.name}`)
  ]
  const lines = [header.join(',')]

  for (const e of expenses) {
    const tag = e.tags[0] ? tagNameFor(e.tags[0], config) : ''
    const paidByMember = new Map(contributionsOf(e).map(c => [c.member, c.amount]))
    const owedByMember = new Map(e.splits.map(s => [s.member, s.amount]))

    const row = [
      e.date,
      csvField(e.description),
      csvField(tag),
      ...members.map(m => { const v = paidByMember.get(m.id); return v ? v.toString() : '' }),
      ...members.map(m => { const v = owedByMember.get(m.id); return v ? v.toString() : '' })
    ]
    lines.push(row.join(','))
  }
  return lines.join('\n') + '\n'
}

export function buildSettlementsCsv(events: Event[], config: GroupConfig | null | undefined): string {
  const settlements = events.filter(e => e.type === 'SETTLEMENT')
  const lines = ['date,from,to,amount,note']
  for (const s of settlements) {
    const date = s.createdAt.slice(0, 10)
    const from = config?.members.find(m => m.id === s.from)?.name ?? `#${s.from}`
    const to = config?.members.find(m => m.id === s.to)?.name ?? `#${s.to}`
    const row = [date, csvField(from), csvField(to), s.amount.toString(), csvField(s.note ?? '')]
    lines.push(row.join(','))
  }
  return lines.join('\n') + '\n'
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
