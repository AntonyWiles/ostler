import type { PlanningActor, PlanningWorkItem } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import {
  FIND_REPLACE_LIMITS,
  applyMatches,
  findMatches,
  sameFields,
  type FindReplaceChange,
  type FindReplaceChoice,
  type FindReplaceFields,
  type FindReplacePreview,
  type FindReplaceResult
} from '@shared/planning/find-replace'
import type { PlanningService } from './planning-service'

/** The most matches one preview returns, and one apply may change. */
export const MAX_FIND_REPLACE_MATCHES = 5000

/** What to find, in one project. */
export interface FindReplaceQuery {
  projectId: string
  find: string
  replace: string
  matchCase: boolean
  wholeWords: boolean
  includeArchived: boolean
}

type Planning = Pick<
  PlanningService,
  'listWorkItems' | 'getWorkItem' | 'updateWorkItem' | 'runInTransaction'
>

/**
 * Find and replace (N2.5): finds in the main process, so a project of 5,000
 * tasks previews off the renderer's thread, and applies through the planning
 * service's normal update path in one transaction, so activity, search,
 * reminders and rules see every change. The app's IPC and the automation API
 * both come here.
 */
export class FindReplaceService {
  constructor(private readonly planning: Planning) {}

  private tasks(query: FindReplaceQuery): PlanningWorkItem[] {
    const live = this.planning.listWorkItems(query.projectId)
    return query.includeArchived
      ? [...live, ...this.planning.listWorkItems(query.projectId, 'archived')]
      : live
  }

  preview(query: FindReplaceQuery): FindReplacePreview {
    const all = findMatches(this.tasks(query), query.find, query.replace, query)
    const matches = all.slice(0, MAX_FIND_REPLACE_MATCHES)
    return {
      matches,
      taskCount: new Set(matches.map((match) => match.taskId)).size,
      truncated: all.length > matches.length
    }
  }

  /** Previews again and applies the matches `matchIds` names (the automation API). */
  applyIds(query: FindReplaceQuery, matchIds: readonly string[], actor: PlanningActor) {
    const wanted = new Set(matchIds)
    const found = this.preview(query).matches
    const unknown = matchIds.filter((id) => !found.some((match) => match.id === id))
    return this.apply(
      query.projectId,
      query.replace,
      found.filter((match) => wanted.has(match.id)),
      actor,
      unknown
    )
  }

  /**
   * Applies chosen matches, task by task, in one transaction. A task whose
   * text no longer holds a match where the preview saw it is skipped and
   * reported, never overwritten; so is one whose new text breaks a rule.
   */
  apply(
    projectId: string,
    replace: string,
    choices: readonly FindReplaceChoice[],
    actor: PlanningActor,
    unknownIds: readonly string[] = []
  ): FindReplaceResult {
    const result: FindReplaceResult = {
      changed: [],
      skipped: unknownIds.map((id) => ({ id, title: '', reason: 'changed' as const }))
    }
    const byTask = new Map<string, FindReplaceChoice[]>()
    for (const choice of choices)
      byTask.set(choice.taskId, [...(byTask.get(choice.taskId) ?? []), choice])
    this.planning.runInTransaction(() => {
      for (const [taskId, chosen] of byTask) {
        const current = this.current(taskId, projectId)
        if (!current) {
          result.skipped.push({ id: taskId, title: '', reason: 'missing' })
          continue
        }
        const change = applyMatches(current, chosen, replace)
        if (typeof change === 'string') {
          result.skipped.push({ id: taskId, title: current.title, reason: change })
          continue
        }
        this.write(change, actor)
        result.changed.push(change)
      }
    })
    return result
  }

  /**
   * Applies whole-text changes, as undo sends them (`undoTextChanges`). A
   * task whose text is no longer what the change starts from (the person
   * edited it again) is skipped and reported, so a newer edit is never lost.
   */
  applyChanges(
    projectId: string,
    changes: readonly FindReplaceChange[],
    actor: PlanningActor
  ): FindReplaceResult {
    const result: FindReplaceResult = { changed: [], skipped: [] }
    this.planning.runInTransaction(() => {
      for (const change of changes) {
        const current = this.current(change.id, projectId)
        if (!current) {
          result.skipped.push({ id: change.id, title: '', reason: 'missing' })
          continue
        }
        if (!sameFields(current, change.from)) {
          result.skipped.push({ id: change.id, title: current.title, reason: 'changed' })
          continue
        }
        this.write(change, actor)
        result.changed.push(change)
      }
    })
    return result
  }

  private current(taskId: string, projectId: string): PlanningWorkItem | null {
    try {
      const item = this.planning.getWorkItem(taskId)
      return item.projectId === projectId && !item.deletedAt ? item : null
    } catch {
      return null
    }
  }

