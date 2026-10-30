import { describe, expect, it } from 'vitest'
import {
  homePath,
  parseAppPath,
  projectOpenPath,
  projectPath,
  searchPath,
  settingsPath,
  teamPath,
  taskPath,
  workloadPath
} from '@renderer/navigation/paths'
import { PROJECT_VIEWS, SETTINGS_SECTIONS } from '@renderer/navigation/registry'

describe('path builders', () => {
  it('opens a Planning project at its Plan and any other at its Overview', () => {
    expect(projectOpenPath('p1', 'planning')).toBe('/projects/p1/plan')
    for (const stage of ['active', 'on-hold', 'done', undefined, 'something-else']) {
      expect(projectOpenPath('p1', stage)).toBe('/projects/p1/overview')
    }
  })

  it('round-trips every project view', () => {
    for (const view of PROJECT_VIEWS) {
      expect(parseAppPath(projectPath('p 1', view.id))).toEqual({
        kind: 'project',
        projectId: 'p 1',
        view: view.id
      })
    }
    expect(parseAppPath(projectPath('p1'))).toEqual({
      kind: 'project',
      projectId: 'p1',
      view: null
    })
  })

  it('round-trips tasks, home and settings', () => {
    expect(parseAppPath(taskPath('p/1', 't#2'))).toEqual({
      kind: 'task',
      projectId: 'p/1',
      taskId: 't#2'
    })
    expect(parseAppPath(homePath())).toEqual({ kind: 'home' })
    expect(parseAppPath(settingsPath())).toEqual({ kind: 'settings', section: null })
    for (const section of SETTINGS_SECTIONS) {
      expect(parseAppPath(settingsPath(section.id))).toEqual({
        kind: 'settings',
        section: section.id
      })
    }
  })

  it('carries a view’s own parameters and leaves out empty ones', () => {
    expect(projectPath('p1', 'library', { item: 'i 1', new: null })).toBe(
      '/projects/p1/library?item=i+1'
    )
    expect(projectPath('p1', 'files', {})).toBe('/projects/p1/files')
  })

  it('builds and reads the search page (P5.7)', () => {
    expect(searchPath('colour scheme', { type: 'comment' })).toBe(
      '/search?q=colour+scheme&type=comment'
    )
    expect(searchPath()).toBe('/search')
    expect(parseAppPath('/search')).toEqual({ kind: 'search' })
  })

  it('opens Workload at a week and on a project', () => {
    expect(workloadPath()).toBe('/workload')
    expect(workloadPath('2026-10-12')).toBe('/workload?week=2026-10-12')
    expect(workloadPath(undefined, { project: 'p1' })).toBe('/workload?project=p1')
    expect(workloadPath(undefined, { project: null })).toBe('/workload')
  })

  it('opens the Team view, filtered by team or project', () => {
    expect(teamPath()).toBe('/team')
    expect(teamPath({ team: 't1' })).toBe('/team?team=t1')
    expect(teamPath({ project: 'p1' })).toBe('/team?project=p1')
    expect(teamPath({ team: null, project: null })).toBe('/team')
  })

  it('rejects unknown paths', () => {
    expect(parseAppPath('/projects/p1/portfolio')).toBeNull()
    expect(parseAppPath('/settings/nope')).toBeNull()
    expect(parseAppPath('/elsewhere')).toBeNull()
  })
})
