import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import {
  GitReaderService,
  parseGitGraphLog,
  parseGitGraphRefs
} from '../../electron/services/git-reader'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

describe('git-reader.ts', () => {
  const tempDir = useTempDir('ostler-git-reader-')
  let project: WatchedProject
  let service: GitReaderService

  beforeEach(() => {
    project = makeWatchedProject({
      id: 'project-1',
      name: 'Test project',
      path: path.join(tempDir(), 'missing-project'),
      color: '#fff',
      addedAt: Date.now()
    })
    service = new GitReaderService()
  })

  afterEach(() => {
    service.stopAll()
  })

  it('returns a safe empty state for missing or non-Git projects', async () => {
    const state = await service.getState(project.id, project.path, 10)

    expect(state).toEqual({
      projectId: project.id,
      isGitRepo: false,
      currentBranch: null,
      lastCommit: null,
      workingTreeStatus: { modified: 0, untracked: 0, staged: 0, conflicted: 0 },
      recentCommits: [],
      remoteUrl: null
    })
  })

  it('does not create a polling loop for a non-Git project', async () => {
    const commits: unknown[] = []

    await service.startMonitoring(project, 10, (projectId, newCommits) => {
      commits.push({ projectId, newCommits })
    })

    expect(await service.getLog(project.id, 10)).toEqual([])
    expect(commits).toEqual([])
  })

  it('keeps read failures isolated from the caller', async () => {
    const state = await service.getState('unknown-project', path.join(tempDir(), 'nowhere'), 10)

    expect(state.isGitRepo).toBe(false)
    expect(await service.getLog('unknown-project', 10)).toEqual([])
  })

  it('reads both the commit subject and body without writing to the repository', async () => {
    const repoPath = path.join(tempDir(), 'repository')
    fs.mkdirSync(repoPath)
    const git = simpleGit(repoPath)
    await git.init()
    await git.addConfig('user.name', 'Ostler Test')
    await git.addConfig('user.email', 'ostler@example.test')
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test\n')
    await git.add('README.md')
    await git.commit(
      'feat: preserve commit context\n\nThis explains the project-management intent.'
    )

    project.path = repoPath
    await service.startMonitoring(project, 60_000, () => undefined)

    const [commit] = await service.getLog(project.id, 1)
    expect(commit.message).toBe('feat: preserve commit context')
    expect(commit.body).toBe('This explains the project-management intent.')
  })

  it('returns the unified diff for a single file at a single commit, read-only', async () => {
    const repoPath = path.join(tempDir(), 'diff-repository')
    fs.mkdirSync(repoPath)
    const git = simpleGit(repoPath)
    await git.init()
    await git.addConfig('user.name', 'Ostler Test')
    await git.addConfig('user.email', 'ostler@example.test')
    fs.writeFileSync(path.join(repoPath, 'file.txt'), 'line one\n')
    await git.add('file.txt')
    await git.commit('chore: add file')
    fs.writeFileSync(path.join(repoPath, 'file.txt'), 'line one\nline two\n')
    await git.add('file.txt')
    await git.commit('chore: extend file')

    project.path = repoPath
    await service.startMonitoring(project, 60_000, () => undefined)
    const [latest] = await service.getLog(project.id, 1)
    const statusBefore = await git.status()

    const diff = await service.getFileDiff(project.id, project.path, latest.hash, 'file.txt')

    expect(diff).toContain('+line two')
    expect(diff).toContain('file.txt')

    const statusAfter = await git.status()
    expect(statusAfter.not_added).toEqual(statusBefore.not_added)
    expect(statusAfter.modified).toEqual(statusBefore.modified)
    expect(statusAfter.staged).toEqual(statusBefore.staged)
    expect(statusAfter.conflicted).toEqual(statusBefore.conflicted)
  })

  it('returns null when the project/commit cannot be read', async () => {
    const diff = await service.getFileDiff(
      'unknown-project',
      path.join(tempDir(), 'nowhere'),
      'deadbeef',
      'file.txt'
    )
    expect(diff).toBeNull()
  })

  describe('parseGitGraphRefs', () => {
    it('parses HEAD, plain branches, and marks Ostler session branches', () => {
      const refs = parseGitGraphRefs('HEAD -> main, origin/main, nexus/session/abc123, tag: v1.0')
      expect(refs).toEqual([
        { name: 'main', isHead: true, isSessionBranch: false },
        { name: 'origin/main', isHead: false, isSessionBranch: false },
        { name: 'nexus/session/abc123', isHead: false, isSessionBranch: true },
        { name: 'tag: v1.0', isHead: false, isSessionBranch: false }
      ])
    })

    it('returns an empty array for an undecorated commit', () => {
      expect(parseGitGraphRefs('')).toEqual([])
      expect(parseGitGraphRefs('   ')).toEqual([])
    })
  })

  describe('parseGitGraphLog', () => {
    const SEP = ''

    function fixtureLine(
      hash: string,
      parents: string,
      refs: string,
      author: string,
      date: string,
      message: string
    ): string {
      return [hash, parents, refs, author, date, message].join(SEP)
    }

    it('shapes multi-branch, diverged raw log output into graph-ready commits', () => {
      const raw = [
        fixtureLine('c3', 'c1', 'HEAD -> main', 'Dev', '2026-08-25T10:00:00+00:00', 'main tip'),
        fixtureLine(
          'c2',
          'c1',
          'nexus/session/task-9',
          'Agent',
          '2026-08-25T09:00:00+00:00',
          'session work'
        ),
        fixtureLine('c1', '', '', 'Dev', '2026-08-25T08:00:00+00:00', 'root commit')
      ].join('\n')

      const commits = parseGitGraphLog(raw)

      expect(commits).toHaveLength(3)
      expect(commits[0]).toEqual({
        hash: 'c3',
        abbreviatedHash: 'c3',
        parents: ['c1'],
        refs: [{ name: 'main', isHead: true, isSessionBranch: false }],
        author: 'Dev',
        date: '2026-08-25T10:00:00+00:00',
        message: 'main tip'
      })
      expect(commits[1].refs).toEqual([
        { name: 'nexus/session/task-9', isHead: false, isSessionBranch: true }
      ])
      expect(commits[2].parents).toEqual([])

      // Both c2 and c3 diverge from the same parent c1.
      expect(commits[0].parents).toEqual(commits[1].parents)
    })

    it('ignores blank lines and handles multiple parents (merge commits)', () => {
      const raw = `\n${fixtureLine('m1', 'c2 c3', '', 'Dev', '2026-08-25T11:00:00+00:00', 'merge')}\n\n`
      const commits = parseGitGraphLog(raw)
      expect(commits).toHaveLength(1)
      expect(commits[0].parents).toEqual(['c2', 'c3'])
    })
  })

  it('shapes a real diverged repository into a branch graph, read-only', async () => {
    const repoPath = path.join(tempDir(), 'graph-repository')
    fs.mkdirSync(repoPath)
    const git = simpleGit(repoPath)
    await git.init()
    await git.addConfig('user.name', 'Ostler Test')
    await git.addConfig('user.email', 'ostler@example.test')
    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'a\n')
    await git.add('a.txt')
    await git.commit('root commit')

    await git.checkoutLocalBranch('nexus/session/graph-test')
    fs.writeFileSync(path.join(repoPath, 'b.txt'), 'b\n')
    await git.add('b.txt')
    await git.commit('session work')

    await git.checkout('master')
    fs.writeFileSync(path.join(repoPath, 'c.txt'), 'c\n')
    await git.add('c.txt')
    await git.commit('main work')

    project.path = repoPath
    const statusBefore = await git.status()

    const graph = await service.getBranchGraph(project.id, project.path, 50)

    expect(graph.commits.length).toBeGreaterThanOrEqual(3)
    const sessionCommit = graph.commits.find((c) =>
      c.refs.some((r) => r.name === 'nexus/session/graph-test')
    )
    expect(sessionCommit).toBeDefined()
    expect(sessionCommit?.refs.some((r) => r.isSessionBranch)).toBe(true)

    const rootCommit = graph.commits.find((c) => c.parents.length === 0)
    expect(rootCommit).toBeDefined()

    const statusAfter = await git.status()
    expect(statusAfter.current).toBe(statusBefore.current)
    expect(statusAfter.modified).toEqual(statusBefore.modified)
  })
})
