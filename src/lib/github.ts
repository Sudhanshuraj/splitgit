/**
 * Thin wrapper around the GitHub REST API via Octokit.
 * All functions require an authenticated Octokit instance.
 */

import { Octokit } from 'octokit'
import type { Group, Member, GroupConfig } from '../types'
import { DEFAULT_GROUP_CONFIG } from '../types'

// ─── Config ───────────────────────────────────────────────────────────────────

/** Fill these in after setting up your GitHub OAuth App + Cloudflare Worker */
export const GITHUB_OAUTH_CONFIG = {
  clientId: import.meta.env.VITE_GITHUB_CLIENT_ID ?? 'YOUR_GITHUB_CLIENT_ID',
  /** Your Cloudflare Worker URL that exchanges the code for a token */
  workerUrl: import.meta.env.VITE_OAUTH_WORKER_URL ?? 'https://your-worker.workers.dev/callback',
  /** Scopes needed: repo (to create/read private repos) + read:user */
  scope: 'repo read:user user:email'
}

export const SPLITGIT_REPO_TOPIC = 'splitgit-group'
const EXPENSES_FILE_PATH = 'expenses.json'
const CONFIG_FILE_PATH = 'config.json'

// ─── Auth ─────────────────────────────────────────────────────────────────────

export function buildOAuthUrl(state: string): string {
  // Use the actual current base path so it works both locally and on GitHub Pages
  const base = import.meta.env.BASE_URL.replace(/\/$/, '') // e.g. /splitgit or ''
  const params = new URLSearchParams({
    client_id: GITHUB_OAUTH_CONFIG.clientId,
    redirect_uri: `${window.location.origin}${base}/auth/callback`,
    scope: GITHUB_OAUTH_CONFIG.scope,
    state
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const res = await fetch(GITHUB_OAUTH_CONFIG.workerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  })
  const data = await res.json() as { access_token?: string; error?: string }
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(data.error ?? 'Token exchange failed')
  }
  return data.access_token
}

export function makeOctokit(token: string): Octokit {
  return new Octokit({ auth: token })
}

// ─── User ─────────────────────────────────────────────────────────────────────

export async function getCurrentUser(octokit: Octokit) {
  const { data } = await octokit.rest.users.getAuthenticated()
  return {
    login: data.login,
    name: data.name,
    avatarUrl: data.avatar_url,
    email: data.email
  }
}

export async function getUser(octokit: Octokit, username: string): Promise<Member> {
  const { data } = await octokit.rest.users.getByUsername({ username })
  return { login: data.login, avatarUrl: data.avatar_url, name: data.name }
}

// ─── Groups (repos) ───────────────────────────────────────────────────────────

export async function listGroups(octokit: Octokit): Promise<Group[]> {
  // Fetch all repos the user owns or collaborates on that have the splitgit topic
  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    visibility: 'private',
    affiliation: 'owner,collaborator',
    per_page: 100,
    sort: 'updated'
  })

  const splitRepos = data.filter(r => r.topics?.includes(SPLITGIT_REPO_TOPIC))

  return Promise.all(splitRepos.map(async r => {
    const members = await listMembers(octokit, r.owner.login, r.name)
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? '',
      owner: r.owner.login,
      members,
      createdAt: r.created_at ?? new Date().toISOString(),
      isPrivate: r.private,
      htmlUrl: r.html_url
    } satisfies Group
  }))
}

export async function createGroup(
  octokit: Octokit,
  name: string,
  description: string
): Promise<Group> {
  // Sanitise repo name
  const repoName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')

  const { data: repo } = await octokit.rest.repos.createForAuthenticatedUser({
    name: repoName,
    description,
    private: true,
    auto_init: false
  })

  // Tag with splitgit topic
  await octokit.rest.repos.replaceAllTopics({
    owner: repo.owner.login,
    repo: repo.name,
    names: [SPLITGIT_REPO_TOPIC]
  })

  // Commit the initial empty expenses.json
  const content = btoa(JSON.stringify([], null, 2))
  await octokit.rest.repos.createOrUpdateFileContents({
    owner: repo.owner.login,
    repo: repo.name,
    path: EXPENSES_FILE_PATH,
    message: 'chore: initialise SplitGit expense log',
    content
  })

  const { data: user } = await octokit.rest.users.getAuthenticated()
  const owner: Member = { login: user.login, avatarUrl: user.avatar_url, name: user.name }

  return {
    id: repo.id,
    name: repo.name,
    description: repo.description ?? '',
    owner: repo.owner.login,
    members: [owner],
    createdAt: repo.created_at ?? new Date().toISOString(),
    isPrivate: true,
    htmlUrl: repo.html_url
  }
}

export async function deleteGroup(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<void> {
  await octokit.rest.repos.delete({ owner, repo })
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function listMembers(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<Member[]> {
  // Owner is always a member
  const ownerData = await getUser(octokit, owner)
  try {
    const { data } = await octokit.rest.repos.listCollaborators({ owner, repo, per_page: 100 })
    const collaborators = data
      .filter(c => c.login !== owner)
      .map(c => ({ login: c.login, avatarUrl: c.avatar_url, name: c.name ?? null }))
    return [ownerData, ...collaborators]
  } catch {
    return [ownerData]
  }
}

export async function inviteMember(
  octokit: Octokit,
  owner: string,
  repo: string,
  username: string
): Promise<void> {
  await octokit.rest.repos.addCollaborator({ owner, repo, username, permission: 'push' })
}

export async function removeMember(
  octokit: Octokit,
  owner: string,
  repo: string,
  username: string
): Promise<void> {
  await octokit.rest.repos.removeCollaborator({ owner, repo, username })
}

// ─── File operations (expenses.json) ─────────────────────────────────────────

interface FileResult {
  content: string
  sha: string
}

export async function getExpensesFile(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<FileResult> {
  const { data } = await octokit.rest.repos.getContent({ owner, repo, path: EXPENSES_FILE_PATH })
  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error('expenses.json is not a file')
  }
  return { content: atob(data.content.replace(/\n/g, '')), sha: data.sha }
}

export async function updateExpensesFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  content: string,
  sha: string,
  commitMessage: string
): Promise<void> {
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: EXPENSES_FILE_PATH,
    message: commitMessage,
    content: btoa(content),
    sha
  })
}

// ─── Group config (config.json) ───────────────────────────────────────────────

export interface ConfigFileResult {
  config: GroupConfig
  sha: string | null   // null if file doesn't exist yet
}

export async function getGroupConfig(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<ConfigFileResult> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: CONFIG_FILE_PATH })
    if (Array.isArray(data) || data.type !== 'file') {
      return { config: DEFAULT_GROUP_CONFIG, sha: null }
    }
    const config = JSON.parse(atob(data.content.replace(/\n/g, ''))) as GroupConfig
    return { config, sha: data.sha }
  } catch {
    // File doesn't exist yet — return defaults
    return { config: DEFAULT_GROUP_CONFIG, sha: null }
  }
}

export async function saveGroupConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  config: GroupConfig,
  existingSha: string | null
): Promise<string> {
  const params: Parameters<typeof octokit.rest.repos.createOrUpdateFileContents>[0] = {
    owner,
    repo,
    path: CONFIG_FILE_PATH,
    message: 'config: update group tags',
    content: btoa(JSON.stringify(config, null, 2))
  }
  if (existingSha) {
    (params as Record<string, unknown>).sha = existingSha
  }
  const { data } = await octokit.rest.repos.createOrUpdateFileContents(params)
  return (data.content as { sha: string }).sha
}
