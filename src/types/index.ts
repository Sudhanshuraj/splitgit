// ─── Core domain types ────────────────────────────────────────────────────────

export interface Split {
  username: string
  amount: number
}

export interface Expense {
  id: string
  type: 'EXPENSE'
  description: string
  amount: number
  currency: string
  paidBy: string       // GitHub username
  splits: Split[]      // must sum to amount
  splitType: 'equal' | 'exact' | 'percentage'
  createdAt: string    // ISO 8601
  hash: string         // SHA-256 of all fields (tamper detection)
}

export interface Settlement {
  id: string
  type: 'SETTLEMENT'
  from: string         // GitHub username
  to: string           // GitHub username
  amount: number
  currency: string
  note?: string
  createdAt: string
  hash: string
}

export type Event = Expense | Settlement

// ─── GitHub-backed group ──────────────────────────────────────────────────────

export interface Group {
  id: number           // GitHub repo id
  name: string         // repo name
  description: string  // repo description
  owner: string        // repo owner login
  members: Member[]
  createdAt: string
  isPrivate: boolean
  htmlUrl: string
}

export interface Member {
  login: string
  avatarUrl: string
  name: string | null
}

// ─── Balance computation ──────────────────────────────────────────────────────

/** Net amount owed between two people. Positive = "from" owes "to". */
export interface DebtEdge {
  from: string
  to: string
  amount: number
  currency: string
}

/** Per-person net balance within a group */
export interface Balance {
  username: string
  avatarUrl: string
  net: number          // positive = is owed, negative = owes
  currency: string
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  login: string
  name: string | null
  avatarUrl: string
  token: string
}

// ─── Offline queue ────────────────────────────────────────────────────────────

export interface QueuedEvent {
  id: string
  groupOwner: string
  groupName: string
  event: Event
  enqueuedAt: string
}
