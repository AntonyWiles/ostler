import type { PlanningPriority, PlanningWorkItemStatus } from '@shared/ostler-api'

/**
 * What `npm run seed:scale` creates (P9.1): a deterministic plan, so every
 * seeded data folder holds the same shape and perf numbers compare across
 * runs. Pure: `seed-scale.ts` writes the plan through the services.
 *
 * The brief asks for 5,000 tasks, a Board of 500 cards and a List of 5,000
 * rows. One project cannot be both, so the List project holds 5,000 tasks,
 * the Board project 500, and the other 48 projects a few each (`perf.json`
 * and `docs/performance.md` say which project each measure opens).
 */

export const SCALE = {
  projects: 50,
  /** Projects with a scratch Git folder. */
  projectsWithFolders: 5,
  listProjectTasks: 5_000,
  boardProjectTasks: 500,
  otherProjectTasks: 20,
  statusChanges: 20_000,
  historyDays: 180,
  comments: 3_000,
  libraryItems: 300,
  savedViews: 40,
  people: 12,
  milestonesPerProject: 3,
  /** What later work added to a task and around it, so perf measures it too. */
  typedShare: 0.7,
  datedChecklistShare: 0.5,
  taskLinks: 1_500,
  timeBlocks: 2_000,
  costs: 1_000,
  calendarEvents: 400,
  sidebarPins: 12,
  countdowns: 3
} as const

export const LIST_PROJECT_NAME = 'Scale list (5,000 tasks)'
export const BOARD_PROJECT_NAME = 'Scale board (500 tasks)'

const STATUSES: PlanningWorkItemStatus[] = [
  'backlog',
  'ready',
  'active',
  'blocked',
  'review',
  'done'
]
const PRIORITIES: PlanningPriority[] = ['low', 'medium', 'high', 'critical']
export const LABELS = [
  'design',
  'backend',
  'frontend',
  'research',
  'bug',
  'docs',
  'ops',
  'finance',
  'legal',
  'marketing',
  'hiring',
  'urgent'
]
const VERBS = ['Draft', 'Review', 'Plan', 'Fix', 'Write', 'Check', 'Prepare', 'Update', 'Test']
const NOUNS = [
  'the budget report',
  'onboarding guide',
  'release notes',
  'supplier contract',
  'login page',
  'quarterly plan',
  'customer survey',
  'invoice export',
  'site map',
  'press kit',
  'data backup',
  'hiring brief'
]
const WORDS =
  'agreed with the team that we should move this along after the review and check the numbers again before Friday because the last draft missed a few details'.split(
    ' '
  )

/** A small seeded random number generator (mulberry32), so plans repeat. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface PlannedTask {
  /** Index within its project; dependencies and parents point at earlier ones. */
  index: number
  title: string
  description: string
  priority: PlanningPriority
  labels: string[]
  checklist: string[]
  /** How many checklist items are ticked. */
  checked: number
  /** Index into the plan's people, or null for nobody. */
  assignee: number | null
  /** Days from today; null for no date. */
  startOffset: number | null
  dueOffset: number | null
  milestone: number | null
  dependsOn: number[]
  parent: number | null
  /** The statuses it moves through after its first, oldest first. */
  path: PlanningWorkItemStatus[]
  firstStatus: PlanningWorkItemStatus
}

export interface PlannedProject {
  name: string
  withFolder: boolean
  tasks: PlannedTask[]
}

export interface ScalePlan {
  people: string[]
  projects: PlannedProject[]
  /** [project index, task index, body]. */
  comments: Array<[number, number, string]>
  /** [project index, title, body]. */
  libraryItems: Array<[number, string, string]>
  /** [project index, name, view type, query]. */
  savedViews: Array<[number, string, 'board' | 'list' | 'calendar' | 'timeline', string]>
  /** What later work added: types, fields, dated checklist items, links, blocks, costs, events, pins. */
  extras: PlannedExtras
}

export interface PlannedField {
  name: string
  type: 'choice' | 'number'
  /** A Choice field's options, in order. */
  options: string[]
}

export interface PlannedTaskType {
  name: string
  icon: string
  /** Indexes into the plan's fields: the ones a task of this type shows. */
  fields: number[]
}

export interface PlannedCalendarEvent {
  title: string
  /** Days from today. */
  dayOffset: number
  startMinute: number
  lengthMinutes: number
  /** Every weekday from its first day, as a stand-up would be. */
  weekdays: boolean
}

