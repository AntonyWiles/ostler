import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRAND } from '../../src/shared/brand'
import {
  lineTaskDrafts,
  rewriteLinesAsLinks,
  selectedLineRange
} from '../../src/shared/note-line-tasks'
import type { QuickAddContext } from '../../src/shared/quick-add'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { LibraryService } = await import('../../electron/services/library-service')
const { PlanningService } = await import('../../electron/services/planning-service')
const { makeLineTasks, undoLineTasks } = await import('../../electron/ipc/line-tasks-handlers')

const CONTEXT: QuickAddContext = {
  today: '2026-10-14',
  locale: 'en-NZ',
  people: [{ id: 'sam', name: 'Sam' }],
  labels: ['admin'],
  projects: []
}

describe('lineTaskDrafts', () => {
  const body = [
    '# Venue',
    '- call the venue about parking #Admin !high',
    '',
    '* [ ] send @Sam the draft',
    '  1. book the room friday',
    '- [x] done already'
  ].join('\n')

  it('makes a task from each non-empty line, dropping list markers and check boxes', () => {
    const drafts = lineTaskDrafts(body, 1, 4, 'each', CONTEXT)
    expect(drafts.map((draft) => [draft.line, draft.title])).toEqual([
      [1, 'call the venue about parking'],
      [3, 'send the draft'],
      [4, 'book the room']
    ])
  })

  it('reads each line with quick add', () => {
    const [first, second, third] = lineTaskDrafts(body, 1, 4, 'each', CONTEXT)
    expect(first.labels).toEqual(['admin'])
    expect(first.priority).toBe('high')
    expect(second.assigneeId).toBe('sam')
    expect(third.dueDate).toMatch(/^2026-10-1[0-9]$/)
  })

  it('assigns a line that names nobody to Me, as quick add does', () => {
    const withMe: QuickAddContext = {
      ...CONTEXT,
      people: [...CONTEXT.people, { id: 'me', name: 'Robin', isMe: true }]
    }
    const [first, second, third] = lineTaskDrafts(body, 1, 4, 'each', withMe)
    expect(first.assigneeId).toBe('me')
    expect(second.assigneeId).toBe('sam')
    expect(third.assigneeId).toBe('me')
    expect(lineTaskDrafts(body, 1, 5, 'one', withMe)[0].assigneeId).toBe('me')
    // With nobody set as Me, nobody, as quick add.
    expect(lineTaskDrafts(body, 1, 1, 'each', CONTEXT)[0].assigneeId).toBeNull()
  })

  it('makes one task: the first line the title, the rest the description', () => {
    const drafts = lineTaskDrafts(body, 1, 5, 'one', CONTEXT)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      line: 1,
      title: 'call the venue about parking',
      description: 'send @Sam the draft\nbook the room friday\ndone already'
    })
  })

  it('skips a line that is already a link to an item', () => {
    const linked = `- [Call](${BRAND.urlScheme}://task/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002)\n- next`
    expect(lineTaskDrafts(linked, 0, 1, 'each', CONTEXT).map((draft) => draft.line)).toEqual([1])
  })

  it('finds the lines a selection touches', () => {
    const text = 'one\ntwo\nthree'
    expect(selectedLineRange(text, 0, 0)).toEqual({ from: 0, to: 0 })
    expect(selectedLineRange(text, 5, 10)).toEqual({ from: 1, to: 2 })
    // Ending just after a line break ends on the line before.
    expect(selectedLineRange(text, 0, 4)).toEqual({ from: 0, to: 0 })
  })
})

describe('rewriteLinesAsLinks', () => {
  it('keeps indentation, markers, check boxes and words', () => {
    const body = 'Intro\r\n  - [ ] call [venue] #admin\r\n1. send draft'
    const result = rewriteLinesAsLinks(body, [
      { line: 1, url: 'ostler://task/p/a' },
      { line: 2, url: 'ostler://task/p/b' }
    ])
    expect(result).toBe(
      'Intro\r\n  - [ ] [call \\[venue\\] #admin](ostler://task/p/a)\r\n1. [send draft](ostler://task/p/b)'
    )
  })
})

