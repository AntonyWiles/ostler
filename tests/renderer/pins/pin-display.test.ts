import { describe, expect, it } from 'vitest'
import type { PinView } from '@shared/ostler-api'
import { livePins } from '../../../src/renderer/pins/pin-display'

const pin = (over: Partial<PinView>): PinView =>
  ({
    id: 'p',
    kind: 'task',
    targetId: 't',
    projectId: 'proj',
    exists: true,
    title: 'Task',
    archived: false,
    ...over
  }) as PinView

describe('livePins', () => {
  it('leaves out a pin whose target is gone, so none shows as "Gone"', () => {
    const kept = pin({ id: 'a' })
    const view = pin({ id: 'b', kind: 'project-view', targetId: 'overview', title: null })
    const deleted = pin({ id: 'c', exists: false, title: null })
    const oldView = pin({ id: 'd', kind: 'project-view', targetId: 'no-such-view', title: null })
    expect(livePins([kept, view, deleted, oldView]).map((p) => p.id)).toEqual(['a', 'b'])
  })
})
