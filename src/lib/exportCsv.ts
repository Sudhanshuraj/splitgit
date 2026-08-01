/**
 * Export the live ledger back into the same CSV shape the importer accepts:
 *   expenses:    date,description,amount,paid_by,split_type,splits,tag
 *   settlements: date,from,to,amount,note
 *
 * Uses resolveExpenses() so edited/deleted events are collapsed to their
 * current, correct state — this is a snapshot of what the app shows today,
 * not the raw append-only log.
 */
import { resolveExpenses } from './eventLog'
import type { Event, GroupConfig } from '../types'

function csvField(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function nameFor(id: number, config: GroupConfig | null | undefined): string {
  return config?.members.find(m => m.id === id)?.name ?? `#${id}`
}

function tagNameFor(id: string, config: GroupConfig | null | undefined): string {
  return config?.tags.find(t => t.id === id)?.name ?? id
}

export function buildExpensesCsv(events: Event[], config: GroupConfig | null | undefined): string {
  const expenses = resolveExpenses(events)
  const lines = ['date,description,amount,paid_by,split_type,splits,tag']
  for (const e of expenses) {
    const paidBy = nameFor(e.paidBy, config)
    const tag = e.tags[0] ? tagNameFor(e.tags[0], config) : ''
    const isEqual = e.splitType === 'equal'
    const splitsStr = isEqual
      ? e.splits.map(s => nameFor(s.member, config)).join(',')
      : e.splits.map(s => `${nameFor(s.member, config)}:${s.amount}`).join(',')
    const row = [
      e.date,
      csvField(e.description),
      e.amount.toString(),
      csvField(paidBy),
      isEqual ? 'equal' : 'exact',
      csvField(splitsStr),
      csvField(tag)
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
    const from = nameFor(s.from, config)
    const to = nameFor(s.to, config)
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
