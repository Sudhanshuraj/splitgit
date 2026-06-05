import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthUser } from '../types'
import { makeOctokit, getCurrentUser } from '../lib/github'
import { Octokit } from 'octokit'

interface AuthState {
  user: AuthUser | null
  octokit: Octokit | null
  isLoading: boolean
  login: (token: string) => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      octokit: null,
      isLoading: false,

      login: async (token: string) => {
        set({ isLoading: true })
        try {
          const octokit = makeOctokit(token)
          const userData = await getCurrentUser(octokit)
          const user: AuthUser = { ...userData, token }
          set({ user, octokit, isLoading: false })
        } catch (err) {
          set({ isLoading: false })
          throw err
        }
      },

      logout: () => {
        set({ user: null, octokit: null })
      }
    }),
    {
      name: 'splitgit-auth',
      // Only persist the token & user, not the Octokit instance
      partialize: (state) => ({ user: state.user }),
      onRehydrateStorage: () => (state) => {
        // Re-create Octokit from stored token after hydration
        if (state?.user?.token) {
          state.octokit = makeOctokit(state.user.token)
        }
      }
    }
  )
)
