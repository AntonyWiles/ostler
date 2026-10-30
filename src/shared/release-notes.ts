import type { PlanningIteration, PlanningMilestone, PlanningWorkItem } from './ostler-api'
import type { PlanningTaskType } from './ostler-api/task-type-types'
import { formatDate } from './format'
import { t } from './i18n'

/**
 * Release notes (N9.9, N67): a milestone's or an iteration's finished tasks as
 * a Markdown draft for the person to edit. One builder for the app's dialog
 * and the automation API, so both write the same draft. A release is a
 * milestone; nothing here is stored.
 */

export type ReleaseNotesGroupBy = 'type' | 'label' | 'none'

export const RELEASE_NOTES_GROUP_BY: readonly ReleaseNotesGroupBy[] = ['type', 'label', 'none']

/** The tag every release notes note gets in the Library. */
export const RELEASE_NOTES_TAG = 'release-notes'

/** A description's first sentence is cut here, so one long paragraph cannot take over. */
export const RELEASE_NOTES_SENTENCE_MAX = 240

export interface ReleaseNotesOptions {
  groupBy: ReleaseNotesGroupBy
  /** Add each task's first sentence of its description after its title. */
  descriptions: boolean
  /** List finished subtasks under their parent; left out by default. */
  subtasks: boolean
}

export const DEFAULT_RELEASE_NOTES_OPTIONS: ReleaseNotesOptions = {
  groupBy: 'type',
  descriptions: false,
  subtasks: false
}

/** What the notes are for: a milestone or an iteration, by name. */
export type ReleaseNotesSource =
  | { kind: 'milestone'; milestone: PlanningMilestone }
  | { kind: 'iteration'; iteration: PlanningIteration }

export interface ReleaseNotesInput {
  source: ReleaseNotesSource
  /** The project's tasks, live and archived; binned and unfinished ones are left out here. */
  items: readonly PlanningWorkItem[]
  taskTypes: readonly PlanningTaskType[]
  /** Today, `YYYY-MM-DD`, used when the milestone or iteration is not reached yet. */
  today: string
}

export interface ReleaseNotes {
  title: string
  markdown: string
  /** The titles of every task in the notes, as the person wrote them (for Polish with AI's check). */
  taskTitles: string[]
}

/**
 * Characters that mean something in Markdown, escaped with a backslash so a
 * title such as `Fix *all* [links]` stays one bullet of plain text.
 */
