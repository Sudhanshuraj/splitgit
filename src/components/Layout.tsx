import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { useToast } from '../store/toast'
import { applyTheme, getInitialTheme, type Theme } from '../lib/theme'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore()
  const location = useLocation()
  const toast = useToast()
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
  }

  const navItems = [
    { path: '/groups', label: 'Groups', icon: '⑂' },
    { path: '/settle', label: 'Settle', icon: '✓' }
  ]

  return (
    <div className="app-shell min-h-screen flex flex-col relative">
      {/* Flowing liquid backdrop */}
      <div className="liquid-bg" aria-hidden="true">
        <span className="blob blob-1" />
        <span className="blob blob-2" />
        <span className="blob blob-3" />
      </div>

      {/* Top header */}
      <header className="glass-header text-white px-4 py-3 flex items-center justify-between sticky top-0 z-50">
        <Link to="/groups" className="flex items-center gap-2 font-semibold text-lg">
          <span className="text-emerald-400 text-xl">⑂</span>
          SplitGit
        </Link>
        <div className="flex items-center gap-3">
          <button onClick={toggleTheme} title="Toggle dark mode"
            className="text-zinc-300 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10">
            {theme === 'dark' ? (
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" /></svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" /></svg>
            )}
          </button>
          {user && (
            <>
              <img src={user.avatarUrl} alt={user.login} className="w-8 h-8 rounded-full border-2 border-zinc-600" />
              <button onClick={logout} className="text-zinc-400 hover:text-white text-sm transition-colors">Sign out</button>
            </>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 relative z-10">
        {children}
      </main>

      {/* Background-save failure toast */}
      {toast.message && (
        <div className="fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4">
          <div className="bg-zinc-900 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 max-w-md w-full border border-white/10">
            <span className="text-red-400 text-lg">⚠</span>
            <span className="text-sm flex-1">{toast.message}</span>
            {toast.retry && (
              <button onClick={() => { toast.retry?.(); toast.dismiss() }}
                className="text-emerald-400 font-semibold text-sm">Retry</button>
            )}
            <button onClick={toast.dismiss} className="text-zinc-400 hover:text-white text-sm">✕</button>
          </div>
        </div>
      )}

      {/* Bottom nav (mobile) */}
      {user && (
        <nav className="sticky bottom-0 z-40 glass-nav flex safe-bottom">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex-1 flex flex-col items-center py-3 gap-0.5 text-xs font-medium transition-colors
                ${location.pathname.startsWith(item.path)
                  ? 'text-emerald-600'
                  : 'text-zinc-500 hover:text-zinc-800'
                }`}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}
