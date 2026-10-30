import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { GithubLink, GithubLinkKind, GithubLinkState } from '@shared/ostler-api'
import { GITHUB_LINK_STATES, MAX_GITHUB_LINKS_PER_TASK } from '@shared/ostler-api'
import { githubLinkUrl } from '@shared/github/github-reference'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

interface LinkRow {
  id: string
  project_id: string
  work_item_id: string
  owner: string
  repo: string
  number: number
  kind: GithubLinkKind
  title: string
  state: GithubLinkState | null
  fetched_at: number | null
  created_at: number
}

interface TaskRow {
  id: string
  project_id: string
  deleted_at: number | null
}

/** What a fetch from GitHub says about a link. */
export interface GithubLinkFetched {
  kind: GithubLinkKind
  title: string
  state: GithubLinkState
  fetchedAt: number
}

/** A link to write: where it points, and what a fetch said, when one did (an import). */
export interface GithubLinkInput {
  owner: string
  repo: string
  number: number
  kind: GithubLinkKind | null
  fetched?: GithubLinkFetched
}

const MAX_TITLE_LENGTH = 1000

/**
 * GitHub links on tasks (R4.4, D40), stored. The planning service owns this,
 * so the app, imports, the project file and the automation API share one
 * set of rules: a task links an issue once, at most 20 links per task, and
 * never on a task in the recycle bin. Nothing here reaches the network;
 * `GithubLinkService` fetches and hands the result to `saveFetched`.
 */
export class PlanningGithubLinks {
  constructor(
    private readonly db: Database.Database,
    private readonly requireProject: (projectId: string) => void
  ) {}

