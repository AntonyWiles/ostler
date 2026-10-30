import { normalizeProjectStage } from '@shared/project-stages'
import {
  isProjectViewId,
  isSettingsSectionId,
  type ProjectViewId,
  type SettingsSectionId
} from './registry'

/**
 * Typed builders for the app's internal paths, and their parser. Every link and `navigate`
 * builds its path here, so a route changes in one place.
 */

type Params = Record<string, string | null | undefined>

function withQuery(path: string, params?: Params): string {
  if (!params) return path
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') query.set(key, value)
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

export function homePath(): string {
  return '/home'
}

export function inboxPath(): string {
  return '/inbox'
}

/**
 * My work (R3.1): every task assigned to a person. `person` opens it on that
 * person (an archived one too, from a link) instead of the remembered one.
 */
export function myWorkPath(params?: { person?: string | null }): string {
  return withQuery('/my-work', params)
}

/** The search page (P5.7), with its words and, optionally, a type and project. */
export function searchPath(query?: string, params?: Params): string {
  return withQuery('/search', { q: query, ...params })
}

/** The Timesheet (R2.3, D35), at the week starting on `week` (`YYYY-MM-DD`), or this week. */
export function timesheetPath(week?: string): string {
  return withQuery('/timesheet', { week })
}

/**
 * Workload (R3.2, D35), from the week starting on `week` (`YYYY-MM-DD`), or this week;
 * `project` opens it filtered to that project, `team` to that team's people.
 */
export function workloadPath(
  week?: string,
  params?: { project?: string | null; team?: string | null }
): string {
  return withQuery('/workload', { week, ...params })
}

/**
 * The Team view (team-leaders plan, D4): everyone's load across projects; `team` and `project`
 * open it filtered.
 */
export function teamPath(params?: { team?: string | null; project?: string | null }): string {
  return withQuery('/team', { ...params })
}

/** The Timeline across projects (N5.4). */
export function timelineOverviewPath(): string {
  return '/timeline'
}

/** Contacts (N6.5), with one contact open when `contact` names it. */
export function contactsPath(contactId?: string | null): string {
  return withQuery('/contacts', { contact: contactId })
}

/** The undo history: every change made, step by step. */
export function undoHistoryPath(): string {
  return '/undo-history'
}

/** Goals of one's own (N5.6b), with one goal shown when `goal` names it. */
export function goalsPath(goalId?: string | null): string {
  return withQuery('/goals', { goal: goalId })
}

/** The weekly review (N1.5). */
export function weeklyReviewPath(): string {
  return '/weekly-review'
}

/**
 * A project's workspace. Without a view it opens the project's last view
 * (or Overview). `params` carry a view's own hand-offs, such as the Library's
 * `item` and `new`, or the Files view's `rootLabel` and `rootPath`.
 */
export function projectPath(projectId: string, view?: ProjectViewId, params?: Params): string {
  const base = `/projects/${encodeURIComponent(projectId)}`
  return withQuery(view ? `${base}/${view}` : base, params)
}

/**
 * Where Home opens a project: its Plan while it is in Planning, else its
 * Overview. The board and the cards both use it.
 */
export function projectOpenPath(projectId: string, stage: unknown): string {
  return projectPath(projectId, normalizeProjectStage(stage) === 'planning' ? 'plan' : 'overview')
}

/** The Plan's hand-off that opens one whiteboard, filling the page (plan `docs/plans/whiteboards/`, D4). */
export const WHITEBOARD_PARAM = 'whiteboard'

/** A whiteboard, open on the project's Plan. */
export function whiteboardPath(projectId: string, whiteboardId: string): string {
  return projectPath(projectId, 'plan', { [WHITEBOARD_PARAM]: whiteboardId })
}

/** The query parameter that scopes a project's views to one sub-project (a workstream). */
export const SUBPROJECT_PARAM = 'sub'

/** A project's view, showing only one sub-project's work. */
export function subprojectPath(
  projectId: string,
  subprojectId: string,
  view?: ProjectViewId
): string {
  return projectPath(projectId, view, { [SUBPROJECT_PARAM]: subprojectId })
}

/** The Plan's hand-off that makes a new whiteboard with its one New whiteboard action, then opens it. */
export const NEW_WHITEBOARD_PARAM = 'newWhiteboard'

/** The Plan, making a new whiteboard (the Library's Add › New whiteboard comes here). */
export function newWhiteboardPath(projectId: string): string {
  return projectPath(projectId, 'plan', { [NEW_WHITEBOARD_PARAM]: '1' })
}

/** The Board's hand-off that opens Customise board. */
export const CUSTOMISE_BOARD_PARAM = 'customise'

/**
 * A project's Board with Customise board open: its views, toolbar, options
 * and columns. Settings and Project settings › Board link here.
 */
export function boardLayoutPath(projectId: string): string {
  return projectPath(projectId, 'board', { [CUSTOMISE_BOARD_PARAM]: '1' })
}

/**
 * Settings › Projects › Board for all projects, by its fold id: Customise
 * board's "Settings for all projects" opens it (`openSettingsGroup`).
 */
export const BOARD_SETTINGS_GROUP = 'board-all-projects'

/** A project's Overview with the status update dialog open (N5.5). */
export function statusUpdatePath(projectId: string): string {
  return projectPath(projectId, 'overview', { postUpdate: '1' })
}

/** The project's last view with this task's drawer open. */
export function taskPath(projectId: string, taskId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`
}

/**
 * Where a linked item opens (N4.4a), in place: a task in its drawer, a
 * milestone in Milestones with its panel open, a decision in Decisions, a
 * Library item in the Library. Search results and links in texts both use it.
 */
export function itemPath(
  kind: 'task' | 'milestone' | 'decision' | 'library',
  projectId: string,
  id: string
): string {
  switch (kind) {
    case 'task':
      return taskPath(projectId, id)
    case 'milestone':
      return projectPath(projectId, 'milestones', { edit: `milestone:${id}` })
    case 'decision':
      return projectPath(projectId, 'decisions', { decision: id })
    case 'library':
      return projectPath(projectId, 'library', { item: id })
  }
}

/** A user guide page (P8.1), or the guide's first page. */
export function helpPath(page?: string): string {
  return page ? `/help/${encodeURIComponent(page)}` : '/help'
}

export function settingsPath(section?: SettingsSectionId): string {
  return section ? `/settings/${section}` : '/settings'
}

/** What a current path points at. */
export type AppLocation =
  | { kind: 'home' }
  | { kind: 'inbox' }
  | { kind: 'my-work' }
  | { kind: 'search' }
  | { kind: 'timesheet' }
  | { kind: 'workload' }
  | { kind: 'team' }
  | { kind: 'weekly-review' }
  | { kind: 'contacts' }
  | { kind: 'goals' }
  | { kind: 'undo-history' }
  | { kind: 'timeline-overview' }
  | { kind: 'project'; projectId: string; view: ProjectViewId | null }
  | { kind: 'task'; projectId: string; taskId: string }
  | { kind: 'settings'; section: SettingsSectionId | null }
  | { kind: 'help'; page: string | null }

/** Reads an app path. Unknown paths give null. */
export function parseAppPath(pathname: string): AppLocation | null {
  const parts = pathname.split('/').filter(Boolean).map(safeDecode)
  if (parts.length === 1 && parts[0] === 'home') return { kind: 'home' }
  if (parts.length === 1 && parts[0] === 'inbox') return { kind: 'inbox' }
  if (parts.length === 1 && parts[0] === 'my-work') return { kind: 'my-work' }
  if (parts.length === 1 && parts[0] === 'search') return { kind: 'search' }
  if (parts.length === 1 && parts[0] === 'timesheet') return { kind: 'timesheet' }
  if (parts.length === 1 && parts[0] === 'workload') return { kind: 'workload' }
  if (parts.length === 1 && parts[0] === 'team') return { kind: 'team' }
  if (parts.length === 1 && parts[0] === 'weekly-review') return { kind: 'weekly-review' }
  if (parts.length === 1 && parts[0] === 'contacts') return { kind: 'contacts' }
  if (parts.length === 1 && parts[0] === 'goals') return { kind: 'goals' }
  if (parts.length === 1 && parts[0] === 'undo-history') return { kind: 'undo-history' }
  if (parts.length === 1 && parts[0] === 'timeline') return { kind: 'timeline-overview' }
  if (parts[0] === 'help' && parts.length <= 2) return { kind: 'help', page: parts[1] ?? null }
  if (parts[0] === 'settings' && parts.length <= 2) {
    const section = parts[1] ?? null
    if (section !== null && !isSettingsSectionId(section)) return null
    return { kind: 'settings', section }
  }
  if (parts[0] === 'projects' && parts[1]) {
    const projectId = parts[1]
    if (parts.length === 2) return { kind: 'project', projectId, view: null }
    if (parts.length === 3 && isProjectViewId(parts[2]))
      return { kind: 'project', projectId, view: parts[2] }
    if (parts.length === 4 && parts[2] === 'tasks' && parts[3])
      return { kind: 'task', projectId, taskId: parts[3] }
  }
  return null
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}
