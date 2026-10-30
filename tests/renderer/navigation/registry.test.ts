import { describe, expect, it } from 'vitest'
import {
  allProjectViews,
  availableProjectView,
  globalViews,
  openableProjectViews,
  PROJECT_VIEWS,
  projectTabs,
  projectViewToOpen,
  projectViews,
  SETTINGS_SECTIONS,
  settingsSections,
  settingsSubsections,
  type ViewContext
} from '@renderer/navigation/registry'

import { PROJECT_USAGE_FACTS } from '@shared/ostler-api'

const ids = (views: { id: string }[]) => views.map((view) => view.id)

describe('navigation registry', () => {
  // Every combination of the three switches a view may depend on, in a
  // project that uses nothing beyond the everyday views yet.
  const everyday = ['overview', 'board', 'list', 'calendar', 'library']
  const inMore = [
    'plan',
    'timeline',
    'milestones',
    'decisions',
    'matrix',
    'triage',
    'someday',
    'costs',
    'shopping',
    'time-report',
    'archive',
    'bin'
  ]
  const cases: Array<[ViewContext, string[], string[]]> = [
    [
      { hasFolder: false, agents: false, ai: false },
      everyday,
      ['home', 'inbox', 'my-work', 'timeline-overview', 'settings']
    ],
    [
      { hasFolder: false, agents: false, ai: true },
      everyday,
      ['home', 'inbox', 'my-work', 'timeline-overview', 'settings']
    ],
    [
      { hasFolder: false, agents: true, ai: false },
      everyday,
      ['home', 'inbox', 'my-work', 'timeline-overview', 'agents', 'settings']
    ],
    [
      { hasFolder: false, agents: true, ai: true },
      everyday,
      ['home', 'inbox', 'my-work', 'timeline-overview', 'agents', 'settings']
    ],
    [
      { hasFolder: true, agents: false, ai: false },
      [...everyday, 'files', 'history'],
      ['home', 'inbox', 'my-work', 'timeline-overview', 'settings']
    ],
    [
      { hasFolder: true, agents: false, ai: true },
      [...everyday, 'files', 'history'],
      ['home', 'inbox', 'my-work', 'timeline-overview', 'settings']
    ],
    [
      { hasFolder: true, agents: true, ai: false },
      [...everyday, 'files', 'history', 'agents'],
      ['home', 'inbox', 'my-work', 'timeline-overview', 'agents', 'settings']
    ],
    [
      { hasFolder: true, agents: true, ai: true },
      [...everyday, 'files', 'history', 'agents'],
      ['home', 'inbox', 'my-work', 'timeline-overview', 'agents', 'settings']
    ]
  ]

  it.each(cases)('offers the right views for %o', (ctx, tabs, global) => {
    expect(ids(projectViews(ctx, 'tab'))).toEqual(tabs)
    // Archive and the recycle bin are always reached from More views.
    expect(ids(projectViews(ctx, 'more'))).toEqual(inMore)
    expect(ids(allProjectViews(ctx))).toEqual([...tabs, ...inMore])
    // Inbox is registered but hidden until P5.6 builds it.
    expect(ids(globalViews(ctx))).toEqual(global)
  })

  it('gives a view in More its tab once the project uses it, in its own place', () => {
    const ctx: ViewContext = {
      hasFolder: false,
      agents: false,
      ai: false,
      uses: ['scheduled', 'decisions', 'costs']
    }
    expect(ids(projectViews(ctx, 'tab'))).toEqual([
      'overview',
      'board',
      'list',
      'calendar',
      'timeline',
      'library',
      'decisions',
      'costs'
    ])
    expect(ids(projectViews(ctx, 'more'))).not.toContain('timeline')
    expect(ids(projectViews(ctx, 'more'))).toContain('milestones')
    // Archive and the recycle bin never earn a tab; Plan earns its tab from
    // the project's stage, not from what the project holds.
    expect(ids(projectViews({ ...ctx, uses: [...PROJECT_USAGE_FACTS] }, 'more'))).toEqual([
      'plan',
      'archive',
      'bin'
    ])
  })

  it('makes Plan a tab while the project is in Planning', () => {
    const planning: ViewContext = { hasFolder: false, agents: false, ai: false, planning: true }
    expect(ids(projectViews(planning, 'tab'))).toEqual([
      'overview',
      'plan',
      'board',
      'list',
      'calendar',
      'library'
    ])
    const active: ViewContext = { ...planning, planning: false }
    expect(ids(projectViews(active, 'tab'))).not.toContain('plan')
    expect(ids(projectViews(active, 'more'))).toContain('plan')
    const unpinned: ViewContext = { ...planning, tabPrefs: { pinned: [], unpinned: ['plan'] } }
    expect(ids(projectViews(unpinned, 'more'))).toContain('plan')
    expect(projectViewToOpen('plan', null, { hasFolder: false, agents: false, ai: false })).toBe(
      'plan'
    )
  })

  it('moves a view between the tab row and More as the viewer pins or unpins it', () => {
    const base: ViewContext = { hasFolder: false, agents: false, ai: false }
    // No prefs: the registry's own placement.
    expect(ids(projectViews({ ...base, tabPrefs: null }, 'tab'))).toEqual(
      ids(projectViews(base, 'tab'))
    )
    // Pinning a More view makes it a tab, in its own order.
    const pinned: ViewContext = { ...base, tabPrefs: { pinned: ['someday'], unpinned: [] } }
    expect(ids(projectViews(pinned, 'tab'))).toEqual([...everyday, 'someday'])
    expect(ids(projectViews(pinned, 'more'))).not.toContain('someday')
    // Unpinning a tab moves it to More, in its own place there.
    const unpinned: ViewContext = { ...base, tabPrefs: { pinned: [], unpinned: ['board'] } }
    expect(ids(projectViews(unpinned, 'tab'))).toEqual(['overview', 'list', 'calendar', 'library'])
    // More is in registry order: Plan (1.5) comes before an unpinned Board (2).
    expect(ids(projectViews(unpinned, 'more'))).toEqual(['plan', 'board', ...inMore.slice(1)])
  })

  it('shows a view opened from More as a tab while it is open', () => {
    const ctx: ViewContext = { hasFolder: false, agents: false, ai: false, uses: [] }
    expect(ids(projectTabs(ctx, 'board'))).toEqual(ids(projectViews(ctx, 'tab')))
    expect(ids(projectTabs(ctx, 'someday'))).toEqual([...ids(projectViews(ctx, 'tab')), 'someday'])
  })

  it('falls back to Overview for a view that is unavailable or unknown', () => {
    const noFolder = { hasFolder: false, agents: true, ai: true }
    expect(availableProjectView('board', noFolder)).toBe('board')
    expect(availableProjectView('files', noFolder)).toBe('overview')
    expect(availableProjectView('agents', { hasFolder: true, agents: false, ai: true })).toBe(
      'overview'
    )
    expect(availableProjectView('portfolio', noFolder)).toBe('overview')
    expect(availableProjectView(null, noFolder)).toBe('overview')
  })

  it('offers To triage only when it can hold something, and still opens it from its path', () => {
    const empty: ViewContext = { hasFolder: false, agents: false, ai: false, triage: false }
    expect(ids(projectViews(empty, 'more'))).not.toContain('triage')
    expect(ids(allProjectViews(empty))).not.toContain('triage')
    expect(ids(openableProjectViews(empty))).toContain('triage')
    expect(projectViewToOpen('triage', null, empty)).toBe('triage')
    // The view used last is not reopened once it is no longer offered.
    expect(projectViewToOpen(null, 'triage', empty)).toBe('overview')

    const holding = { ...empty, triage: true }
    expect(ids(projectViews(holding, 'more'))).toContain('triage')
    expect(projectViewToOpen(null, 'triage', holding)).toBe('triage')
  })

  it('has unique, stable ids', () => {
    const projectIds = PROJECT_VIEWS.map((view) => view.id)
    expect(new Set(projectIds).size).toBe(projectIds.length)
    const sectionIds = SETTINGS_SECTIONS.map((section) => section.id)
    expect(new Set(sectionIds).size).toBe(sectionIds.length)
  })

  it('lists the settings sections in the IA order', () => {
    const ctx = { hasFolder: false, agents: false, ai: false }
    expect(settingsSections(ctx).map((section) => section.id)).toEqual([
      'general',
      'projects',
      'people',
      'notifications',
      'ai',
      'agents',
      'connections',
      'devices',
      'data',
      'advanced',
      'git',
      'about'
    ])
  })

  it('puts Git under Advanced in the settings menu', () => {
    const sections = settingsSections({ hasFolder: false, agents: false, ai: false })
    expect(settingsSubsections(sections, 'advanced').map((section) => section.id)).toEqual(['git'])
    expect(settingsSubsections(sections, 'general')).toEqual([])
  })

  it('gives every project view a lazy element', () => {
    for (const view of PROJECT_VIEWS) expect(view.element).toBeDefined()
  })
})
