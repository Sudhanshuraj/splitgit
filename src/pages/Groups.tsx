/**
 * Groups list — shows all expense groups the current user is a member of.
 * Tabs: Active | Archived
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { listGroups, createGroup, unarchiveGroup } from '../lib/github'
import { Spinner } from '../components/Spinner'
import type { Group } from '../types'

export function Groups() {
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [tab, setTab] = useState<'active' | 'archived'>('active')

  const { data: groups, isLoading, error } = useQuery({
    queryKey: ['groups'],
    queryFn: () => listGroups(octokit!),
    enabled: !!octokit,
    staleTime: 30_000
  })

  const createMutation = useMutation({
    mutationFn: ({ name, desc }: { name: string; desc: string }) =>
      createGroup(octokit!, name, desc),
    onSuccess: (newGroup: Group) => {
      qc.setQueryData(['groups'], (old: Group[] = []) => [newGroup, ...old])
      setShowCreate(false)
      setNewName('')
      setNewDesc('')
      navigate(`/groups/${newGroup.owner}/${newGroup.name}`)
    }
  })

  const unarchiveMutation = useMutation({
    mutationFn: ({ owner, repo }: { owner: string; repo: string }) =>
      unarchiveGroup(octokit!, owner, repo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
    }
  })

  if (!user) return null

  const activeGroups = groups?.filter(g => !g.archived) ?? []
  const archivedGroups = groups?.filter(g => g.archived) ?? []
  const shown = tab === 'active' ? activeGroups : archivedGroups

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Your Groups</h1>
        {tab === 'active' && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            + New Group
          </button>
        )}
      </div>

      {/* Active / Archived tabs */}
      <div className="flex bg-zinc-100 rounded-xl p-1 mb-5">
        <button
          onClick={() => setTab('active')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors
            ${tab === 'active' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          Active
          {groups && activeGroups.length > 0 && (
            <span className="ml-1.5 text-xs bg-emerald-100 text-emerald-700 font-semibold px-1.5 py-0.5 rounded-full">
              {activeGroups.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('archived')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors
            ${tab === 'archived' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          Archived
          {groups && archivedGroups.length > 0 && (
            <span className="ml-1.5 text-xs bg-zinc-200 text-zinc-600 font-semibold px-1.5 py-0.5 rounded-full">
              {archivedGroups.length}
            </span>
          )}
        </button>
      </div>

      {/* Create group modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-4 pb-safe">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-zinc-900 mb-4">New Group</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Group name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Hiking Trip 2025"
                  className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  autoFocus
                />
                <p className="text-xs text-zinc-400 mt-1">
                  This becomes a private GitHub repo name (only letters, numbers, hyphens).
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Description <span className="text-zinc-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder="e.g. Weekend hiking with friends"
                  className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
            {createMutation.error && (
              <p className="text-red-600 text-sm mt-3">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : 'Failed to create group'}
              </p>
            )}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowCreate(false); setNewName(''); setNewDesc('') }}
                className="flex-1 border border-zinc-300 text-zinc-700 font-medium py-3 rounded-xl hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate({ name: newName, desc: newDesc })}
                disabled={!newName.trim() || createMutation.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {createMutation.isPending ? <Spinner /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          Failed to load groups: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {!isLoading && shown.length === 0 && (
        <div className="text-center py-16 text-zinc-500">
          {tab === 'active' ? (
            <>
              <div className="text-5xl mb-4">⑂</div>
              <p className="font-medium text-zinc-700 text-lg">No groups yet</p>
              <p className="text-sm mt-1">Create your first group to start splitting expenses.</p>
            </>
          ) : (
            <>
              <div className="text-4xl mb-4">📦</div>
              <p className="font-medium text-zinc-700">No archived groups</p>
            </>
          )}
        </div>
      )}

      {shown.length > 0 && (
        <div className="space-y-3">
          {shown.map(group => (
            <GroupCard
              key={group.id}
              group={group}
              currentUser={user.login}
              onUnarchive={
                group.archived && group.owner === user.login
                  ? () => unarchiveMutation.mutate({ owner: group.owner, repo: group.name })
                  : undefined
              }
              unarchiving={unarchiveMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function GroupCard({
  group,
  currentUser,
  onUnarchive,
  unarchiving
}: {
  group: Group
  currentUser: string
  onUnarchive?: () => void
  unarchiving?: boolean
}) {
  const navigate = useNavigate()
  const isOwner = group.owner === currentUser

  return (
    <div className={`bg-white border rounded-2xl p-4 transition-all
      ${group.archived ? 'border-zinc-200 opacity-75' : 'border-zinc-200 hover:border-emerald-300 hover:shadow-sm cursor-pointer'}`}
      onClick={group.archived ? undefined : () => navigate(`/groups/${group.owner}/${group.name}`)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-zinc-900 truncate">{group.name}</h3>
            {isOwner && !group.archived && (
              <span className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full shrink-0">owner</span>
            )}
            {group.archived && (
              <span className="text-xs bg-amber-100 text-amber-700 font-medium px-2 py-0.5 rounded-full shrink-0">
                archived
              </span>
            )}
          </div>
          {group.description && (
            <p className="text-sm text-zinc-500 mt-0.5 truncate">{group.description}</p>
          )}
        </div>

        {onUnarchive ? (
          <button
            onClick={e => { e.stopPropagation(); onUnarchive() }}
            disabled={unarchiving}
            className="shrink-0 border border-emerald-400 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors flex items-center gap-1.5">
            {unarchiving ? <Spinner /> : '↩ Unarchive'}
          </button>
        ) : (
          !group.archived && (
            <svg className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
            </svg>
          )
        )}
      </div>

      {/* Member avatars */}
      <div className="flex items-center gap-1 mt-3">
        <div className="flex -space-x-1.5">
          {group.members.slice(0, 5).map(m => (
            <img
              key={m.login}
              src={m.avatarUrl}
              alt={m.login}
              title={m.login}
              className="w-6 h-6 rounded-full border-2 border-white"
            />
          ))}
        </div>
        <span className="text-xs text-zinc-400 ml-1">
          {group.members.length} member{group.members.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}
