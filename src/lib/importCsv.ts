/**
 * Parse the SplitKaro-migration CSVs into typed rows.
 *
 * Expense CSV columns:  date,description,amount,paid_by,split_type,splits,tag
 *   - split_type "equal": `splits` is a comma list of usernames (amount divided evenly)
 *   - split_type "exact": `splits` is "Name:amount,Name:amount" (must sum to amount)
 * Settlement CSV columns: date,from,to,amount,note
 *
 * The parser resolves splits into concrete {username, amount} pairs and surfaces
 * warnings (bad numbers, sums that don't match) rather than throwing, so the
 * preview screen can show problems before anything is committed.
 */

export interface ParsedSplit {
  username: string
  amount: number
}

export interface ImportExpenseRow {
  line: number
  date: string
  description: string
  amount: number
  paidBy: string
  splitType: 'equal' | 'exact'
  splits: ParsedSplit[]
  tag: string            // tag NAME as written in the CSV (resolved to an id later)
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

/** Divide `amount` evenly across `people`, putting any rounding remainder on the first. */
export function equalSplit(amount: number, people: string[]): ParsedSplit[] {
  const each = round2(amount / people.length)
  const remainder = round2(amount - each * people.length)
  return people.map((username, i) => ({
    username,
    amount: i === 0 ? round2(each + remainder) : each
  }))
}

// ─── Expense CSV ───────────────────────────────────────────────────────────────

export function parseImportCsv(text: string): ParsedExpenses {
  const errors: string[] = []
  const rows: ImportExpenseRow[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return { rows, errors: ['File is empty'] }

  // Detect + skip a header row
  let start = 0
  if (/date/i.test(lines[0]) && /amount/i.test(lines[0])) start = 1

  for (let i = start; i < lines.length; i++) {
    const lineNo = i + 1
    const c = splitCsvLine(lines[i])
    if (c.length < 7) { errors.push(`Line ${lineNo}: expected 7 columns, got ${c.length}`); continue }
    const [date, description, amountStr, paidBy, splitTypeRaw, splitsRaw, tag] = c

    const amount = parseFloat(amountStr)
    if (isNaN(amount) || amount <= 0) { errors.push(`Line ${lineNo}: bad amount "${amountStr}"`); continue }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push(`Line ${lineNo}: bad date "${date}" (want YYYY-MM-DD)`); continue }
    if (!paidBy) { errors.push(`Line ${lineNo}: missing paid_by`); continue }

    const splitType = splitTypeRaw.toLowerCase() === 'exact' ? 'exact' : 'equal'
    const warnings: string[] = []
    let splits: ParsedSplit[]

    if (splitType === 'exact') {
      splits = []
      for (const part of splitsRaw.split(',')) {
        const [name, amtStr] = part.split(':')
        const amt = parseFloat(amtStr)
        if (!name || isNaN(amt)) { warnings.push(`unparseable split "${part}"`); continue }
        splits.push({ username: name.trim(), amount: round2(amt) })
      }
      const sum = round2(splits.reduce((s, x) => s + x.amount, 0))
      if (Math.abs(sum - round2(amount)) > 0.01) {
        warnings.push(`splits sum to ${sum} but amount is ${amount}`)
      }
    } else {
      const people = splitsRaw.split(',').map(s => s.trim()).filter(Boolean)
      if (people.length === 0) { errors.push(`Line ${lineNo}: no participants`); continue }
      splits = equalSplit(amount, people)
    }

    rows.push({ line: lineNo, date, description, amount: round2(amount), paidBy, splitType, splits, tag, warnings })
  }

  return { rows, errors }
}

// ─── Settlement CSV ──────────────────────────────────────────────────────────

export function parseSettlementsCsv(text: string): ParsedSettlements {
  const errors: string[] = []
  const rows: ImportSettlementRow[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return { rows, errors: [] }

  let start = 0
  if (/from/i.test(lines[0]) && /to/i.test(lines[0])) start = 1

  for (let i = start; i < lines.length; i++) {
    const lineNo = i + 1
    const c = splitCsvLine(lines[i])
    if (c.length < 4) { errors.push(`Line ${lineNo}: expected 4-5 columns, got ${c.length}`); continue }
    const [date, from, to, amountStr, note = ''] = c
    const amount = parseFloat(amountStr)
    if (isNaN(amount) || amount <= 0) { errors.push(`Line ${lineNo}: bad amount "${amountStr}"`); continue }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push(`Line ${lineNo}: bad date "${date}"`); continue }
    if (!from || !to) { errors.push(`Line ${lineNo}: missing from/to`); continue }
    rows.push({ line: lineNo, date, from, to, amount: round2(amount), note, warnings: [] })
  }

  return { rows, errors }
}

/** Net receivable for a person implied by a set of expense rows (for a pre-commit sanity check). */
export function netForPerson(person: string, rows: ImportExpenseRow[]): number {
  let net = 0
  for (const r of rows) {
    if (r.paidBy === person) net += r.amount
    const share = r.splits.find(s => s.username === person)
    if (share) net -= share.amount
  }
  return round2(net)
}
