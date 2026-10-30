import { describe, expect, it } from 'vitest'
import { BRAND } from '../../src/shared/brand'
import type { QuickAddContext } from '../../src/shared/quick-add'
import { LINE_TASKS_MAX } from '../../src/shared/note-line-tasks'
import {
  defaultObject,
  type MindmapObject,
  type WhiteboardObjectInput
} from '../../src/shared/whiteboard/model'
import {
  isTaskableObject,
  WHITEBOARD_TASKS_MAX,
  whiteboardTaskDrafts,
  whiteboardTaskSkip
} from '../../src/shared/whiteboard/tasks'

/** Make tasks from a whiteboard (plan `docs/plans/whiteboards/`, prompt 13, D17). */

const CONTEXT: QuickAddContext = {
  today: '2026-10-14',
  locale: 'en-NZ',
  people: [
    { id: 'sam', name: 'Sam' },
    { id: 'me', name: 'Robin', isMe: true }
  ],
  labels: ['admin'],
  projects: []
}

const TASK_LINK = `${BRAND.urlScheme}://task/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002`

function object(
  kind: 'note' | 'text' | 'shape' | 'frame',
  id: string,
  text: string,
  x = 0,
  y = 0
): WhiteboardObjectInput {
  return { ...defaultObject(kind, { id, x, y, z: 0 }), text }
}

function node(id: string, text: string, x = 0, y = 0): MindmapObject {
  return {
    id,
    kind: 'mindmap',
    x,
    y,
    width: 160,
    height: 48,
    z: 0,
    colour: 'blue',
    text,
    link: null,
    groupId: null,
    data: { parentId: null, order: 0, textSize: 'medium' }
  }
}

describe('isTaskableObject', () => {
  it('takes notes, shapes and mind-map nodes with words and no link', () => {
    expect(isTaskableObject(object('note', 'a', 'Call the venue'))).toBe(true)
    expect(isTaskableObject(object('shape', 'b', 'Book a room'))).toBe(true)
    expect(isTaskableObject(node('c', 'Plan the menu'))).toBe(true)
  })

  it('says why the others are left out', () => {
    expect(whiteboardTaskSkip(object('text', 'a', 'Heading'))).toBe('kind')
    expect(whiteboardTaskSkip(object('frame', 'b', 'Week one'))).toBe('kind')
    expect(whiteboardTaskSkip(object('note', 'c', '  \n\t '))).toBe('noText')
    expect(whiteboardTaskSkip(object('shape', 'd', ''))).toBe('noText')
    // A list marker alone has no words, as for Make a task from a line.
    expect(whiteboardTaskSkip(object('note', 'e', '- '))).toBe('noText')
    expect(whiteboardTaskSkip({ ...object('note', 'f', 'Call'), link: TASK_LINK })).toBe('linked')
    expect(whiteboardTaskSkip({ ...node('g', 'Plan'), link: 'https://example.com' })).toBe('linked')
  })
})

describe('whiteboardTaskDrafts', () => {
  it('reads the first line with quick add', () => {
    const [draft] = whiteboardTaskDrafts(
      [object('note', 'a', 'Call the venue tomorrow !high')],
      CONTEXT
    )
    expect(draft).toMatchObject({
      objectId: 'a',
      title: 'Call the venue',
      dueDate: '2026-10-15',
      priority: 'high',
      description: '',
      // Names nobody: Me, as quick add does.
      assigneeId: 'me'
    })
  })

  it('reads labels and people as quick add does', () => {
    const [draft] = whiteboardTaskDrafts(
      [object('note', 'a', 'Send @Sam the draft #Admin')],
      CONTEXT
    )
    expect(draft.title).toBe('Send the draft')
    expect(draft.assigneeId).toBe('sam')
    expect(draft.labels).toEqual(['admin'])
  })

  it('makes the remaining lines, trimmed, the description', () => {
    const [draft] = whiteboardTaskDrafts(
      [object('shape', 'a', '\n  - Book the room  \n  ask about parking \n\n  check the lift')],
      CONTEXT
    )
    expect(draft.title).toBe('Book the room')
    expect(draft.description).toBe('ask about parking\ncheck the lift')
  })

  it('leaves out what cannot make a task and goes in reading order', () => {
    const drafts = whiteboardTaskDrafts(
      [
        object('note', 'right', 'Second', 400, 0),
        object('note', 'below', 'Third', 0, 400),
        object('text', 'words', 'Not a task', 0, 0),
        { ...object('note', 'linked', 'Linked', 200, 0), link: TASK_LINK },
        node('left', 'First', 0, 0)
      ],
      CONTEXT
    )
    expect(drafts.map((draft) => [draft.objectId, draft.title])).toEqual([
      ['left', 'First'],
      ['right', 'Second'],
      ['below', 'Third']
    ])
  })

  it('makes at most the line feature’s maximum', () => {
    expect(WHITEBOARD_TASKS_MAX).toBe(LINE_TASKS_MAX)
    const many = Array.from({ length: WHITEBOARD_TASKS_MAX + 5 }, (_, index) =>
      object('note', `n${index}`, `Task ${index}`, 0, index * 300)
    )
    const drafts = whiteboardTaskDrafts(many, CONTEXT)
    expect(drafts).toHaveLength(WHITEBOARD_TASKS_MAX)
    expect(drafts[0].objectId).toBe('n0')
    expect(drafts[WHITEBOARD_TASKS_MAX - 1].objectId).toBe(`n${WHITEBOARD_TASKS_MAX - 1}`)
  })
})
