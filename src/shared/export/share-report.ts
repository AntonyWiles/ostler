import type {
  PlanningColumnSettings,
  PlanningDecision,
  PlanningMilestone,
  PlanningWorkItem,
  PlanningWorkItemStatus,
  ReportKeyNumbers,
  ShareReportOptions,
  StatusUpdate
} from '../ostler-api'
import { statusUpdateHealthLabel } from '../status-updates'
import { BRAND } from '../brand'
import { formatIsoDate } from '../dates'
import { formatDate, formatNumber } from '../format'
import { TASK_STATUSES, taskColumnLabel, taskStatusLabel } from '../task-labels'
import { currentLanguage, t } from '../i18n'

/*
 * A project as one self-contained web page (R4.1, D37): "Share as a web
 * page…" and `GET /export?format=html`. The person sends the file wherever
 * they like; Ostler uploads nothing.
 *
 * The page stands alone and stays small: its own CSS, no script, no network
 * request (a Content Security Policy says so too), no Library files or
 * images. Every piece of text is escaped here, and Markdown (descriptions,
 * decisions) arrives already rendered by `renderMarkdown`, which uses the
 * app's own sanitising and drops links and images.
 */

/** The page's Content Security Policy: nothing but its own inline styles and data images. */
export const SHARE_REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"

/** Every option resolved; the status update (N5.5) is there only when it is on. */
export type ResolvedShareReportOptions = Required<Omit<ShareReportOptions, 'statusUpdate'>> & {
  statusUpdate?: true
}

/** The options as asked, made safe: anything unknown falls back to its default. */
export function normalizeShareReportOptions(value: unknown): ResolvedShareReportOptions {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const flag = (key: string, fallback: boolean) =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : fallback
  return {
    descriptions: flag('descriptions', false),
    decisions: flag('decisions', false),
    finished: flag('finished', true),
    people: flag('people', true),
    groupBy: raw['groupBy'] === 'milestone' ? 'milestone' : 'status',
    ...(flag('statusUpdate', false) ? { statusUpdate: true as const } : {})
  }
}

export interface ShareReportInput {
  project: { name: string }
  keyNumbers: ReportKeyNumbers
  tasks: readonly PlanningWorkItem[]
  milestones: readonly PlanningMilestone[]
  decisions: readonly PlanningDecision[]
  /** The latest status update (N5.5), shown when the option asks for it. */
  statusUpdate?: StatusUpdate | null
  personName: (personId: string) => string | null
  /** The project's column names (R2.4): status headings and cells use them. */
  columns?: PlanningColumnSettings | null
  options?: ShareReportOptions
  now: number
  /** Markdown to sanitised HTML with no links or images. */
  renderMarkdown: (markdown: string) => string
}

