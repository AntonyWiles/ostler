import { describe, expect, it } from 'vitest'
import {
  isAcceptedPhoto,
  matchPersonName,
  readTextTaskSuggestions,
  TEXT_TASKS_MAX_PHOTO_BYTES,
  TEXT_TASKS_MAX_SUGGESTIONS
} from '../../src/shared/tasks-from-text'
import { buildTasksFromTextUserPrompt } from '../../src/shared/ostler-ai-prompts'

const people = [
  { id: 'p-ada', name: 'Ada Lovelace', initials: 'AL', isMe: true },
  { id: 'p-grace', name: 'Grace Hopper', initials: 'GH' },
  { id: 'p-gregor', name: 'Gregor Mendel', initials: 'GM' }
]

describe('buildTasksFromTextUserPrompt', () => {
  it("gives today's date and the week start, and fences the person's words as content", () => {
    const prompt = buildTasksFromTextUserPrompt({
      text: 'Call the plumber next Friday',
      today: '2026-10-15',
      weekStart: 0,
      hasPhoto: false
    })
    expect(prompt).toContain('Today is 2026-10-15.')
    expect(prompt).toContain('The week starts on Sunday.')
    expect(prompt).toContain('<content>\nCall the plumber next Friday\n</content>')
    expect(prompt).toContain('There is no photo.')
  })

  it('says a photo follows when there is one', () => {
    const prompt = buildTasksFromTextUserPrompt({
      text: '',
      today: '2026-10-15',
      weekStart: 1,
      hasPhoto: true
    })
    expect(prompt).toContain('The week starts on Monday.')
    expect(prompt).toContain('A photo follows')
  })
})

describe('matchPersonName', () => {
  it('matches the full name, the first name and initials, on this PC only', () => {
    expect(matchPersonName('Grace Hopper', people)?.id).toBe('p-grace')
    expect(matchPersonName('grace', people)?.id).toBe('p-grace')
    expect(matchPersonName('GH', people)?.id).toBe('p-grace')
    expect(matchPersonName('A.L.', people)?.id).toBe('p-ada')
  })

  it('matches nobody when the name is unknown or could be two people', () => {
    expect(matchPersonName('Linus', people)).toBeNull()
    expect(matchPersonName('Gr', people)).toBeNull()
  })
})

describe('readTextTaskSuggestions', () => {
  it('keeps checked fields and matches names locally', () => {
    const read = readTextTaskSuggestions(
      {
        tasks: [
          {
            title: '  Book the venue ',
            description: 'For the launch',
            dueDate: '2026-10-23',
            person: 'Grace',
            checklist: ['Get quotes', '', 'Pay deposit']
          }
        ]
      },
      people
    )
    expect(read.suggestions).toEqual([
      {
        title: 'Book the venue',
        description: 'For the launch',
        dueDate: '2026-10-23',
        personName: 'Grace',
        assigneeId: 'p-grace',
        checklist: ['Get quotes', 'Pay deposit']
      }
    ])
    expect(read).toMatchObject({ unmatchedNames: [], badDates: 0, dropped: 0 })
  })

  it('refuses dates that are not real days', () => {
    const read = readTextTaskSuggestions(
      {
        tasks: [
          { title: 'A', dueDate: '2026-02-30' },
          { title: 'B', dueDate: 'next Friday' },
          { title: 'C', dueDate: '2026-11-02' }
        ]
      },
      people
    )
    expect(read.suggestions.map((entry) => entry.dueDate)).toEqual([null, null, '2026-11-02'])
    expect(read.badDates).toBe(2)
  })

  it('refuses over-long fields and suggestions past the limit', () => {
    const tasks = [
      { title: 'x'.repeat(201) },
      { title: '' },
      'not an object',
      { title: 'Long bits', person: 'n'.repeat(81), checklist: ['y'.repeat(501), 'ok'] },
      ...Array.from({ length: TEXT_TASKS_MAX_SUGGESTIONS + 2 }, (_, index) => ({
        title: `Task ${index}`
      }))
    ]
    const read = readTextTaskSuggestions({ tasks }, people)
    expect(read.suggestions).toHaveLength(TEXT_TASKS_MAX_SUGGESTIONS)
    expect(read.suggestions[0]).toMatchObject({
      title: 'Long bits',
      personName: null,
      checklist: ['ok']
    })
    expect(read.dropped).toBe(3 + 3)
  })

  it('leaves an unmatched name empty and notes it once', () => {
    const read = readTextTaskSuggestions(
      {
        tasks: [
          { title: 'One', person: 'Linus' },
          { title: 'Two', person: 'Linus' }
        ]
      },
      people
    )
    expect(read.suggestions.map((entry) => entry.assigneeId)).toEqual([null, null])
    expect(read.suggestions[0].personName).toBe('Linus')
    expect(read.unmatchedNames).toEqual(['Linus'])
  })

  it('reads an answer without a task list as no tasks', () => {
    expect(readTextTaskSuggestions({ summary: 'none' }, people).suggestions).toEqual([])
  })
})

describe('isAcceptedPhoto', () => {
  it('takes PNG, JPEG and HEIC up to 10 MB', () => {
    expect(isAcceptedPhoto({ mimeType: 'image/png', size: 10 })).toBe(true)
    expect(isAcceptedPhoto({ mimeType: 'image/HEIC', size: 10 })).toBe(true)
    expect(isAcceptedPhoto({ mimeType: 'image/gif', size: 10 })).toBe(false)
    expect(isAcceptedPhoto({ mimeType: 'image/jpeg', size: TEXT_TASKS_MAX_PHOTO_BYTES + 1 })).toBe(
      false
    )
  })
})