export function escapeMarkdown(text: string): string {
  return (
    text
      .replace(/[\\`*_{}[\]<>()#+!|~&]/g, '\\$&')
      // A leading "1." or "-" would start a list of its own inside the bullet.
      .replace(/^(\d+)([.)])/, '$1\\$2')
      .replace(/^-/, '\\-')
  )
}

/** A description's first sentence, on one line, or '' when it has none. */
export function firstSentence(description: string): string {
  const paragraph =
    description
      .split(/\n\s*\n/)
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .find(Boolean) ?? ''
  const match = /^.*?[.!?](?=\s|$)/.exec(paragraph)
  const sentence = (match ? match[0] : paragraph).trim()
  if (sentence.length <= RELEASE_NOTES_SENTENCE_MAX) return sentence
  return `${sentence.slice(0, RELEASE_NOTES_SENTENCE_MAX - 1).trimEnd()}…`
}

/** Finished for the notes: done, not closed as won't do, not in the recycle bin. */
function finished(item: PlanningWorkItem): boolean {
  return item.status === 'done' && item.resolution !== 'wont-do' && !item.deletedAt
}

function inSource(item: PlanningWorkItem, source: ReleaseNotesSource): boolean {
  return source.kind === 'milestone'
    ? item.milestoneId === source.milestone.id
    : item.iterationId === source.iteration.id
}

function sourceName(source: ReleaseNotesSource): string {
  return source.kind === 'milestone' ? source.milestone.name : source.iteration.name
}

/** The day it was reached: a complete milestone's last change, a finished iteration's end. */
function reachedOn(source: ReleaseNotesSource, today: string): Date {
  if (source.kind === 'milestone' && source.milestone.status === 'complete')
    return new Date(source.milestone.updatedAt)
  if (source.kind === 'iteration' && source.iteration.finishedAt !== null)
    return new Date(source.iteration.finishedAt)
  const [year, month, day] = today.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** The title of a milestone's or an iteration's notes, also the Library note's title. */
export function releaseNotesTitle(source: ReleaseNotesSource): string {
  return t('tasks:releaseNotes.noteTitle', { name: sourceName(source) })
}

interface Section {
  heading: string
  items: PlanningWorkItem[]
}

function sections(
  top: PlanningWorkItem[],
  groupBy: ReleaseNotesGroupBy,
  taskTypes: readonly PlanningTaskType[]
): Section[] {
  if (groupBy === 'none') return [{ heading: '', items: top }]
  const other: PlanningWorkItem[] = []
  const groups = new Map<string, PlanningWorkItem[]>()
  if (groupBy === 'type') {
    const types = [...taskTypes].sort((a, b) => a.position - b.position)
    for (const type of types) groups.set(type.id, [])
    for (const item of top) {
      const group = item.typeId ? groups.get(item.typeId) : undefined
      if (group) group.push(item)
      else other.push(item)
    }
    const result = types
      .map((type) => ({ heading: type.name, items: groups.get(type.id) ?? [] }))
      .filter((section) => section.items.length > 0)
    if (other.length > 0) result.push({ heading: t('tasks:releaseNotes.other'), items: other })
    return result
  }
  // By label: a task with several labels goes under its first; labels in name order.
  for (const item of top) {
    const label = item.labels[0]
    if (!label) {
      other.push(item)
      continue
    }
    const group = groups.get(label)
    if (group) group.push(item)
    else groups.set(label, [item])
  }
  const result = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([heading, items]) => ({ heading, items }))
  if (other.length > 0) result.push({ heading: t('tasks:releaseNotes.other'), items: other })
  return result
}

/**
 * Builds the draft: a title, the day reached (or today), a count, then the
 * finished tasks, grouped by type in the project's order, by first label, or
 * not at all, with "Other" last. Archived done tasks count; binned, won't-do
 * and unfinished ones do not. Subtasks are left out, or listed under their
 * parent when `subtasks` is on (at the top of their group when their parent
 * is not in the notes).
 */
export function buildReleaseNotes(
  input: ReleaseNotesInput,
  options: ReleaseNotesOptions
): ReleaseNotes {
  const done = input.items.filter((item) => finished(item) && inSource(item, input.source))
  const included = options.subtasks ? done : done.filter((item) => !item.parentWorkItemId)
  const ids = new Set(included.map((item) => item.id))
  const children = new Map<string, PlanningWorkItem[]>()
  const top: PlanningWorkItem[] = []
  for (const item of included) {
    const parent = item.parentWorkItemId
    if (parent && ids.has(parent)) {
      const list = children.get(parent)
      if (list) list.push(item)
      else children.set(parent, [item])
    } else top.push(item)
  }

  const title = releaseNotesTitle(input.source)
  const lines: string[] = [
    `# ${escapeMarkdown(title)}`,
    '',
    formatDate(reachedOn(input.source, input.today), { dateStyle: 'long' }),
    '',
    t('tasks:releaseNotes.count', { count: included.length })
  ]
  const taskTitles: string[] = []
  const bullet = (item: PlanningWorkItem, depth: number) => {
    taskTitles.push(item.title)
    const sentence = options.descriptions ? firstSentence(item.description) : ''
    const text = escapeMarkdown(item.title.replace(/\s+/g, ' ').trim())
    lines.push(`${'  '.repeat(depth)}- ${text}${sentence ? `: ${escapeMarkdown(sentence)}` : ''}`)
    // A subtask's own subtasks go under it, up to the three levels tasks allow.
    for (const child of children.get(item.id) ?? []) bullet(child, depth + 1)
  }
  for (const section of sections(top, options.groupBy, input.taskTypes)) {
    lines.push('')
    if (section.heading) lines.push(`## ${escapeMarkdown(section.heading)}`, '')
    for (const item of section.items) bullet(item, 0)
  }
  return { title, markdown: `${lines.join('\n')}\n`, taskTitles }
}

/**
 * The titles a polished draft no longer mentions (Polish with AI must keep
 * every item). Compared without case, Markdown characters or repeated spaces.
 */
export function missingTaskTitles(taskTitles: readonly string[], polished: string): string[] {
  const plain = (text: string) =>
    text
      // Formatting the model may add or drop: escapes, emphasis, code, links.
      .replace(/[\\`*_{}[\]<>()#+!|~&]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase()
  const haystack = plain(polished)
  return taskTitles.filter((title) => !haystack.includes(plain(title)))
}

/** What Polish with AI asks for: the milestone or iteration and the dialog's options. */
export interface PolishReleaseNotesRequest {
  source: { kind: 'milestone' | 'iteration'; id: string }
  options: ReleaseNotesOptions
}

/** Polish with AI's answer: the draft that was sent and the friendlier version. */
export interface PolishedReleaseNotes {
  draft: string
  suggestion: string
  /** Task titles the suggestion no longer mentions; the dialog warns about them. */
  missingTitles: string[]
}

/** The longest draft Polish with AI sends at once. */
export const RELEASE_NOTES_POLISH_MAX_CHARS = 40_000
