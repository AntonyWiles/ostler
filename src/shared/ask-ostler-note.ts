import type { AskSource } from './ostler-api'
import { BRAND } from './brand'
import { t } from './i18n'

/**
 * Save as a note (N8.3b): an Ask Ostler conversation as the Markdown of a
 * Library note. Pure, so the panel and the tests share one rule.
 */

/** One question of a conversation, its answer and that answer's own numbered sources. */
export interface AskConversationTurn {
  question: string
  answer: string
  sources: AskSource[]
}

/** The longest title a saved conversation gets from its first question. */
export const ASK_NOTE_TITLE_CHARS = 80

/** The note's title: the first question on one line, shortened. */
export function askNoteTitle(turns: readonly AskConversationTurn[]): string {
  const first = oneLine(turns[0]?.question ?? '')
  if (first.length <= ASK_NOTE_TITLE_CHARS) return first
  const cut = first.slice(0, ASK_NOTE_TITLE_CHARS - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > ASK_NOTE_TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * The project a note is saved to by default: the one most sources came from
 * (earliest first on a tie), or null when there are no sources.
 */
export function askNoteDefaultProject(turns: readonly AskConversationTurn[]): string | null {
  const counts = new Map<string, number>()
  for (const turn of turns)
    for (const source of turn.sources)
      counts.set(source.projectId, (counts.get(source.projectId) ?? 0) + 1)
  let best: string | null = null
  for (const [projectId, count] of counts)
    if (best === null || count > (counts.get(best) ?? 0)) best = projectId
  return best
}

/** A task's link: the deep link `<scheme>://task/<projectId>/<taskId>`. */
export function askTaskLink(projectId: string, taskId: string): string {
  return `${BRAND.urlScheme}://task/${projectId}/${taskId}`
}

/**
 * The note's body: a line saying Ostler AI wrote it and when, a line naming
 * the projects its sources came from when any is not the project it is saved
 * in, then each question as a heading, its answer as written, and its
 * sources as a numbered list matching the answer's [n].
 */
export function askNoteMarkdown(input: {
  turns: readonly AskConversationTurn[]
  /** The project the note is saved in. */
  projectId: string
  /** Each project's name, by id. */
  projectName: (projectId: string) => string
  /** The date, as YYYY-MM-DD. */
  today: string
}): string {
  const { turns, projectId, projectName, today } = input
  const lines: string[] = [`_${t('ai:askOstler.noteWrittenBy', { date: today })}_`]

  const sourceProjects = [
    ...new Set(turns.flatMap((turn) => turn.sources.map((source) => source.projectId)))
  ]
  if (sourceProjects.some((id) => id !== projectId)) {
    lines.push(
      '',
      t('ai:askOstler.noteSourcesFrom', {
        projects: sourceProjects.map((id) => projectName(id) || id).join(', ')
      })
    )
  }

  for (const turn of turns) {
    lines.push('', `## ${escapeText(oneLine(turn.question))}`, '', turn.answer.trim())
    if (turn.sources.length === 0) continue
    lines.push('', `**${t('ai:askOstler.sources')}**`, '')
    for (const source of turn.sources)
      lines.push(`${source.number}. ${sourceLine(source, projectName(source.projectId))}`)
  }
  return `${lines.join('\n')}\n`
}

/** One source in the note: a task as a task link, anything else by type, project and title. */
function sourceLine(source: AskSource, project: string): string {
  const where = project ? ` · ${escapeText(project)}` : ''
  if (source.type === 'task')
    return `[${escapeText(source.title)}](${askTaskLink(source.projectId, source.id)})${where}`
  const title =
    source.type === 'file'
      ? t('ai:askOstler.fileLines', {
          path: source.path ?? source.id,
          start: source.startLine ?? 1,
          end: source.endLine ?? source.startLine ?? 1
        })
      : source.type === 'comment'
        ? t('ai:askOstler.commentOn', { title: source.title })
        : source.title
  return `${typeLabel(source.type)}${where} · ${escapeText(title)}`
}

function typeLabel(type: AskSource['type']): string {
  switch (type) {
    case 'file':
      return t('ai:askOstler.file')
    case 'task':
      return t('views:searchResults.task')
    case 'comment':
      return t('views:searchResults.comment')
    case 'goal':
      return t('views:searchResults.goal')
    case 'milestone':
      return t('views:searchResults.milestone')
    case 'decision':
      return t('views:searchResults.decision')
    case 'library':
      return t('views:searchResults.libraryItem')
    case 'contact':
      return t('views:searchResults.contact')
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Text that must not turn into Markdown: brackets, emphasis and the like are escaped. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>#|])/g, '\\$1')
}
