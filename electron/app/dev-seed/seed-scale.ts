import { shiftIsoDate, todayIsoDate } from '@shared/dates'
import type { PlanningActor, PlanningWorkItem, WatchedProject } from '@shared/ostler-api'
import type { PlanningService } from '../../services/planning-service'
import type { PeopleService } from '../../services/people-service'
import type { LibraryService } from '../../services/library-service'
import type { ProjectPackageService } from '../../services/project-package-service'
import type { TimeBlockService } from '../../services/time-block-service'
import type { OutsideCalendarService } from '../../services/outside-calendar-service'
import {
  SCALE,
  buildScalePlan,
  seededRandom,
  taskKey,
  type PlannedCalendarEvent
} from './scale-plan'

/**
 * The scale dataset's writer (P9.1, `npm run seed:scale`). Development only:
 * `main.ts` runs it when `OSTLER_SEED_SCALE=1` and refuses that flag in a
 * packaged build. Everything goes through the services, so the search index,
 * activity and field history are the real thing; projects are created the
 * way the New project wizard creates them, folders included.
 */
export interface SeedTargets {
  planning: PlanningService
  people: PeopleService
  library: LibraryService
  packages: ProjectPackageService
  timeBlocks: TimeBlockService
  calendars: OutsideCalendarService
  /** Where the scratch Git folders go: `C:\temp\ostler-roadmap\projects\<data name>`. */
  projectsParent: string
  log(message: string): void
}

const DAY_MS = 24 * 60 * 60 * 1000