/**
 * Added after the first plan, from a random stream of its own, so the
 * projects, tasks, comments, notes and views above stay as they were and
 * older numbers still compare. Every project has the same types and fields.
 */
export interface PlannedExtras {
  fields: PlannedField[]
  taskTypes: PlannedTaskType[]
  /** [project, task] → [type index, values by field index]: an option index or a number. */
  typed: Map<string, { type: number; values: Map<number, number> }>
  /** [project, task, checklist item index, days from today]: unticked items only. */
  checklistDates: Array<[number, number, number, number]>
  /** [project, from task, to task, kind]: no pair twice, never a task to itself. */
  links: Array<[number, number, number, 'relates' | 'duplicates' | 'copied-from']>
  /** [project, task, days from today, start minute, length in minutes]. */
  timeBlocks: Array<[number, number, number, number, number]>
  /** [project, task or null, days from today, amount in pence, description, category, paid]. */
  costs: Array<[number, number | null, number, number, string, string, boolean]>
  /** [project, budget in pence]: every fifth project. */
  budgets: Array<[number, number]>
  calendarEvents: PlannedCalendarEvent[]
  /** [project, task]: sidebar pins of tasks due ahead; the first `SCALE.countdowns` count down. */
  pins: Array<[number, number]>
}

/** The key of a task in `PlannedExtras.typed`. */
export function taskKey(projectIndex: number, taskIndex: number): string {
  return `${projectIndex}:${taskIndex}`
}

const FIELDS: PlannedField[] = [
  { name: 'Area', type: 'choice', options: ['Web', 'Mobile', 'Office', 'Finance', 'Events'] },
  { name: 'Effort', type: 'number', options: [] },
  { name: 'Severity', type: 'choice', options: ['Minor', 'Major', 'Critical'] }
]

const TASK_TYPES: PlannedTaskType[] = [
  { name: 'Bug', icon: 'bug', fields: [0, 2] },
  { name: 'Feature', icon: 'sparkles', fields: [0, 1] },
  { name: 'Chore', icon: 'wrench', fields: [1] }
]

const LINK_KINDS = ['relates', 'relates', 'relates', 'duplicates', 'copied-from'] as const
const COST_CATEGORIES = ['Software', 'Travel', 'Printing', 'Contractors', 'Venue', '']
const EVENT_TITLES = ['Team meeting', 'Client call', '1:1', 'Workshop', 'Dentist', 'Lunch']

