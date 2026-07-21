// ─── Core domain types ────────────────────────────────────────────────────────

export interface Split {
  member: number       // ledger member id (references LedgerMember.id)
  amount: number
}

export interface Expense {
  id: string
  type: 'EXPENSE'
  description: string
  amount: number
  currency: string
  paidBy: number       // ledger member id
  splits: Split[]      // must sum to amount
  splitType: 'equal' | 'exact' | 'percentage'
  tags: string[]       // tag IDs (references TagConfig.id)
  date: string         // YYYY-MM-DD — the actual expense date (user-set, defaults to today)
  supersedesId?: string // if set, this is a correction of the original event
  createdAt: string    // ISO 8601 — when the record was written (audit only)
  hash: string         // SHA-256 of all fields (tamper detection)
}

export interface Settlement {
  id: string
  type: 'SETTLEMENT'
  from: number         // ledger member id (payer)
  to: number           // ledger member id (payee)
  amount: number
  currency: string
  note?: string
  createdAt: string
  hash: string
}

export interface ExpenseDeletion {
  id: string
  type: 'EXPENSE_DELETION'
  deletedId: string   // id of the expense being soft-deleted
  deletedBy: string   // GitHub username of who deleted it
  createdAt: string
  hash: string
}

export type Event = Expense | Settlement | ExpenseDeletion

// ─── GitHub-backed group ──────────────────────────────────────────────────────

export interface Group {
  id: number           // GitHub repo id
  name: string         // repo name
  description: string  // repo description
  owner: string        // repo owner login
  members: Member[]
  createdAt: string
  isPrivate: boolean
  archived: boolean
  htmlUrl: string
}

export interface Member {
  login: string
  avatarUrl: string
  name: string | null
}

// ─── Balance computation ──────────────────────────────────────────────────────

/** Net amount owed between two ledger members. "from" owes "to". */
export interface DebtEdge {
  from: number
  to: number
  amount: number
  currency: string
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  login: string
  name: string | null
  avatarUrl: string
  token: string
}

// ─── Group config (stored in config.json in the repo) ────────────────────────

export interface TagConfig {
  id: string          // stable UUID — stored in expenses, never changes
  name: string        // e.g. "Food", "Transport" — can be renamed freely
  emoji?: string      // optional emoji prefix e.g. "🍔" — can be changed freely
}

/**
 * A ledger member = a person who appears in expenses. Identified by a stable
 * numeric id that transactions reference. `name` is the display label and can
 * be renamed freely. `claimedBy` links this slot to a GitHub account (login)
 * once someone claims it — so their in-app actions attribute to this slot.
 */
export interface LedgerMember {
  id: number
  name: string
  claimedBy?: string   // GitHub login of the account that owns this slot
}

export interface GroupConfig {
  version: 3
  tags: TagConfig[]
  members: LedgerMember[]
}

export const DEFAULT_GROUP_CONFIG: GroupConfig = {
  version: 3,
  tags: [],
  members: []
}

// ─── Offline queue ────────────────────────────────────────────────────────────

export interface QueuedEvent {
  id: string
  groupOwner: string
  groupName: string
  event: Event
  enqueuedAt: string
}
