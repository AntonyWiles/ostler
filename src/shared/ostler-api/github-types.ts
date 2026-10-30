import type { ImportPreviewRow, ImportPreviewTotals } from './import-types'

/**
 * GitHub links (R4.4, D40): tasks link to issues and pull requests on
 * github.com. Ostler only reads from GitHub, and only when the person opens
 * the task, presses Refresh or imports; titles and states are cached with
 * the time they were fetched. Nothing is ever written to GitHub.
 */

/** An issue or a pull request. A `#123` link is an issue until GitHub says otherwise. */
export type GithubLinkKind = 'issue' | 'pull'

/** Open, closed, merged (pull requests) or draft (an open draft pull request). */
export type GithubLinkState = 'open' | 'closed' | 'merged' | 'draft'

export const GITHUB_LINK_STATES: readonly GithubLinkState[] = ['open', 'closed', 'merged', 'draft']

/** A task can link at most this many issues and pull requests. */
export const MAX_GITHUB_LINKS_PER_TASK = 20

export interface GithubLink {
  id: string
  projectId: string
  workItemId: string
  owner: string
  repo: string
  number: number
  kind: GithubLinkKind
  /** `https://github.com/<owner>/<repo>/issues/<n>` or `/pull/<n>`. */
  url: string
  /** The title when it was last fetched; '' before the first fetch. */
  title: string
  /** The state when it was last fetched, or null before the first fetch. */
  state: GithubLinkState | null
  /** When the title and state were last fetched (epoch ms), or null. */
  fetchedAt: number | null
  createdAt: number
}

/** A task's links after a fetch, and what went wrong for any of them, by link id. */
export interface GithubLinksRefresh {
  links: GithubLink[]
  problems: Record<string, string>
}

/** A link just added, and why its title could not be fetched, if it could not. */
export interface GithubLinkAdded {
  link: GithubLink
  problem: string | null
}

/** Import tasks › From GitHub issues: which issues to read. */
export interface GithubIssueQuery {
  /** `owner/repo` or a github.com URL. */
  repository: string
  /** Open issues (the default) or every issue. */
  state?: 'open' | 'all'
  /** Only issues with every one of these labels. */
  labels?: string[]
  /** Only issues in this milestone: its title or number. */
  milestone?: string
}

/** The dry run of a GitHub import: the issues, minus those a task already links. */
export interface GithubImportPreview extends ImportPreviewTotals {
  /** `owner/repo`. */
  repository: string
  /** Issues GitHub returned (pull requests are never imported). */
  issueCount: number
  /** Issues already linked to a task in the project, so skipped. */
  alreadyLinkedCount: number
  /** GitHub had more issues than one import reads (1,000): narrow it with labels or a milestone. */
  truncated: boolean
  /** The first 50 issues to import. */
  rows: ImportPreviewRow[]
}