function buildExtras(projects: PlannedProject[], seed: number): PlannedExtras {
  const random = seededRandom(seed)
  const typed: PlannedExtras['typed'] = new Map()
  const checklistDates: PlannedExtras['checklistDates'] = []
  for (const [projectIndex, project] of projects.entries()) {
    for (const task of project.tasks) {
      if (random() < SCALE.typedShare) {
        const type = Math.floor(random() * TASK_TYPES.length)
        const values = new Map<number, number>()
        for (const field of TASK_TYPES[type].fields) {
          if (random() < 0.6) continue
          values.set(
            field,
            FIELDS[field].type === 'number'
              ? 1 + Math.floor(random() * 8)
              : Math.floor(random() * FIELDS[field].options.length)
          )
        }
        typed.set(taskKey(projectIndex, task.index), { type, values })
      }
      // Dated items among the unticked ones, a few days either side of today.
      for (let item = task.checked; item < task.checklist.length; item += 1) {
        if (random() < SCALE.datedChecklistShare)
          checklistDates.push([projectIndex, task.index, item, Math.floor(random() * 40) - 10])
      }
    }
  }

  // Links within a project, mostly on the two big ones, as the comments are.
  const links: PlannedExtras['links'] = []
  const linked = new Set<string>()
  while (links.length < SCALE.taskLinks) {
    const roll = random()
    const projectIndex =
      roll < 0.4 ? 0 : roll < 0.7 ? 1 : 2 + Math.floor(random() * (SCALE.projects - 2))
    const count = projects[projectIndex].tasks.length
    const from = Math.floor(random() * count)
    const to = Math.floor(random() * count)
    const kind = LINK_KINDS[Math.floor(random() * LINK_KINDS.length)]
    const pair = `${projectIndex}:${Math.min(from, to)}:${Math.max(from, to)}`
    if (from === to || linked.has(pair)) continue
    linked.add(pair)
    links.push([projectIndex, from, to, kind])
  }

  // Time blocks on working hours, from three weeks back to three ahead.
  const timeBlocks: PlannedExtras['timeBlocks'] = []
  for (let index = 0; index < SCALE.timeBlocks; index += 1) {
    const roll = random()
    const projectIndex =
      roll < 0.3 ? 0 : roll < 0.6 ? 1 : 2 + Math.floor(random() * (SCALE.projects - 2))
    timeBlocks.push([
      projectIndex,
      Math.floor(random() * projects[projectIndex].tasks.length),
      Math.floor(random() * 42) - 21,
      (8 + Math.floor(random() * 8)) * 60 + 15 * Math.floor(random() * 4),
      15 * (2 + Math.floor(random() * 7))
    ])
  }

  const costs: PlannedExtras['costs'] = []
  for (let index = 0; index < SCALE.costs; index += 1) {
    const projectIndex = Math.floor(random() * SCALE.projects)
    const onTask = random() < 0.5
    costs.push([
      projectIndex,
      onTask ? Math.floor(random() * projects[projectIndex].tasks.length) : null,
      Math.floor(random() * 240) - 180,
      100 * (5 + Math.floor(random() * 2_000)),
      `${pick(random, VERBS)} ${pick(random, NOUNS)}`,
      pick(random, COST_CATEGORIES),
      random() < 0.6
    ])
  }
  const budgets: PlannedExtras['budgets'] = []
  for (let projectIndex = 0; projectIndex < SCALE.projects; projectIndex += 5)
    budgets.push([projectIndex, 100 * (20_000 + Math.floor(random() * 80_000))])

  // One outside calendar: a weekday stand-up, then single events.
  const calendarEvents: PlannedCalendarEvent[] = [
    {
      title: 'Stand-up',
      dayOffset: -60,
      startMinute: 9 * 60 + 30,
      lengthMinutes: 15,
      weekdays: true
    }
  ]
  while (calendarEvents.length < SCALE.calendarEvents) {
    calendarEvents.push({
      title: pick(random, EVENT_TITLES),
      dayOffset: Math.floor(random() * 180) - 90,
      startMinute: (8 + Math.floor(random() * 9)) * 60 + 30 * Math.floor(random() * 2),
      lengthMinutes: 30 * (1 + Math.floor(random() * 4)),
      weekdays: false
    })
  }

  // Sidebar pins: the Board project's tasks due ahead, so the countdowns have dates.
  const pins: PlannedExtras['pins'] = []
  for (const task of projects[1].tasks) {
    if (pins.length >= SCALE.sidebarPins) break
    if (task.dueOffset !== null && task.dueOffset > 3 && task.parent === null)
      pins.push([1, task.index])
  }

  return {
    fields: FIELDS,
    taskTypes: TASK_TYPES,
    typed,
    checklistDates,
    links,
    timeBlocks,
    costs,
    budgets,
    calendarEvents,
    pins
  }
}

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)]
}

function sentence(random: () => number, words: number): string {
  const out: string[] = []
  for (let index = 0; index < words; index += 1) out.push(pick(random, WORDS))
  const text = out.join(' ')
  return `${text[0].toUpperCase()}${text.slice(1)}.`
}

function taskCount(projectIndex: number): number {
  if (projectIndex === 0) return SCALE.listProjectTasks
  if (projectIndex === 1) return SCALE.boardProjectTasks
  return SCALE.otherProjectTasks
}

function projectName(projectIndex: number): string {
  if (projectIndex === 0) return LIST_PROJECT_NAME
  if (projectIndex === 1) return BOARD_PROJECT_NAME
  return `Scale project ${String(projectIndex + 1).padStart(2, '0')}`
}

