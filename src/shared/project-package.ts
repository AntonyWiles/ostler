import { isScore } from './planning/idea-scores'
import { LEGACY_NAMES } from './legacy-names'
import {
  dependencyLinksOf,
  isPlainDependencyLink,
  normalisedDependencyLink,
  type DependencyLinkSource
} from './planning/dependency-links'
import type { Result } from './ostler-api/common-types'
import type { SavedView, SavedViewConfig, SavedViewType } from './ostler-api/search-types'
import {
  DEFAULT_VIEW_NAME,
  parseSavedViewConfig,
  parseSavedViewName,
  parseSavedViewType
} from './saved-views'
import { EMPTY_TASK_FILTER, type TaskFilter } from './task-filter'
import { CONTACT_LIMITS, TASK_CONTACT_ROLES, isEmailAddress, websiteHref } from './contacts'
import { MAX_STATUS_UPDATE_NOTE, STATUS_UPDATE_HEALTHS } from './status-updates'
import { isProjectIcon } from './project-icons'
import {
  COST_STATES,
  isCurrencyCode,
  MAX_COST_CATEGORY,
  MAX_COST_DESCRIPTION,
  MAX_MINOR_UNITS
} from './money'
import { MAX_SHOPPING_NAME, MAX_SHOPPING_QUANTITY, MAX_SHOPPING_UNIT } from './shopping'
import { MAX_BASELINES, MAX_BASELINE_NAME } from './planning/baselines'
import {
  MAX_COLUMN_NAME_LENGTH,
  MAX_CUSTOM_COLUMNS,
  MAX_RESOLUTION_REASON_LENGTH,
  PLANNING_RESOLUTIONS,
  type PlanningGoalStatus,
  type PlanningIterationStatus,
  type PlanningMilestoneStatus,
  type PlanningSubprojectStatus,
  type PlanningPriority,
  type PlanningWorkItemStatus
} from './ostler-api/planning-types'
import type { EstimateUnit } from './ostler-api/people-types'
import type { LibraryAiAccess } from './ostler-api/library-types'
import { MAX_TIME_ENTRY_SECONDS, MAX_TIME_NOTE_LENGTH } from './ostler-api/time-types'
import {
  MAX_FIELD_NAME_LENGTH,
  MAX_FIELD_OPTION_LENGTH,
  MAX_FIELD_OPTIONS,
  MAX_FIELD_TEXT_LENGTH,
  MAX_AI_INSTRUCTION_LENGTH,
  MAX_PROJECT_FIELDS,
  PLANNING_FIELD_TYPES
} from './ostler-api/field-types'
import { isIsoDate } from './dates'
import {
  isRelativeDate,
  relativePackageDate,
  resolvePackageDate,
  type PackageDate
} from './relative-dates'
import { MAX_ROTATION_PEOPLE, normalizeRecurrence } from './recurrence'
import { normalizeMilestoneRepeat } from './milestone-rounds'
import { t } from './i18n'
import { taskStatusLabel } from './task-labels'
import { MAX_HOURLY_RATE } from './time/billing'
import { MAX_CHECK_IN_NOTE_LENGTH, parseGoalCheckInInput, parseGoalMeasure } from './goal-measures'
import {
  DEFAULT_TASK_TYPE_ICON,
  MAX_TASK_TYPES,
  MAX_TASK_TYPE_NAME_LENGTH,
  isTaskTypeIcon
} from './task-types'
import { isHexColor, paletteColorFor } from './project-colors'
import { parseRuleDefinition } from './planning/rules'
import { MAX_RULES_PER_PROJECT } from './ostler-api/rule-types'
import { githubLinkUrl, parseGithubReference } from './github/github-reference'
import { isLinkKind } from './planning/links'
import { isEntityId } from './deep-link'
import { MAX_TASK_TEMPLATES, type TaskTemplateBody } from './ostler-api/task-template-types'
import { parseTaskTemplateBody, parseTaskTemplateName } from './task-templates'
import { parseTaskPrefix } from './task-key'
import {
  WHITEBOARD_LIMITS,
  cleanWhiteboardObject,
  type WhiteboardObjectInput
} from './whiteboard/model'
import { detachMissing } from './whiteboard/connectors'

import {
  PROJECT_PACKAGE_FORMAT,
  TEMPLATE_ICONS,
  type PackageRecurrence,
  type PackagePerson,
  type PackageLabel,
  type PackageGoal,
  type PackageGoalMeasure,
  type PackageCheckIn,
  type PackageMilestone,
  type PackageSubproject,
  type PackageMilestoneRepeat,
  type PackageIteration,
  type PackageRule,
  type PackageTaskType,
  type PackageIterationSummary,
  type PackageField,
  type PackageTask,
  type PackageTimeEntry,
  type PackageBillingSettings,
  type PackageBilling,
  type PackageGithubLink,
  type PackageTaskLink,
  type PackageContact,
  type PackageTaskContact,
  type PackageDecision,
  type PackageComment,
  type PackageLibraryKind,
  type PackageLibraryItem,
  type PackageWhiteboard,
  type PackageWhiteboardPicture,
  type PackageTemplateInfo,
  type ProjectPackage,
  type PackageBaseline,
  type PackageBaselineEntry,
  type PackageShoppingItem,
  type PackageBudget,
  type PackageCost,
  type PackageStatusUpdate,
  type PackagePinKind,
  type PackagePin,
  type PackageView,
  type PackageLinkIds,
  type PackageTaskTemplate,
  type PackageColumns,
  type ProjectPackageSummary,
  type PackageDependencyLink
} from './project-package-types'

export * from './project-package-types'
import {
  REF,
  PackageError,
  type Json,
  fail,
  describe,
  record,
  fields,
  text,
  list,
  textList,
  oneOf,
  color,
  date,
  ref,
  optionalRef,
  uniqueRefs,
  resolves
} from './project-package-parse'

/**
 * The project package: one
 * versioned JSON format for templates, the sample project, and P6.1's export
 * and import, so there is one serializer (`ProjectPackageService`) and one
 * parser (here). References (`ref`, `*Ref`) are local to the file and become
 * new ids on creation. Dates are `YYYY-MM-DD`, or relative to the day the
 * package is used: `+14d`, `-3d`, `+2w`.
 */

/** True for a package's `format`, including one exported before the rename (legacy-names.ts). */
export function isProjectPackageFormat(format: unknown): boolean {
  return format === PROJECT_PACKAGE_FORMAT || format === LEGACY_NAMES.projectPackageFormat
}
export const PROJECT_PACKAGE_VERSION = 1
export const MAX_PACKAGE_TASKS = 2000
/** Of JSON text, the whole package. */
export const MAX_PACKAGE_TEXT = 1_000_000

export type { PackageDate }
export { isRelativeDate, relativePackageDate, resolvePackageDate }

/** A file path inside an export's `library/` folder: one plain name, no folders. */
// eslint-disable-next-line no-control-regex
const LIBRARY_FILE = /^library\/(?!\.{1,2}$)[^\\/:*?"<>|\u0000-\u001f]{1,200}$/

/** At most this many baselines travel, with at most this many entries each. */
const MAX_PACKAGE_BASELINES = MAX_BASELINES
const MAX_PACKAGE_BASELINE_ENTRIES = 100000

/** At most this many shopping items travel. */
const MAX_PACKAGE_SHOPPING = 20000

/** At most this many costs travel. */
const MAX_PACKAGE_COSTS = 20000

/** At most this many billings travel. */
const MAX_PACKAGE_BILLINGS = 20000

/** At most this many status updates travel; years of weekly updates. */
const MAX_PACKAGE_STATUS_UPDATES = 5000

/** At most this many shortcuts travel; more than anyone keeps. */
const MAX_PACKAGE_PINS = 200

/** At most this many saved views travel. */
const MAX_PACKAGE_VIEWS = 100

/** The records a saved view's filter or options can point at, by their file refs. */
export const VIEW_REF_KINDS = [
  'person',
  'goal',
  'milestone',
  'subproject',
  'iteration',
  'type',
  'field',
  'option',
  'column',
  'contact',
  'task'
] as const
export type ViewRefKind = (typeof VIEW_REF_KINDS)[number]

const VIEW_REF_TOKEN = new RegExp(
  `#(${VIEW_REF_KINDS.join('|')})\\.([A-Za-z0-9_-]{1,40}(?:/[A-Za-z0-9_-]{1,40})?)`,
  'g'
)
const VIEW_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Every string in a view's state, rewritten by `swap`; a string `swap` returns
 * null for is dropped from its list, or becomes null outside one. A filter
 * condition left with an empty list is dropped, as it would match nothing.
 */
function swapViewStrings(value: unknown, swap: (text: string) => string | null): unknown {
  if (typeof value === 'string') return swap(value)
  if (Array.isArray(value))
    return value
      .map((entry) => swapViewStrings(entry, swap))
      .filter((entry) => entry !== null && !(Array.isArray(entry) && entry.length === 0))
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, swapViewStrings(entry, swap)])
    )
  return value
}

/** A filter with its emptied conditions left out (`swapViewStrings`). */
function keptConditions(filter: unknown): TaskFilter {
  const swapped = filter as TaskFilter
  return {
    match: swapped.match,
    conditions: swapped.conditions.filter(
      (condition) =>
        condition.value !== null &&
        !(Array.isArray(condition.value) && condition.value.length === 0) &&
        (condition.fieldId === undefined || condition.fieldId !== null)
    )
  }
}

/**
 * A saved view for the file: each id in it becomes the ref token `tokenOf`
 * gives, and one that names nothing in the file is left out.
 */
export function viewToPackage(
  view: Pick<SavedView, 'name' | 'viewType' | 'isDefault' | 'config'>,
  tokenOf: (id: string) => string | undefined
): PackageView {
  const swap = (text: string): string | null => {
    let lost = false
    const swapped = text.replace(VIEW_ID, (id) => {
      const token = tokenOf(id.toLowerCase())
      if (token === undefined) lost = true
      return token ?? id
    })
    return lost ? null : swapped
  }
  const filter = keptConditions(swapViewStrings(view.config.filter, swap))
  const options = swapViewStrings(view.config.options, swap) as Record<string, unknown>
  return {
    name: view.name,
    viewType: view.viewType,
    ...(view.isDefault ? { default: true as const } : {}),
    ...(view.config.query ? { query: view.config.query } : {}),
    ...(filter.conditions.length > 0 ? { filter } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {})
  }
}

/**
 * A view from the file, ready to save: each ref token becomes the id `idOf`
 * gives, and one that names nothing in the new project is left out.
 */
export function viewFromPackage(
  view: PackageView,
  idOf: (kind: ViewRefKind, ref: string) => string | undefined
): SavedViewConfig {
  const swap = (text: string): string | null => {
    let lost = false
    const swapped = text.replace(VIEW_REF_TOKEN, (_token, kind: ViewRefKind, ref: string) => {
      const id = idOf(kind, ref)
      if (id === undefined) lost = true
      return id ?? ''
    })
    return lost ? null : swapped
  }
  return {
    filter: keptConditions(swapViewStrings(view.filter ?? EMPTY_TASK_FILTER, swap)),
    query: view.query ?? '',
    options: swapViewStrings(view.options ?? {}, swap) as Record<string, unknown>
  }
}

