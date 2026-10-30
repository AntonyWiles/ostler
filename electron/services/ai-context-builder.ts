import type {
  WatchedProject,
  GitProjectState,
  HarnessProjectState,
  EventStats
} from '@shared/ostler-api'
import { buildOstlerAiContextSystemPrompt } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'

export interface AICommitContext {
  hash: string
  subject: string
  body: string
  author: string
  date: string
}

export interface AIProjectContext {
  name: string
  /** The linked folder, or null for a project with none. */
  path: string | null
  currentBranch: string | null
  recentCommitCount: number
  recentFileChanges: number
  activeAgentSessions: number
  pendingTasks: number
  healthStatus: 'healthy' | 'warning' | 'error' | 'unknown'
  lastActivity: string | null
}

export interface AIContext {
  projects: AIProjectContext[]
  recentCommits: { projectName: string; commits: AICommitContext[] }[]
  recentEventsSummary: string
  timestamp: string
}

export class AIContextBuilder {
  buildContext(
    projects: WatchedProject[],
    gitStates: Map<string, GitProjectState>,
    harnessStates: Map<string, HarnessProjectState>,
    _eventStats: Map<string, EventStats>,
    commitHistory: Map<string, AICommitContext[]> = new Map()
  ): AIContext {
    const projectContexts: AIProjectContext[] = projects.map((p) => {
      const git = gitStates.get(p.id)
      const harness = harnessStates.get(p.id)

      let healthStatus: AIProjectContext['healthStatus'] = 'unknown'
      if (git) {
        if (git.workingTreeStatus.conflicted > 0) {
          healthStatus = 'error'
        } else if (git.isGitRepo) {
          healthStatus = 'healthy'
        }
      }

      if (harness?.automation?.lastReportHealth === 'error') {
        healthStatus = 'error'
      } else if (harness?.automation?.lastReportHealth === 'warning' && healthStatus !== 'error') {
        healthStatus = 'warning'
      }

      const activeAgentSessions = harness?.activeSessions ? harness.activeSessions.length : 0
      const pendingTasks = harness?.taskQueue
        ? harness.taskQueue.filter((t) => t.status === 'pending').length
        : 0

      const uncommittedChanges = git
        ? git.workingTreeStatus.modified +
          git.workingTreeStatus.untracked +
          git.workingTreeStatus.staged
        : 0

      return {
        name: p.name,
        path: projectFolder(p),
        currentBranch: git?.currentBranch || null,
        recentCommitCount: git?.recentCommits.length || 0,
        recentFileChanges: uncommittedChanges,
        activeAgentSessions,
        pendingTasks,
        healthStatus,
        lastActivity: p.lastActivity ? new Date(p.lastActivity).toISOString() : null
      }
    })

    return {
      projects: projectContexts,
      recentCommits: projects.map((project) => ({
        projectName: project.name,
        commits: commitHistory.get(project.id) || []
      })),
      recentEventsSummary: `Monitoring ${projects.length} project(s).`,
      timestamp: new Date().toISOString()
    }
  }

  buildSystemPrompt(context: AIContext, userSystemPrompt: string): string {
    const projectsTable = context.projects
      .map(
        (p) =>
          `- ${p.name} (branch: ${p.currentBranch || 'none'}): ${p.activeAgentSessions} active session(s), ${p.recentFileChanges} uncommitted change(s). Health: ${p.healthStatus}`
      )
      .join('\n')

    const commitHistory = context.recentCommits
      .filter((project) => project.commits.length > 0)
      .map((project) => {
        const commits = project.commits
          .map((commit) => {
            const body = commit.body.trim() ? `\n  Details: ${commit.body.trim()}` : ''
            return `- [${commit.hash}] ${commit.subject} — ${commit.author} (${commit.date})${body}`
          })
          .join('\n')
        return `### ${project.projectName}\n${commits}`
      })
      .join('\n\n')

    return buildOstlerAiContextSystemPrompt({
      basePrompt: userSystemPrompt,
      projectsTable,
      commitHistory,
      recentEventsSummary: context.recentEventsSummary,
      timestamp: context.timestamp
    })
  }
}
