import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESKTOP_SETTINGS,
  EMPTY_MENU_CONTEXT,
  assertValidDesktopUpdate,
  badgeText,
  isValidHotkey,
  normalizeDesktopSettings,
  normalizeMenuContext
} from '../../src/shared/ostler-api'
import { notificationTarget } from '../../electron/services/notification-service'

describe('badgeText', () => {
  it('is empty at zero, the count from 1 to 9, then 9+', () => {
    expect(badgeText(0)).toBeNull()
    expect(badgeText(-2)).toBeNull()
    expect(badgeText(Number.NaN)).toBeNull()
    expect(badgeText(1)).toBe('1')
    expect(badgeText(9)).toBe('9')
    expect(badgeText(10)).toBe('9+')
    expect(badgeText(250)).toBe('9+')
  })
})

describe('the Quick add key', () => {
  it('needs Ctrl or Alt with a letter, digit or function key', () => {
    for (const key of ['Ctrl+Alt+N', 'Alt+F2', 'Ctrl+Shift+7', 'Ctrl+F12']) {
      expect(isValidHotkey(key), key).toBe(true)
    }
    for (const key of [
      'N',
      'Shift+N',
      'Ctrl+Ctrl+N',
      'Ctrl+Alt+',
      'Ctrl+Alt+Space',
      'Win+N',
      'Ctrl+F25',
      42
    ]) {
      expect(isValidHotkey(key), String(key)).toBe(false)
    }
  })

  it('refuses a bad key with advice, and keeps the default when a bad one is stored', () => {
    expect(() => assertValidDesktopUpdate({ quickAddHotkey: 'N' })).toThrow(/Ctrl or Alt/)
    expect(() => assertValidDesktopUpdate({ backgroundMode: 'yes' as never })).toThrow()
    expect(() => assertValidDesktopUpdate({ quickAddHotkey: 'Ctrl+Alt+Q' })).not.toThrow()
    expect(normalizeDesktopSettings({ quickAddHotkey: 'Q', backgroundMode: true })).toEqual({
      ...DEFAULT_DESKTOP_SETTINGS,
      backgroundMode: true
    })
    expect(normalizeDesktopSettings(undefined)).toEqual(DEFAULT_DESKTOP_SETTINGS)
  })
})

describe('the Snip to task key (N4.2a)', () => {
  it('is off with Ctrl+Alt+S ready, and a bad stored key falls back to it', () => {
    expect(DEFAULT_DESKTOP_SETTINGS.snipHotkeyEnabled).toBe(false)
    expect(DEFAULT_DESKTOP_SETTINGS.snipHotkey).toBe('Ctrl+Alt+S')
    expect(normalizeDesktopSettings({ snipHotkey: 'S', snipHotkeyEnabled: 'yes' })).toEqual(
      DEFAULT_DESKTOP_SETTINGS
    )
    expect(normalizeDesktopSettings({ snipHotkey: 'Alt+F9', snipHotkeyEnabled: true })).toEqual({
      ...DEFAULT_DESKTOP_SETTINGS,
      snipHotkey: 'Alt+F9',
      snipHotkeyEnabled: true
    })
  })

  it('refuses an invalid key with advice', () => {
    expect(() => assertValidDesktopUpdate({ snipHotkey: 'S' })).toThrow(/Ctrl or Alt/)
    expect(() => assertValidDesktopUpdate({ snipHotkey: 'Win+S' })).toThrow(/Ctrl or Alt/)
    expect(() => assertValidDesktopUpdate({ snipHotkeyEnabled: 1 as never })).toThrow()
    expect(() => assertValidDesktopUpdate({ snipHotkey: 'Ctrl+Alt+P' })).not.toThrow()
  })

  it('refuses the Quick add key, either way round and in any modifier order', () => {
    const current = { ...DEFAULT_DESKTOP_SETTINGS }
    expect(() => assertValidDesktopUpdate({ snipHotkey: 'Ctrl+Alt+N' }, current)).toThrow(
      /Quick add key/
    )
    expect(() => assertValidDesktopUpdate({ snipHotkey: 'Alt+Ctrl+N' }, current)).toThrow(
      /Quick add key/
    )
    expect(() => assertValidDesktopUpdate({ quickAddHotkey: 'Ctrl+Alt+S' }, current)).toThrow(
      /Quick add key/
    )
    // Swapping both in one change is fine.
    expect(() =>
      assertValidDesktopUpdate({ quickAddHotkey: 'Ctrl+Alt+S', snipHotkey: 'Ctrl+Alt+N' }, current)
    ).not.toThrow()
    // Turning a key on or off is never refused for it.
    expect(() => assertValidDesktopUpdate({ snipHotkeyEnabled: true }, current)).not.toThrow()
  })
})

describe('normalizeMenuContext', () => {
  it('keeps a well-formed context and drops what is malformed', () => {
    expect(normalizeMenuContext(null)).toEqual(EMPTY_MENU_CONTEXT)
    expect(
      normalizeMenuContext({
        project: { id: 'p1', name: 'Website' },
        views: [
          { id: 'board', label: 'Board', keys: 'Ctrl+2' },
          { id: '../x', label: 'Bad' },
          { id: 'list', label: 'List', keys: 'Alt+F4' }
        ],
        viewIds: ['board', 'list', 'Bad View', 3],
        printable: 'yes',
        recentProjectIds: ['p1', 7]
      })
    ).toEqual({
      project: { id: 'p1', name: 'Website' },
      views: [
        { id: 'board', label: 'Board', keys: 'Ctrl+2' },
        { id: 'list', label: 'List' }
      ],
      viewIds: ['board', 'list'],
      printable: false,
      recentProjectIds: ['p1']
    })
  })
})

describe('notificationTarget', () => {
  it('opens the given item, else the project, else just the window', () => {
    expect(notificationTarget({ kind: 'inbox' }, 'p1')).toEqual({ kind: 'inbox' })
    expect(notificationTarget(undefined, 'p1')).toEqual({
      kind: 'project',
      projectId: 'p1',
      view: 'overview'
    })
    expect(notificationTarget(undefined, null)).toBeNull()
  })
})
