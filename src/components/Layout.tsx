import { Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore()
  const location = useLocation()

  const navItems = [
    { path: '/groups', label: 'Groups', icon: '⑂' },
    { path: '/settle', label: 'Settle', icon: '✓' }
  ]

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {/* Top header */}
      <header className="bg-zinc-900 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-50">
        <Link to="/groups" className="flex items-center gap-2 font-semibold text-lg">
          <span className="text-emerald-400 text-xl">⑂</span>
          SplitGit
        </Link>
        {user && (
          <div className="flex items-center gap-3">
            <img
              src={user.avatarUrl}
              alt={user.login}
              className="w-8 h-8 rounded-full border-2 border-zinc-600"
            />
            <button
              onClick={logout}
              className="text-zinc-400 hover:text-white text-sm transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        {children}
      </main>

      {/* Bottom nav (mobile) */}
      {user && (
        <nav className="sticky bottom-0 bg-white border-t border-zinc-200 flex safe-bottom">
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