// Relative dates live in `./relative-dates`, shared with task templates (N2.1).

export function summarizeProjectPackage(
  pkg: ProjectPackage,
  firstCount = 5
): ProjectPackageSummary {
  return {
    milestoneCount: pkg.milestones.length,
    taskCount: pkg.tasks.length,
    firstTasks: pkg.tasks
      .filter((task) => task.parentRef === null)
      .slice(0, firstCount)
      .map((task) => task.title)
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

const GOAL_STATUSES: PlanningGoalStatus[] = ['active', 'achieved', 'archived']
const MILESTONE_STATUSES: PlanningMilestoneStatus[] = ['planned', 'active', 'complete', 'archived']
const TASK_STATUSES: PlanningWorkItemStatus[] = [
  'backlog',
  'ready',
  'active',
  'blocked',
  'review',
  'done'
]
const PRIORITIES: PlanningPriority[] = ['low', 'medium', 'high', 'critical']
const LIBRARY_KINDS: PackageLibraryKind[] = [
  'brief',
  'guide',
  'note',
  'link',
  'document',
  'image',
  'whiteboard'
]
const AI_ACCESS: LibraryAiAccess[] = ['always', 'when-selected', 'human-only']
const ESTIMATE_UNITS: EstimateUnit[] = ['points', 'hours']

function parsePerson(value: unknown, path: string): PackagePerson {
  const input = record(value, path)
  fields(input, path, ['ref', 'name'], ['initials', 'color'])
  const initials = text(input.initials, `${path}.initials`, 3)
  return {
    ref: ref(input.ref, `${path}.ref`),
    name: text(input.name, `${path}.name`, 80, true),
    initials: initials.trim().toUpperCase(),
    color: color(input.color, `${path}.color`)
  }
}

function parseLabel(value: unknown, path: string): PackageLabel {
  const input = record(value, path)
  fields(input, path, ['name', 'color'], [])
  return {
    name: text(input.name, `${path}.name`, 80, true),
    color:
      color(input.color, `${path}.color`) ?? fail(t('data:projectPackage.colorMissing', { path }))
  }
}

function parseGoal(value: unknown, path: string): PackageGoal {
  const input = record(value, path)
  fields(input, path, ['ref', 'title'], ['outcome', 'status', 'measure', 'checkIns'])
  const measure =
    input.measure === undefined || input.measure === null
      ? undefined
      : parseGoalMeasureEntry(input.measure, `${path}.measure`)
  const checkIns = list(input.checkIns, `${path}.checkIns`, 5000).map((item, index) =>
    parseCheckIn(item, `${path}.checkIns[${index}]`)
  )
  const dates = new Set<string>()
  for (const [index, checkIn] of checkIns.entries()) {
    if (dates.has(checkIn.date))
      fail(t('data:projectPackage.checkInDuplicate', { path: `${path}.checkIns[${index}]` }))
    dates.add(checkIn.date)
  }
  return {
    ref: ref(input.ref, `${path}.ref`),
    title: text(input.title, `${path}.title`, 160, true),
    outcome: text(input.outcome, `${path}.outcome`, 4000),
    status: oneOf(input.status, GOAL_STATUSES, `${path}.status`, 'active'),
    ...(measure ? { measure } : {}),
    ...(checkIns.length > 0 ? { checkIns } : {})
  }
}

/**
 * A goal's measure (N5.6a), checked by the one parser; a relative date is
 * checked as a placeholder day, as a relative iteration's is.
 */
function parseGoalMeasureEntry(value: unknown, path: string): PackageGoalMeasure {
  const input = record(value, path)
  fields(
    input,
    path,
    ['startValue', 'targetValue', 'startDate', 'targetDate'],
    ['unit', 'direction']
  )
  const startDate = date(input.startDate, `${path}.startDate`)
  const targetDate = date(input.targetDate, `${path}.targetDate`)
  if (!startDate || !targetDate) fail(t('data:projectPackage.missing2', { path }))
  try {
    const checked = parseGoalMeasure({
      ...input,
      startDate: resolvePackageDate(startDate, '2000-01-01'),
      targetDate: resolvePackageDate(targetDate, '2000-01-01')
    })
    return { ...checked, startDate, targetDate }
  } catch (error) {
    if (error instanceof PackageError) throw error
    return fail(
      t('data:projectPackage.ruleInvalid', {
        path,
        reason: error instanceof Error ? error.message : String(error)
      })
    )
  }
}

function parseCheckIn(value: unknown, path: string): PackageCheckIn {
  const input = record(value, path)
  fields(input, path, ['date', 'value', 'recordedAt'], ['note'])
  const recordedAt = text(input.recordedAt, `${path}.recordedAt`, 40, true)
  if (!Number.isFinite(Date.parse(recordedAt)))
    fail(t('data:projectPackage.checkInTimeInvalid', { path }))
  try {
    const checked = parseGoalCheckInInput({
      date: input.date,
      value: input.value,
      note: text(input.note, `${path}.note`, MAX_CHECK_IN_NOTE_LENGTH)
    })
    return { ...checked, recordedAt }
  } catch (error) {
    return fail(
      t('data:projectPackage.ruleInvalid', {
        path,
        reason: error instanceof Error ? error.message : String(error)
      })
    )
  }
}

function parseMilestone(value: unknown, path: string): PackageMilestone {
  const input = record(value, path)
  fields(
    input,
    path,
    ['ref', 'name'],
    [
      'goalRef',
      'outcome',
      'targetDate',
      'successCriteria',
      'status',
      'repeat',
      'roundStart',
      'previousRoundRef',
      'subprojectRef'
    ]
  )
  const roundStart = date(input.roundStart, `${path}.roundStart`)
  const previousRoundRef = optionalRef(input.previousRoundRef, `${path}.previousRoundRef`)
  const subprojectRef = optionalRef(input.subprojectRef, `${path}.subprojectRef`)
  const repeat = parseMilestoneRepeat(input.repeat, `${path}.repeat`)
  return {
    ref: ref(input.ref, `${path}.ref`),
    goalRef: optionalRef(input.goalRef, `${path}.goalRef`),
    name: text(input.name, `${path}.name`, 160, true),
    outcome: text(input.outcome, `${path}.outcome`, 4000),
    targetDate: date(input.targetDate, `${path}.targetDate`),
    successCriteria: textList(input.successCriteria, `${path}.successCriteria`, 25, 500),
    status: oneOf(input.status, MILESTONE_STATUSES, `${path}.status`, 'planned'),
    ...(repeat ? { repeat } : {}),
    ...(roundStart !== null ? { roundStart } : {}),
    ...(previousRoundRef !== null ? { previousRoundRef } : {}),
    ...(subprojectRef !== null ? { subprojectRef } : {})
  }
}

const SUBPROJECT_STATUSES: PlanningSubprojectStatus[] = ['active', 'on_hold', 'done']

function parseSubproject(value: unknown, path: string): PackageSubproject {
  const input = record(value, path)
  fields(
    input,
    path,
    ['ref', 'name'],
    ['description', 'color', 'icon', 'leadRef', 'memberRefs', 'status']
  )
  const name = text(input.name, `${path}.name`, 80, true)
  return {
    ref: ref(input.ref, `${path}.ref`),
    name,
    description: text(input.description, `${path}.description`, 4000),
    color: isHexColor(input.color) ? input.color.toLowerCase() : paletteColorFor(name),
    ...(isProjectIcon(input.icon) ? { icon: input.icon } : {}),
    leadRef: optionalRef(input.leadRef, `${path}.leadRef`),
    memberRefs: list(input.memberRefs, `${path}.memberRefs`, 200).map((item, i) =>
      ref(item, `${path}.memberRefs[${i}]`)
    ),
    status: oneOf(input.status, SUBPROJECT_STATUSES, `${path}.status`, 'active')
  }
}

/** A round schedule (N5.7a), checked by the one checker; a relative start as a placeholder day. */
function parseMilestoneRepeat(value: unknown, path: string): PackageMilestoneRepeat | null {
  if (value === undefined || value === null) return null
  const input = record(value, path)
  fields(input, path, ['rule', 'lengthDays', 'nextStart'], ['on'])
  const nextStart = date(input.nextStart, `${path}.nextStart`)
  if (nextStart === null) return fail(t('data:projectPackage.roundNextStartRequired', { path }))
  if (input.on !== undefined && typeof input.on !== 'boolean')
    return fail(t('data:projectPackage.roundOnMustTrueFalse', { path }))
  try {
    const checked = normalizeMilestoneRepeat({
      rule: input.rule,
      lengthDays: input.lengthDays,
      nextStart: isRelativeDate(nextStart) ? '2000-01-01' : nextStart
    })
    return {
      rule: checked.rule,
      lengthDays: checked.lengthDays,
      nextStart,
      on: input.on !== false
    }
  } catch (error) {
    return fail(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseRecurrence(value: unknown, path: string): PackageRecurrence | null {
  if (value === undefined || value === null) return null
  const input = record(value, path)
  fields(input, path, ['rule'], ['endsOn', 'remaining', 'rotationRefs', 'nextIndex', 'goToAgents'])
  if (input.goToAgents !== undefined && typeof input.goToAgents !== 'boolean')
    return fail(`${path}.goToAgents must be true or false`)
  const endsOn = date(input.endsOn, `${path}.endsOn`)
  const rotationRefs =
    input.rotationRefs === undefined || input.rotationRefs === null
      ? null
      : list(input.rotationRefs, `${path}.rotationRefs`, MAX_ROTATION_PEOPLE).map((entry, index) =>
          ref(entry, `${path}.rotationRefs[${index}]`)
        )
  try {
    // The one rule checker; a relative end date is checked as a placeholder day.
    const settings = normalizeRecurrence({
      rule: input.rule,
      endsOn: endsOn === null ? null : isRelativeDate(endsOn) ? '2000-01-01' : endsOn,
      remaining: input.remaining ?? null,
      rotation: rotationRefs,
      nextIndex: input.nextIndex ?? null
    })
    return {
      rule: settings.rule,
      endsOn,
      remaining: settings.remaining,
      ...(settings.rotation
        ? { rotationRefs: settings.rotation, nextIndex: settings.nextIndex }
        : {}),
      ...(input.goToAgents === true ? { goToAgents: true as const } : {})
    }
  } catch (error) {
    return fail(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseTask(value: unknown, path: string): PackageTask {
  const input = record(value, path)
  fields(
    input,
    path,
    ['ref', 'title'],
    [
      'milestoneRef',
      'parentRef',
      'description',
      'status',
      'priority',
      'labels',
      'checklist',
      'assigneeRef',
      'startDate',
      'dueDate',
      'estimate',
      'dependsOnRefs',
      'dependsOnLinks',
      'recurrence',
      'fieldValues',
      'aiFills',
      'iterationRef',
      'typeRef',
      'subprojectRef',
      'resolution',
      'resolutionReason',
      'showFrom',
      'someday',
      'impact',
      'effort',
      'roundSourceRef',
      'number',
      'columnRef'
    ]
  )
  const checklist = list(input.checklist, `${path}.checklist`, 30).map((entry, index) => {
    const itemPath = `${path}.checklist[${index}]`
    const item = record(entry, itemPath)
    fields(item, itemPath, ['text'], ['checked', 'dueDate', 'assigneeRef'])
    if (item.checked !== undefined && typeof item.checked !== 'boolean')
      fail(t('data:projectPackage.checkedMustTrueFalse', { itemPath }))
    const dueDate = date(item.dueDate, `${itemPath}.dueDate`)
    const assigneeRef = optionalRef(item.assigneeRef, `${itemPath}.assigneeRef`)
    return {
      text: text(item.text, `${itemPath}.text`, 500, true),
      checked: item.checked === true,
      ...(dueDate !== null ? { dueDate } : {}),
      ...(assigneeRef !== null ? { assigneeRef } : {})
    }
  })
  const seen = new Set<string>()
  checklist.forEach((item, index) => {
    if (seen.has(item.text))
      fail(t('data:projectPackage.checklistTextListedTwice', { path, index, itemText: item.text }))
    seen.add(item.text)
  })
  let estimate: number | null = null
  if (input.estimate !== undefined && input.estimate !== null) {
    if (typeof input.estimate !== 'number' || !Number.isFinite(input.estimate))
      fail(t('data:projectPackage.estimateMustNumber', { path }))
    if (input.estimate < 0 || input.estimate > 1000)
      fail(t('data:projectPackage.estimateMust01000', { path }))
    estimate = input.estimate
  }
  return {
    ref: ref(input.ref, `${path}.ref`),
    milestoneRef: optionalRef(input.milestoneRef, `${path}.milestoneRef`),
    parentRef: optionalRef(input.parentRef, `${path}.parentRef`),
    title: text(input.title, `${path}.title`, 200, true),
    description: text(input.description, `${path}.description`, 8000),
    status: oneOf(input.status, TASK_STATUSES, `${path}.status`, 'backlog'),
    priority: oneOf(input.priority, PRIORITIES, `${path}.priority`, 'medium'),
    labels: [...new Set(textList(input.labels, `${path}.labels`, 20, 80))],
    checklist,
    assigneeRef: optionalRef(input.assigneeRef, `${path}.assigneeRef`),
    startDate: date(input.startDate, `${path}.startDate`),
    dueDate: date(input.dueDate, `${path}.dueDate`),
    estimate,
    dependsOnRefs: [
      ...new Set(
        list(input.dependsOnRefs, `${path}.dependsOnRefs`, 100).map((entry, index) =>
          ref(entry, `${path}.dependsOnRefs[${index}]`)
        )
      )
    ],
    ...parseDependsOnLinks(input.dependsOnLinks, `${path}.dependsOnLinks`),
    recurrence: parseRecurrence(input.recurrence, `${path}.recurrence`),
    ...parseResolution(input, path),
    ...parseShowFrom(input, path),
    ...parseScores(input, path),
    ...(input.iterationRef === undefined || input.iterationRef === null
      ? {}
      : { iterationRef: ref(input.iterationRef, `${path}.iterationRef`) }),
    ...(input.subprojectRef === undefined || input.subprojectRef === null
      ? {}
      : { subprojectRef: ref(input.subprojectRef, `${path}.subprojectRef`) }),
    ...(input.typeRef === undefined || input.typeRef === null
      ? {}
      : { typeRef: ref(input.typeRef, `${path}.typeRef`) }),
    ...(input.roundSourceRef === undefined || input.roundSourceRef === null
      ? {}
      : { roundSourceRef: ref(input.roundSourceRef, `${path}.roundSourceRef`) }),
    ...(input.columnRef === undefined || input.columnRef === null
      ? {}
      : { columnRef: ref(input.columnRef, `${path}.columnRef`) }),
    ...parseTaskNumber(input, path),
    ...(input.fieldValues === undefined || input.fieldValues === null
      ? {}
      : {
          fieldValues: record(
            input.fieldValues,
            `${path}.fieldValues`
          ) as PackageTask['fieldValues']
        }),
    ...parseAiFills(input.aiFills, `${path}.aiFills`)
  }
}

/** A task's `aiFills` (N8.4): by field ref, each with an 8-digit hex hash. */
function parseAiFills(value: unknown, path: string): Pick<PackageTask, 'aiFills'> {
  if (value === undefined || value === null) return {}
  const input = record(value, path)
  const fills: NonNullable<PackageTask['aiFills']> = {}
  for (const [fieldRef, entry] of Object.entries(input)) {
    const entryPath = `${path}.${fieldRef}`
    const fill = record(entry, entryPath)
    fields(fill, entryPath, ['sourceHash'], [])
    if (typeof fill.sourceHash !== 'string' || !/^[0-9a-f]{8}$/.test(fill.sourceHash))
      fail(t('data:projectPackage.fieldValueWrong', { path: entryPath, describe: describe(entry) }))
    fills[ref(fieldRef, entryPath)] = { sourceHash: fill.sourceHash }
  }
  return Object.keys(fills).length > 0 ? { aiFills: fills } : {}
}

const ITERATION_STATUSES: PlanningIterationStatus[] = ['planned', 'active', 'finished']

/** A task's number (N9.8a), left out when it has none. */
function parseTaskNumber(
  input: Record<string, unknown>,
  path: string
): Pick<PackageTask, 'number'> {
  if (input.number === undefined || input.number === null) return {}
  if (typeof input.number !== 'number' || !Number.isSafeInteger(input.number) || input.number < 1)
    fail(t('data:projectPackage.numberMustWhole', { path }))
  return { number: input.number }
}

/** An idea's scores (N1.1b), each a whole number from 1 to 5, left out when not set. */
function parseScores(
  input: Record<string, unknown>,
  path: string
): Pick<PackageTask, 'impact' | 'effort'> {
  const scores: Pick<PackageTask, 'impact' | 'effort'> = {}
  for (const field of ['impact', 'effort'] as const) {
    const value = input[field]
    if (value === undefined || value === null) continue
    if (!isScore(value)) fail(t('data:projectPackage.scoreMust15', { path, field }))
    scores[field] = value
  }
  return scores
}

/** A task's show-from date and Someday flag (N1.1a), each left out when not set. */
function parseShowFrom(
  input: Record<string, unknown>,
  path: string
): Pick<PackageTask, 'showFrom' | 'someday'> {
  const showFrom = date(input.showFrom, `${path}.showFrom`)
  if (input.someday !== undefined && input.someday !== null && typeof input.someday !== 'boolean')
    fail(t('data:projectPackage.somedayMustTrueFalse', { path }))
  return {
    ...(showFrom !== null ? { showFrom } : {}),
    ...(input.someday === true ? { someday: true } : {})
  }
}

/** A task's won't-do mark and reason (N1.2), or nothing for an open task. */
function parseResolution(
  input: Record<string, unknown>,
  path: string
): Pick<PackageTask, 'resolution' | 'resolutionReason'> {
  if (input.resolution === undefined || input.resolution === null) return {}
  const resolution = oneOf(
    input.resolution,
    [...PLANNING_RESOLUTIONS],
    `${path}.resolution`,
    'wont-do'
  )
  if (input.status === 'done') fail(t('data:projectPackage.wontDoDone', { path }))
  const reason = text(
    input.resolutionReason,
    `${path}.resolutionReason`,
    MAX_RESOLUTION_REASON_LENGTH
  ).trim()
  return reason ? { resolution, resolutionReason: reason } : { resolution }
}

function count(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000)
    fail(t('data:projectPackage.mustCount', { path }))
  return value
}

function parseRule(value: unknown, path: string): PackageRule {
  try {
    return parseRuleDefinition(value)
  } catch (error) {
    return fail(
      t('data:projectPackage.ruleInvalid', {
        path,
        reason: error instanceof Error ? error.message : String(error)
      })
    )
  }
}

function parseTaskType(value: unknown, path: string): PackageTaskType {
  const input = record(value, path)
  fields(input, path, ['ref', 'name'], ['icon', 'color', 'fieldRefs', 'templateName'])
  const name = text(input.name, `${path}.name`, MAX_TASK_TYPE_NAME_LENGTH, true)
  const fieldRefs =
    input.fieldRefs === undefined || input.fieldRefs === null
      ? undefined
      : list(input.fieldRefs, `${path}.fieldRefs`, MAX_PROJECT_FIELDS).map((item, i) =>
          ref(item, `${path}.fieldRefs[${i}]`)
        )
  const templateName =
    input.templateName === undefined || input.templateName === null
      ? undefined
      : parseTaskTemplateName(input.templateName)
  return {
    ref: ref(input.ref, `${path}.ref`),
    name,
    icon: isTaskTypeIcon(input.icon) ? input.icon : DEFAULT_TASK_TYPE_ICON,
    color: isHexColor(input.color) ? input.color.toLowerCase() : paletteColorFor(name),
    ...(fieldRefs ? { fieldRefs } : {}),
    ...(templateName ? { templateName } : {})
  }
}

function parseIteration(value: unknown, path: string): PackageIteration {
  const input = record(value, path)
  fields(input, path, ['ref', 'name', 'startDate', 'endDate'], ['goal', 'status', 'summary'])
  const startDate = date(input.startDate, `${path}.startDate`)
  const endDate = date(input.endDate, `${path}.endDate`)
  if (startDate === null) fail(t('data:projectPackage.missing2', { path: `${path}.startDate` }))
  if (endDate === null) fail(t('data:projectPackage.missing2', { path: `${path}.endDate` }))
  let summary: PackageIterationSummary | null = null
  if (input.summary !== undefined && input.summary !== null) {
    const summaryPath = `${path}.summary`
    const raw = record(input.summary, summaryPath)
    fields(
      raw,
      summaryPath,
      ['doneCount', 'doneEstimate', 'carriedCount', 'carriedEstimate'],
      ['carryOver']
    )
    summary = {
      doneCount: count(raw.doneCount, `${summaryPath}.doneCount`),
      doneEstimate: count(raw.doneEstimate, `${summaryPath}.doneEstimate`),
      carriedCount: count(raw.carriedCount, `${summaryPath}.carriedCount`),
      carriedEstimate: count(raw.carriedEstimate, `${summaryPath}.carriedEstimate`),
      carryOver: oneOf(raw.carryOver, ['next', 'none'], `${summaryPath}.carryOver`, 'none')
    }
  }
  return {
    ref: ref(input.ref, `${path}.ref`),
    name: text(input.name, `${path}.name`, 80, true),
    startDate: startDate!,
    endDate: endDate!,
    goal: text(input.goal, `${path}.goal`, 300),
    status: oneOf(input.status, ITERATION_STATUSES, `${path}.status`, 'planned'),
    summary
  }
}

const HIDEABLE_COLUMNS: PlanningWorkItemStatus[] = ['ready', 'blocked', 'review']

/** Column names (up to 40 characters) and the hideable statuses (R2.4). */
function parseColumns(value: unknown): PackageColumns {
  const input = record(value, 'columns')
  fields(input, 'columns', [], ['names', 'hidden', 'custom'])
  const names: PackageColumns['names'] = {}
  if (input.names !== undefined && input.names !== null) {
    const given = record(input.names, 'columns.names')
    fields(given, 'columns.names', [], TASK_STATUSES)
    for (const status of TASK_STATUSES) {
      const name = text(given[status], `columns.names.${status}`, MAX_COLUMN_NAME_LENGTH).trim()
      if (name) names[status] = name
    }
  }
  const hidden = list(input.hidden, 'columns.hidden', HIDEABLE_COLUMNS.length).map((item, i) =>
    oneOf(item, HIDEABLE_COLUMNS, `columns.hidden[${i}]`, 'ready')
  )
  const seen = new Set<string>()
  const custom = list(input.custom, 'columns.custom', MAX_CUSTOM_COLUMNS).map((item, i) => {
    const path = `columns.custom[${i}]`
    const column = record(item, path)
    fields(column, path, ['ref', 'name', 'countsAs'], ['hidden'])
    const name = text(column.name, `${path}.name`, MAX_COLUMN_NAME_LENGTH, true).trim()
    return {
      ref: ref(column.ref, `${path}.ref`),
      name,
      countsAs: oneOf(column.countsAs, TASK_STATUSES, `${path}.countsAs`, 'active'),
      ...(column.hidden === true ? { hidden: true } : {})
    }
  })
  // A name twice, or a standard word, is left out: the file still imports.
  const kept = custom.filter((column) => {
    const lower = column.name.toLowerCase()
    if (
      seen.has(lower) ||
      TASK_STATUSES.some((status) => taskStatusLabel(status).toLowerCase() === lower)
    )
      return false
    seen.add(lower)
    return true
  })
  return {
    names,
    hidden: TASK_STATUSES.filter((status) => hidden.includes(status)),
    ...(kept.length > 0 ? { custom: kept } : {})
  }
}

function parseField(value: unknown, path: string): PackageField {
  const input = record(value, path)
  fields(input, path, ['ref', 'name', 'type'], ['options', 'aiInstruction'])
  const type = oneOf(input.type, [...PLANNING_FIELD_TYPES], `${path}.type`, 'text')
  const aiInstruction =
    input.aiInstruction === undefined || input.aiInstruction === null
      ? ''
      : text(input.aiInstruction, `${path}.aiInstruction`, MAX_AI_INSTRUCTION_LENGTH, false)
  if (aiInstruction && type !== 'text' && type !== 'choice')
    fail(t('data:projectPackage.aiInstructionOnlyTextChoice', { path }))
  const options = list(input.options, `${path}.options`, MAX_FIELD_OPTIONS).map((entry, i) => {
    const optionPath = `${path}.options[${i}]`
    const option = record(entry, optionPath)
    fields(option, optionPath, ['ref', 'name'], ['color'])
    return {
      ref: ref(option.ref, `${optionPath}.ref`),
      name: text(option.name, `${optionPath}.name`, MAX_FIELD_OPTION_LENGTH, true),
      color: color(option.color, `${optionPath}.color`)
    }
  })
  if (options.length > 0 && type !== 'choice' && type !== 'choices')
    fail(t('data:projectPackage.optionsOnlyChoice', { path }))
  uniqueRefs(options, `${path}.options`)
  return {
    ref: ref(input.ref, `${path}.ref`),
    name: text(input.name, `${path}.name`, MAX_FIELD_NAME_LENGTH, true),
    type,
    options,
    ...(aiInstruction.trim() ? { aiInstruction: aiInstruction.trim() } : {})
  }
}

/** Checks a task's custom field values against the package's fields. */
function checkFieldValues(
  task: Pick<PackageTask, 'fieldValues'>,
  path: string,
  byRef: Map<string, PackageField>
): void {
  for (const [fieldRef, value] of Object.entries(task.fieldValues ?? {})) {
    const valuePath = `${path}.fieldValues.${fieldRef}`
    const field = byRef.get(fieldRef)
    if (!field)
      fail(
        t('data:projectPackage.doesNotMatchAny', {
          path: valuePath,
          value: fieldRef,
          what: 'field'
        })
      )
    const optionRefs = new Set(field.options.map((option) => option.ref))
    const wrong = () =>
      fail(t('data:projectPackage.fieldValueWrong', { path: valuePath, describe: describe(value) }))
    switch (field.type) {
      case 'text':
        if (typeof value !== 'string' || !value.trim() || value.length > MAX_FIELD_TEXT_LENGTH)
          wrong()
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) wrong()
        break
      case 'date':
        if (date(value, valuePath) === null) wrong()
        break
      case 'checkbox':
        if (value !== true) wrong()
        break
      case 'choice':
        if (typeof value !== 'string' || !optionRefs.has(value)) wrong()
        break
      case 'choices':
        if (
          !Array.isArray(value) ||
          value.length === 0 ||
          value.some((entry) => typeof entry !== 'string' || !optionRefs.has(entry))
        )
          wrong()
        break
    }
  }
}

function parseDecision(value: unknown, path: string): PackageDecision {
  const input = record(value, path)
  fields(
    input,
    path,
    ['title', 'decision'],
    ['context', 'alternatives', 'consequences', 'date', 'taskRefs']
  )
  return {
    title: text(input.title, `${path}.title`, 200, true),
    context: text(input.context, `${path}.context`, 8000),
    decision: text(input.decision, `${path}.decision`, 8000, true),
    alternatives: text(input.alternatives, `${path}.alternatives`, 8000),
    consequences: text(input.consequences, `${path}.consequences`, 8000),
    date: date(input.date, `${path}.date`),
    taskRefs: list(input.taskRefs, `${path}.taskRefs`, 100).map((entry, index) =>
      ref(entry, `${path}.taskRefs[${index}]`)
    )
  }
}

function parseComment(value: unknown, path: string): PackageComment {
  const input = record(value, path)
  fields(input, path, ['taskRef', 'body'], ['authorRef'])
  return {
    taskRef: ref(input.taskRef, `${path}.taskRef`),
    authorRef: optionalRef(input.authorRef, `${path}.authorRef`),
    body: text(input.body, `${path}.body`, 10000, true)
  }
}

function parseTimeEntry(value: unknown, path: string): PackageTimeEntry {
  const input = record(value, path)
  fields(
    input,
    path,
    ['taskRef', 'startedAt', 'durationSeconds'],
    ['personRef', 'note', 'source', 'billable', 'billingRef']
  )
  const startedAt = text(input.startedAt, `${path}.startedAt`, 40, true)
  if (!Number.isFinite(Date.parse(startedAt)))
    fail(t('data:projectPackage.timeStartInvalid', { path }))
  const seconds = input.durationSeconds
  if (
    typeof seconds !== 'number' ||
    !Number.isInteger(seconds) ||
    seconds <= 0 ||
    seconds > MAX_TIME_ENTRY_SECONDS
  )
    fail(t('data:projectPackage.timeDurationInvalid', { path }))
  return {
    taskRef: ref(input.taskRef, `${path}.taskRef`),
    personRef: optionalRef(input.personRef, `${path}.personRef`),
    startedAt,
    durationSeconds: seconds as number,
    note: text(input.note, `${path}.note`, MAX_TIME_NOTE_LENGTH),
    source: oneOf(input.source, ['timer', 'manual'], `${path}.source`, 'manual'),
    ...(flag(input.billable, `${path}.billable`) ? { billable: true } : {}),
    ...(input.billingRef === undefined || input.billingRef === null
      ? {}
      : { billingRef: ref(input.billingRef, `${path}.billingRef`) })
  }
}

/** An optional true or false; anything else is refused. */
function flag(value: unknown, path: string): boolean {
  if (value === undefined || value === null) return false
  if (typeof value !== 'boolean') fail(t('data:projectPackage.mustTrueFalse', { path }))
  return value as boolean
}

/** The hourly rate and default (N6.4). */
function parseBillingSettings(value: unknown, path: string): PackageBillingSettings {
  const input = record(value, path)
  fields(input, path, [], ['hourlyRate', 'newTimeBillable'])
  const rate = input.hourlyRate
  if (
    rate !== undefined &&
    rate !== null &&
    (typeof rate !== 'number' || !Number.isSafeInteger(rate) || rate < 0 || rate > MAX_HOURLY_RATE)
  )
    fail(t('data:projectPackage.amountInvalid', { path: `${path}.hourlyRate` }))
  return {
    hourlyRate: rate === undefined || rate === null ? null : (rate as number),
    newTimeBillable: flag(input.newTimeBillable, `${path}.newTimeBillable`)
  }
}

/** A billing (N6.4): its range, when it was marked and the totals it kept. */
function parseBilling(value: unknown, path: string): PackageBilling {
  const input = record(value, path)
  fields(
    input,
    path,
    ['ref', 'from', 'to', 'markedAt', 'entryCount', 'billableSeconds', 'currency'],
    ['hourlyRate', 'amount']
  )
  const from = text(input.from, `${path}.from`, 10, true)
  const to = text(input.to, `${path}.to`, 10, true)
  if (!isIsoDate(from) || !isIsoDate(to) || to < from)
    fail(t('data:projectPackage.billingRangeInvalid', { path }))
  const markedAt = text(input.markedAt, `${path}.markedAt`, 40, true)
  if (!Number.isFinite(Date.parse(markedAt)))
    fail(t('data:projectPackage.billingTimeInvalid', { path }))
  const count = (raw: unknown, key: string): number => {
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0)
      fail(t('data:projectPackage.mustCount', { path: `${path}.${key}` }))
    return raw as number
  }
  if (!isCurrencyCode(input.currency))
    fail(t('data:projectPackage.currencyInvalid', { path, describe: describe(input.currency) }))
  const settings = parseBillingSettings({ hourlyRate: input.hourlyRate }, path)
  return {
    ref: ref(input.ref, `${path}.ref`),
    from,
    to,
    markedAt,
    entryCount: count(input.entryCount, 'entryCount'),
    billableSeconds: count(input.billableSeconds, 'billableSeconds'),
    hourlyRate: settings.hourlyRate,
    amount:
      input.amount === undefined || input.amount === null
        ? null
        : minorUnits(input.amount, `${path}.amount`),
    currency: input.currency as string
  }
}

function parseGithubLink(value: unknown, path: string): PackageGithubLink {
  const input = record(value, path)
  fields(input, path, ['taskRef', 'url'], [])
  const url = text(input.url, `${path}.url`, 500, true)
  return {
    taskRef: ref(input.taskRef, `${path}.taskRef`),
    url: githubLinkUrl(githubUrl(url, path))
  }
}

function parseTaskLink(value: unknown, path: string): PackageTaskLink | null {
  const input = record(value, path)
  fields(input, path, ['fromRef', 'toRef', 'kind'], [])
  const fromRef = ref(input.fromRef, `${path}.fromRef`)
  const toRef = ref(input.toRef, `${path}.toRef`)
  // An unknown kind (from a later version) is dropped, not refused.
  return isLinkKind(input.kind) ? { fromRef, toRef, kind: input.kind } : null
}

/**
 * The links the file can keep (N2.4): both tasks in the file, not a task
 * linked to itself, and one link per pair and kind. The rest are dropped.
 */
function keptTaskLinks(
  links: (PackageTaskLink | null)[],
  taskRefs: Set<string>
): PackageTaskLink[] {
  const seen = new Set<string>()
  return links.filter((link): link is PackageTaskLink => {
    if (!link || link.fromRef === link.toRef) return false
    if (!taskRefs.has(link.fromRef) || !taskRefs.has(link.toRef)) return false
    const key = [link.kind, ...[link.fromRef, link.toRef].sort()].join(' ')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A github.com issue or pull request URL; anything else refuses the package. */
function githubUrl(url: string, path: string): ReturnType<typeof parseGithubReference> {
  try {
    return parseGithubReference(url, null)
  } catch {
    return fail(t('data:projectPackage.githubLinkInvalid', { path }))
  }
}

function parseLibraryItem(value: unknown, path: string): PackageLibraryItem {
  const input = record(value, path)
  fields(
    input,
    path,
    ['kind', 'title'],
    ['summary', 'body', 'url', 'aiAccess', 'tags', 'file', 'whiteboard']
  )
  const kind = oneOf(input.kind, LIBRARY_KINDS, `${path}.kind`, 'note')
  const url = text(input.url, `${path}.url`, 2000)
  if (kind === 'link' && !url) fail(t('data:projectPackage.urlMissingLinkNeeds', { path }))
  const isFile = kind === 'document' || kind === 'image'
  const file = text(input.file, `${path}.file`, 300)
  if (isFile && !file) fail(t('data:projectPackage.fileMissingNeedsOne', { path, kind }))
  if (!isFile && file) fail(t('data:projectPackage.fileOnlyDocumentsImages', { path }))
  if (isFile && !LIBRARY_FILE.test(file))
    fail(t('data:projectPackage.fileMustFileName', { path, describe: describe(file) }))
  const hasBoard = input.whiteboard !== undefined && input.whiteboard !== null
  if (kind === 'whiteboard' && !hasBoard) fail(t('data:projectPackage.whiteboardMissing', { path }))
  if (kind !== 'whiteboard' && hasBoard)
    fail(t('data:projectPackage.whiteboardOnlyWhiteboards', { path }))
  const body = text(input.body, `${path}.body`, 200_000)
  return {
    kind,
    title: text(input.title, `${path}.title`, 200, true),
    summary: text(input.summary, `${path}.summary`, 2000),
    // A whiteboard's body is its outline, written from its objects (D6): never read from a file.
    body: kind === 'whiteboard' ? '' : body,
    url: kind === 'link' ? url : null,
    aiAccess:
      input.aiAccess === undefined || input.aiAccess === null
        ? null
        : oneOf(input.aiAccess, AI_ACCESS, `${path}.aiAccess`, 'always'),
    tags: textList(input.tags, `${path}.tags`, 20, 40),
    file: isFile ? file : null,
    ...(kind === 'whiteboard'
      ? { whiteboard: parseWhiteboard(input.whiteboard, `${path}.whiteboard`) }
      : {})
  }
}

/**
 * A whiteboard's objects and pictures (D21). Each object passes the one object rule,
 * `cleanWhiteboardObject`; an image object's `imageItemId` is read as null, since a file names its
 * pictures only in `pictures`. Whether each `libraryIndex` is an image is checked once the whole
 * `library` is read.
 */
function parseWhiteboard(value: unknown, path: string): PackageWhiteboard {
  const input = record(value, path)
  fields(input, path, ['objects'], ['pictures'])
  const ids = new Set<string>()
  const images = new Set<string>()
  const objects = list(input.objects, `${path}.objects`, WHITEBOARD_LIMITS.objects).map(
    (item, i): WhiteboardObjectInput => {
      let object: WhiteboardObjectInput
      try {
        object = cleanWhiteboardObject(item)
      } catch (error) {
        return fail(
          t('data:projectPackage.whiteboardObjectInvalid', {
            path: `${path}.objects[${i}]`,
            message: error instanceof Error ? error.message : String(error)
          })
        )
      }
      if (ids.has(object.id))
        fail(t('data:projectPackage.whiteboardObjectTwice', { path, id: object.id }))
      ids.add(object.id)
      if (object.kind !== 'image') return object
      images.add(object.id)
      return { ...object, data: { ...object.data, imageItemId: null } }
    }
  )
  const shown = new Set<string>()
  const pictures = list(input.pictures, `${path}.pictures`, WHITEBOARD_LIMITS.objects).map(
    (item, i): PackageWhiteboardPicture => {
      const at = `${path}.pictures[${i}]`
      const picture = record(item, at)
      fields(picture, at, ['objectId', 'libraryIndex'], [])
      const objectId = picture.objectId
      if (typeof objectId !== 'string' || !images.has(objectId))
        fail(
          t('data:projectPackage.whiteboardPictureNotImage', {
            path: at,
            describe: describe(objectId)
          })
        )
      if (shown.has(objectId))
        fail(t('data:projectPackage.whiteboardPictureTwice', { path, id: objectId }))
      shown.add(objectId)
      const libraryIndex = picture.libraryIndex
      if (typeof libraryIndex !== 'number' || !Number.isInteger(libraryIndex) || libraryIndex < 0)
        fail(
          t('data:projectPackage.whiteboardPictureIndexInvalid', {
            path: at,
            describe: describe(libraryIndex)
          })
        )
      return { objectId, libraryIndex }
    }
  )
  return { objects, pictures }
}

/**
 * A whiteboard as a template carries it (D21): templates carry no files, so its pictures go, and
 * connectors stuck to them come loose where they were drawn.
 */
export function templateWhiteboard(board: PackageWhiteboard): PackageWhiteboard {
  const pictures = new Set(
    board.objects.filter((object) => object.kind === 'image').map((object) => object.id)
  )
  const kept = board.objects.filter((object) => !pictures.has(object.id))
  const freed = new Map(detachMissing(kept, pictures).map((object) => [object.id, object]))
  return {
    objects: kept.map((object) => freed.get(object.id) ?? object),
    pictures: []
  }
}

/**
 * A task's `dependsOnLinks`: each names a ref; a type or lag this build does
 * not know reads as finish to start, 0 days, so a file is never refused over
 * one. Links that are plain are dropped, and a ref listed twice keeps its first.
 */
function parseDependsOnLinks(
  value: unknown,
  path: string
): { dependsOnLinks?: PackageDependencyLink[] } {
  if (value === undefined || value === null) return {}
  const links: PackageDependencyLink[] = []
  const seen = new Set<string>()
  list(value, path, 100).forEach((entry, index) => {
    const itemPath = `${path}[${index}]`
    const item = record(entry, itemPath)
    fields(item, itemPath, ['ref'], ['type', 'lagDays'])
    const link = normalisedDependencyLink({
      id: ref(item.ref, `${itemPath}.ref`),
      type: item.type,
      lagDays: item.lagDays
    })
    if (seen.has(link.id)) return
    seen.add(link.id)
    if (isPlainDependencyLink(link)) return
    links.push({ ref: link.id, type: link.type, lagDays: link.lagDays })
  })
  return links.length > 0 ? { dependsOnLinks: links } : {}
}

/** The type and lag a file gives the link to `ref`: finish to start, 0 days when it gives none. */
export function packageDependencyLink(
  task: Pick<PackageTask, 'dependsOnLinks'>,
  ref: string
): Pick<PackageDependencyLink, 'type' | 'lagDays'> {
  const link = task.dependsOnLinks?.find((entry) => entry.ref === ref)
  return link ? { type: link.type, lagDays: link.lagDays } : { type: 'finish-to-start', lagDays: 0 }
}

/** What a file writes for a task's links with a type or lag: nothing when all are plain. */
export function packageDependsOnLinks(
  item: DependencyLinkSource,
  refs: ReadonlyMap<string, string>
): { dependsOnLinks?: PackageDependencyLink[] } {
  const links = dependencyLinksOf(item).flatMap((link) => {
    const ref = refs.get(link.id)
    return ref && !isPlainDependencyLink(link)
      ? [{ ref, type: link.type, lagDays: link.lagDays }]
      : []
  })
  return links.length > 0 ? { dependsOnLinks: links } : {}
}

/**
 * The refs a task names, wherever a batch of new records is described by
 * refs: a project package's tasks, or the automation API's `split` items.
 * One implementation of refs, so both refuse the same mistakes in the same words.
 */
export interface RefTask {
  ref: string
  milestoneRef: string | null
  parentRef: string | null
  dependsOnRefs: string[]
}

/** How a batch names its tasks in error messages. */
export interface RefNames {
  /** The path of the task at this index, such as `tasks[3]`. */
  pathOf(index: number): string
  /** The field that lists a task's dependencies, such as `dependsOnRefs`. */
  dependencyField: string
}

/** A short reference of letters, digits, - or _. */
export function isRef(value: unknown): value is string {
  return typeof value === 'string' && REF.test(value)
}

/** Throws a PackageError naming the first task in a loop. */
function refuseCycles<T extends RefTask>(
  tasks: T[],
  edges: (task: T) => string[],
  what: string,
  names: RefNames
) {
  const byRef = new Map(tasks.map((task, index) => [task.ref, { task, index }]))
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (refValue: string): void => {
    const mark = state.get(refValue)
    if (mark === 'done') return
    const entry = byRef.get(refValue)!
    if (mark === 'visiting')
      fail(t('data:projectPackage.partLoop', { pathOf: names.pathOf(entry.index), refValue, what }))
    state.set(refValue, 'visiting')
    for (const next of edges(entry.task)) visit(next)
    state.set(refValue, 'done')
  }
  for (const task of tasks) visit(task.ref)
}

/**
 * Every milestone, parent and dependency ref a task names resolves; no task
 * is its own parent or dependency; a subtask depends only on its siblings;
 * there are no dependency or subtask loops; and nothing nests more than three
 * levels deep. Task refs must already be unique. Throws a PackageError.
 */
function checkTaskRefs(tasks: RefTask[], milestoneRefs: Set<string>, names: RefNames): void {
  const taskRefs = new Set(tasks.map((task) => task.ref))
  const byRef = new Map(tasks.map((task) => [task.ref, task]))
  const dependencyField = names.dependencyField
  tasks.forEach((task, i) => {
    const path = names.pathOf(i)
    resolves(task.milestoneRef, milestoneRefs, `${path}.milestoneRef`, 'milestone')
    resolves(task.parentRef, taskRefs, `${path}.parentRef`, 'task')
    if (task.parentRef === task.ref)
      fail(t('data:projectPackage.parentrefTaskItself', { path, ref: task.ref }))
    task.dependsOnRefs.forEach((dependency, d) => {
      const depPath = `${path}.${dependencyField}[${d}]`
      resolves(dependency, taskRefs, depPath, 'task')
      if (dependency === task.ref)
        fail(t('data:projectPackage.taskItself', { depPath, dependency }))
      if (task.parentRef !== null) {
        if (dependency === task.parentRef)
          fail(t('data:projectPackage.subtasksOwnParent', { depPath, dependency }))
        if (byRef.get(dependency)!.parentRef !== task.parentRef)
          fail(t('data:projectPackage.mustSubtaskSameParent', { depPath, dependency }))
      }
    })
  })
  refuseCycles(tasks, (task) => task.dependsOnRefs, 'dependency', names)
  refuseCycles(tasks, (task) => (task.parentRef ? [task.parentRef] : []), 'subtask', names)
  tasks.forEach((task, i) => {
    let depth = 1
    for (let parent = task.parentRef; parent; parent = byRef.get(parent)!.parentRef) depth++
    if (depth > 4) fail(t('data:projectPackage.nestedMoreThanThree', { pathOf: names.pathOf(i) }))
  })
}

/**
 * The ref checks of a package's tasks, for any other batch described by refs
 * (the automation API's `split`). Refs must be unique across `tasks` and
 * `milestoneRefs` already.
 */
export function validateTaskRefs(
  tasks: RefTask[],
  milestoneRefs: Set<string>,
  names: RefNames
): Result<null> {
  try {
    checkTaskRefs(tasks, milestoneRefs, names)
    return { ok: true, value: null }
  } catch (error) {
    if (error instanceof PackageError) return { ok: false, error: error.message }
    throw error
  }
}

/** At most this many contacts, and links to them, travel (N6.5). */
const MAX_PACKAGE_CONTACTS = 5000
const MAX_PACKAGE_TASK_CONTACTS = 100000

/** One list a package carries: its cap, and how one entry is read. */
interface PackageCollection<T> {
  max: number
  parse: (value: unknown, path: string) => T
  /** The refusal for a list over its cap, where it has wording of its own. */
  tooMany?: (count: number) => string
}

function collection<T>(
  max: number,
  parse: (value: unknown, path: string) => T,
  tooMany?: (count: number) => string
): PackageCollection<T> {
  return { max, parse, tooMany }
}

/** Every list in a package, read in this order. Its keys are also the package's allowed list fields. */
const COLLECTIONS = {
  people: collection(500, parsePerson),
  labels: collection(500, parseLabel),
  fields: collection(MAX_PROJECT_FIELDS, parseField),
  goals: collection(500, parseGoal),
  milestones: collection(500, parseMilestone),
  subprojects: collection(200, parseSubproject),
  iterations: collection(500, parseIteration),
  taskTypes: collection(MAX_TASK_TYPES, parseTaskType),
  rules: collection(MAX_RULES_PER_PROJECT, parseRule),
  tasks: collection(MAX_PACKAGE_TASKS, parseTask, (taskListCount) =>
    t('data:projectPackage.packageHasTasksPackage', { taskListCount, MAX_PACKAGE_TASKS })
  ),
  decisions: collection(2000, parseDecision),
  comments: collection(20000, parseComment),
  timeEntries: collection(100000, parseTimeEntry),
  githubLinks: collection(100000, parseGithubLink),
  taskLinks: collection(100000, parseTaskLink),
  library: collection(500, parseLibraryItem),
  taskTemplates: collection(MAX_TASK_TEMPLATES, parseTaskTemplate),
  statusUpdates: collection(MAX_PACKAGE_STATUS_UPDATES, parseStatusUpdate),
  costs: collection(MAX_PACKAGE_COSTS, parseCost),
  billings: collection(MAX_PACKAGE_BILLINGS, parseBilling),
  contacts: collection(MAX_PACKAGE_CONTACTS, parseContact),
  taskContacts: collection(MAX_PACKAGE_TASK_CONTACTS, parseTaskContact),
  shopping: collection(MAX_PACKAGE_SHOPPING, parseShoppingItem),
  baselines: collection(MAX_PACKAGE_BASELINES, parseBaseline)
}

type PackageCollections = {
  [K in keyof typeof COLLECTIONS]: ReturnType<(typeof COLLECTIONS)[K]['parse']>[]
}

/** The package's other optional fields: single values, and the lists read with context. */
const PACKAGE_SINGLE_FIELDS = [
  'exportedAt',
  'app',
  'template',
  'columns',
  'linkIds',
  'pins',
  'views',
  'budget',
  'billingSettings'
]

function parseCollections(root: Json): PackageCollections {
  const parsed: Record<string, unknown[]> = {}
  for (const [key, { max, parse, tooMany }] of Object.entries(COLLECTIONS) as [
    string,
    PackageCollection<unknown>
  ][]) {
    const items = list(root[key], key, tooMany ? Infinity : max)
    if (tooMany && items.length > max) fail(tooMany(items.length))
    parsed[key] = items.map((item, i) => parse(item, `${key}[${i}]`))
  }
  return parsed as PackageCollections
}

function parsePackage(json: unknown): ProjectPackage {
  const root = record(json, t('data:projectPackage.package'))
  let size = 0
  try {
    size = JSON.stringify(root).length
  } catch {
    fail(t('data:projectPackage.packageNotPlainJson'))
  }
  if (size > MAX_PACKAGE_TEXT) fail(t('data:projectPackage.packageLargerThan1'))
  fields(
    root,
    'package',
    ['format', 'version', 'project'],
    [...PACKAGE_SINGLE_FIELDS, ...Object.keys(COLLECTIONS)]
  )
  if (!isProjectPackageFormat(root.format))
    fail(t('data:projectPackage.packageFormatMust', { PROJECT_PACKAGE_FORMAT }))
  if (root.version !== PROJECT_PACKAGE_VERSION)
    fail(
      t('data:projectPackage.packageVersionNotSupported', {
        describe: describe(root.version),
        PROJECT_PACKAGE_VERSION
      })
    )

  let app: ProjectPackage['app'] = null
  if (root.app !== undefined && root.app !== null) {
    const input = record(root.app, 'package.app')
    fields(input, 'package.app', ['name', 'version'], [])
    app = {
      name: text(input.name, 'package.app.name', 80, true),
      version: text(input.version, 'package.app.version', 40, true)
    }
  }
  let template: PackageTemplateInfo | null = null
  if (root.template !== undefined && root.template !== null) {
    const input = record(root.template, 'package.template')
    fields(input, 'package.template', ['description', 'icon'], [])
    template = {
      description: text(input.description, 'package.template.description', 200, true),
      icon: oneOf(input.icon, [...TEMPLATE_ICONS], 'package.template.icon', 'file')
    }
  }
  const projectInput = record(root.project, 'package.project')
  fields(projectInput, 'package.project', ['name'], ['color', 'estimateUnit', 'icon', 'taskPrefix'])
  // An icon this version does not know is left out rather than refusing the file.
  const projectIcon = isProjectIcon(projectInput.icon) ? projectInput.icon : undefined
  // A prefix that is not one (N9.8a) is left out: the new project makes its own.
  const taskPrefix = parseTaskPrefix(projectInput.taskPrefix)
  const project = {
    ...(projectIcon ? { icon: projectIcon } : {}),
    ...(taskPrefix ? { taskPrefix } : {}),
    name: text(projectInput.name, 'package.project.name', 80, true),
    color: color(projectInput.color, 'package.project.color'),
    estimateUnit: oneOf(
      projectInput.estimateUnit,
      ESTIMATE_UNITS,
      'package.project.estimateUnit',
      'points'
    )
  }

  const {
    people,
    labels,
    fields: packageFields,
    goals,
    milestones,
    subprojects,
    iterations,
    taskTypes,
    rules,
    tasks,
    decisions,
    comments,
    timeEntries,
    githubLinks,
    taskLinks: rawTaskLinks,
    library,
    taskTemplates,
    statusUpdates,
    costs,
    billings,
    contacts,
    taskContacts,
    shopping,
    baselines
  } = parseCollections(root)
  library.forEach((item, i) => {
    item.whiteboard?.pictures.forEach((picture, p) => {
      if (library[picture.libraryIndex]?.kind !== 'image')
        fail(
          t('data:projectPackage.whiteboardPictureNotImageItem', {
            path: `library[${i}].whiteboard.pictures[${p}]`,
            index: picture.libraryIndex
          })
        )
    })
  })
  const columns =
    root.columns === undefined || root.columns === null ? null : parseColumns(root.columns)

  const labelNames = new Set<string>()
  labels.forEach((label, index) => {
    if (labelNames.has(label.name))
      fail(t('data:projectPackage.labelsNameListedTwice', { index, labelName: label.name }))
    labelNames.add(label.name)
  })

  // Every ref resolves.
  const personRefs = uniqueRefs(people, 'people')
  const goalRefs = uniqueRefs(goals, 'goals')
  const milestoneRefs = uniqueRefs(milestones, 'milestones')
  const taskRefs = uniqueRefs(tasks, 'tasks')
  const iterationRefs = uniqueRefs(iterations, 'iterations')
  const subprojectRefs = uniqueRefs(subprojects, 'subprojects')
  subprojects.forEach((subproject, i) => {
    resolves(subproject.leadRef, personRefs, `subprojects[${i}].leadRef`, 'person')
    subproject.memberRefs.forEach((member, m) =>
      resolves(member, personRefs, `subprojects[${i}].memberRefs[${m}]`, 'person')
    )
  })
  const typeRefs = uniqueRefs(taskTypes, 'taskTypes')
  const typeNames = new Set<string>()
  taskTypes.forEach((type, index) => {
    if (typeNames.has(type.name.toLocaleLowerCase()))
      fail(t('data:projectPackage.taskTypeNameTwice', { index, name: type.name }))
    typeNames.add(type.name.toLocaleLowerCase())
  })
  uniqueRefs(packageFields, 'fields')
  const fieldNames = new Set<string>()
  packageFields.forEach((field, index) => {
    if (fieldNames.has(field.name.toLowerCase()))
      fail(t('data:projectPackage.fieldNameListedTwice', { index, fieldName: field.name }))
    fieldNames.add(field.name.toLowerCase())
  })
  const fieldsByRef = new Map(packageFields.map((field) => [field.ref, field]))
  milestones.forEach((milestone, i) => {
    resolves(milestone.goalRef, goalRefs, `milestones[${i}].goalRef`, 'goal')
    resolves(
      milestone.previousRoundRef ?? null,
      milestoneRefs,
      `milestones[${i}].previousRoundRef`,
      'milestone'
    )
    resolves(
      milestone.subprojectRef ?? null,
      subprojectRefs,
      `milestones[${i}].subprojectRef`,
      'workstream'
    )
  })
  const packageNames: RefNames = {
    pathOf: (index) => `tasks[${index}]`,
    dependencyField: 'dependsOnRefs'
  }
  checkTaskRefs(tasks, milestoneRefs, packageNames)
  tasks.forEach((task, i) => {
    const path = `tasks[${i}]`
    resolves(task.assigneeRef, personRefs, `${path}.assigneeRef`, 'person')
    resolves(task.roundSourceRef ?? null, taskRefs, `${path}.roundSourceRef`, 'task')
    task.checklist.forEach((item, c) =>
      resolves(
        item.assigneeRef ?? null,
        personRefs,
        `${path}.checklist[${c}].assigneeRef`,
        'person'
      )
    )
    resolves(task.iterationRef ?? null, iterationRefs, `${path}.iterationRef`, 'iteration')
    resolves(task.typeRef ?? null, typeRefs, `${path}.typeRef`, 'task type')
    resolves(task.subprojectRef ?? null, subprojectRefs, `${path}.subprojectRef`, 'workstream')
    if (task.recurrence && task.dueDate === null)
      fail(t('data:projectPackage.recurrenceNeedsTaskHave', { path }))
    task.recurrence?.rotationRefs?.forEach((personRef, r) =>
      resolves(personRef, personRefs, `${path}.recurrence.rotationRefs[${r}]`, 'person')
    )
    checkFieldValues(task, path, fieldsByRef)
  })
  decisions.forEach((decision, i) =>
    decision.taskRefs.forEach((taskRef, t) =>
      resolves(taskRef, taskRefs, `decisions[${i}].taskRefs[${t}]`, 'task')
    )
  )
  comments.forEach((comment, i) => {
    resolves(comment.taskRef, taskRefs, `comments[${i}].taskRef`, 'task')
    resolves(comment.authorRef, personRefs, `comments[${i}].authorRef`, 'person')
  })
  timeEntries.forEach((entry, i) => {
    resolves(entry.taskRef, taskRefs, `timeEntries[${i}].taskRef`, 'task')
    resolves(entry.personRef, personRefs, `timeEntries[${i}].personRef`, 'person')
  })
  githubLinks.forEach((link, i) => {
    resolves(link.taskRef, taskRefs, `githubLinks[${i}].taskRef`, 'task')
  })
  const taskLinks = keptTaskLinks(rawTaskLinks, taskRefs)
  const linkIds = parseLinkIds(root.linkIds, {
    tasks: tasks.length,
    milestones: milestones.length,
    decisions: decisions.length,
    library: library.length
  })
  statusUpdates.forEach((update, i) =>
    resolves(update.personRef ?? null, personRefs, `statusUpdates[${i}].personRef`, 'person')
  )
  const budget =
    root.budget === undefined || root.budget === null ? null : parseBudget(root.budget, 'budget')
  costs.forEach((cost, i) => {
    resolves(cost.taskRef ?? null, taskRefs, `costs[${i}].taskRef`, 'task')
    resolves(cost.milestoneRef ?? null, milestoneRefs, `costs[${i}].milestoneRef`, 'milestone')
  })
  const billingSettings =
    root.billingSettings === undefined || root.billingSettings === null
      ? null
      : parseBillingSettings(root.billingSettings, 'billingSettings')
  const billingRefs = uniqueRefs(billings, 'billings')
  timeEntries.forEach((entry, i) =>
    resolves(entry.billingRef ?? null, billingRefs, `timeEntries[${i}].billingRef`, 'billing')
  )
  const contactRefs = uniqueRefs(contacts, 'contacts')
  const boughtCosts = new Set<number>()
  shopping.forEach((item, i) => {
    resolves(item.taskRef ?? null, taskRefs, `shopping[${i}].taskRef`, 'task')
    resolves(item.supplierRef ?? null, contactRefs, `shopping[${i}].supplierRef`, 'contact')
    if (item.costIndex === undefined) return
    // A bought item points at a paid cost of its own.
    if (
      item.costIndex < 0 ||
      item.costIndex >= costs.length ||
      costs[item.costIndex].state !== 'paid' ||
      boughtCosts.has(item.costIndex)
    )
      fail(t('data:projectPackage.costIndexInvalid', { path: `shopping[${i}].costIndex` }))
    boughtCosts.add(item.costIndex)
  })
  taskContacts.forEach((link, i) => {
    resolves(link.taskRef, taskRefs, `taskContacts[${i}].taskRef`, 'task')
    resolves(link.contactRef, contactRefs, `taskContacts[${i}].contactRef`, 'contact')
  })
  const views = parseViews(root.views)
  const pins = parsePins(root.pins, {
    task: tasks.length,
    milestone: milestones.length,
    decision: decisions.length,
    library: library.length,
    view: views.length
  })
  const templateNames = new Set<string>()
  taskTemplates.forEach((template, i) => {
    const path = `taskTemplates[${i}]`
    resolves(template.assigneeRef, personRefs, `${path}.assigneeRef`, 'person')
    for (const [itemText, personRef] of Object.entries(template.checklistAssigneeRefs ?? {})) {
      if (!template.body.checklist.includes(itemText))
        fail(t('data:projectPackage.checklistPersonNotListed', { path, itemText }))
      resolves(personRef, personRefs, `${path}.checklistAssigneeRefs`, 'person')
    }
    checkFieldValues(template, path, fieldsByRef)
    const key = template.name.toLocaleLowerCase()
    if (templateNames.has(key))
      fail(t('data:projectPackage.taskTemplateNameTwice', { path, name: template.name }))
    templateNames.add(key)
  })
  // Each type's fields and template (N2.7b) are the file's own.
  const fieldRefSet = new Set(fieldsByRef.keys())
  taskTypes.forEach((type, i) => {
    for (const fieldRef of type.fieldRefs ?? [])
      resolves(fieldRef, fieldRefSet, `taskTypes[${i}].fieldRefs`, 'field')
    if (type.templateName !== undefined)
      resolves(
        type.templateName.toLocaleLowerCase(),
        templateNames,
        `taskTypes[${i}].templateName`,
        'task template'
      )
  })

  return {
    format: PROJECT_PACKAGE_FORMAT,
    version: 1,
    exportedAt:
      root.exportedAt === undefined || root.exportedAt === null
        ? null
        : text(root.exportedAt, 'package.exportedAt', 40),
    app,
    template,
    project,
    people,
    labels,
    ...(packageFields.length > 0 ? { fields: packageFields } : {}),
    goals,
    milestones,
    ...(subprojects.length > 0 ? { subprojects } : {}),
    ...(iterations.length > 0 ? { iterations } : {}),
    ...(taskTypes.length > 0 ? { taskTypes } : {}),
    ...(rules.length > 0 ? { rules } : {}),
    tasks,
    decisions,
    comments,
    ...(timeEntries.length > 0 ? { timeEntries } : {}),
    ...(githubLinks.length > 0 ? { githubLinks } : {}),
    ...(taskLinks.length > 0 ? { taskLinks } : {}),
    ...(columns ? { columns } : {}),
    library,
    ...(taskTemplates.length > 0 ? { taskTemplates } : {}),
    ...(linkIds ? { linkIds } : {}),
    ...(pins.length > 0 ? { pins } : {}),
    ...(views.length > 0 ? { views } : {}),
    ...(statusUpdates.length > 0 ? { statusUpdates } : {}),
    ...(budget ? { budget } : {}),
    ...(costs.length > 0 ? { costs } : {}),
    ...(billingSettings ? { billingSettings } : {}),
    ...(billings.length > 0 ? { billings } : {}),
    ...(contacts.length > 0 ? { contacts } : {}),
    ...(taskContacts.length > 0 ? { taskContacts } : {}),
    ...(shopping.length > 0 ? { shopping } : {}),
    ...(baselines.length > 0 ? { baselines } : {})
  }
}

/** A baseline (N7.4): a name, when, and dates by ref. A date that is not one reads as none. */
function parseBaseline(value: unknown, path: string): PackageBaseline {
  const input = record(value, path)
  fields(input, path, ['name', 'savedAt'], ['entries'])
  const savedAt = text(input.savedAt, `${path}.savedAt`, 40, true)
  if (Number.isNaN(Date.parse(savedAt)))
    fail(t('data:projectPackage.baselineTimeInvalid', { path }))
  const day = (raw: unknown) => (isIsoDate(raw) ? raw : null)
  const entries = list(input.entries, `${path}.entries`, MAX_PACKAGE_BASELINE_ENTRIES).map(
    (raw, i): PackageBaselineEntry => {
      const entryPath = `${path}.entries[${i}]`
      const entry = record(raw, entryPath)
      fields(entry, entryPath, ['kind', 'ref'], ['start', 'due'])
      const kind = oneOf(entry.kind, ['task', 'milestone'], `${entryPath}.kind`, 'task')
      return {
        kind,
        ref: ref(entry.ref, `${entryPath}.ref`),
        start: kind === 'task' ? day(entry.start) : null,
        due: day(entry.due)
      }
    }
  )
  return { name: text(input.name, `${path}.name`, MAX_BASELINE_NAME, true), savedAt, entries }
}

/** A shopping item (N6.3b): words, a quantity, an estimate, and links by ref or place. */
function parseShoppingItem(value: unknown, path: string): PackageShoppingItem {
  const input = record(value, path)
  fields(
    input,
    path,
    ['name'],
    ['quantity', 'unit', 'estimate', 'supplierRef', 'taskRef', 'costIndex']
  )
  const quantity = input.quantity ?? 1
  if (
    typeof quantity !== 'number' ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > MAX_SHOPPING_QUANTITY
  )
    fail(t('data:projectPackage.quantityInvalid', { path: `${path}.quantity` }))
  const costIndex = input.costIndex
  if (costIndex !== undefined && costIndex !== null && !Number.isSafeInteger(costIndex))
    fail(t('data:projectPackage.costIndexInvalid', { path: `${path}.costIndex` }))
  return {
    name: text(input.name, `${path}.name`, MAX_SHOPPING_NAME, true),
    quantity: quantity as number,
    unit: text(input.unit, `${path}.unit`, MAX_SHOPPING_UNIT).trim(),
    estimate:
      input.estimate === undefined || input.estimate === null
        ? null
        : minorUnits(input.estimate, `${path}.estimate`),
    supplierRef: optionalRef(input.supplierRef, `${path}.supplierRef`),
    taskRef: optionalRef(input.taskRef, `${path}.taskRef`),
    ...(typeof costIndex === 'number' ? { costIndex } : {})
  }
}

/** A contact (N6.5): its fields within the contact limits; an email that is not one is dropped. */
function parseContact(value: unknown, path: string): PackageContact {
  const input = record(value, path)
  fields(
    input,
    path,
    ['ref', 'name'],
    ['organisation', 'role', 'phones', 'emails', 'website', 'address', 'notes']
  )
  const phones = list(input.phones, `${path}.phones`, CONTACT_LIMITS.phones).map((item, i) => {
    const phone = record(item, `${path}.phones[${i}]`)
    fields(phone, `${path}.phones[${i}]`, ['number'], ['label'])
    return {
      label: text(phone.label, `${path}.phones[${i}].label`, CONTACT_LIMITS.phoneLabel).trim(),
      number: text(phone.number, `${path}.phones[${i}].number`, CONTACT_LIMITS.phoneNumber, true)
    }
  })
  const website = text(input.website, `${path}.website`, CONTACT_LIMITS.website).trim()
  return {
    ref: ref(input.ref, `${path}.ref`),
    name: text(input.name, `${path}.name`, CONTACT_LIMITS.name, true),
    organisation: text(
      input.organisation,
      `${path}.organisation`,
      CONTACT_LIMITS.organisation
    ).trim(),
    role: text(input.role, `${path}.role`, CONTACT_LIMITS.role).trim(),
    phones,
    emails: textList(
      input.emails,
      `${path}.emails`,
      CONTACT_LIMITS.emails,
      CONTACT_LIMITS.email
    ).filter(isEmailAddress),
    website: websiteHref(website) === null ? '' : website,
    address: text(input.address, `${path}.address`, CONTACT_LIMITS.address).trim(),
    notes: text(input.notes, `${path}.notes`, CONTACT_LIMITS.notes).trim()
  }
}

function parseTaskContact(value: unknown, path: string): PackageTaskContact {
  const input = record(value, path)
  fields(input, path, ['taskRef', 'contactRef', 'role'], [])
  return {
    taskRef: ref(input.taskRef, `${path}.taskRef`),
    contactRef: ref(input.contactRef, `${path}.contactRef`),
    role: oneOf(input.role, [...TASK_CONTACT_ROLES], `${path}.role`, 'other')
  }
}

/** A whole number of minor units within the limit. */
function minorUnits(value: unknown, path: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_MINOR_UNITS
  )
    fail(t('data:projectPackage.amountInvalid', { path }))
  return value as number
}

/** The budget (N6.3a): an amount or null, and a currency `Intl` knows. */
function parseBudget(value: unknown, path: string): PackageBudget {
  const input = record(value, path)
  fields(input, path, ['currency'], ['amount'])
  if (!isCurrencyCode(input.currency))
    fail(t('data:projectPackage.currencyInvalid', { path, describe: describe(input.currency) }))
  return {
    amount:
      input.amount === undefined || input.amount === null
        ? null
        : minorUnits(input.amount, `${path}.amount`),
    currency: input.currency as string
  }
}

/** A cost (N6.3a): a date, an amount, words, and links by ref. */
function parseCost(value: unknown, path: string): PackageCost {
  const input = record(value, path)
  fields(
    input,
    path,
    ['date', 'amount', 'description'],
    ['category', 'taskRef', 'milestoneRef', 'state']
  )
  const day = date(input.date, `${path}.date`)
  if (day === null) fail(t('data:projectPackage.missing', { path, key: 'date' }))
  return {
    date: day!,
    amount: minorUnits(input.amount, `${path}.amount`),
    description: text(input.description, `${path}.description`, MAX_COST_DESCRIPTION, true),
    category: text(input.category, `${path}.category`, MAX_COST_CATEGORY).trim(),
    taskRef: optionalRef(input.taskRef, `${path}.taskRef`),
    milestoneRef: optionalRef(input.milestoneRef, `${path}.milestoneRef`),
    state: oneOf(input.state, [...COST_STATES], `${path}.state`, 'planned')
  }
}

/** A status update (N5.5): a health, a note within the limit, who, and when. */
function parseStatusUpdate(value: unknown, path: string): PackageStatusUpdate {
  const input = record(value, path)
  fields(input, path, ['health', 'postedAt'], ['note', 'by', 'personRef', 'editedAt'])
  const when = (raw: unknown, key: string, required: boolean): string | null => {
    const written = text(raw, `${path}.${key}`, 40, required)
    if (!written) return null
    if (!Number.isFinite(Date.parse(written)))
      fail(t('data:projectPackage.statusUpdateTimeInvalid', { path }))
    return written
  }
  return {
    health: oneOf(input.health, [...STATUS_UPDATE_HEALTHS], `${path}.health`, 'on-track'),
    note: text(input.note, `${path}.note`, MAX_STATUS_UPDATE_NOTE).trim(),
    by: oneOf(input.by, ['person', 'automation'], `${path}.by`, 'person'),
    personRef: optionalRef(input.personRef, `${path}.personRef`),
    postedAt: when(input.postedAt, 'postedAt', true)!,
    editedAt: when(input.editedAt, 'editedAt', false)
  }
}

/**
 * The Overview's shortcuts (N5.2a). Pointers only, so a malformed entry, or one
 * whose item is not in the file, is dropped rather than refusing the file.
 */
function parsePins(
  value: unknown,
  lengths: Record<Exclude<PackagePinKind, 'project-view'>, number>
): PackagePin[] {
  if (!Array.isArray(value)) return []
  const pins: PackagePin[] = []
  for (const entry of value.slice(0, MAX_PACKAGE_PINS)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const input = entry as Record<string, unknown>
    if (input.kind === 'project-view') {
      if (typeof input.viewId === 'string' && /^[a-z][a-z-]{1,39}$/.test(input.viewId))
        pins.push({ kind: 'project-view', viewId: input.viewId })
      continue
    }
    const kind = input.kind as Exclude<PackagePinKind, 'project-view'>
    if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(lengths, kind)) continue
    const index = input.index
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= lengths[kind]
    )
      continue
    pins.push({ kind, index })
  }
  return pins
}

/**
 * Saved views. A view is setup, not work, so a malformed one, or a second
 * default of one type, is dropped rather than refusing the file.
 */
function parseViews(value: unknown): PackageView[] {
  if (!Array.isArray(value)) return []
  const views: PackageView[] = []
  const defaults = new Set<SavedViewType>()
  for (const entry of value.slice(0, MAX_PACKAGE_VIEWS)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const input = entry as Record<string, unknown>
    try {
      const viewType = parseSavedViewType(input.viewType)
      const isDefault = input.default === true
      if (isDefault && defaults.has(viewType)) continue
      const name =
        isDefault && input.name === undefined ? DEFAULT_VIEW_NAME : parseSavedViewName(input.name)
      const config = parseSavedViewConfig({
        filter: input.filter,
        query: input.query,
        options: input.options
      })
      if (isDefault) defaults.add(viewType)
      views.push({
        name,
        viewType,
        ...(isDefault ? { default: true as const } : {}),
        ...(config.query ? { query: config.query } : {}),
        ...(config.filter.conditions.length > 0 ? { filter: config.filter } : {}),
        ...(Object.keys(config.options).length > 0 ? { options: config.options } : {})
      })
    } catch {
      // dropped -- see above
    }
  }
  return views
}

/**
 * The exported items' ids (N4.4a). Only a hint for rewriting links, so a
 * malformed one is dropped rather than refusing the file: links then stay as
 * written. Each list is cut to its own list's length; an entry that is not an
 * id becomes empty.
 */
function parseLinkIds(
  value: unknown,
  lengths: Record<'tasks' | 'milestones' | 'decisions' | 'library', number>
): PackageLinkIds | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (typeof input.projectId !== 'string' || !isEntityId(input.projectId)) return null
  const ids = (key: keyof typeof lengths): string[] => {
    const raw = Array.isArray(input[key]) ? (input[key] as unknown[]) : []
    return raw
      .slice(0, lengths[key])
      .map((entry) => (typeof entry === 'string' && isEntityId(entry) ? entry : ''))
  }
  return {
    projectId: input.projectId,
    tasks: ids('tasks'),
    milestones: ids('milestones'),
    decisions: ids('decisions'),
    library: ids('library')
  }
}

/**
 * A project's own task template (N2.1). Its body is checked by the one task
 * template validator; the assignee and custom field values sit beside it by
 * ref, as a task's do, and its dates are always relative.
 */
function parseTaskTemplate(value: unknown, path: string): PackageTaskTemplate {
  const input = record(value, path)
  fields(
    input,
    path,
    ['name', 'body'],
    ['assigneeRef', 'fieldValues', 'checklistAssigneeRefs', 'playbook']
  )
  if (
    input.playbook !== undefined &&
    input.playbook !== null &&
    typeof input.playbook !== 'boolean'
  )
    fail(t('data:projectPackage.taskTemplatePlaybookInvalid', { path }))
  let name: string
  let body: TaskTemplateBody
  try {
    name = parseTaskTemplateName(input.name)
    body = parseTaskTemplateBody(input.body)
  } catch (error) {
    return fail(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (
    body.assigneeId !== null ||
    Object.keys(body.fieldValues).length > 0 ||
    (body.checklistDetails ?? []).some((detail) => detail.assigneeId !== null)
  )
    fail(t('data:projectPackage.taskTemplateByRef', { path }))
  let checklistAssigneeRefs: Record<string, string> | undefined
  if (input.checklistAssigneeRefs !== undefined && input.checklistAssigneeRefs !== null) {
    const refs = record(input.checklistAssigneeRefs, `${path}.checklistAssigneeRefs`)
    checklistAssigneeRefs = {}
    for (const [itemText, personRef] of Object.entries(refs))
      checklistAssigneeRefs[itemText] = ref(personRef, `${path}.checklistAssigneeRefs`)
  }
  return {
    name,
    body,
    ...(input.playbook === true ? { playbook: true as const } : {}),
    ...(checklistAssigneeRefs ? { checklistAssigneeRefs } : {}),
    assigneeRef: optionalRef(input.assigneeRef, `${path}.assigneeRef`),
    ...(input.fieldValues === undefined || input.fieldValues === null
      ? {}
      : {
          fieldValues: record(
            input.fieldValues,
            `${path}.fieldValues`
          ) as PackageTaskTemplate['fieldValues']
        })
  }
}

/**
 * Checks a package strictly and returns it with every optional field filled
 * in, or an error in plain words that gives the path:
 * "tasks[12].milestoneRef 'm9' does not match any milestone".
 */
export function validateProjectPackage(json: unknown): Result<ProjectPackage> {
  try {
    return { ok: true, value: parsePackage(json) }
  } catch (error) {
    if (error instanceof PackageError) return { ok: false, error: error.message }
    throw error
  }
}

/** Order in which tasks can be created: parents and dependencies first. */
export function packageCreationOrder<T extends RefTask>(tasks: T[]): T[] {
  const byRef = new Map(tasks.map((task) => [task.ref, task]))
  const done = new Set<string>()
  const order: T[] = []
  const visit = (task: T): void => {
    if (done.has(task.ref)) return
    done.add(task.ref)
    if (task.parentRef) visit(byRef.get(task.parentRef)!)
    for (const dependency of task.dependsOnRefs) visit(byRef.get(dependency)!)
    order.push(task)
  }
  tasks.forEach(visit)
  return order
}
