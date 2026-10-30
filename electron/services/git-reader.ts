import simpleGit, { SimpleGit, DiffResult } from 'simple-git'
import * as fs from 'fs'
import type {
  GitProjectState,
  GitCommit,
  GitBranchGraph,
  GitGraphCommit,
  GitGraphRef,
  WatchedProject
} from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import { isOstlerTaskBranch } from './harness/task-copies'

interface ProjectState {
  git: SimpleGit
  lastKnownHash: string | null
  interval: NodeJS.Timeout | null
}

// Requests per-commit diff stats so filesChanged/insertions/deletions are populated.
const STAT_LOG_OPTION = { '--stat': null } as unknown as Record<string, string | number>

// ASCII unit separator - won't collide with anything in a commit subject/author/date field.
const FIELD_SEP = ''
const GRAPH_LOG_FORMAT = ['%H', '%P', '%D', '%an', '%ad', '%s'].join(FIELD_SEP)

/**
 * Parses ref-decoration text from `git log --format=%D` (e.g.
 * `"HEAD -> main, origin/main, nexus/session/abc, tag: v1.0"`) into structured refs.
 * Exported standalone so the shaping logic is unit-testable without a real repo.
 */
export function parseGitGraphRefs(refField: string): GitGraphRef[] {
  if (!refField.trim()) return []
  return refField
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      let name = token
      let isHead = false
      if (token.startsWith('HEAD -> ')) {
        name = token.slice('HEAD -> '.length)
        isHead = true
      } else if (token === 'HEAD') {
        isHead = true
      }
      return { name, isHead, isSessionBranch: isOstlerTaskBranch(name) }
    })
}

/**
 * Shapes the raw ``-delimited output of `git log --format=<GRAPH_LOG_FORMAT>`
 * into graph-ready commit nodes (hash, parent hashes, ref labels). Exported standalone
 * so the shaping logic is unit-testable without a real repo.
 */
export function parseGitGraphLog(raw: string): GitGraphCommit[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash = '', parentsField = '', refsField = '', author = '', date = '', message = ''] =
        line.split(FIELD_SEP)
      return {
        hash,
        abbreviatedHash: hash ? hash.substring(0, 7) : '',
        parents: parentsField.split(' ').filter(Boolean),
        refs: parseGitGraphRefs(refsField),
        author,
        date,
        message
      }
    })
}

/**
 * Helper to map simple-git commit object to GitCommit
 */
function mapToGitCommit(c: {
  hash: string
  message: string
  body: string
  author_name: string
  date: string
  diff?: DiffResult | null
}): GitCommit {
  return {
    hash: c.hash,
    abbreviatedHash: c.hash ? c.hash.substring(0, 7) : '',
    message: c.message,
    body: (c.body || '').trim(),
    author: c.author_name,
    date: c.date,
    filesChanged: c.diff?.changed ?? c.diff?.files.length ?? 0,
    insertions: c.diff?.insertions ?? 0,
    deletions: c.diff?.deletions ?? 0,
    changedFiles: c.diff?.files.map((f) => f.file) ?? []
  }
}

/**
 * Service for reading Git repository state (strictly read-only).
 */
export class GitReaderService {
  private projects: Map<string, ProjectState> = new Map()

  constructor() {}

  /** A Git client for the folder, or null for a project with no folder or a missing one. */
  private createGit(projectPath: string | null): SimpleGit | null {
    if (projectPath === null) return null
    try {
      if (!fs.statSync(projectPath).isDirectory()) {
        return null
      }

      return simpleGit(projectPath)
    } catch {
      return null
    }
  }

  /** Read-only: whether a folder is a Git repository. False for no folder. */
  public async isRepository(projectPath: string | null): Promise<boolean> {
    const git = this.createGit(projectPath)
    if (!git) return false
    try {
      return await git.checkIsRepo()
    } catch {
      return false
    }
  }

