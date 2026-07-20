/**
 * CSV import — migrate expenses + settlements (e.g. from SplitKaro) into a group.
 *
 * Flow: choose expenses CSV (+ optional settlements CSV) → preview table with
 * totals, resolved splits, and warnings → Commit (one GitHub commit).
 */
import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { getGroupConfig } from '../lib/github'
import { importEvents } from '../lib/eventLog'
import {
  parseImportCsv, parseSettlementsCsv, netForPerson,
  type ImportExpenseRow, type ImportSettlementRow
} from '../lib/importCsv'
import { formatAmount } from '../lib/balances'
import { Spinner } from '../components/Spinner'

export function ImportCsv() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>()
  const { octokit, user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [expRows, setExpRows] = useState<ImportExpenseRow[]>([])
  const [expErrors, setExpErrors] = useState<string[]>([])
  const [setRows, setSetRows] = useState<ImportSettlementRow[]>([])
  const [setErrors, setSetErrors] = useState<string[]>([])
  const [expName, setExpName] = useState('')
  const [setName, setSetName] = useState('')

  const isOwner = owner === user?.login

  const { data: configData } = useQuery({
    queryKey: ['config', owner, repo],
    queryFn: () => getGroupConfig(octokit!, owner!, repo!),
    enabled: !!octokit && !!owner && !!repo
  })
  const existingTagNames = new Set((configData?.config.tags ?? []).map(t => t.name.toLowerCase()))

  async function onExpenseFile(f: File) {
    const text = await f.text()
    const { rows, errors } = parseImportCsv(text)
    setExpRows(rows); setExpErrors(errors); setExpName(f.name)
  }
  async function onSettlementFile(f: File) {
    const text = await f.text()
    const { rows, errors } = parseSettlementsCsv(text)
    setSetRows(rows); setSetErrors(errors); setSetName(f.name)
  }

  const stats = useMemo(() => {
    const total = expRows.reduce((s, r) => s + r.amount, 0)
    const people = new Set<string>()
    expRows.forEach(r => { people.add(r.paidBy); r.splits.forEach(s => people.add(s.username)) })
    setRows.forEach(r => { people.add(r.from); people.add(r.to) })
    const newTags = new Set(
      expRows.map(r => r.tag).filter(t => t && !existingTagNames.has(t.toLowerCase()))
    )
    const nets = [...people].map(p => ({ person: p, net: netForPerson(p, expRows) }))
    const warnCount = expRows.filter(r => r.warnings.length).length
    return { total, people: [...people], newTags: [...newTags], nets, warnCount }
  }, [expRows, setRows, existingTagNames])

  const mutation = useMutation({
    mutationFn: () => importEvents(octokit!, owner!, repo!, { expenses: expRows, settlements: setRows }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events', owner, repo] })
      qc.invalidateQueries({ queryKey: ['config', owner, repo] })
      navigate(`/groups/${owner}/${repo}`)
    }
  })

  if (!isOwner) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <p className="text-4xl mb-3">🔒</p>
        <p className="font-medium text-zinc-700">Owner only</p>
        <p className="text-sm mt-1">Only the group owner can import.</p>
      </div>
    )
  }

  const canCommit = expRows.length > 0 && expErrors.length === 0 && setErrors.length === 0

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(`/groups/${owner}/${repo}`)} className="text-zinc-500 hover:text-zinc-900">
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Import CSV</h1>
          <p className="text-xs text-zinc-400">{repo}</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* File pickers */}
        <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">Expenses CSV <span className="text-red-400 text-xs">required</span></label>
            <input type="file" accept=".csv,text/csv"
              onChange={e => e.target.files?.[0] && onExpenseFile(e.target.files[0])}
              className="block w-full text-sm text-zinc-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-emerald-600 file:text-white file:font-semibold file:text-sm hover:file:bg-emerald-700" />
            {expName && <p className="text-xs text-zinc-500 mt-1">{expName} — {expRows.length} rows</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">Settlements CSV <span className="text-zinc-400 text-xs">optional</span></label>
            <input type="file" accept=".csv,text/csv"
              onChange={e => e.target.files?.[0] && onSettlementFile(e.target.files[0])}
              className="block w-full text-sm text-zinc-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-zinc-200 file:text-zinc-700 file:font-semibold file:text-sm hover:file:bg-zinc-300" />
            {setName && <p className="text-xs text-zinc-500 mt-1">{setName} — {setRows.length} settlements</p>}
          </div>
        </div>

        {/* Errors */}
        {(expErrors.length > 0 || setErrors.length > 0) && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
            <p className="font-semibold mb-1">Fix these lines before importing:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {[...expErrors, ...setErrors].slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        {/* Summary */}
        {expRows.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
              <p className="text-xs text-zinc-500 font-medium">Expenses</p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">{expRows.length}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{formatAmount(stats.total, 'INR')} total</p>
            </div>
            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
              <p className="text-xs text-zinc-500 font-medium">Settlements</p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">{setRows.length}</p>
              {stats.warnCount > 0 && <p className="text-xs text-amber-600 mt-0.5">{stats.warnCount} row(s) with warnings</p>}
            </div>
          </div>
        )}

        {/* Net balance preview */}
        {expRows.length > 0 && (
          <div className="bg-white border border-zinc-200 rounded-2xl p-4">
            <p className="text-sm font-semibold text-zinc-700 mb-2">Net after import (expenses only)</p>
            <div className="space-y-1">
              {stats.nets.map(n => (
                <div key={n.person} className="flex justify-between text-sm">
                  <span className="text-zinc-600">@{n.person}</span>
                  <span className={n.net >= 0 ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium'}>
                    {n.net >= 0 ? 'is owed ' : 'owes '}{formatAmount(Math.abs(n.net), 'INR')}
                  </span>
                </div>
              ))}
            </div>
            {setRows.length > 0 && <p className="text-xs text-zinc-400 mt-2">Settlements will adjust these further.</p>}
          </div>
        )}

        {/* New tags */}
        {stats.newTags.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700">
            <span className="font-semibold">{stats.newTags.length} new tag(s)</span> will be created: {stats.newTags.join(', ')}
          </div>
        )}

        {/* Preview table */}
        {expRows.length > 0 && (
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100"><h3 className="text-sm font-semibold text-zinc-700">Preview</h3></div>
            <div className="max-h-80 overflow-y-auto divide-y divide-zinc-100">
              {expRows.map((r, i) => (
                <div key={i} className="px-4 py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-800 truncate">{r.description}</span>
                    <span className="text-zinc-900 font-semibold shrink-0">{formatAmount(r.amount, 'INR')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-0.5 flex-wrap">
                    <span>{r.date}</span><span>·</span>
                    <span>paid by @{r.paidBy}</span><span>·</span>
                    <span>{r.splitType}</span>
                    {r.tag && <span className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">{r.tag}</span>}
                  </div>
                  {r.warnings.length > 0 && (
                    <p className="text-xs text-amber-600 mt-0.5">⚠ {r.warnings.join('; ')}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {mutation.error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
            {mutation.error instanceof Error ? mutation.error.message : 'Import failed'}
          </div>
        )}

        <button
          onClick={() => mutation.mutate()}
          disabled={!canCommit || mutation.isPending}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl text-base transition-colors flex items-center justify-center gap-2">
          {mutation.isPending
            ? <><Spinner /> Importing {expRows.length + setRows.length} events…</>
            : `Import ${expRows.length} expense${expRows.length === 1 ? '' : 's'}${setRows.length ? ` + ${setRows.length} settlement${setRows.length === 1 ? '' : 's'}` : ''}`}
        </button>
        <p className="text-xs text-zinc-400 text-center">Everything is written in a single commit. Nothing changes until you press import.</p>
      </div>
    </div>
  )
}
