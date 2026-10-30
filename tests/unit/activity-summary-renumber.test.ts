import { describe, expect, it } from 'vitest'
import { summarizeActivity } from '../../src/shared/activity-summary'

describe('activity for a task renumbered by sync', () => {
  it('says which number it had and which it has now', () => {
    const text = summarizeActivity(
      { kind: 'change', field: 'number', from: 1, to: 2, metadata: null },
      {
        actorName: 'Ostler',
        personName: (id) => id,
        milestoneName: (id) => id,
        workItemTitle: (id) => id
      }
    )
    expect(text).toContain('#1')
    expect(text).toContain('#2')
  })
})
