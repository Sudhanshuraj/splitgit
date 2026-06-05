import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { Groups } from './pages/Groups'
import { Group } from './pages/Group'
import { AddExpense } from './pages/AddExpense'
import { Settle } from './pages/Settle'
import { GlobalSettle } from './pages/GlobalSettle'
import { GroupSettings } from './pages/GroupSettings'
import { getQueuedEvents, removeQueuedEvent, isOnline, onOnline } from './lib/offline'
import { addExpense, addSettlement } from './lib/eventLog'
import type { Expense, Settlement } from './types'

/** Guard: redirect to / if not authenticated */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)
  if (!user) return <Navigate to="/" replace />
  return <>{children}</>
}

export function App() {
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()

  // Flush offline queue when we come back online (or on mount if already online)
  useEffect(() => {
    if (!octokit || !user) return

    async function flushQueue() {
      if (!isOnline() || !octokit) return
      const queued = await getQueuedEvents()
      for (const item of queued) {
        try {
          if (item.event.type === 'EXPENSE') {
            const e = item.event as Expense
            await addExpense(octokit, item.groupOwner, item.groupName, {
              description: e.description,
              amount: e.amount,
              currency: e.currency,
              paidBy: e.paidBy,
              participants: e.splits.map(s => s.username),
              splitType: 'equal',
              tags: e.tags ?? []
            })
          } else {
            const s = item.event as Settlement
            await addSettlement(octokit, item.groupOwner, item.groupName, {
              from: s.from,
              to: s.to,
              amount: s.amount,
              currency: s.currency,
              note: s.note
            })
          }
          await removeQueuedEvent(item.id)
        } catch {
          // Leave in queue; will retry next time
        }
      }
    }

    flushQueue()
    const cleanup = onOnline(flushQueue)
    return cleanup
  }, [octokit, user])

  // Handle OAuth redirect at /auth/callback — the code is picked up by Home.tsx
  // but if someone lands on /auth/callback directly after login, redirect to /
  useEffect(() => {
    if (window.location.pathname === '/auth/callback') {
      navigate('/', { replace: true })
    }
  }, [navigate])

  return (
    <Routes>
      {/* Public: login / OAuth callback */}
      <Route path="/" element={<Home />} />
      <Route path="/auth/callback" element={<Home />} />

      {/* Protected routes — all inside Layout (header + bottom nav) */}
      <Route
        path="/groups"
        element={
          <RequireAuth>
            <Layout><Groups /></Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/groups/:owner/:repo"
        element={
          <RequireAuth>
            <Layout><Group /></Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/groups/:owner/:repo/add"
        element={
          <RequireAuth>
            <Layout><AddExpense /></Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/groups/:owner/:repo/settle"
        element={
          <RequireAuth>
            <Layout><Settle /></Layout>
          </RequireAuth>
        }
      />

      {/* Group settings */}
      <Route
        path="/groups/:owner/:repo/settings"
        element={
          <RequireAuth>
            <Layout><GroupSettings /></Layout>
          </RequireAuth>
        }
      />

      {/* Global cross-group settle */}
      <Route
        path="/settle"
        element={
          <RequireAuth>
            <Layout><GlobalSettle /></Layout>
          </RequireAuth>
        }
      />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/groups" replace />} />
    </Routes>
  )
}