/** Builds the whole plan from one seed. */
export function buildScalePlan(seed = 9_1): ScalePlan {
  const random = seededRandom(seed)
  const people = Array.from({ length: SCALE.people }, (_, index) => `Person ${index + 1}`)
  const projects: PlannedProject[] = []
  for (let projectIndex = 0; projectIndex < SCALE.projects; projectIndex += 1) {
    const count = taskCount(projectIndex)
    const tasks: PlannedTask[] = []
    for (let index = 0; index < count; index += 1) {
      const checklistLength = random() < 0.4 ? 1 + Math.floor(random() * 4) : 0
      const checklist = Array.from(
        { length: checklistLength },
        (_, item) => `Step ${item + 1}: ${pick(random, VERBS).toLowerCase()} ${pick(random, NOUNS)}`
      )
      // Subtasks hang off an earlier task that is not itself a subtask.
      let parent: number | null = null
      if (index > 10 && random() < 0.1) {
        const candidate = Math.floor(random() * index)
        if (tasks[candidate].parent === null) parent = candidate
      }
      // Dependencies link top-level tasks only (a subtask may depend only on
      // its siblings, which this plan leaves alone).
      const dependsOn: number[] = []
      if (parent === null && index > 5 && random() < 0.15) {
        for (let tries = 0; tries < (random() < 0.3 ? 2 : 1); tries += 1) {
          const candidate = Math.floor(random() * index)
          if (tasks[candidate].parent === null && !dependsOn.includes(candidate))
            dependsOn.push(candidate)
        }
      }
      const hasDates = random() < 0.7
      const startOffset = hasDates ? Math.floor(random() * 180) - 120 : null
      tasks.push({
        index,
        title: `${pick(random, VERBS)} ${pick(random, NOUNS)} #${index + 1}`,
        description: random() < 0.5 ? sentence(random, 12 + Math.floor(random() * 30)) : '',
        priority: pick(random, PRIORITIES),
        labels: random() < 0.6 ? [pick(random, LABELS)] : [],
        checklist,
        checked: Math.floor(random() * (checklistLength + 1)),
        assignee: random() < 0.75 ? Math.floor(random() * SCALE.people) : null,
        startOffset,
        dueOffset: startOffset === null ? null : startOffset + 1 + Math.floor(random() * 30),
        milestone: random() < 0.6 ? Math.floor(random() * SCALE.milestonesPerProject) : null,
        dependsOn,
        parent,
        path: [],
        firstStatus: 'backlog'
      })
    }
    projects.push({
      name: projectName(projectIndex),
      withFolder: projectIndex >= 2 && projectIndex < 2 + SCALE.projectsWithFolders,
      tasks
    })
  }

  // Status changes, spread over every task in proportion: each task walks
  // forward through the statuses (with the odd step back), so lead and cycle
  // times come out as real workflows would.
  const allTasks = projects.flatMap((project) => project.tasks)
  for (let change = 0; change < SCALE.statusChanges; change += 1) {
    const task = allTasks[change % allTasks.length]
    const current = task.path.length > 0 ? task.path[task.path.length - 1] : task.firstStatus
    const position = STATUSES.indexOf(current)
    const back = random() < 0.12 && position > 0
    const next = back
      ? STATUSES[position - 1]
      : STATUSES[Math.min(STATUSES.length - 1, position + 1 + (random() < 0.2 ? 1 : 0))]
    task.path.push(next === current ? STATUSES[Math.max(0, position - 1)] : next)
  }

  const comments: ScalePlan['comments'] = []
  for (let index = 0; index < SCALE.comments; index += 1) {
    // Half the comments land on the two big projects, the rest anywhere.
    const projectIndex =
      index % 2 === 0 ? (index % 4 === 0 ? 0 : 1) : Math.floor(random() * SCALE.projects)
    const taskIndex = Math.floor(random() * projects[projectIndex].tasks.length)
    comments.push([projectIndex, taskIndex, sentence(random, 6 + Math.floor(random() * 25))])
  }

  const libraryItems: ScalePlan['libraryItems'] = []
  for (let index = 0; index < SCALE.libraryItems; index += 1) {
    const paragraphs = Array.from({ length: 3 + Math.floor(random() * 6) }, () =>
      sentence(random, 20 + Math.floor(random() * 40))
    )
    libraryItems.push([
      index % SCALE.projects,
      `Note ${index + 1}: ${pick(random, NOUNS)}`,
      paragraphs.join('\n\n')
    ])
  }

  const viewTypes = ['board', 'list', 'calendar', 'timeline'] as const
  const savedViews: ScalePlan['savedViews'] = []
  for (let index = 0; index < SCALE.savedViews; index += 1) {
    savedViews.push([
      index % 10,
      `Saved view ${index + 1}`,
      viewTypes[index % viewTypes.length],
      pick(random, NOUNS).split(' ').pop() ?? ''
    ])
  }

  const extras = buildExtras(projects, seed + 17)
  return { people, projects, comments, libraryItems, savedViews, extras }
}
