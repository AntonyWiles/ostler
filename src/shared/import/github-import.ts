import type {
  GithubImportPreview,
  ImportPreviewRow,
  ImportRowIssue,
  PlanningWorkItemStatus
} from '../ostler-api'
import {
  LIMITS,
  PREVIEW_ROWS,
  cleanImportedText,
  clip,
  nearestPaletteColor,
  previewTotals,
  type ImportKnownRecords,
  type ImportPlan,
  type ImportTaskDraft
} from './import-plan'
import { t } from '../i18n'

/**
 * Import from GitHub issues (R4.4, D40): a repository's issues, as GitHub
 * returned them, become task drafts for the one import writer. Each task
 * links its issue, so an issue a task in the project already links is
 * skipped and importing again adds only new ones. Titles and bodies are
 * untrusted text: control characters go, bodies stay Markdown (the drawer
 * renders descriptions through the app's sanitiser), and none of it is read
 * as instructions.
 */

export interface GithubImportIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  body: string
  labels: { name: string; color: string }[]
  /** GitHub logins: matched to people by name, any case, or added. */
  assignees: string[]
  milestone: string | null
}

export interface GithubImportSource {
  owner: string
  repo: string
  issues: GithubImportIssue[]
  /** GitHub had more issues than one import reads. */
  truncated: boolean
}

export interface GithubImportAnalysis {
  plan: ImportPlan
  preview: GithubImportPreview
}

/**
 * The drafts and the preview. `linked` holds the issue numbers of this
 * repository that a task in the project already links.
 */
export function analyzeGithubIssues(
  source: GithubImportSource,
  known: ImportKnownRecords,
  linked: ReadonlySet<number>
): GithubImportAnalysis {
  const rows: ImportPreviewRow[] = []
  const tasks: ImportTaskDraft[] = []
  const labelColors = new Map<string, string>()
  let alreadyLinked = 0

  for (const issue of source.issues) {
    if (linked.has(issue.number)) {
      alreadyLinked += 1
      continue
    }
    const line = issue.number
    const errors: ImportRowIssue[] = []
    const warnings: ImportRowIssue[] = []
    let cut: boolean

    let title = cleanImportedText(issue.title).replace(/\s+/g, ' ').trim()
    if (!title) title = t('data:githubImport.untitledIssue', { number: issue.number })
    ;[title, cut] = clip(title, LIMITS.title)
    if (cut)
      warnings.push({
        field: 'title',
        message: t('data:githubImport.titleCut', { count: LIMITS.title })
      })

    let description = cleanImportedText(issue.body).trim()
    ;[description, cut] = clip(description, LIMITS.description)
    if (cut)
      warnings.push({
        field: 'description',
        message: t('data:githubImport.bodyCut', { count: LIMITS.description })
      })

    let labels: string[] = []
    for (const label of issue.labels) {
      const [name] = clip(cleanImportedText(label.name).trim(), LIMITS.label)
      if (!name || labels.includes(name)) continue
      labels.push(name)
      if (/^[0-9a-f]{6}$/i.test(label.color) && !labelColors.has(name))
        labelColors.set(name, nearestPaletteColor(`#${label.color}`))
    }
    if (labels.length > LIMITS.labels) {
      warnings.push({
        field: 'labels',
        message: t('data:githubImport.labelsCut', { count: LIMITS.labels })
      })
      labels = labels.slice(0, LIMITS.labels)
    }

    const assignees = issue.assignees.map((login) => clip(login, LIMITS.name)[0]).filter(Boolean)
    if (assignees.length > 1)
      warnings.push({
        field: 'assignee',
        message: t('data:githubImport.oneAssignee', { person: assignees[0] })
      })

    const milestone = issue.milestone
      ? clip(cleanImportedText(issue.milestone).trim(), LIMITS.milestone)[0] || null
      : null
    const status: PlanningWorkItemStatus = issue.state === 'closed' ? 'done' : 'backlog'

    rows.push({
      line,
      title,
      cells: {
        key: `#${issue.number}`,
        status:
          issue.state === 'closed' ? t('data:githubImport.closed') : t('data:githubImport.open'),
        labels: labels.join(', '),
        assignee: assignees[0] ?? '',
        milestone: milestone ?? ''
      },
      errors,
      warnings
    })
    tasks.push({
      line,
      title,
      description,
      status,
      priority: 'medium',
      labels,
      checklist: [],
      assigneeName: assignees[0] ?? null,
      startDate: null,
      dueDate: null,
      estimate: null,
      milestoneName: milestone,
      githubIssue: {
        owner: source.owner,
        repo: source.repo,
        number: issue.number,
        title: clip(issue.title, 1000)[0],
        state: issue.state
      }
    })
  }

  const plan: ImportPlan = {
    tasks,
    labelColors: [...labelColors.entries()].map(([name, color]) => ({ name, color })),
    people: [],
    skipped: 0
  }
  return {
    plan,
    preview: {
      ...previewTotals(rows, plan, known),
      repository: `${source.owner}/${source.repo}`,
      issueCount: source.issues.length,
      alreadyLinkedCount: alreadyLinked,
      truncated: source.truncated,
      rows: rows.slice(0, PREVIEW_ROWS)
    }
  }
}
