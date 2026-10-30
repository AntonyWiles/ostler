import { describe, expect, it } from 'vitest'
import { dayBeforeMonth, parseQuickAdd, type QuickAddContext } from '../../src/shared/quick-add'

// Wednesday 7 October 2026.
const base: QuickAddContext = {
  today: '2026-10-07',
  locale: 'en-NZ',
  people: [
    { id: 'p-me', name: 'Jordan Reyes', isMe: true },
    { id: 'p-ada', name: 'Ada Lovelace' },
    { id: 'p-al', name: 'Alan Turing' },
    { id: 'p-grace', name: 'Grace Hopper' }
  ],
  labels: ['admin', 'Finance', 'bug'],
  projects: [
    { id: 'proj-web', name: 'Website' },
    { id: 'proj-home', name: 'Home Reno' },
    { id: 'proj-wh', name: 'Warehouse' }
  ]
}

const parse = (text: string, extra: Partial<QuickAddContext> = {}) =>
  parseQuickAdd(text, { ...base, ...extra })

describe('parseQuickAdd', () => {
  it('leaves a plain title alone', () => {
    expect(parse('Pay invoice')).toMatchObject({
      title: 'Pay invoice',
      labels: [],
      assigneeId: null,
      priority: null,
      projectId: null,
      dueDate: null,
      tokens: []
    })
  })

  it('parses the brief’s example', () => {
    const result = parse('Pay invoice tomorrow #admin !high')
    expect(result).toMatchObject({
      title: 'Pay invoice',
      labels: ['admin'],
      priority: 'high',
      dueDate: '2026-10-08'
    })
    expect(result.tokens.map((token) => token.kind)).toEqual(['date', 'label', 'priority'])
  })

  it('takes tokens out of the middle of the title', () => {
    expect(parse('Pay #admin the !high invoice').title).toBe('Pay the invoice')
  })

  it('records where each token is', () => {
    const [token] = parse('Pay #admin now').tokens
    expect(token).toMatchObject({ text: '#admin', start: 4, end: 10 })
  })

  it('reuses an existing label’s spelling, case-insensitively', () => {
    const result = parse('Budget #finance')
    expect(result.labels).toEqual(['Finance'])
    expect(result.tokens[0].isNew).toBe(false)
  })

  it('keeps an unknown label as a new one', () => {
    const result = parse('Budget #taxes')
    expect(result.labels).toEqual(['taxes'])
    expect(result.tokens[0].isNew).toBe(true)
  })

  it('takes several labels and ignores a repeat', () => {
    expect(parse('A #bug #admin #BUG').labels).toEqual(['bug', 'admin'])
  })

  it('assigns by first name', () => {
    expect(parse('Review @ada').assigneeId).toBe('p-ada')
  })

  it('assigns by full name with the space squeezed out', () => {
    expect(parse('Review @GraceHopper').assigneeId).toBe('p-grace')
  })

  it('assigns @me to Me', () => {
    expect(parse('Call the bank @me').assigneeId).toBe('p-me')
  })

  it('leaves an unknown person in the title and reports it', () => {
    const result = parse('Ask @bob about it')
    expect(result.assigneeId).toBeNull()
    expect(result.title).toBe('Ask @bob about it')
    expect(result.unknown).toEqual([{ kind: 'person', text: '@bob' }])
  })

  it('does not guess between two people who share a prefix', () => {
    const result = parse('Ask @a')
    expect(result.assigneeId).toBeNull()
    expect(result.unknown).toHaveLength(1)
  })

  it('reads every priority word', () => {
    expect(parse('x !low').priority).toBe('low')
    expect(parse('x !med').priority).toBe('medium')
    expect(parse('x !medium').priority).toBe('medium')
    expect(parse('x !HIGH').priority).toBe('high')
    expect(parse('x !crit').priority).toBe('critical')
    expect(parse('x !critical').priority).toBe('critical')
  })

  it('keeps the first priority and an unknown one in the title', () => {
    expect(parse('x !low !high')).toMatchObject({ priority: 'low', title: 'x !high' })
    expect(parse('Wow !urgent').title).toBe('Wow !urgent')
  })

  it('chooses a project with +Project', () => {
    expect(parse('Paint +Website').projectId).toBe('proj-web')
  })

  it('matches a project with spaces by its squeezed name or a prefix', () => {
    expect(parse('Tiles +HomeReno').projectId).toBe('proj-home')
    expect(parse('Tiles +home').projectId).toBe('proj-home')
  })

  it('leaves an unknown or ambiguous project in the title', () => {
    expect(parse('Tiles +Garden')).toMatchObject({
      projectId: null,
      title: 'Tiles +Garden',
      unknown: [{ kind: 'project', text: '+Garden' }]
    })
    // Website and Warehouse both start with "w".
    expect(parse('Tiles +w').projectId).toBeNull()
  })

  it('reads today and tomorrow', () => {
    expect(parse('Ring today').dueDate).toBe('2026-10-07')
    expect(parse('Ring Tomorrow').dueDate).toBe('2026-10-08')
  })

  it('reads weekday names as the next such day, today included', () => {
    expect(parse('Ring friday').dueDate).toBe('2026-10-09')
    expect(parse('Ring mon').dueDate).toBe('2026-10-12')
    expect(parse('Ring Wednesday').dueDate).toBe('2026-10-07')
  })

  it('does not read "sat" or "sun" as days', () => {
    expect(parse('Fix sun icon').dueDate).toBeNull()
  })

  it('reads next week as next Monday, and next Friday as Friday next week', () => {
    expect(parse('Plan next week').dueDate).toBe('2026-10-12')
    expect(parse('Plan next friday').dueDate).toBe('2026-10-16')
  })

  it('reads in N days and in N weeks', () => {
    expect(parse('Check in 3 days').dueDate).toBe('2026-10-10')
    expect(parse('Check in two weeks').dueDate).toBe('2026-10-21')
    expect(parse('Check in 3 days').title).toBe('Check')
  })

  it('leaves "in" alone when no date follows', () => {
    expect(parse('Log in 3 places').dueDate).toBeNull()
    expect(parse('Log in 3 places').title).toBe('Log in 3 places')
  })

  it('reads ISO dates', () => {
    expect(parse('File 2027-01-15 taxes')).toMatchObject({
      dueDate: '2027-01-15',
      title: 'File taxes'
    })
  })

  it('reads an ambiguous numeric date day-first in en-NZ', () => {
    expect(parse('Pay 3/4').dueDate).toBe('2027-04-03')
    expect(parse('Pay 12/10').dueDate).toBe('2026-10-12')
  })

  it('reads the same numeric date month-first in en-US', () => {
    expect(parse('Pay 3/4', { locale: 'en-US' }).dueDate).toBe('2027-03-04')
    expect(parse('Pay 10/12', { locale: 'en-US' }).dueDate).toBe('2026-10-12')
  })

  it('reads numeric dates with a year, two or four digits', () => {
    expect(parse('Pay 3/4/2027').dueDate).toBe('2027-04-03')
    expect(parse('Pay 3.4.27').dueDate).toBe('2027-04-03')
  })

  it('leaves impossible numeric dates in the title', () => {
    expect(parse('Pay 31/2')).toMatchObject({ dueDate: null, title: 'Pay 31/2' })
    expect(parse('Pay 13/13', { locale: 'en-US' }).dueDate).toBeNull()
  })

  it('takes "on", "by" and "due" with the date', () => {
    expect(parse('Call Tom on Friday').title).toBe('Call Tom')
    expect(parse('Report due tomorrow').title).toBe('Report')
    expect(parse('Ship by 2026-12-01').tokens[0].text).toBe('by 2026-12-01')
  })

  it('keeps "on" when no date follows', () => {
    expect(parse('Turn on lights')).toMatchObject({ title: 'Turn on lights', dueDate: null })
  })

  it('uses the first date and leaves a second in the title', () => {
    expect(parse('Move today tomorrow')).toMatchObject({
      dueDate: '2026-10-07',
      title: 'Move tomorrow'
    })
  })

  it('matches dates as whole words', () => {
    expect(parse("Write today's notes").dueDate).toBeNull()
  })

  it('reads everything at once, in any order', () => {
    const result = parse('!crit +Website @ada Fix #bug login on fri')
    expect(result).toMatchObject({
      title: 'Fix login',
      priority: 'critical',
      projectId: 'proj-web',
      assigneeId: 'p-ada',
      labels: ['bug'],
      dueDate: '2026-10-09'
    })
  })

  it('leaves a token the person removed from the preview as title text', () => {
    const text = 'Read Monday notes'
    const first = parse(text)
    expect(first.dueDate).toBe('2026-10-12')
    const kept = parse(text, { ignore: [first.tokens[0].start] })
    expect(kept).toMatchObject({ dueDate: null, title: 'Read Monday notes' })
  })

  it('ignores trailing punctuation on a token', () => {
    expect(parse('Pay #admin, then rest').labels).toEqual(['admin'])
  })

  it('knows each locale’s day and month order', () => {
    expect(dayBeforeMonth('en-NZ')).toBe(true)
    expect(dayBeforeMonth('en-GB')).toBe(true)
    expect(dayBeforeMonth('en-US')).toBe(false)
  })
})
