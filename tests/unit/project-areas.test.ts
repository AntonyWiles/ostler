import * as path from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import {
  groupProjectsByArea,
  moveArea,
  normalizeAreaName,
  normalizeAreas,
  MAX_AREA_NAME_LENGTH
} from '../../src/shared/project-areas'
import { PROJECT_ICONS, isProjectIcon, normalizeProjectIcon } from '../../src/shared/project-icons'
import { useTempDir } from '../helpers/temp-dir'

const home = { id: 'home', name: 'Home' }
const work = { id: 'work', name: 'Work' }
const p = (id: string, areaId: string | null = null) => ({ id, areaId })
const names = (
  groups: ReturnType<typeof groupProjectsByArea<{ id: string; areaId: string | null }>>
) => groups.map((group) => [group.area?.id ?? null, group.projects.map((project) => project.id)])

describe('groupProjectsByArea (N5.1)', () => {
  it('is one group with no heading when there are no areas', () => {
    expect(names(groupProjectsByArea([p('a', 'home'), p('b')], []))).toEqual([[null, ['a', 'b']]])
  })

  it('lists every area in area order, empty ones too, then "No area" last', () => {
    const groups = groupProjectsByArea([p('a'), p('b', 'work')], [home, work])
    expect(names(groups)).toEqual([
      ['home', []],
      ['work', ['b']],
      [null, ['a']]
    ])
  })

  it('keeps the sidebar order within each area', () => {
    const projects = [p('c', 'work'), p('a', 'home'), p('b', 'work'), p('d', 'home')]
    expect(names(groupProjectsByArea(projects, [work, home]))).toEqual([
      ['work', ['c', 'b']],
      ['home', ['a', 'd']],
      [null, []]
    ])
  })

  it('puts a project whose area went away in "No area"', () => {
    expect(names(groupProjectsByArea([p('a', 'gone')], [home]))).toEqual([
      ['home', []],
      [null, ['a']]
    ])
  })
})

describe('areas', () => {
  it('normalizes a saved list: drops non-areas and repeats, trims and cuts names', () => {
    const long = 'x'.repeat(60)
    expect(
      normalizeAreas([
        { id: 'a', name: ' Home ' },
        { id: 'a', name: 'Again' },
        { id: 'b', name: long },
        { id: 'c', name: '  ' },
        { name: 'No id' },
        'junk'
      ])
    ).toEqual([
      { id: 'a', name: 'Home' },
      { id: 'b', name: 'x'.repeat(MAX_AREA_NAME_LENGTH) }
    ])
    expect(normalizeAreas('nope')).toEqual([])
  })

  it('refuses an empty or too long name', () => {
    expect(normalizeAreaName('  Work ')).toBe('Work')
    expect(() => normalizeAreaName('   ')).toThrow()
    expect(() => normalizeAreaName('x'.repeat(41))).toThrow(/40/)
  })

  it('moves an area by places, and ignores a move past either end', () => {
    expect(moveArea([home, work], 'work', -1)).toEqual([work, home])
    expect(moveArea([home, work], 'home', -1)).toEqual([home, work])
    expect(moveArea([home, work], 'nope', 1)).toEqual([home, work])
  })
})

describe('project icons', () => {
  it('has around sixty curated icons, each id once', () => {
    expect(PROJECT_ICONS.length).toBeGreaterThanOrEqual(55)
    expect(new Set(PROJECT_ICONS).size).toBe(PROJECT_ICONS.length)
  })

  it('accepts only ids from the curated set; null, "" and undefined are none', () => {
    expect(isProjectIcon('house')).toBe(true)
    expect(isProjectIcon('House')).toBe(false)
    expect(isProjectIcon('skull')).toBe(false)
    expect(normalizeProjectIcon('plane')).toBe('plane')
    expect(normalizeProjectIcon(null)).toBeNull()
    expect(normalizeProjectIcon('')).toBeNull()
    expect(normalizeProjectIcon(undefined)).toBeNull()
    expect(() => normalizeProjectIcon('skull')).toThrow(/Unknown project icon/)
    expect(() => normalizeProjectIcon(3)).toThrow()
  })
})

