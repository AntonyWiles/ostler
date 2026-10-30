import { describe, expect, it } from 'vitest'
import type { PinView } from '../../src/shared/ostler-api'
import { deepLinkFor, parseDeepLink } from '../../src/shared/deep-link'
import { countdownEntries } from '../../electron/app/desktop/countdowns'

const ID = '0f4c8f43-5ac0-4b6b-9f5a-2a3c1c8e5d11'

describe('a goal of one’s own outside Ostler (N5.6b)', () => {
  it('has a deep link of its own, read back exactly and nothing looser', () => {
    const link = deepLinkFor({ kind: 'personal-goal', id: ID }, 'ostler')
    expect(link).toBe(`ostler://goal/${ID}`)
    expect(parseDeepLink(link, 'ostler', () => true)).toEqual({
      ok: true,
      request: { kind: 'personal-goal', id: ID }
    })
    expect(parseDeepLink('ostler://goal/not-an-id', 'ostler', () => true).ok).toBe(false)
    expect(parseDeepLink(`ostler://goal/${ID}/x`, 'ostler', () => true).ok).toBe(false)
  })

  it('counts down in the tray and jump list, opening it in Goals', () => {
    const pin: PinView = {
      id: 'pin-goal',
      place: 'sidebar',
      projectId: '',
      kind: 'personal-goal',
      targetId: ID,
      orderKey: 'V',
      createdAt: 0,
      countdown: true,
      exists: true,
      title: 'Save £5,000',
      archived: false,
      date: '2026-11-21',
      done: false
    }
    expect(countdownEntries([pin], '2026-10-12', { daysOff: [] })).toEqual([
      {
        pinId: 'pin-goal',
        label: '40 days to Save £5,000 (29 working days)',
        request: { kind: 'personal-goal', id: ID }
      }
    ])
  })
})
