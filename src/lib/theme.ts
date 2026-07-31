/**
 * Light/dark theme. We toggle a `.dark` class on <html>; index.css maps the
 * app's light utility classes to a dark palette under `.dark`. Choice persists
 * in localStorage and defaults to the OS preference.
 */
export type Theme = 'light' | 'dark'
const KEY = 'splitgit-theme'

export function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle('dark', t === 'dark')
  // Keep the browser UI (address bar) in sync
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', t === 'dark' ? '#050506' : '#18181b')
  try { localStorage.setItem(KEY, t) } catch { /* ignore */ }
}