describe('makeLineTasks and undoLineTasks', () => {
  const PROJECT = '10000000-0000-4000-8000-000000000001'
  const tempDir = useTempDir('ostler-line-tasks-')
  let library: InstanceType<typeof LibraryService>
  let planning: InstanceType<typeof PlanningService>

  beforeEach(async () => {
    const dbPath = await createMigratedDatabase(tempDir())
    library = new LibraryService(dbPath, tempDir())
    planning = new PlanningService(dbPath, () => [PROJECT])
  })

  afterEach(() => {
    library.close()
    planning.close()
  })

  function note(body: string) {
    return library.createItem(PROJECT, { kind: 'note', title: 'Venue notes', body })
  }

  it('makes the tasks, links the lines and records the note as source at its new revision', () => {
    const item = note('Plan\n- call the venue #admin\n- send the draft')
    const drafts = lineTaskDrafts(item.body, 1, 2, 'each', CONTEXT)
    const result = makeLineTasks(planning, library, PROJECT, {
      itemId: item.id,
      revision: item.revision,
      body: item.body,
      tasks: drafts
    })
    expect(result.taskIds).toHaveLength(2)
    expect(result.item.revision).toBe(item.revision + 1)
    const [first, second] = result.taskIds.map((id) => planning.getWorkItem(id))
    expect(first.title).toBe('call the venue')
    expect(first.labels).toEqual(['admin'])
    expect(first.status).toBe('backlog')
    expect(result.item.body).toBe(
      `Plan\n- [call the venue #admin](${BRAND.urlScheme}://task/${PROJECT}/${first.id})\n` +
        `- [send the draft](${BRAND.urlScheme}://task/${PROJECT}/${second.id})`
    )
    const sources = library.listWorkItemSources(PROJECT, first.id)
    expect(sources).toHaveLength(1)
    expect(sources[0].revisionAtLink).toBe(result.item.revision)
    // N4.4a's index sees the new links.
    expect(planning.listLinkedFrom('task', first.id).length).toBe(1)
  })

  it('refuses when the note changed after the lines were selected', () => {
    const item = note('- one')
    library.updateItem(PROJECT, item.id, { body: '- one\n- two' })
    expect(() =>
      makeLineTasks(planning, library, PROJECT, {
        itemId: item.id,
        revision: item.revision,
        body: item.body,
        tasks: lineTaskDrafts(item.body, 0, 0, 'each', CONTEXT)
      })
    ).toThrow(/changed since you selected/)
    expect(planning.listWorkItems(PROJECT)).toHaveLength(0)
  })

  it('refuses a line that is not in the text', () => {
    const item = note('- one')
    expect(() =>
      makeLineTasks(planning, library, PROJECT, {
        itemId: item.id,
        revision: item.revision,
        body: item.body,
        tasks: [{ ...lineTaskDrafts(item.body, 0, 0, 'each', CONTEXT)[0], line: 4 }]
      })
    ).toThrow()
    expect(planning.listWorkItems(PROJECT)).toHaveLength(0)
  })

  it('one undo removes the tasks and puts the text back', () => {
    const item = note('- one\n- two')
    const result = makeLineTasks(planning, library, PROJECT, {
      itemId: item.id,
      revision: item.revision,
      body: item.body,
      tasks: lineTaskDrafts(item.body, 0, 1, 'each', CONTEXT)
    })
    const restored = undoLineTasks(planning, library, PROJECT, {
      itemId: item.id,
      taskIds: result.taskIds,
      revision: result.item.revision,
      body: item.body
    })
    expect(restored.body).toBe('- one\n- two')
    expect(planning.listWorkItems(PROJECT)).toHaveLength(0)
  })

  it('refuses the undo, changing nothing, once the note was saved again', () => {
    const item = note('- one')
    const result = makeLineTasks(planning, library, PROJECT, {
      itemId: item.id,
      revision: item.revision,
      body: item.body,
      tasks: lineTaskDrafts(item.body, 0, 0, 'each', CONTEXT)
    })
    library.updateItem(PROJECT, item.id, { body: `${result.item.body}\nmore` })
    expect(() =>
      undoLineTasks(planning, library, PROJECT, {
        itemId: item.id,
        taskIds: result.taskIds,
        revision: result.item.revision,
        body: item.body
      })
    ).toThrow()
    expect(planning.listWorkItems(PROJECT)).toHaveLength(1)
  })
})
