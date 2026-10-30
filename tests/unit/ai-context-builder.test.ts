import { describe, it, expect } from 'vitest'
import { AIContextBuilder } from '../../electron/services/ai-context-builder'
import type {
  WatchedProject,
  GitProjectState,
  HarnessProjectState,
  EventStats
} from '../../src/shared/ostler-api'
import { makeWatchedProject } from '../helpers/projects'

describe('ai-context-builder.ts', () => {
  it('builds structured context from project states and formats system prompt', () => {
    const builder = new AIContextBuilder()

    const projects: WatchedProject[] = [
      makeWatchedProject({
        id: 'proj-1',
        name: 'Ostler Core',
        path: '/repos/ostler',
        notes: 'Main repo',
        tags: ['electron', 'react'],
        addedAt: Date.now(),
        lastActivity: Date.now()
      })
    ]

    const gitStates = new Map<string, GitProjectState>([
      [
        'proj-1',
        {
          projectId: 'proj-1',
          isGitRepo: true,
          currentBranch: 'main',
          lastCommit: null,
          workingTreeStatus: {
            modified: 2,
            untracked: 1,
            staged: 0,
            conflicted: 0
          },
          recentCommits: [
            {
              hash: '123456',
              abbreviatedHash: '123456',
              message: 'Initial commit',
              body: '',
              author: 'Dev',
              date: new Date().toISOString(),
              filesChanged: 1,
              insertions: 10,
              deletions: 0
            }
          ],
          remoteUrl: null
        }
      ]
    ])

    const harnessStates = new Map<string, HarnessProjectState>([
      [
        'proj-1',
        {
          projectId: 'proj-1',
          hasHarness: true,
          activeSessions: [
            {
              id: 'sess-1',
              title: 'Agent Worker',
              startedAt: '',
              lastUpdate: '',
              statusNote: 'Active',
              status: 'active',
              blocked: false,
              workspace: null,
              token: 'session-token',
              lastSeenAt: null,
              provenance: 'external'
            }
          ],
          taskQueue: [
            {
              id: 'task-1',
              title: 'Refactor DB',
              status: 'pending',
              claimedBy: null,
              priority: 'medium',
              planningWorkItemId: null,
              details: '',
              autoContinue: false
            }
          ],
          reviewSessions: [],
          questions: [],
          watcherRunning: true
        }
      ]
    ])

    const eventStats = new Map<string, EventStats>()

    const context = builder.buildContext(
      projects,
      gitStates,
      harnessStates,
      eventStats,
      new Map([
        [
          'proj-1',
          [
            {
              hash: '123456',
              subject: 'Initial commit',
              body: 'Establishes the monitoring baseline.',
              author: 'Dev',
              date: '2026-08-24'
            }
          ]
        ]
      ])
    )
    expect(context.projects.length).toBe(1)
    expect(context.projects[0].name).toBe('Ostler Core')
    expect(context.projects[0].healthStatus).toBe('healthy')
    expect(context.projects[0].activeAgentSessions).toBe(1)
    expect(context.projects[0].pendingTasks).toBe(1)
    expect(context.projects[0].recentFileChanges).toBe(3) // 2 modified + 1 untracked

    const prompt = builder.buildSystemPrompt(context, 'You are an assistant.')
    expect(prompt).toContain('You are an assistant.')
    expect(prompt).toContain('Ostler Core')
    expect(prompt).toContain('branch: main')
    expect(prompt).toContain('1 active session(s)')
    expect(prompt).toContain('[123456] Initial commit')
    expect(prompt).toContain('Establishes the monitoring baseline.')
  })
})