describe('config-store areas', () => {
  const tempDir = useTempDir('ostler-areas-')
  let store: ConfigStore

  beforeEach(() => {
    store = new ConfigStore(path.join(tempDir(), 'config.json'))
    store.registerProject({ name: 'Garden', folder: null, id: 'garden' })
    store.registerProject({ name: 'Taxes', folder: null, id: 'taxes' })
  })

  it('makes areas with ids, in order, and saves them', () => {
    const saved = store.saveAreas([{ name: 'Home' }, { id: 'work', name: ' Work ' }])
    expect(saved.map((area) => area.name)).toEqual(['Home', 'Work'])
    expect(saved[0].id).toEqual(expect.any(String))
    expect(saved[1].id).toBe('work')
    const reloaded = new ConfigStore(path.join(tempDir(), 'config.json'))
    expect(reloaded.getAreas()).toEqual(saved)
  })

  it('refuses a repeated area, an empty name or a long name', () => {
    expect(() =>
      store.saveAreas([
        { id: 'a', name: 'A' },
        { id: 'a', name: 'B' }
      ])
    ).toThrow()
    expect(() => store.saveAreas([{ name: ' ' }])).toThrow()
    expect(() => store.saveAreas([{ name: 'x'.repeat(41) }])).toThrow()
    expect(() => store.saveAreas('nope')).toThrow()
  })

  it('puts a project in an area only if the area exists', () => {
    store.saveAreas([{ id: 'home', name: 'Home' }])
    expect(store.updateProject('garden', { areaId: 'home' }).areaId).toBe('home')
    expect(() => store.updateProject('garden', { areaId: 'nope' })).toThrow(/not found/)
    expect(store.updateProject('garden', { areaId: null }).areaId).toBeNull()
  })

  it('saves only curated icons', () => {
    expect(store.updateProject('garden', { icon: 'sprout' }).icon).toBe('sprout')
    expect(() => store.updateProject('garden', { icon: 'skull' as unknown as 'sprout' })).toThrow(
      /Unknown project icon/
    )
    expect(store.updateProject('garden', { icon: null }).icon).toBeNull()
  })

  it('moves the projects of a removed area to "No area" and changes nothing else', () => {
    store.saveAreas([
      { id: 'home', name: 'Home' },
      { id: 'work', name: 'Work' }
    ])
    store.updateProject('garden', { areaId: 'home', icon: 'sprout' })
    store.updateProject('taxes', { areaId: 'work' })
    const before = store.getProjects().map((project) => ({ ...project }))
    store.saveAreas([{ id: 'work', name: 'Work' }])
    const garden = store.getProjects().find((project) => project.id === 'garden')!
    expect(garden).toEqual({ ...before[0], areaId: null })
    expect(store.getProjects().find((project) => project.id === 'taxes')!.areaId).toBe('work')
    expect(store.getProjects().map((project) => project.id)).toEqual(['garden', 'taxes'])
  })

  it('puts an area and its projects back in one save (Undo)', () => {
    store.saveAreas([{ id: 'home', name: 'Home' }])
    store.updateProject('garden', { areaId: 'home' })
    store.saveAreas([])
    store.saveAreas([{ id: 'home', name: 'Home' }], { garden: 'home' })
    expect(store.getProjects().find((project) => project.id === 'garden')!.areaId).toBe('home')
    expect(() => store.saveAreas([], { garden: 'home' })).toThrow(/not found/)
    expect(() => store.saveAreas([], { nope: null })).toThrow(/not found/)
  })

  it('gives a new project no area, and the icon it was made with', () => {
    const made = store.registerProject({ name: 'Trip', folder: null, icon: 'plane' })
    expect(made.areaId).toBeNull()
    expect(made.icon).toBe('plane')
  })
})