/** Text for HTML: the five characters that matter, escaped. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const date = (iso: string | null) => (iso ? escapeHtml(formatIsoDate(iso)) : '')

const STYLE = `
:root{color-scheme:light;--ink:#1f2328;--muted:#59636e;--line:#d1d9e0;--soft:#f6f8fa;--accent:#2f6feb;--done:#1a7f37}
*{box-sizing:border-box}
body{margin:0;font:15px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--ink);background:#fff}
main{max-width:960px;margin:0 auto;padding:32px 24px 48px}
h1{font-size:28px;margin:0 0 4px}
h2{font-size:19px;margin:32px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:16px;margin:20px 0 8px}
.meta,.empty,footer{color:var(--muted);font-size:13px}
.numbers{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0;padding:0}
.numbers div{border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--soft)}
.numbers dt{color:var(--muted);font-size:13px}
.numbers dd{margin:0;font-size:24px;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:13px}
td.n{white-space:nowrap}
.bar{display:block;margin-top:4px}
.desc{color:var(--muted);font-size:13px;margin-top:4px}
.desc p,.md p{margin:4px 0}
.decision{border:1px solid var(--line);border-radius:8px;padding:8px 16px;margin:12px 0}
.decision h3{margin-top:8px}
h4{font-size:14px;margin:12px 0 4px}
footer{margin-top:40px}
@media (max-width:600px){main{padding:20px 12px}td.n{white-space:normal}th,td{padding:6px 4px}}
@media print{main{max-width:none;padding:0}h2{break-after:avoid}tr,.decision{break-inside:avoid}.numbers div{background:none}}
`

function progressBar(done: number, total: number): string {
  const width = total === 0 ? 0 : Math.round((done / total) * 120)
  return (
    `<svg class="bar" width="120" height="8" viewBox="0 0 120 8" aria-hidden="true">` +
    `<rect width="120" height="8" rx="4" fill="#d1d9e0"/>` +
    (width > 0 ? `<rect width="${width}" height="8" rx="4" fill="#1a7f37"/>` : '') +
    `</svg>`
  )
}

/** The page's HTML. */
export function buildShareReport(input: ShareReportInput): string {
  const options = normalizeShareReportOptions(input.options)
  const name = escapeHtml(input.project.name)
  const k = input.keyNumbers
  const visible = input.tasks.filter((task) => options.finished || task.status !== 'done')
  const person = (id: string | null) => (id ? (input.personName(id) ?? '') : '')

  const numbers = [
    [t('data:shareReport.numbers.tasks'), input.tasks.length],
    [t('data:shareReport.numbers.open'), k.open],
    [t('data:shareReport.numbers.doneLast30'), k.doneInRange],
    [t('data:shareReport.numbers.overdue'), k.overdueNow],
    [t('data:shareReport.numbers.dueNext7'), k.dueNext7Days]
  ] as const
  const parts: string[] = []
  parts.push(
    `<header><h1>${name}</h1><p class="meta">${escapeHtml(
      t('data:shareReport.exported', { date: formatDate(input.now, { dateStyle: 'long' }) })
    )}</p></header>`
  )
  // The person's own word on how it is going (N5.5), first when asked for.
  if (options.statusUpdate && input.statusUpdate) {
    const update = input.statusUpdate
    const posted = formatDate(update.postedAt, { dateStyle: 'long' })
    parts.push(
      `<section><h2>${escapeHtml(t('data:shareReport.statusUpdate'))}</h2>` +
        `<p><strong class="health">${escapeHtml(statusUpdateHealthLabel(update.health))}</strong> ` +
        `<span class="meta">${escapeHtml(
          options.people
            ? t('data:shareReport.statusUpdateBy', { name: update.authorName, date: posted })
            : posted
        )}</span></p>` +
        (update.note.trim() ? `<div class="md">${input.renderMarkdown(update.note)}</div>` : '') +
        `</section>`
    )
  }
  parts.push(
    `<section><h2>${escapeHtml(t('data:shareReport.keyNumbers'))}</h2><dl class="numbers">` +
      numbers
        .map(
          ([label, value]) =>
            `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatNumber(value))}</dd></div>`
        )
        .join('') +
      `</dl></section>`
  )

  // Milestones, with their progress over every task in them.
  const milestones = [...input.milestones].sort(
    (a, b) =>
      (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') || a.createdAt - b.createdAt
  )
  parts.push(`<section><h2>${escapeHtml(t('data:shareReport.milestones'))}</h2>`)
  if (milestones.length === 0) {
    parts.push(`<p class="empty">${escapeHtml(t('data:shareReport.noMilestones'))}</p>`)
  } else {
    parts.push(
      `<table><thead><tr><th>${escapeHtml(t('data:shareReport.column.milestone'))}</th>` +
        `<th>${escapeHtml(t('data:shareReport.column.status'))}</th>` +
        `<th>${escapeHtml(t('data:shareReport.column.due'))}</th>` +
        `<th>${escapeHtml(t('data:shareReport.column.progress'))}</th></tr></thead><tbody>`
    )
    for (const milestone of milestones) {
      const inIt = input.tasks.filter((task) => task.milestoneId === milestone.id)
      const done = inIt.filter((task) => task.status === 'done').length
      parts.push(
        `<tr><td>${escapeHtml(milestone.name)}</td>` +
          `<td>${escapeHtml(t(`tasks:milestoneCard.${milestone.status}`))}</td>` +
          `<td class="n">${date(milestone.targetDate)}</td>` +
          `<td>${escapeHtml(t('tasks:milestoneCard.tasksDone', { done, count: inIt.length }))}${progressBar(done, inIt.length)}</td></tr>`
      )
    }
    parts.push(`</tbody></table>`)
  }
  parts.push(`</section>`)

  // Tasks, grouped by status (Board order) or milestone (then "No milestone").
  const groups: { title: string; tasks: PlanningWorkItem[] }[] =
    options.groupBy === 'milestone'
      ? [
          ...milestones.map((milestone) => ({
            title: milestone.name,
            tasks: visible.filter((task) => task.milestoneId === milestone.id)
          })),
          {
            title: t('data:shareReport.noMilestone'),
            tasks: visible.filter(
              (task) =>
                !task.milestoneId || !milestones.some((entry) => entry.id === task.milestoneId)
            )
          }
        ]
      : TASK_STATUSES.map((status: PlanningWorkItemStatus) => ({
          title: taskStatusLabel(status, input.columns),
          tasks: visible.filter((task) => task.status === status)
        }))
  parts.push(`<section><h2>${escapeHtml(t('data:shareReport.tasks'))}</h2>`)
  if (visible.length === 0) {
    parts.push(`<p class="empty">${escapeHtml(t('data:shareReport.noTasks'))}</p>`)
  }
  for (const group of groups) {
    if (group.tasks.length === 0) continue
    const sorted = [...group.tasks].sort(
      (a, b) =>
        (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') || a.createdAt - b.createdAt
    )
    parts.push(
      `<h3>${escapeHtml(group.title)} <span class="meta">(${escapeHtml(formatNumber(sorted.length))})</span></h3>` +
        `<table><thead><tr><th>${escapeHtml(t('data:shareReport.column.task'))}</th>` +
        `<th>${escapeHtml(t('data:shareReport.column.status'))}</th>` +
        (options.people ? `<th>${escapeHtml(t('data:shareReport.column.assignee'))}</th>` : '') +
        `<th>${escapeHtml(t('data:shareReport.column.start'))}</th>` +
        `<th>${escapeHtml(t('data:shareReport.column.due'))}</th></tr></thead><tbody>`
    )
    for (const task of sorted) {
      const description =
        options.descriptions && task.description.trim()
          ? `<div class="desc md">${input.renderMarkdown(task.description)}</div>`
          : ''
      parts.push(
        `<tr><td>${escapeHtml(task.title)}${description}</td>` +
          `<td class="n">${escapeHtml(taskColumnLabel(task, input.columns))}</td>` +
          (options.people ? `<td>${escapeHtml(person(task.assigneeId))}</td>` : '') +
          `<td class="n">${date(task.startDate)}</td>` +
          `<td class="n">${date(task.targetDate)}</td></tr>`
      )
    }
    parts.push(`</tbody></table>`)
  }
  parts.push(`</section>`)

  if (options.decisions) {
    parts.push(`<section><h2>${escapeHtml(t('data:shareReport.decisions'))}</h2>`)
    if (input.decisions.length === 0) {
      parts.push(`<p class="empty">${escapeHtml(t('data:shareReport.noDecisions'))}</p>`)
    }
    const decisions = [...input.decisions].sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt
    )
    for (const decision of decisions) {
      const field = (label: string, text: string) =>
        text.trim()
          ? `<h4>${escapeHtml(label)}</h4><div class="md">${input.renderMarkdown(text)}</div>`
          : ''
      parts.push(
        `<article class="decision"><h3>${escapeHtml(decision.title)}</h3>` +
          `<p class="meta">${date(decision.date)}</p>` +
          field(t('data:shareReport.decision.decision'), decision.decision) +
          field(t('data:shareReport.decision.context'), decision.context) +
          field(t('data:shareReport.decision.alternatives'), decision.alternativesConsidered) +
          field(t('data:shareReport.decision.consequences'), decision.consequences) +
          `</article>`
      )
    }
    parts.push(`</section>`)
  }

  parts.push(
    `<footer>${escapeHtml(t('data:shareReport.footer', { appName: BRAND.fullName }))}</footer>`
  )

  return (
    `<!DOCTYPE html>\n<html lang="${escapeHtml(currentLanguage())}"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${SHARE_REPORT_CSP}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="referrer" content="no-referrer">` +
    `<title>${name}</title><style>${STYLE}</style></head>` +
    `<body><main>${parts.join('\n')}</main></body></html>\n`
  )
}