  /** A task's links, in the order they were added. */
  listForWorkItem(workItemId: string): GithubLink[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM planning_github_links WHERE work_item_id = ? ORDER BY created_at, rowid'
        )
        .all(workItemId) as LinkRow[]
    ).map(toLink)
  }

  /** Every link in a project, by task: one query for a whole Board. */
  byWorkItem(projectId: string): Map<string, GithubLink[]> {
    const rows = this.db
      .prepare(
        'SELECT * FROM planning_github_links WHERE project_id = ? ORDER BY created_at, rowid'
      )
      .all(projectId) as LinkRow[]
    const links = new Map<string, GithubLink[]>()
    for (const row of rows) {
      const list = links.get(row.work_item_id) ?? []
      list.push(toLink(row))
      links.set(row.work_item_id, list)
    }
    return links
  }

  /** Every link in a project (the project file). */
  listForProject(projectId: string): GithubLink[] {
    this.requireProject(projectId)
    return [...this.byWorkItem(projectId).values()].flat()
  }

  /** The link, refused unless it is one of `projectId`'s. */
  get(projectId: string, linkId: unknown): GithubLink {
    if (typeof linkId !== 'string') throw new Refusal(t('errors:github.linkNotFound'))
    const row = this.db.prepare('SELECT * FROM planning_github_links WHERE id = ?').get(linkId) as
      LinkRow | undefined
    if (!row || row.project_id !== projectId) throw new Refusal(t('errors:github.linkNotFound'))
    return toLink(row)
  }

  /**
   * The issue numbers of `owner/repo` that a task in the project already
   * links, outside the recycle bin: what an import skips.
   */
  linkedNumbers(projectId: string, owner: string, repo: string): Set<number> {
    const rows = this.db
      .prepare(
        `SELECT link.number FROM planning_github_links link
         JOIN planning_work_items item ON item.id = link.work_item_id
         WHERE link.project_id = ? AND link.owner = ? COLLATE NOCASE
           AND link.repo = ? COLLATE NOCASE AND item.deleted_at IS NULL`
      )
      .all(projectId, owner, repo) as { number: number }[]
    return new Set(rows.map((row) => row.number))
  }

  /** Links a task to an issue or pull request. */
  add(
    projectId: string,
    workItemId: unknown,
    input: GithubLinkInput,
    now = Date.now()
  ): GithubLink {
    const task = this.task(projectId, workItemId)
    const existing = this.listForWorkItem(task.id)
    if (sameIssue(existing, input.owner, input.repo, input.number))
      throw new Refusal(t('errors:github.alreadyLinked'))
    refuseTooMany(existing)
    const id = uuidv4()
    this.insert({
      id,
      project_id: projectId,
      work_item_id: task.id,
      owner: input.owner,
      repo: input.repo,
      number: input.number,
      kind: input.fetched?.kind ?? input.kind ?? 'issue',
      title: input.fetched ? input.fetched.title.slice(0, MAX_TITLE_LENGTH) : '',
      state: input.fetched?.state ?? null,
      fetched_at: input.fetched?.fetchedAt ?? null,
      created_at: now
    })
    return this.get(projectId, id)
  }

  /** Removes a link; the link is returned for Undo (`restore`). */
  remove(projectId: string, linkId: unknown): GithubLink {
    const link = this.get(projectId, linkId)
    this.db.prepare('DELETE FROM planning_github_links WHERE id = ?').run(link.id)
    return link
  }

  /** Puts back a link `remove` returned. */
  restore(projectId: string, link: GithubLink): GithubLink {
    if (!link || typeof link !== 'object' || typeof link.id !== 'string')
      throw new Refusal(t('errors:github.linkNotFound'))
    const task = this.task(projectId, link.workItemId)
    const number = Number(link.number)
    if (
      typeof link.owner !== 'string' ||
      typeof link.repo !== 'string' ||
      !Number.isInteger(number) ||
      number <= 0
    )
      throw new Refusal(t('errors:github.linkNotFound'))
    const taken = this.db.prepare('SELECT 1 FROM planning_github_links WHERE id = ?').get(link.id)
    if (taken) return this.get(projectId, link.id)
    // The same checks as `add`: the issue may have been linked again since.
    const existing = this.listForWorkItem(task.id)
    const same = sameIssue(existing, link.owner, link.repo, number)
    if (same) return same
    refuseTooMany(existing)
    this.insert({
      id: link.id,
      project_id: projectId,
      work_item_id: task.id,
      owner: link.owner,
      repo: link.repo,
      number,
      kind: link.kind === 'pull' ? 'pull' : 'issue',
      title: typeof link.title === 'string' ? link.title.slice(0, MAX_TITLE_LENGTH) : '',
      state: GITHUB_LINK_STATES.includes(link.state as GithubLinkState) ? link.state : null,
      fetched_at: typeof link.fetchedAt === 'number' ? link.fetchedAt : null,
      created_at: typeof link.createdAt === 'number' ? link.createdAt : Date.now()
    })
    return this.get(projectId, link.id)
  }

  /**
   * Keeps what a fetch said about a link. Returns whether the title, state
   * or kind changed, so a screen reads again only when it has to.
   */
  saveFetched(linkId: string, fetched: GithubLinkFetched): boolean {
    const row = this.db.prepare('SELECT * FROM planning_github_links WHERE id = ?').get(linkId) as
      LinkRow | undefined
    if (!row) return false
    const title = fetched.title.slice(0, MAX_TITLE_LENGTH)
    const changed = row.title !== title || row.state !== fetched.state || row.kind !== fetched.kind
    this.db
      .prepare(
        'UPDATE planning_github_links SET kind = ?, title = ?, state = ?, fetched_at = ? WHERE id = ?'
      )
      .run(fetched.kind, title, fetched.state, fetched.fetchedAt, linkId)
    return changed
  }

  private insert(row: LinkRow): void {
    this.db
      .prepare(
        `INSERT INTO planning_github_links
           (id, project_id, work_item_id, owner, repo, number, kind, title, state, fetched_at, created_at)
         VALUES (@id, @project_id, @work_item_id, @owner, @repo, @number, @kind, @title, @state,
           @fetched_at, @created_at)`
      )
      .run(row)
  }

  /** A task in `projectId` that is not in the recycle bin. */
  private task(projectId: string, workItemId: unknown): TaskRow {
    this.requireProject(projectId)
    if (typeof workItemId !== 'string') throw new Refusal(t('errors:github.taskNotFound'))
    const row = this.db
      .prepare('SELECT id, project_id, deleted_at FROM planning_work_items WHERE id = ?')
      .get(workItemId) as TaskRow | undefined
    if (!row || row.project_id !== projectId) throw new Refusal(t('errors:github.taskNotFound'))
    if (row.deleted_at !== null) throw new Refusal(t('errors:github.taskInBin'))
    return row
  }
}

function toLink(row: LinkRow): GithubLink {
  return {
    id: row.id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    owner: row.owner,
    repo: row.repo,
    number: row.number,
    kind: row.kind,
    url: githubLinkUrl(row),
    title: row.title,
    state: row.state,
    fetchedAt: row.fetched_at,
    createdAt: row.created_at
  }
}

/** The task's link to this issue or pull request, if it has one. */
function sameIssue(
  existing: GithubLink[],
  owner: string,
  repo: string,
  number: number
): GithubLink | undefined {
  return existing.find(
    (link) =>
      link.number === number &&
      link.owner.toLowerCase() === owner.toLowerCase() &&
      link.repo.toLowerCase() === repo.toLowerCase()
  )
}

function refuseTooMany(existing: GithubLink[]): void {
  if (existing.length >= MAX_GITHUB_LINKS_PER_TASK)
    throw new Refusal(t('errors:github.tooManyLinks', { count: MAX_GITHUB_LINKS_PER_TASK }))
}