  /**
   * Starts monitoring a Git repository for new commits.
   */
  public async startMonitoring(
    project: WatchedProject,
    pollIntervalMs: number,
    onNewCommits: (projectId: string, commits: GitCommit[]) => void
  ): Promise<void> {
    this.stopMonitoring(project.id)

    const git = this.createGit(projectFolder(project))
    if (!git) {
      return
    }

    let isRepo = false
    try {
      isRepo = await git.checkIsRepo()
    } catch {
      isRepo = false
    }

    if (!isRepo) {
      this.projects.set(project.id, { git, lastKnownHash: null, interval: null })
      return
    }

    let lastKnownHash: string | null = null
    try {
      const log = await git.log({ maxCount: 1 })
      lastKnownHash = log.latest ? log.latest.hash : null
    } catch {
      // Repository might not have any commits yet
    }

    const interval = setInterval(async () => {
      try {
        const currentIsRepo = await git.checkIsRepo()
        if (!currentIsRepo) return

        const state = this.projects.get(project.id)
        if (state && !state.lastKnownHash) {
          // No baseline yet: either the repository had no commits when
          // monitoring started, or that first read failed. Adopt the current
          // tip silently. Reporting the existing history as "new commits"
          // here fired large-changeset notifications for work that predates
          // the watch entirely.
          const initial = await git.log({ maxCount: 1 })
          state.lastKnownHash = initial.latest ? initial.latest.hash : null
          if (state.lastKnownHash) return
        }
        if (!state?.lastKnownHash) return

        const log = await git.log({
          from: state.lastKnownHash,
          to: 'HEAD',
          ...STAT_LOG_OPTION
        })

        if (log.all.length > 0) {
          const newCommitsRaw = log.all.filter((c) => c.hash !== state?.lastKnownHash)

          if (newCommitsRaw.length > 0) {
            const newCommits: GitCommit[] = newCommitsRaw.map(mapToGitCommit)
            const latestHash = newCommits[0].hash
            if (state) {
              state.lastKnownHash = latestHash
            }

            onNewCommits(project.id, newCommits)
          }
        }
      } catch {
        // Handle git errors gracefully
      }
    }, pollIntervalMs)

    this.projects.set(project.id, { git, lastKnownHash, interval })
  }

  /**
   * Stops monitoring a specific project.
   */
  public stopMonitoring(projectId: string): void {
    const state = this.projects.get(projectId)
    if (state && state.interval) {
      clearInterval(state.interval)
      state.interval = null
    }
  }

  /**
   * Stops monitoring all projects.
   */
  public stopAll(): void {
    for (const projectId of this.projects.keys()) {
      this.stopMonitoring(projectId)
    }
  }

  /**
   * Gets the full Git state of a project.
   */
  public async getState(
    projectId: string,
    projectPath: string | null,
    maxCommits: number
  ): Promise<GitProjectState> {
    let state = this.projects.get(projectId)
    if (!state) {
      const git = this.createGit(projectPath)
      if (!git) {
        return {
          projectId,
          isGitRepo: false,
          currentBranch: null,
          lastCommit: null,
          workingTreeStatus: { modified: 0, untracked: 0, staged: 0, conflicted: 0 },
          recentCommits: [],
          remoteUrl: null
        }
      }

      state = { git, lastKnownHash: null, interval: null }
      this.projects.set(projectId, state)
    }

    const defaultState: GitProjectState = {
      projectId,
      isGitRepo: false,
      currentBranch: null,
      lastCommit: null,
      workingTreeStatus: { modified: 0, untracked: 0, staged: 0, conflicted: 0 },
      recentCommits: [],
      remoteUrl: null
    }

    const git = state.git
    let isGitRepo = false
    try {
      isGitRepo = await git.checkIsRepo()
    } catch {
      isGitRepo = false
    }

    if (!isGitRepo) {
      return defaultState
    }

    let currentBranch: string | null = null
    try {
      const branchSummary = await git.branch()
      currentBranch = branchSummary.current || null
    } catch {
      // Ignore
    }

    let workingTreeStatus = { modified: 0, untracked: 0, staged: 0, conflicted: 0 }
    try {
      const statusSummary = await git.status()
      workingTreeStatus = {
        modified: statusSummary.modified.length,
        untracked: statusSummary.not_added.length,
        staged: statusSummary.staged.length,
        conflicted: statusSummary.conflicted.length
      }
    } catch {
      // Ignore
    }

    let recentCommits: GitCommit[] = []
    let lastCommit: GitCommit | null = null
    try {
      const log = await git.log({ maxCount: maxCommits, ...STAT_LOG_OPTION })
      recentCommits = log.all.map(mapToGitCommit)
      if (recentCommits.length > 0) {
        lastCommit = recentCommits[0]
      }
    } catch {
      // Ignore
    }

    let remoteUrl: string | null = null
    try {
      const remotes = await git.getRemotes(true)
      if (remotes.length > 0) {
        remoteUrl = remotes[0].refs.fetch || remotes[0].refs.push || null
      }
    } catch {
      // Ignore
    }

    return {
      projectId,
      isGitRepo,
      currentBranch,
      lastCommit,
      workingTreeStatus,
      recentCommits,
      remoteUrl
    }
  }

