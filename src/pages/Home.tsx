/**
 * Login page — shown when the user is not authenticated.
 * Initiates GitHub OAuth flow.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { buildOAuthUrl, exchangeCodeForToken } from '../lib/github'
import { Spinner } from '../components/Spinner'

function generateState(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function Home() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, login, isLoading } = useAuthStore()
  const [error, setError] = useState<string | null>(null)
  const [exchanging, setExchanging] = useState(false)

  // If already logged in, go to groups
  useEffect(() => {
    if (user) navigate('/groups', { replace: true })
  }, [user, navigate])

  // Handle OAuth callback (code + state params)
  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const storedState = sessionStorage.getItem('oauth_state')

    if (!code) return
    if (state !== storedState) {
      setError('Invalid OAuth state. Please try again.')
      return
    }

    sessionStorage.removeItem('oauth_state')
    setExchanging(true)

    exchangeCodeForToken(code)
      .then(token => login(token))
      .then(() => navigate('/groups', { replace: true }))
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Login failed. Please try again.')
        setExchanging(false)
      })
  }, [searchParams, login, navigate])

  function handleLogin() {
    const state = generateState()
    sessionStorage.setItem('oauth_state', state)
    window.location.href = buildOAuthUrl(state)
  }

  if (isLoading || exchanging) {
    return (
      <div className="min-h-screen bg-zinc-900 flex flex-col items-center justify-center gap-6 px-4">
        <div className="text-emerald-400 text-5xl">⑂</div>
        <Spinner className="mt-2" />
        <p className="text-zinc-400 text-sm">Signing you in…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-900 flex flex-col items-center justify-center px-6 text-center">
      {/* Logo */}
      <div className="mb-6">
        <div className="text-7xl text-emerald-400 mb-3">⑂</div>
        <h1 className="text-4xl font-bold text-white tracking-tight">SplitGit</h1>
        <p className="text-zinc-400 mt-2 text-lg">Expense splitting, powered by GitHub.</p>
      </div>

      {/* Feature highlights */}
      <div className="grid grid-cols-1 gap-3 mb-10 w-full max-w-sm text-left">
        {[
          { icon: '🔐', title: 'No account needed', desc: 'Use your existing GitHub login' },
          { icon: '📋', title: 'Audit trail forever', desc: 'Every expense is a git commit' },
          { icon: '📵', title: 'Works offline', desc: 'Queue expenses, sync when back online' },
          { icon: '📱', title: 'Install as app', desc: 'Add to home screen on iOS or Android' }
        ].map(f => (
          <div key={f.title} className="flex items-start gap-3 bg-zinc-800 rounded-xl p-3">
            <span className="text-2xl">{f.icon}</span>
            <div>
              <p className="text-white text-sm font-medium">{f.title}</p>
              <p className="text-zinc-400 text-xs">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 w-full max-w-sm bg-red-900/40 border border-red-700 rounded-xl p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleLogin}
        className="w-full max-w-sm flex items-center justify-center gap-3 bg-white hover:bg-zinc-100 text-zinc-900 font-semibold py-4 rounded-2xl text-base transition-colors shadow-lg"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
        Continue with GitHub
      </button>

      <p className="mt-6 text-zinc-500 text-xs max-w-xs">
        SplitGit creates private repositories in your GitHub account to store group expenses.
        Your data is yours.
      </p>
    </div>
  )
}
