// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearProjectTabPrefs,
  effectiveTabPrefs,
  writeTabPrefs
} from '@renderer/navigation/tab-prefs'

describe('saved tab preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('keeps a project choice over the all-projects one, and falls back when cleared', () => {
    writeTabPrefs('global', { pinned: ['someday'], unpinned: [] })
    writeTabPrefs({ projectId: 'p1' }, { pinned: [], unpinned: ['board'] })

    expect(effectiveTabPrefs('p1')).toEqual({ pinned: [], unpinned: ['board'] })
    expect(effectiveTabPrefs('p2')).toEqual({ pinned: ['someday'], unpinned: [] })

    clearProjectTabPrefs('p1')
    expect(effectiveTabPrefs('p1')).toEqual({ pinned: ['someday'], unpinned: [] })
  })

  it('drops ids that are not project views and ignores bad stored JSON', () => {
    window.localStorage.setItem(
      'ostler.tabPrefs',
      JSON.stringify({ pinned: ['someday', 'no-such-view', 42], unpinned: ['board'] })
    )
    expect(effectiveTabPrefs()).toEqual({ pinned: ['someday'], unpinned: ['board'] })

    window.localStorage.setItem('ostler.tabPrefs', '{not json')
    expect(effectiveTabPrefs()).toBeNull()
  })
})
