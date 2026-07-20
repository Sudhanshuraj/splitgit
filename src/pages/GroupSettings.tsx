import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { useAuthStore } from '../store/auth'
import { getGroupConfig, saveGroupConfig, archiveGroup, deleteGroup, listMembers } from '../lib/github'
import { invalidateCachedConfig, invalidateCachedEvents } from '../lib/cache'
import { Spinner } from '../components/Spinner'
import type { TagConfig, GroupConfig } from '../types'

const PRESET_EMOJIS = [
  '🍔', '🍕', '☕', '🍺', '🛒',
  '🚗', '✈️', '🚆', '⛽', '🛵',
  '🏨', '🏠', '🎬', '🎮', '🎵',
  '💊', '🛍️', '📦', '💡', '🧾',
]

export function GroupSettings() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>()
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [newTagName, setNewTagName] = useState('')
  const [newTagEmoji, setNewTagEmoji] = useState('')

  // Inline edit state: tagId → draft values
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmoji, setEditEmoji] = useState('')

  // Danger zone state
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  // Nickname edit state: login → draft nickname
  const [nickDrafts, setNickDrafts] = useState<Record<string, string>>({})

  const { data: configData, isLoading } = useQuery({
    queryKey: ['config', owner, repo],
    queryFn: () => getGroupConfig(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo
  })

  const { data: members } = useQuery({
    queryKey: ['members', owner, repo],
    queryFn: () => listMembers(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo,
    staleTime: 60_000
  })

  // Save the whole config, always preserving both tags and nicknames.
  function persistConfig(next: Partial<Pick<GroupConfig, 'tags' | 'nicknames'>>) {
    const current = configData?.config
    const merged: GroupConfig = {
      version: 2,
      tags: next.tags ?? current?.tags ?? [],
      nicknames: next.nicknames ?? current?.nicknames ?? {}
    }
    return saveGroupConfig(octokit!, owner!, repo!, merged, configData?.sha ?? null)
  }

  const saveMutation = useMutation({
    mutationFn: (tags: TagConfig[]) => persistConfig({ tags }),
    onSuccess: async () => {
      await invalidateCachedConfig(owner!, repo!)
      qc.invalidateQueries({ queryKey: ['config', owner, repo] })
    }
  })

  const nickMutation = useMutation({
    mutationFn: (nicknames: Record<string, string>) => persistConfig({ nicknames }),
    onSuccess: async () => {
      await invalidateCachedConfig(owner!, repo!)
      qc.invalidateQueries({ queryKey: ['config', owner, repo] })
    }
  })

  function saveNickname(login: string) {
    const current = configData?.config.nicknames ?? {}
    const draft = (nickDrafts[login] ?? '').trim()
    const next = { ...current }
    if (draft) next[login] = draft
    else delete next[login]   // empty clears the nickname
    nickMutation.mutate(next)
  }

  const archiveMutation = useMutation({
    mutationFn: () => archiveGroup(octokit!, owner!, repo!),
    onSuccess: async () => {
      await invalidateCachedEvents(owner!, repo!)
      qc.invalidateQueries({ queryKey: ['groups'] })
      navigate('/groups')
    }
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteGroup(octokit!, owner!, repo!),
    onSuccess: async () => {
      await invalidateCachedEvents(owner!, repo!)
      await invalidateCachedConfig(owner!, repo!)
      qc.invalidateQueries({ queryKey: ['groups'] })
      navigate('/groups')
    }
  })

  const tags = configData?.config.tags ?? []
  const isOwner = owner === user?.login

  function addTag() {
    if (!newTagName.trim()) return
    const updated: TagConfig[] = [
      ...tags,
      { id: uuidv4(), name: newTagName.trim(), emoji: newTagEmoji || undefined }
    ]
    saveMutation.mutate(updated)
    setNewTagName('')
    setNewTagEmoji('')
  }

  function removeTag(id: string) {
    saveMutation.mutate(tags.filter(t => t.id !== id))
  }

  function startEditing(tag: TagConfig) {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditEmoji(tag.emoji ?? '')
  }

  function saveEdit(id: string) {
    if (!editName.trim()) return
    const updated = tags.map(t =>
      t.id === id ? { ...t, name: editName.trim(), emoji: editEmoji || undefined } : t
    )
    saveMutation.mutate(updated)
    setEditingId(null)
  }

  if (!isOwner) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <p className="text-4xl mb-3">🔒</p>
        <p className="font-medium text-zinc-700">Owner only</p>
        <p className="text-sm mt-1">Only the group owner can change settings.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(`/groups/${owner}/${repo}`)} className="text-zinc-500 hover:text-zinc-900">
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Group Settings</h1>
          <p className="text-xs text-zinc-400">{repo}</p>
        </div>
      </div>

      {isLoading ? <Spinner className="py-12" /> : (
        <div className="space-y-6">

          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700">
            Every expense requires exactly one tag. Renaming a tag updates all historical expenses automatically.
          </div>

          {/* Import CSV */}
          <button
            onClick={() => navigate(`/groups/${owner}/${repo}/import`)}
            className="w-full flex items-center justify-between bg-white border border-zinc-200 rounded-2xl px-4 py-3 hover:border-emerald-300 hover:shadow-sm transition-all">
            <div className="flex items-center gap-3">
              <span className="text-xl">📥</span>
              <div className="text-left">
                <p className="text-sm font-semibold text-zinc-800">Import from CSV</p>
                <p className="text-xs text-zinc-400">Bulk-add expenses &amp; settlements (e.g. from SplitKaro)</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-zinc-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
            </svg>
          </button>

          {/* Existing tags */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-700 mb-3">
              Tags {tags.length > 0 && <span className="text-zinc-400 font-normal">({tags.length})</span>}
            </h2>

            {tags.length === 0 ? (
              <p className="text-sm text-zinc-400 py-4 text-center border border-dashed border-zinc-300 rounded-xl">
                No tags yet. Add one below.
              </p>
            ) : (
              <div className="space-y-2">
                {tags.map(tag => (
                  <div key={tag.id} className="bg-white border border-zinc-200 rounded-xl px-4 py-3">
                    {editingId === tag.id ? (
                      // ── Inline edit mode ──────────────────────────
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <span className="text-xl w-7 text-center self-center">{editEmoji || '🏷️'}</span>
                          <input
                            type="text"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveEdit(tag.id)}
                            autoFocus
                            className="flex-1 border border-zinc-300 rounded-lg px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {PRESET_EMOJIS.map(e => (
                            <button key={e} type="button"
                              onClick={() => setEditEmoji(editEmoji === e ? '' : e)}
                              className={`w-8 h-8 text-base rounded-lg flex items-center justify-center transition-all
                                ${editEmoji === e ? 'bg-emerald-100 ring-2 ring-emerald-400' : 'bg-zinc-50 border border-zinc-200 hover:border-zinc-300'}`}>
                              {e}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          value={editEmoji}
                          onChange={e => setEditEmoji(e.target.value)}
                          placeholder="Or type any emoji…"
                          maxLength={4}
                          className="w-full border border-zinc-300 rounded-lg px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingId(null)}
                            className="flex-1 border border-zinc-200 text-zinc-600 text-sm font-medium py-1.5 rounded-lg hover:bg-zinc-50 transition-colors">
                            Cancel
                          </button>
                          <button
                            onClick={() => saveEdit(tag.id)}
                            disabled={!editName.trim() || saveMutation.isPending}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 text-white text-sm font-semibold py-1.5 rounded-lg transition-colors">
                            {saveMutation.isPending ? <Spinner /> : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      // ── Normal view mode ──────────────────────────
                      <div className="flex items-center gap-3">
                        <span className="text-xl w-7 text-center">{tag.emoji ?? '🏷️'}</span>
                        <span className="flex-1 font-medium text-zinc-800">{tag.name}</span>
                        <button
                          onClick={() => startEditing(tag)}
                          className="text-zinc-400 hover:text-zinc-700 p-1 rounded-lg hover:bg-zinc-100 transition-colors"
                          title="Rename tag">
                          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => removeTag(tag.id)}
                          disabled={saveMutation.isPending}
                          className="text-zinc-400 hover:text-red-500 transition-colors p-1 rounded-lg hover:bg-red-50">
                          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Member nicknames */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-700 mb-1">
              Member Nicknames
            </h2>
            <p className="text-xs text-zinc-400 mb-3">
              Show a friendly name instead of the GitHub username across this group.
            </p>
            <div className="space-y-2">
              {(members ?? []).map(m => {
                const savedNick = configData?.config.nicknames?.[m.login] ?? ''
                const draft = nickDrafts[m.login] ?? savedNick
                const dirty = draft.trim() !== savedNick.trim()
                return (
                  <div key={m.login} className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl px-3 py-2.5">
                    <img src={m.avatarUrl} alt={m.login} className="w-8 h-8 rounded-full shrink-0" />
                    <div className="flex-1 min-w-0">
                      <input
                        type="text"
                        value={draft}
                        onChange={e => setNickDrafts(prev => ({ ...prev, [m.login]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && dirty && saveNickname(m.login)}
                        placeholder={m.login}
                        className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <p className="text-[11px] text-zinc-400 mt-0.5 truncate">@{m.login}</p>
                    </div>
                    {dirty && (
                      <button
                        onClick={() => saveNickname(m.login)}
                        disabled={nickMutation.isPending}
                        className="shrink-0 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                        {nickMutation.isPending ? <Spinner /> : 'Save'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            {nickMutation.error && (
              <p className="text-red-600 text-sm mt-2">
                {nickMutation.error instanceof Error ? nickMutation.error.message : 'Failed to save nickname'}
              </p>
            )}
          </div>

          {/* Danger Zone */}
          <div className="border border-red-200 rounded-2xl overflow-hidden">
            <div className="bg-red-50 px-4 py-3 border-b border-red-200">
              <h2 className="text-sm font-semibold text-red-700">Danger Zone</h2>
            </div>
            <div className="divide-y divide-red-100">
              {/* Archive */}
              <div className="flex items-center justify-between px-4 py-4 gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-800">Archive group</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Makes the repo read-only. Moves it to the Archived tab. You can unarchive later.</p>
                </div>
                <button
                  onClick={() => setShowArchiveConfirm(true)}
                  className="shrink-0 border border-amber-400 text-amber-700 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-amber-50 transition-colors">
                  Archive
                </button>
              </div>
              {/* Delete */}
              <div className="flex items-center justify-between px-4 py-4 gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-800">Delete group</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Permanently deletes the GitHub repo and all expense history.</p>
                </div>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="shrink-0 border border-red-400 text-red-600 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                  Delete
                </button>
              </div>
            </div>
          </div>

          {/* Archive confirmation modal */}
          {showArchiveConfirm && (
            <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-4 pb-safe">
              <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
                <h2 className="text-xl font-bold text-zinc-900 mb-2">Archive "{repo}"?</h2>
                <p className="text-sm text-zinc-500 mb-1">The group will become read-only. No new expenses can be added.</p>
                <p className="text-sm text-zinc-500 mb-5">You can unarchive it at any time from the Archived tab.</p>
                {archiveMutation.error && (
                  <p className="text-red-600 text-sm mb-3">{archiveMutation.error instanceof Error ? archiveMutation.error.message : 'Failed'}</p>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setShowArchiveConfirm(false)}
                    className="flex-1 border border-zinc-300 text-zinc-700 font-medium py-3 rounded-xl hover:bg-zinc-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={() => archiveMutation.mutate()} disabled={archiveMutation.isPending}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:bg-zinc-300 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
                    {archiveMutation.isPending ? <Spinner /> : 'Archive'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Delete confirmation modal */}
          {showDeleteConfirm && (
            <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-4 pb-safe">
              <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
                <h2 className="text-xl font-bold text-zinc-900 mb-2">Delete "{repo}"?</h2>
                <p className="text-sm text-zinc-500 mb-4">This permanently deletes the GitHub repo and all expense history. This cannot be undone.</p>
                <p className="text-sm font-medium text-zinc-700 mb-2">
                  Type <span className="font-mono bg-zinc-100 px-1.5 py-0.5 rounded text-zinc-900">{repo}</span> to confirm:
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  placeholder={repo}
                  className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"
                  autoFocus
                />
                {deleteMutation.error && (
                  <p className="text-red-600 text-sm mb-3">{deleteMutation.error instanceof Error ? deleteMutation.error.message : 'Failed'}</p>
                )}
                <div className="flex gap-3">
                  <button onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText('') }}
                    className="flex-1 border border-zinc-300 text-zinc-700 font-medium py-3 rounded-xl hover:bg-zinc-50 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteConfirmText !== repo || deleteMutation.isPending}
                    className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-zinc-300 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
                    {deleteMutation.isPending ? <Spinner /> : 'Delete Forever'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add new tag */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-700">Add Tag</h2>

            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1.5">Name</label>
              <input
                type="text"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTag()}
                placeholder="e.g. Food, Transport, Hotel"
                className="w-full border border-zinc-300 rounded-xl px-4 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-2">
                Emoji <span className="text-zinc-400 font-normal">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {PRESET_EMOJIS.map(e => (
                  <button key={e} type="button"
                    onClick={() => setNewTagEmoji(newTagEmoji === e ? '' : e)}
                    className={`w-9 h-9 text-lg rounded-xl flex items-center justify-center transition-all
                      ${newTagEmoji === e ? 'bg-emerald-100 ring-2 ring-emerald-400' : 'bg-white border border-zinc-200 hover:border-zinc-300'}`}>
                    {e}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={newTagEmoji}
                onChange={e => setNewTagEmoji(e.target.value)}
                placeholder="Or type any emoji…"
                maxLength={4}
                className="w-full border border-zinc-300 rounded-xl px-3 py-2 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm bg-white"
              />
            </div>

            {saveMutation.error && (
              <p className="text-red-600 text-sm">
                {saveMutation.error instanceof Error ? saveMutation.error.message : 'Failed to save'}
              </p>
            )}

            <button
              onClick={addTag}
              disabled={!newTagName.trim() || saveMutation.isPending}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
              {saveMutation.isPending ? <Spinner /> : '+ Add Tag'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
