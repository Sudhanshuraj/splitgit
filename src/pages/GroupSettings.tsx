/**
 * Group Settings — manage tags for a group.
 * Only the repo owner can access this page.
 */
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { getGroupConfig, saveGroupConfig } from '../lib/github'
import { invalidateCachedConfig } from '../lib/cache'
import { Spinner } from '../components/Spinner'
import type { TagConfig } from '../types'

const PRESET_COLORS = [
  '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'
]

export function GroupSettings() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>()
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[0]!)
  const [newTagMandatory, setNewTagMandatory] = useState(false)

  const { data: configData, isLoading } = useQuery({
    queryKey: ['config', owner, repo],
    queryFn: () => getGroupConfig(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo
  })

  const saveMutation = useMutation({
    mutationFn: (tags: TagConfig[]) =>
      saveGroupConfig(
        octokit!, owner!, repo!,
        { version: 1, tags },
        configData?.sha ?? null
      ),
    onSuccess: async () => {
      await invalidateCachedConfig(owner!, repo!)
      qc.invalidateQueries({ queryKey: ['config', owner, repo] })
    }
  })

  const tags = configData?.config.tags ?? []
  const isOwner = owner === user?.login

  function addTag() {
    if (!newTagName.trim()) return
    const updated = [...tags, {
      name: newTagName.trim(),
      color: newTagColor,
      mandatory: newTagMandatory
    }]
    saveMutation.mutate(updated)
    setNewTagName('')
    setNewTagMandatory(false)
  }

  function removeTag(name: string) {
    saveMutation.mutate(tags.filter(t => t.name !== name))
  }

  function toggleMandatory(name: string) {
    saveMutation.mutate(tags.map(t =>
      t.name === name ? { ...t, mandatory: !t.mandatory } : t
    ))
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
                  <div key={tag.name}
                    className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl px-4 py-3">
                    <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    <span className="flex-1 font-medium text-zinc-800 text-sm">{tag.name}</span>

                    {/* Mandatory toggle */}
                    <button
                      onClick={() => toggleMandatory(tag.name)}
                      disabled={saveMutation.isPending}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors
                        ${tag.mandatory
                          ? 'bg-red-100 text-red-600 hover:bg-red-200'
                          : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                        }`}>
                      {tag.mandatory ? 'Required' : 'Optional'}
                    </button>

                    {/* Remove */}
                    <button
                      onClick={() => removeTag(tag.name)}
                      disabled={saveMutation.isPending}
                      className="text-zinc-400 hover:text-red-500 transition-colors p-1">
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add new tag */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-700">Add Tag</h2>

            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1.5">Tag name</label>
              <input
                type="text"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTag()}
                placeholder="e.g. Food, Transport, Accommodation"
                className="w-full border border-zinc-300 rounded-xl px-4 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-2">Color</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setNewTagColor(color)}
                    className={`w-7 h-7 rounded-full transition-transform ${newTagColor === color ? 'scale-125 ring-2 ring-offset-2 ring-zinc-400' : 'hover:scale-110'}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setNewTagMandatory(!newTagMandatory)}
                className={`w-10 h-6 rounded-full transition-colors relative ${newTagMandatory ? 'bg-emerald-500' : 'bg-zinc-300'}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${newTagMandatory ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
              <span className="text-sm text-zinc-700">
                Mandatory <span className="text-zinc-400 text-xs">(required on every expense)</span>
              </span>
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
