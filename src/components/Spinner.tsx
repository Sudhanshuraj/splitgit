export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="w-6 h-6 border-2 border-zinc-200 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  )
}

export function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50">
      <div className="flex flex-col items-center gap-3 text-zinc-500">
        <div className="w-10 h-10 border-3 border-zinc-200 border-t-emerald-500 rounded-full animate-spin" />
        <p className="text-sm">Loading…</p>
      </div>
    </div>
  )
}
