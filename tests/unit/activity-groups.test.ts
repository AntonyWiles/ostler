import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { groupActivity } from '../../src/shared/activity-groups'
import type { ActivityEntry } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

function entry(id: string, workItemId: string, at: number, extra: Partial<ActivityEntry> = {}) {
  return {
    id,
    kind: 'change',
    field: 'created',
    projectId: 'p',
    workItemId,
    workItemTitle: `Task ${workItemId}`,
    at,
    actor: { kind: 'human', personId: 'me', name: 'Alex' },
    summary: 'Alex created the task from template “Software project”',
    source: { kind: 'template', name: 'Software project' },
    ...extra
  } as ActivityEntry
}

describe('grouping the project feed', () => {
  it('folds one action on many tasks into one row', () => {
    const entries = ['a', 'b', 'c'].map((task, index) => entry(`f${index}`, task, 1000 - index))
    const items = groupActivity(entries)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'group',
      summary: 'Alex added 3 tasks from the “Software project” template'
    })
  })

  it('keeps comments, other actors and distant times apart; an entry in between does not split', () => {
    const comment = entry('c1', 'a', 900, { kind: 'comment', field: undefined, summary: 'c' })
    const items = groupActivity([
      entry('f1', 'a', 1000),
      comment,
      entry('f2', 'b', 800),
      entry('f3', 'c', 800, { actor: { kind: 'automation', personId: null, name: 'API' } }),
      entry('f4', 'd', 800 - 10 * 60 * 1000)
    ])
    expect(items.map((item) => item.kind)).toEqual(['group', 'entry', 'entry', 'entry'])
    expect(items[0]).toMatchObject({ entries: [{ id: 'f1' }, { id: 'f2' }] })
    expect(items[1]).toMatchObject({ entry: { id: 'c1' } })
  })

  it('never folds two entries for the same task', () => {
    const same = { summary: 'Alex moved the task from Ready to Done', source: undefined }
    const items = groupActivity([
      entry('s1', 'a', 1000, { kind: 'status', field: undefined, ...same }),
      entry('s2', 'a', 999, { kind: 'status', field: undefined, ...same })
    ])
    expect(items.map((item) => item.kind)).toEqual(['entry', 'entry'])
  })

  it('names imports and bulk edits', () => {
    const imported = { source: { kind: 'import' as const, batchId: 'b1', fileName: 'tasks.csv' } }
    expect(
      groupActivity([entry('i1', 'a', 10, imported), entry('i2', 'b', 9, imported)])[0]
    ).toMatchObject({ summary: 'Alex imported 2 tasks from tasks.csv' })
    const moved = {
      kind: 'status' as const,
      field: undefined,
      source: undefined,
      summary: 'Alex moved the task from Ready to Done'
    }
    expect(
      groupActivity([entry('m1', 'a', 10, moved), entry('m2', 'b', 9, moved)])[0]
    ).toMatchObject({ summary: 'Alex made the same change to 2 tasks' })
  })
})

describe('a project made from a template', () => {
  const tempDir = useTempDir('ostler-groups-')
  let planning: PlanningService
  let people: PeopleService
  let service: ProjectPackageService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 9, 10, 0))
    const databasePath = await createMigratedDatabase(tempDir())
    const store = new ConfigStore(path.join(tempDir(), 'config.json'))
    planning = new PlanningService(databasePath, () => store.getProjects().map((p) => p.id))
    people = new PeopleService(databasePath)
    people.ensureMe('Me')
    const scaffold = new ProjectScaffoldService(store, () => tempDir())
    service = new ProjectPackageService({
      planning,
      registerProject: (request, fixed) => scaffold.createProject(request, fixed),
      getProject: (projectId) => store.getProjects().find((entry) => entry.id === projectId)!,
      dataDir: tempDir(),
      appVersion: 'test'
    })
  })

  afterEach(() => {
    planning.close()
    people.close()
    vi.useRealTimers()
  })

  for (const templateId of ['software-project', 'sample']) {
    it(`shows the ${templateId} template's created rows as one group; each task keeps its own`, async () => {
      const { project } = await service.createProjectFromTemplate(templateId, {})
      const tasks = planning.listWorkItems(project.id)
      const page = planning.listProjectActivity(project.id, { limit: 100 })
      const created = page.entries.filter((item) => item.field === 'created')
      expect(created).toHaveLength(tasks.length)
      expect(created[0].source).toMatchObject({ kind: 'template' })

      const items = groupActivity(page.entries)
      const groups = items.filter((item) => item.kind === 'group')
      expect(groups).toHaveLength(1)
      expect(groups[0]).toMatchObject({
        summary: expect.stringMatching(new RegExp(`added ${tasks.length} tasks from the`))
      })
      expect(items).toHaveLength(page.entries.length - tasks.length + 1)
      // A task's own history still has its row.
      expect(
        planning.listActivity(project.id, tasks[0].id).entries.some((e) => e.field === 'created')
      ).toBe(true)
    })
  }
})
