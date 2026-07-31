import { create } from 'zustand'

interface ToastState {
  message: string | null
  retry: (() => void) | null
  show: (message: string, retry?: () => void) => void
  dismiss: () => void
}

/** Tiny global toast — used to surface background write failures with a retry. */
export const useToast = create<ToastState>((set) => ({
  message: null,
  retry: null,
  show: (message, retry) => set({ message, retry: retry ?? null }),
  dismiss: () => set({ message: null, retry: null })
}))