/** "20261019T093000": an `.ics` local time, `minute` minutes into `isoDate`. */
function icsTime(isoDate: string, minute: number): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${isoDate.replaceAll('-', '')}T${pad(Math.floor(minute / 60))}${pad(minute % 60)}00`
}

/** The plan's outside calendar as `.ics` text, its days counted from `today`. */
export function calendarText(events: PlannedCalendarEvent[], today: string): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ostler//Scale dataset//EN']
  for (const [index, event] of events.entries()) {
    const day = shiftIsoDate(today, event.dayOffset)
    lines.push(
      'BEGIN:VEVENT',
      `UID:scale-${index + 1}`,
      `SUMMARY:${event.title}`,
      `DTSTART:${icsTime(day, event.startMinute)}`,
      `DTEND:${icsTime(day, event.startMinute + event.lengthMinutes)}`,
      ...(event.weekdays ? ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'] : []),
      'END:VEVENT'
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export async function seedScaleDataset(targets: SeedTargets, now = Date.now()): Promise<void> {
  const { planning, people, library, packages, timeBlocks, calendars, log } = targets
  const existing = (
    planning.database.prepare('SELECT COUNT(*) AS n FROM planning_work_items').get() as {
      n: number
    }
  ).n
  if (existing > 0) throw new Error('This data folder already has tasks. Seed a fresh one.')

  const plan = buildScalePlan()
  const random = seededRandom(42)
  const today = todayIsoDate()
  const started = Date.now()

  people.ensureMe('Scale tester')
  const personIds = plan.people.map((name) => people.create({ name }).id)
  const actor: PlanningActor = planning.humanActor()

  // Projects, through the wizard's own path; five get a new Git folder.
  const projects: WatchedProject[] = []
  for (const [index, planned] of plan.projects.entries()) {
    const result = await packages.createProjectWithRecords(
      {
        name: planned.name,
        color: '',
        tags: ['scale'],
        notes: '',
        folder: planned.withFolder
          ? {
              kind: 'new',
              parentPath: targets.projectsParent,
              folderName: `scale-${String(index + 1).padStart(2, '0')}`,
              initGit: true,
              addReadme: true,
              gitignore: 'general',
              initialCommit: true
            }
          : null
      },
      'points',
      () => []
    )
    projects.push(result.project)
  }
  log(`${projects.length} projects`)

  // Tasks, with milestones, then each task's status walk. One transaction
  // per project keeps the seeding to minutes rather than hours.
  const db = planning.database
  const { extras } = plan
  const taskIds: string[][] = []
  const statusRows: Array<{ id: string; at: number[] }> = []
  for (const [projectIndex, planned] of plan.projects.entries()) {
    const projectId = projects[projectIndex].id
    const ids: string[] = []
    db.transaction(() => {
      const milestones = Array.from({ length: SCALE.milestonesPerProject }, (_, index) =>
        planning.createMilestone(projectId, {
          name: `Milestone ${index + 1}`,
          targetDate: shiftIsoDate(today, -60 + index * 45)
        })
      )
      // The project's fields, then its types, each showing some of them.
      const fields = extras.fields.map((field) =>
        planning.createField(projectId, {
          name: field.name,
          type: field.type,
          options: field.options.map((name) => ({ name }))
        })
      )
      const types = extras.taskTypes.map((type) =>
        planning.taskTypes.create(projectId, {
          name: type.name,
          icon: type.icon,
          fieldIds: type.fields.map((index) => fields[index].id)
        })
      )
      for (const task of planned.tasks) {
        const typed = extras.typed.get(taskKey(projectIndex, task.index))
        const fieldValues = typed
          ? Object.fromEntries(
              [...typed.values].map(([index, value]) => [
                fields[index].id,
                fields[index].type === 'number' ? value : fields[index].options[value].id
              ])
            )
          : undefined
        const item: PlanningWorkItem = planning.createWorkItem(
          projectId,
          {
            title: task.title,
            description: task.description,
            priority: task.priority,
            labels: task.labels,
            acceptanceCriteria: task.checklist,
            dependencyIds: task.dependsOn.map((index) => ids[index]),
            startDate: task.startOffset === null ? null : shiftIsoDate(today, task.startOffset),
            targetDate: task.dueOffset === null ? null : shiftIsoDate(today, task.dueOffset),
            assigneeId: task.assignee === null ? null : personIds[task.assignee],
            milestoneId: task.milestone === null ? null : milestones[task.milestone].id,
            parentWorkItemId: task.parent === null ? null : ids[task.parent],
            subtaskPhaseNumber: task.parent === null ? undefined : 1,
            status: task.firstStatus,
            typeId: typed ? types[typed.type].id : undefined,
            fieldValues
          },
          actor
        )
        ids.push(item.id)
        for (const text of task.checklist.slice(0, task.checked)) {
          planning.setChecklistItemChecked(item.id, text, true, actor)
        }
        for (const status of task.path) planning.updateWorkItem(item.id, { status }, actor)
      }
    })()
    taskIds.push(ids)
    log(`${planned.name}: ${planned.tasks.length} tasks`)
  }

  // Back-dating, and only here (P9.1): the services stamp every row with the
  // time it is written, so the seeder rewrites the timestamps of the rows it
  // just wrote, to spread each task's history over the last 180 days. Lead
  // time, cycle time, reports and activity then read like months of use.
  const historyStart = now - SCALE.historyDays * DAY_MS
  const historyRows = db.prepare(
    'SELECT sequence FROM planning_status_history WHERE work_item_id = ? ORDER BY sequence'
  )
  const setHistoryAt = db.prepare('UPDATE planning_status_history SET at = ? WHERE sequence = ?')
  const setCreatedAt = db.prepare(
    'UPDATE planning_work_items SET created_at = ?, updated_at = ? WHERE id = ?'
  )
  const setChangesAt = db.prepare(
    'UPDATE planning_field_changes SET at = ? WHERE work_item_id = ? AND at >= ?'
  )
  db.transaction(() => {
    for (const ids of taskIds) {
      for (const id of ids) {
        const rows = historyRows.all(id) as Array<{ sequence: number }>
        const created = historyStart + Math.floor(random() * (SCALE.historyDays - 10) * DAY_MS)
        let at = created
        const stamps: number[] = []
        for (const row of rows) {
          setHistoryAt.run(at, row.sequence)
          stamps.push(at)
          at = Math.min(now - 60_000, at + Math.floor(random() * 6 * DAY_MS) + 60_000)
        }
        setCreatedAt.run(created, stamps[stamps.length - 1] ?? created, id)
        setChangesAt.run(created, id, started)
        statusRows.push({ id, at: stamps })
      }
    }
  })()
  const changes = statusRows.reduce((sum, row) => sum + Math.max(0, row.at.length - 1), 0)
  log(`${changes} status changes over ${SCALE.historyDays} days`)

  db.transaction(() => {
    for (const [projectIndex, taskIndex, body] of plan.comments) {
      planning.addComment(taskIds[projectIndex][taskIndex], body, actor)
    }
  })()
  log(`${plan.comments.length} comments`)

  for (const [projectIndex, title, body] of plan.libraryItems) {
    library.createItem(projects[projectIndex].id, { kind: 'note', title, body })
  }
  log(`${plan.libraryItems.length} Library items`)

  for (const [projectIndex, name, viewType, query] of plan.savedViews) {
    planning.views.create(projects[projectIndex].id, {
      name,
      viewType,
      config: { filter: { match: 'all', conditions: [] }, query, options: {} }
    })
  }
  log(`${plan.savedViews.length} saved views`)

  // What later work added to tasks and around them: dated checklist
  // items, links with kinds, time blocks, costs and budgets, an outside
  // calendar, and sidebar pins with countdowns.
  const projectIdOf = (projectIndex: number) => projects[projectIndex].id
  const taskOf = (projectIndex: number, taskIndex: number) => taskIds[projectIndex][taskIndex]
  db.transaction(() => {
    for (const [projectIndex, taskIndex, item, offset] of extras.checklistDates) {
      const text = plan.projects[projectIndex].tasks[taskIndex].checklist[item]
      planning.setChecklistItemDetails(
        taskOf(projectIndex, taskIndex),
        text,
        { dueDate: shiftIsoDate(today, offset) },
        actor
      )
    }
  })()
  log(`${extras.checklistDates.length} dated checklist items`)

  db.transaction(() => {
    for (const [projectIndex, from, to, kind] of extras.links) {
      planning.addWorkItemLink(taskOf(projectIndex, from), taskOf(projectIndex, to), kind, actor)
    }
  })()
  log(`${extras.links.length} task links`)

  db.transaction(() => {
    for (const [projectIndex, taskIndex, offset, startMinute, lengthMinutes] of extras.timeBlocks) {
      timeBlocks.create(
        {
          workItemId: taskOf(projectIndex, taskIndex),
          date: shiftIsoDate(today, offset),
          startMinute,
          lengthMinutes
        },
        projectIdOf(projectIndex)
      )
    }
  })()
  log(`${extras.timeBlocks.length} time blocks`)

  db.transaction(() => {
    for (const [projectIndex, amount] of extras.budgets) {
      planning.costs.setBudget(projectIdOf(projectIndex), { amount, currency: 'GBP' })
    }
    for (const [
      projectIndex,
      taskIndex,
      offset,
      amount,
      description,
      category,
      paid
    ] of extras.costs) {
      planning.costs.create(projectIdOf(projectIndex), {
        date: shiftIsoDate(today, offset),
        amount,
        description,
        category,
        workItemId: taskIndex === null ? undefined : taskOf(projectIndex, taskIndex),
        state: paid ? 'paid' : 'planned'
      })
    }
  })()
  log(`${extras.costs.length} costs, ${extras.budgets.length} budgets`)

  calendars.addText({ name: 'Scale calendar', text: calendarText(extras.calendarEvents, today) })
  log(`${extras.calendarEvents.length} calendar events`)

  for (const [index, [projectIndex, taskIndex]] of extras.pins.entries()) {
    const pin = planning.pins.create({
      place: 'sidebar',
      kind: 'task',
      targetId: taskOf(projectIndex, taskIndex)
    })
    if (index < SCALE.countdowns) planning.pins.setCountdown(pin.id, { countdown: true })
  }
  log(`${extras.pins.length} sidebar pins`)
  log(`Seeded in ${Math.round((Date.now() - started) / 1000)} s`)
}
