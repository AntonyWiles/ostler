import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRAND } from '../../src/shared/brand'
import { t } from '../../src/shared/i18n'
import { itemLinkUrl } from '../../src/shared/item-links'
import type { QuickAddContext } from '../../src/shared/quick-add'
import { isRefusal } from '../../src/shared/refusal'
import type { WhiteboardObjectInput } from '../../src/shared/whiteboard/model'
import {
  WHITEBOARD_TASKS_MAX,
  whiteboardTaskDrafts,
  type MakeWhiteboardTasksInput,
  type WhiteboardTaskDraft
} from '../../src/shared/whiteboard/tasks'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { LibraryService } = await import('../../electron/services/library-service')
const { PlanningService } = await import('../../electron/services/planning-service')
const { makeWhiteboardTasks, undoWhiteboardTasks } =
  await import('../../electron/ipc/whiteboard-tasks-handlers')

/**
 * Make tasks from a whiteboard in main (plan `docs/plans/whiteboards/`, prompt 13, D17): against
 * a real database, as `note-line-tasks.test.ts` tests Make a task from a line.
 */

const PROJECT = '10000000-0000-4000-8000-000000000001'
const OTHER = '10000000-0000-4000-8000-000000000002'

const CONTEXT: QuickAddContext = {
  today: '2026-10-14',
  locale: 'en-NZ',
  people: [],
  labels: ['admin'],
  projects: []
}

const tempDir = useTempDir('ostler-whiteboard-tasks-')
let library: InstanceType<typeof LibraryService>
let planning: InstanceType<typeof PlanningService>

beforeEach(async () => {
  const dbPath = await createMigratedDatabase(tempDir())
  library = new LibraryService(dbPath, tempDir())
  planning = new PlanningService(dbPath, () => [PROJECT, OTHER])
})

afterEach(() => {
  library.close()
  planning.close()
})

const note = (id: string, text: string, x = 0, y = 0, link: string | null = null) =>
  ({
    id,
    kind: 'note',
    x,
    y,
    width: 200,
    height: 200,
    z: 0,
    colour: 'yellow',
    text,
    link,
    groupId: null,
    data: { textSize: 'medium' }
  }) as WhiteboardObjectInput

const taskUrl = (id: string, projectId = PROJECT) =>
  itemLinkUrl({ kind: 'task', projectId, id }, BRAND.urlScheme)

function board(objects: WhiteboardObjectInput[]) {
  return library.whiteboards.create(PROJECT, { title: 'Party', objects })
}

/** The board's objects by id, as stored. */
function stored(whiteboardId: string) {
  return new Map(
    library.whiteboards.listObjects(PROJECT, whiteboardId).map((object) => [object.id, object])
  )
}

function refusal(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    expect(isRefusal(error)).toBe(true)
    return (error as Error).message
  }
  throw new Error('Expected a refusal')
}

describe('makeWhiteboardTasks', () => {
  it('makes one task per object, in the milestone, with the whiteboard as source', () => {
    const { item, objects } = board([
      note('a', 'Call the venue tomorrow !high\nask about parking'),
      note('b', 'Order the cake #admin', 400, 0)
    ])
    const milestone = planning.createMilestone(PROJECT, { name: 'The party' })
    const result = makeWhiteboardTasks(planning, library, PROJECT, {
      whiteboardId: item.id,
      milestoneId: milestone.id,
      tasks: whiteboardTaskDrafts(objects, CONTEXT)
    })
    expect(result.made.map((entry) => entry.objectId)).toEqual(['a', 'b'])
    const [first, second] = result.made.map((entry) => planning.getWorkItem(entry.taskId))
    expect(first).toMatchObject({
      projectId: PROJECT,
      title: 'Call the venue',
      description: 'ask about parking',
      priority: 'high',
      targetDate: '2026-10-15',
      milestoneId: milestone.id,
      status: 'backlog'
    })
    expect(second).toMatchObject({ title: 'Order the cake', milestoneId: milestone.id })
    expect(second.labels).toEqual(['admin'])
    for (const task of [first, second]) {
      const sources = library.listWorkItemSources(PROJECT, task.id)
      expect(sources.map((source) => source.item.id)).toEqual([item.id])
    }
    // The editor links the objects; main leaves the board as it was.
    expect([...stored(item.id).values()].map((object) => object.link)).toEqual([null, null])
  })

  it('makes tasks with no milestone', () => {
    const { item, objects } = board([note('a', 'Call the venue')])
    const result = makeWhiteboardTasks(planning, library, PROJECT, {
      whiteboardId: item.id,
      milestoneId: null,
      tasks: whiteboardTaskDrafts(objects, CONTEXT)
    })
    expect(planning.getWorkItem(result.made[0].taskId).milestoneId).toBeNull()
  })

  describe('refuses, making nothing', () => {
    const draft = (objectId: string): WhiteboardTaskDraft => ({
      objectId,
      title: 'A task',
      description: '',
      labels: [],
      assigneeId: null,
      priority: null,
      dueDate: null
    })

    const refuses = (input: MakeWhiteboardTasksInput, message: string) => {
      expect(refusal(() => makeWhiteboardTasks(planning, library, PROJECT, input))).toBe(message)
      expect(planning.listWorkItems(PROJECT)).toHaveLength(0)
    }

    it('something that is not a whiteboard', () => {
      const written = library.createItem(PROJECT, { kind: 'note', title: 'Notes', body: 'x' })
      refuses(
        { whiteboardId: written.id, milestoneId: null, tasks: [draft('a')] },
        t('errors:whiteboard.notAWhiteboard')
      )
    })

    it('an archived whiteboard', () => {
      const { item } = board([note('a', 'Call')])
      library.archiveItem(PROJECT, item.id)
      refuses(
        { whiteboardId: item.id, milestoneId: null, tasks: [draft('a')] },
        t('errors:whiteboard.tasks.archived')
      )
    })

    it('no tasks', () => {
      const { item } = board([note('a', 'Call')])
      refuses(
        { whiteboardId: item.id, milestoneId: null, tasks: [] },
        t('errors:whiteboard.tasks.nothingToMake')
      )
    })

    it('more than the maximum', () => {
      const { item } = board([note('a', 'Call')])
      refuses(
        {
          whiteboardId: item.id,
          milestoneId: null,
          tasks: Array.from({ length: WHITEBOARD_TASKS_MAX + 1 }, () => draft('a'))
        },
        t('errors:whiteboard.tasks.tooMany', { max: WHITEBOARD_TASKS_MAX })
      )
    })

    it('an object that is not on the stored board', () => {
      const { item } = board([note('a', 'Call')])
      refuses(
        { whiteboardId: item.id, milestoneId: null, tasks: [draft('unsaved')] },
        t('errors:whiteboard.tasks.badObject')
      )
    })

    it('an object given twice', () => {
      const { item } = board([note('a', 'Call')])
      refuses(
        { whiteboardId: item.id, milestoneId: null, tasks: [draft('a'), draft('a')] },
        t('errors:whiteboard.tasks.badObject')
      )
    })

    it('an object that cannot make a task', () => {
      const { item } = board([
        note('linked', 'Call', 0, 0, taskUrl('20000000-0000-4000-8000-000000000009')),
        note('empty', '  ', 400, 0)
      ])
      for (const id of ['linked', 'empty']) {
        refuses(
          { whiteboardId: item.id, milestoneId: null, tasks: [draft(id)] },
          t('errors:whiteboard.tasks.badObject')
        )
      }
    })

    it('a milestone that is complete, archived, unknown or another project’s', () => {
      const { item } = board([note('a', 'Call')])
      const complete = planning.createMilestone(PROJECT, { name: 'Done' })
      planning.updateMilestone(complete.id, { status: 'complete' })
      const archived = planning.createMilestone(PROJECT, { name: 'Old' })
      planning.updateMilestone(archived.id, { status: 'archived' })
      const elsewhere = planning.createMilestone(OTHER, { name: 'Theirs' })
      for (const milestoneId of [complete.id, archived.id, elsewhere.id, 'nope']) {
        refuses(
          { whiteboardId: item.id, milestoneId, tasks: [draft('a')] },
          t('errors:whiteboard.tasks.badMilestone')
        )
      }
    })
  })
})

