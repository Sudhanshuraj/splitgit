/**
 * CSV import/export format — wide, per-member columns, so every row shows
 * exactly who paid what and who owed what:
 *
 *   date,description,tag,paid_<Member1>,paid_<Member2>,...,owed_<Member1>,owed_<Member2>,...
 *
 * Member names come straight from the header (paid_/owed_ prefix stripped).
 * Leave a cell blank/0 if that person wasn't involved. `amount` is not a
 * separate column — it's the sum of the paid_ columns, and the owed_
 * columns must sum to the same total (a mismatch is a warning, not fatal).
 *
 * This is a clean, from-scratch format — no attempt to read the older
 * single paid_by/splits-string CSVs.
 *
 * Settlement CSV columns are unchanged: date,from,to,amount,note
 */

export interface ParsedSplit {
  username: string
  amount: number
}

export interface ImportExpenseRow {
  line: number
  date: string
  description: string
  amount: number          // derived: sum of the paid_ columns
  tag: string             // tag NAME as written in the CSV (resolved to an id later)
  paid: ParsedSplit[]     // who paid, and how much each contributed
  owed: ParsedSplit[]     // who owes, and how much each owes
  warnings: string[]
}

export interface ImportSettlementRow {
  line: number
  date: string
  from: string
  to: string
  amount: number
  note: string
  warnings: string[]
}

export interface ParsedExpenses {
  rows: ImportExpenseRow[]
  errors: string[]        // fatal per-line problems (row skipped)
  members: string[]       // member names found in the header, in column order
}

export interface ParsedSettlements {
  rows: ImportSettlementRow[]
  errors: string[]
}

// ─── CSV line splitter (handles quoted fields with commas) ─────────────────────

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (c === ',' && !inQuotes) {
      out.push(cur); cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out.map(s => s.trim())
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// ─── Expense CSV ───────────────────────────────────────────────────────────────

export function parseImportCsv(text: string): ParsedExpenses {
  const errors: string[] = []
  const rows: ImportExpenseRow[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return { rows, errors: ['File is empty'], members: [] }

  const header = splitCsvLine(lines[0]!)
  const dateIdx = header.findIndex(h => h.toLowerCase() === 'date')
  const descIdx = header.findIndex(h => h.toLowerCase() === 'description')
  const tagIdx = header.findIndex(h => h.toLowerCase() === 'tag')
  if (dateIdx === -1 || descIdx === -1) {
    return { rows: [], errors: ['Header must include "date" and "description" columns'], members: [] }
  }

  const paidCols: { idx: number; name: string }[] = []
  const owedCols: { idx: number; name: string }[] = []
  header.forEach((h, i) => {
    if (/^paid_/i.test(h)) paidCols.push({ idx: i, name: h.slice(5).trim() })
    else if (/^owed_/i.test(h)) owedCols.push({ idx: i, name: h.slice(5).trim() })
  })
  if (paidCols.length === 0 || owedCols.length === 0) {
    return { rows: [], errors: ['Header must include at least one "paid_<name>" and one "owed_<name>" column'], members: [] }
  }
  const members = [...new Set([...paidCols.map(c => c.name), ...owedCols.map(c => c.name)])]

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1
    const c = splitCsvLine(lines[i]!)
    const date = c[dateIdx] ?? ''
    const description = c[descIdx] ?? ''
    const tag = tagIdx !== -1 ? (c[tagIdx] ?? '') : ''

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push(`Line ${lineNo}: bad date "${date}" (want YYYY-MM-DD)`); continue }
    if (!description) { errors.push(`Line ${lineNo}: missing description`); continue }

    const warnings: string[] = []
    const paid: ParsedSplit[] = []
    for (const { idx, name } of paidCols) {
      const raw = c[idx]
      if (!raw) continue
      const amt = parseFloat(raw)
      if (isNaN(amt)) { warnings.push(`bad paid_${name} value "${raw}"`); continue }
      if (amt > 0) paid.push({ username: name, amount: round2(amt) })
    }
    const owed: ParsedSplit[] = []
    for (const { idx, name } of owedCols) {
      const raw = c[idx]
      if (!raw) continue
      const amt = parseFloat(raw)
      if (isNaN(amt)) { warnings.push(`bad owed_${name} value "${raw}"`); continue }
      if (amt > 0) owed.push({ username: name, amount: round2(amt) })
    }

    if (paid.length === 0) { errors.push(`Line ${lineNo}: no one marked as having paid`); continue }
    if (owed.length === 0) { errors.push(`Line ${lineNo}: no one marked as owing`); continue }

    const amount = round2(paid.reduce((s, p) => s + p.amount, 0))
    const owedSum = round2(owed.reduce((s, o) => s + o.amount, 0))
    if (Math.abs(owedSum - amount) > 0.01) {
      warnings.push(`paid totals ${amount} but owed totals ${owedSum}`)
    }

    rows.push({ line: lineNo, date, description, amount, tag, paid, owed, warnings })
  }

  return { rows, errors, members }
}

// ─── Settlement CSV (unchanged shape) ──────────────────────────────────────────

export function parseSettlementsCsv(text: string): ParsedSettlements {
  const errors: string[] = []
  const rows: ImportSettlementRow[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return { rows, errors: [] }

  let start = 0
  if (/from/i.test(lines[0]!) && /to/i.test(lines[0]!)) start = 1

  for (let i = start; i < lines.length; i++) {
    const lineNo = i + 1
    const c = splitCsvLine(lines[i]!)
    if (c.length < 4) { errors.push(`Line ${lineNo}: expected 4-5 columns, got ${c.length}`); continue }
    const [date, from, to, amountStr, note = ''] = c
    const amount = parseFloat(amountStr!)
    if (isNaN(amount) || amount <= 0) { errors.push(`Line ${lineNo}: bad amount "${amountStr}"`); continue }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date!)) { errors.push(`Line ${lineNo}: bad date "${date}"`); continue }
    if (!from || !to) { errors.push(`Line ${lineNo}: missing from/to`); continue }
    rows.push({ line: lineNo, date: date!, from: from!, to: to!, amount: round2(amount), note, warnings: [] })
  }

  return { rows, errors }
}

/** Net receivable for a person implied by a set of expense rows (for a pre-commit sanity check). */
export function netForPerson(person: string, rows: ImportExpenseRow[]): number {
  let net = 0
  for (const r of rows) {
    const paidShare = r.paid.find(p => p.username === person)
    if (paidShare) net += paidShare.amount
    const owedShare = r.owed.find(o => o.username === person)
    if (owedShare) net -= owedShare.amount
  }
  return round2(net)
}
