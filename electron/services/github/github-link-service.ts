import type {
  GithubLink,
  GithubLinkAdded,
  GithubLinksRefresh,
  WatchedProject
} from '@shared/ostler-api'
import { parseGithubReference } from '@shared/github/github-reference'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { PlanningService } from '../planning-service'
import { GithubError, type GithubClient } from './github-client'

export interface GithubLinkServiceDependencies {
  planning: PlanningService
  client: GithubClient
  getProject(projectId: string): WatchedProject
  /** A link's cached title or state changed, or a link came or went: screens read again. */
  changed?(project: WatchedProject): void
  now?: () => number
}

/**
 * GitHub links on tasks (R4.4, D40), for every surface: the drawer, the
 * automation API and the MCP tools made from it. Each fetch here answers a
 * person's action: adding a link, opening the task, or Refresh. Nothing calls
 * this on a timer or at start-up.
 */
export class GithubLinkService {
  constructor(private readonly deps: GithubLinkServiceDependencies) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private get store() {
    return this.deps.planning.githubLinks
  }

  /** A task's links as cached, without asking GitHub. */
  list(projectId: string, workItemId: string): GithubLink[] {
    this.requireTask(projectId, workItemId)
    return this.store.listForWorkItem(workItemId)
  }

  /**
   * Links a task to what the person typed (a github.com URL, `owner/repo#12`
   * or `#12` with the project's repository), then fetches its title and state.
   * The link stays when the fetch fails; `problem` says why.
   */
  async add(projectId: string, workItemId: string, reference: unknown): Promise<GithubLinkAdded> {
    const project = this.deps.getProject(projectId)
    const parsed = parseGithubReference(
      typeof reference === 'string' ? reference : '',
      project.githubRepository
    )
    const link = this.store.add(project.id, workItemId, parsed, this.now())
    let problem: string | null = null
    try {
      await this.fetchOne(link)
    } catch (error) {
      problem = problemText(error)
    }
    this.deps.changed?.(project)
    return { link: this.store.get(project.id, link.id), problem }
  }

  /**
   * Fetches every link on a task again (the drawer opened, or Refresh). A
   * rate limit stops the rest, which keep their cache and get the same message.
   */
  async refresh(projectId: string, workItemId: string): Promise<GithubLinksRefresh> {
    const project = this.deps.getProject(projectId)
    this.requireTask(project.id, workItemId)
    const problems: Record<string, string> = {}
    let changed = false
    let stopped: string | null = null
    for (const link of this.store.listForWorkItem(workItemId)) {
      if (stopped) {
        problems[link.id] = stopped
        continue
      }
      try {
        changed = (await this.fetchOne(link)) || changed
      } catch (error) {
        problems[link.id] = problemText(error)
        if (error instanceof GithubError && error.rateLimited) stopped = problems[link.id]
      }
    }
    if (changed) this.deps.changed?.(project)
    return { links: this.store.listForWorkItem(workItemId), problems }
  }

  /** Removes a link; the link is returned for Undo. */
  remove(projectId: string, linkId: unknown): GithubLink {
    const project = this.deps.getProject(projectId)
    const link = this.store.remove(project.id, linkId)
    this.deps.changed?.(project)
    return link
  }

  /** Undo for `remove`. */
  restore(projectId: string, link: GithubLink): GithubLink {
    const project = this.deps.getProject(projectId)
    const restored = this.store.restore(project.id, link)
    this.deps.changed?.(project)
    return restored
  }

  /** Fetches one link and keeps the result; whether anything shown changed. */
  private async fetchOne(link: GithubLink): Promise<boolean> {
    const issue = await this.deps.client.getIssue(link.owner, link.repo, link.number)
    return this.store.saveFetched(link.id, {
      kind: issue.kind,
      title: issue.title,
      state: issue.state,
      fetchedAt: this.now()
    })
  }

  private requireTask(projectId: string, workItemId: unknown): void {
    if (typeof workItemId !== 'string') throw new Refusal(t('errors:github.taskNotFound'))
    const item = this.deps.planning.getWorkItem(workItemId)
    if (item.projectId !== projectId) throw new Refusal(t('errors:github.taskNotFound'))
  }
}

function problemText(error: unknown): string {
  if (error instanceof GithubError) return error.message
  console.error('GitHub link fetch failed:', error)
  return t('errors:github.couldNotReach')
}
