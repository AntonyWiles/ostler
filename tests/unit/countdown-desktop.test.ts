import { describe, expect, it, vi } from 'vitest'
import { buildTrayMenu } from '../../electron/app/desktop/tray-menu'
import { buildJumpList } from '../../electron/app/desktop/jump-list'
import {
  CountdownWatch,
  countdownEntries,
  type CountdownEntry
} from '../../electron/app/desktop/countdowns'
import { parseDeepLink } from '../../src/shared/deep-link'
import { myWorkingDays } from '../../src/shared/planning/working-days'
import type { PinView } from '../../src/shared/ostler-api'

const P1 = '0f8fad5b-d9cb-469f-a165-70867728950e'
const TASK = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const MILESTONE = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b'

function pin(overrides: Partial<PinView>): PinView {
  return {
    id: 'pin-1',
    place: 'sidebar',
    projectId: P1,
    kind: 'milestone',
    targetId: MILESTONE,
    orderKey: 'V',
    createdAt: 1,
    countdown: true,
    exists: true,
    title: 'Launch',
    archived: false,
    date: '2026-03-14',
    done: false,
    countdownText: null,
    ...overrides
  }
}

const launch: CountdownEntry = {
  pinId: 'pin-1',
  label: '12 days to Launch & party',
  request: { kind: 'milestone', projectId: P1, id: MILESTONE }
}

const base = {
  program: 'C:/Program Files/Ostler/Ostler.exe',
  baseArgs: [],
  scheme: 'ostler',
  iconPath: 'C:/Program Files/Ostler/resources/icons/icon.ico',
  recentProjects: []
}

describe('countdown entries (N5.2b)', () => {
  it('words each countdown with a short title and links to its item', () => {
    const entries = countdownEntries(
      [
        pin({}),
        pin({
          id: 'pin-2',
          kind: 'task',
          targetId: TASK,
          title: 'Send the invitations to everyone on the list',
          date: '2026-03-03'
        }),
        pin({ id: 'gone', exists: false, title: null }),
        pin({ id: 'off', countdown: false })
      ],
      '2026-03-02',
      { daysOff: [] }
    )
    expect(entries).toEqual([
      {
        pinId: 'pin-1',
        label: '12 days to Launch (9 working days)',
        request: { kind: 'milestone', projectId: P1, id: MILESTONE }
      },
      {
        pinId: 'pin-2',
        label: 'Send the invitations to everyon… is tomorrow',
        request: { kind: 'task', projectId: P1, taskId: TASK }
      }
    ])
  })

  it('counts my own working days in the tray and the jump list, as Home and the API do', () => {
    const mine = myWorkingDays({ id: 'me', workingDays: [1, 2, 3, 4, 5] }, [
      { personId: 'me', firstDate: '2026-03-05', lastDate: '2026-03-05', name: 'Dentist' },
      { personId: 'someone', firstDate: '2026-03-09', lastDate: '2026-03-13', name: 'Leave' }
    ])
    expect(countdownEntries([pin({})], '2026-03-02', mine)[0].label).toBe(
      '12 days to Launch (8 working days)'
    )
  })
})

describe('the tray menu with countdowns (N5.2b)', () => {
  const state = { unread: 0, aiOn: false, remindersPausedUntil: null, time: () => '' }

  it('lists countdowns first, each opening its item, with "&" kept visible', () => {
    const items = buildTrayMenu({ ...state, countdowns: [launch] })
    expect(items[0]).toEqual({
      label: '12 days to Launch && party',
      action: 'open-countdown',
      request: launch.request
    })
    expect(items[1]).toEqual({ type: 'separator' })
    expect(items[2]).toMatchObject({ action: 'open' })
  })

  it('has no countdown section without countdowns', () => {
    expect(buildTrayMenu(state)[0]).toMatchObject({ action: 'open' })
  })
})

describe('the jump list with countdowns (N5.2b)', () => {
  it('adds a Countdowns category whose entries start Ostler on the item link', () => {
    const list = buildJumpList({ ...base, countdowns: [launch] })
    expect(list).toHaveLength(2)
    expect(list[1]).toMatchObject({ type: 'custom', name: 'Countdowns' })
    const [entry] = list[1].items ?? []
    expect(entry).toMatchObject({ title: launch.label })
    const args = (entry as { args: string }).args
    // The same link opens the item whether Ostler is running (second-instance) or not (argv).
    const parsed = parseDeepLink(args, 'ostler', () => true)
    expect(parsed).toEqual({ ok: true, request: launch.request })
  })

  it('leaves the category out without countdowns', () => {
    expect(buildJumpList({ ...base, countdowns: [] })).toHaveLength(1)
  })
})

describe('the countdown watch (N5.2b)', () => {
  it('applies new words when the local date changes, and only then', () => {
    let now = new Date(2026, 2, 2, 23, 58)
    const read = vi.fn((today: string) => [
      { ...launch, label: today === '2026-03-02' ? '12 days to Launch' : '11 days to Launch' }
    ])
    const apply = vi.fn()
    const watch = new CountdownWatch({ now: () => now, read, apply })

    expect(watch.refresh()).toBe(true)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(watch.entries[0].label).toBe('12 days to Launch')

    now = new Date(2026, 2, 2, 23, 59)
    expect(watch.tick()).toBe(false)
    expect(read).toHaveBeenCalledTimes(1)

    now = new Date(2026, 2, 3, 0, 0, 30)
    expect(watch.tick()).toBe(true)
    expect(read).toHaveBeenLastCalledWith('2026-03-03')
    expect(watch.entries[0].label).toBe('11 days to Launch')
    expect(apply).toHaveBeenCalledTimes(2)
  })

  it('does not apply the same entries twice when pins change without changing them', () => {
    const apply = vi.fn()
    const watch = new CountdownWatch({
      now: () => new Date(2026, 2, 2, 12),
      read: () => [launch],
      apply
    })
    watch.refresh()
    expect(watch.refresh()).toBe(false)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('checks the date once a minute while it runs', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 2, 2, 23, 59, 30))
      const read = vi.fn(() => [] as CountdownEntry[])
      const watch = new CountdownWatch({ now: () => new Date(), read, apply: () => {} })
      watch.refresh()
      watch.start()
      vi.advanceTimersByTime(60_000)
      expect(read).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(60_000)
      expect(read).toHaveBeenCalledTimes(2)
      watch.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
