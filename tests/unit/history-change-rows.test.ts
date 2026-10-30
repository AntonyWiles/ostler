import { describe, expect, it } from 'vitest'
import type { ChangeDetail } from '../../src/shared/ostler-api'
import { changeRows, formatChangeValue } from '../../src/renderer/history/describe-change'

const part = (action: ChangeDetail['action']): ChangeDetail => ({
  kind: 'whiteboard',
  subjectId: 'board',
  field: 'objects',
  action,
  before: null,
  after: null
})

describe('history details', () => {
  it('counts parts with no text on one line', () => {
    const rows = changeRows([
      part('changed'),
      part('changed'),
      part('added'),
      { ...part('changed'), field: 'title', before: 'A', after: 'B' }
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ field: 'objects', summary: '1 added, 2 changed' })
    expect(rows[1]).toMatchObject({ field: 'title', before: 'A', after: 'B', summary: null })
  })

  it('shows stored values as words', () => {
    const status = (value: string) => `[${value}]`
    expect(formatChangeValue('labels', '[]', status)).toBeNull()
    expect(formatChangeValue('labels', '["Bug","Feature request"]', status)).toBe(
      'Bug, Feature request'
    )
    expect(formatChangeValue('someday', '1', status)).toBe('Yes')
    expect(formatChangeValue('status', 'in_progress', status)).toBe('[in_progress]')
    expect(formatChangeValue('title', 'Plain', status)).toBe('Plain')
  })
})