  /**
   * Gets the recent commits for a project.
   */
  public async getLog(projectId: string, limit: number): Promise<GitCommit[]> {
    const state = this.projects.get(projectId)
    if (!state) return []

    try {
      const isRepo = await state.git.checkIsRepo()
      if (!isRepo) return []

      const log = await state.git.log({ maxCount: limit, ...STAT_LOG_OPTION })
      return log.all.map(mapToGitCommit)
    } catch {
      return []
    }
  }

  /**
   * Gets the unified diff text for a single file at a single commit (read-only `git show`).
   * Returns null if the project/commit/file combination can't be read.
   */
  public async getFileDiff(
    projectId: string,
    projectPath: string | null,
    commitHash: string,
    filePath: string
  ): Promise<string | null> {
    let state = this.projects.get(projectId)
    if (!state) {
      const git = this.createGit(projectPath)
      if (!git) return null
      state = { git, lastKnownHash: null, interval: null }
      this.projects.set(projectId, state)
    }

    try {
      const isRepo = await state.git.checkIsRepo()
      if (!isRepo) return null

      const diff = await state.git.show([commitHash, '--', filePath])
      return diff
    } catch {
      return null
    }
  }

  /**
   * Gets a shaped commit graph (nodes + parent references + ref labels) for a project,
   * using only local, read-only refs (`git log --all`, no `fetch`).
   */
  public async getBranchGraph(
    projectId: string,
    projectPath: string | null,
    maxCount: number
  ): Promise<GitBranchGraph> {
    let state = this.projects.get(projectId)
    if (!state) {
      const git = this.createGit(projectPath)
      if (!git) return { projectId, commits: [] }
      state = { git, lastKnownHash: null, interval: null }
      this.projects.set(projectId, state)
    }

    try {
      const isRepo = await state.git.checkIsRepo()
      if (!isRepo) return { projectId, commits: [] }

      const raw = await state.git.raw([
        'log',
        '--all',
        '--date-order',
        `--format=${GRAPH_LOG_FORMAT}`,
        '--date=iso-strict',
        '-n',
        String(maxCount)
      ])
      return { projectId, commits: parseGitGraphLog(raw) }
    } catch {
      return { projectId, commits: [] }
    }
  }

  /**
   * Read-only (`git remote`): the `origin` remote's fetch URL, or null when
   * there is no folder, no repository or no origin. Project settings suggests
   * a GitHub repository from it (R4.4).
   */
  public async getOriginUrl(projectPath: string | null): Promise<string | null> {
    const git = this.createGit(projectPath)
    if (!git) return null
    try {
      if (!(await git.checkIsRepo())) return null
      const origin = (await git.getRemotes(true)).find((remote) => remote.name === 'origin')
      return origin?.refs.fetch || origin?.refs.push || null
    } catch {
      return null
    }
  }
}
