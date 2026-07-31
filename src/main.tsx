import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { App } from './App'
import { applyTheme, getInitialTheme } from './lib/theme'

// Set theme before first paint to avoid a flash of the wrong palette
applyTheme(getInitialTheme())

// Auto-update: when a new version is deployed, activate it immediately and
// reload the page so the new code runs. No manual cache clearing ever needed.
//
// skipWaiting + clientsClaim (set in vite.config workbox) make the new SW take
// control right away; that fires `controllerchange`, which we listen for below
// to reload the currently-open tab exactly once.
if ('serviceWorker' in navigator) {
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // prompt-mode fallback — force the update through immediately
    window.location.reload()
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    // Check for a new deploy on every focus/visibility change and every 60s,
    // so a long-open app still picks up updates without any manual action.
    const check = () => registration.update().catch(() => {})
    setInterval(check, 60_000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  }
})
// Some browsers park a new SW in "waiting" — nudge it to activate immediately.
void updateSW

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
      gcTime: 5 * 60_000
    }
  }
})

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
)