  private write(change: FindReplaceChange, actor: PlanningActor): void {
    const { from, to } = change
    this.planning.updateWorkItem(
      change.id,
      {
        ...(to.title !== from.title ? { title: to.title } : {}),
        ...(to.description !== from.description ? { description: to.description } : {}),
        ...(sameList(to.acceptanceCriteria, from.acceptanceCriteria)
          ? {}
          : { acceptanceCriteria: to.acceptanceCriteria })
      },
      actor,
      { renamedCriteria: new Map(change.renamed) }
    )
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

const flag = (value: unknown, name: string): boolean => {
  if (value === undefined || value === null) return false
  if (typeof value !== 'boolean') throw new Refusal(`${name} must be true or false`)
  return value
}

/** Checks what to find: the find text, the replacement and the options. */
export function findReplaceQuery(projectId: string, raw: unknown): FindReplaceQuery {
  if (!raw || typeof raw !== 'object') throw new Refusal('Send what to find')
  const input = raw as Record<string, unknown>
  if (typeof input.find !== 'string' || !input.find)
    throw new Refusal('find must be the text to find')
  if (input.find.length > FIND_REPLACE_LIMITS.find) throw new Refusal('find is too long')
  if (typeof input.replace !== 'string') throw new Refusal('replace must be text')
  if (input.replace.length > FIND_REPLACE_LIMITS.description)
    throw new Refusal('replace is too long')
  return {
    projectId,
    find: input.find,
    replace: input.replace,
    matchCase: flag(input.matchCase, 'matchCase'),
    wholeWords: flag(input.wholeWords, 'wholeWords'),
    includeArchived: flag(input.includeArchived, 'includeArchived')
  }
}

const FIELDS = ['title', 'description', 'checklist'] as const

/** Checks the chosen matches the app sends. */
export function findReplaceChoices(raw: unknown): FindReplaceChoice[] {
  if (!Array.isArray(raw) || raw.length > MAX_FIND_REPLACE_MATCHES)
    throw new Refusal(`Send at most ${MAX_FIND_REPLACE_MATCHES} matches`)
  return raw.map((entry) => {
    const choice = entry as Partial<FindReplaceChoice> | null
    if (
      !choice ||
      typeof choice.taskId !== 'string' ||
      !choice.taskId ||
      choice.taskId.length > 100 ||
      !FIELDS.includes(choice.field as (typeof FIELDS)[number]) ||
      !Number.isInteger(choice.start) ||
      (choice.start as number) < 0 ||
      typeof choice.text !== 'string' ||
      !choice.text ||
      (choice.field === 'checklist'
        ? !Number.isInteger(choice.itemIndex) || (choice.itemIndex as number) < 0
        : choice.itemIndex !== null)
    )
      throw new Refusal('Each match needs taskId, field, itemIndex, start and text')
    return {
      taskId: choice.taskId,
      field: choice.field as FindReplaceChoice['field'],
      itemIndex: choice.itemIndex as number | null,
      start: choice.start as number,
      text: choice.text
    }
  })
}

function fields(raw: unknown): FindReplaceFields {
  const value = raw as Partial<FindReplaceFields> | null
  if (
    !value ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    !Array.isArray(value.acceptanceCriteria) ||
    !value.acceptanceCriteria.every((item) => typeof item === 'string')
  )
    throw new Refusal('Each change needs title, description and acceptanceCriteria')
  return {
    title: value.title,
    description: value.description,
    acceptanceCriteria: [...value.acceptanceCriteria]
  }
}

/** Checks the changes an undo sends. */
export function findReplaceChanges(raw: unknown): FindReplaceChange[] {
  if (!Array.isArray(raw) || raw.length > MAX_FIND_REPLACE_MATCHES)
    throw new Refusal(`Send at most ${MAX_FIND_REPLACE_MATCHES} changes`)
  return raw.map((entry) => {
    const change = entry as Partial<FindReplaceChange> | null
    if (!change || typeof change.id !== 'string' || !change.id || change.id.length > 100)
      throw new Refusal('Each change needs id, from, to and renamed')
    const renamed = change.renamed
    if (
      !Array.isArray(renamed) ||
      !renamed.every(
        (pair) =>
          Array.isArray(pair) &&
          pair.length === 2 &&
          typeof pair[0] === 'string' &&
          typeof pair[1] === 'string'
      )
    )
      throw new Refusal('renamed must be a list of [from, to] texts')
    return {
      id: change.id,
      from: fields(change.from),
      to: fields(change.to),
      renamed: renamed.map(([a, b]): [string, string] => [a, b])
    }
  })
}