describe('undoWhiteboardTasks', () => {
  it('deletes the tasks and clears exactly the links that pointed at them', () => {
    const { item, objects } = board([
      note('a', 'Call the venue'),
      note('b', 'Order the cake', 400, 0),
      note('keep', 'Keep me', 800, 0)
    ])
    const result = makeWhiteboardTasks(planning, library, PROJECT, {
      whiteboardId: item.id,
      milestoneId: null,
      tasks: whiteboardTaskDrafts(objects.slice(0, 2), CONTEXT)
    })
    // The editor links the two objects; another links to an older task.
    const older = planning.createWorkItem(PROJECT, { title: 'Older' }, planning.humanActor())
    const linkOf = new Map(result.made.map((entry) => [entry.objectId, taskUrl(entry.taskId)]))
    linkOf.set('keep', taskUrl(older.id))
    library.whiteboards.save(PROJECT, item.id, {
      upserts: objects.map((object) => ({ ...object, link: linkOf.get(object.id) ?? null })),
      deletes: []
    })

    undoWhiteboardTasks(planning, library, PROJECT, {
      whiteboardId: item.id,
      taskIds: result.made.map((entry) => entry.taskId)
    })

    expect(planning.listWorkItems(PROJECT).map((task) => task.id)).toEqual([older.id])
    const after = stored(item.id)
    expect(after.get('a')?.link).toBeNull()
    expect(after.get('b')?.link).toBeNull()
    expect(after.get('keep')?.link).toBe(taskUrl(older.id))
    // The outline is rewritten from the objects as saved.
    expect(library.getItem(PROJECT, item.id).body).not.toContain(result.made[0].taskId)
  })

  it('works after the board was closed: nothing but the stored board is needed', () => {
    const { item, objects } = board([note('a', 'Call the venue')])
    const result = makeWhiteboardTasks(planning, library, PROJECT, {
      whiteboardId: item.id,
      milestoneId: null,
      tasks: whiteboardTaskDrafts(objects, CONTEXT)
    })
    library.whiteboards.save(PROJECT, item.id, {
      upserts: [{ ...objects[0], link: taskUrl(result.made[0].taskId) }],
      deletes: []
    })
    undoWhiteboardTasks(planning, library, PROJECT, {
      whiteboardId: item.id,
      taskIds: [result.made[0].taskId]
    })
    expect(planning.listWorkItems(PROJECT)).toHaveLength(0)
    expect(stored(item.id).get('a')?.link).toBeNull()
  })

  it('leaves a task of another project, and the link to it, alone', () => {
    const theirs = planning.createWorkItem(OTHER, { title: 'Theirs' }, planning.humanActor())
    const { item } = board([note('a', 'Linked', 0, 0, taskUrl(theirs.id, OTHER))])
    undoWhiteboardTasks(planning, library, PROJECT, {
      whiteboardId: item.id,
      taskIds: [theirs.id]
    })
    expect(planning.getWorkItem(theirs.id).title).toBe('Theirs')
    expect(stored(item.id).get('a')?.link).toBe(taskUrl(theirs.id, OTHER))
  })
})
