import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { validateProjectPackage, type ProjectPackage } from '../../src/shared/project-package'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const TODAY = '2026-10-17'

function packageOf(json: Record<string, unknown>): ProjectPackage {
  const result = validateProjectPackage({ format: 'ostler-project-package', version: 1, ...json })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const IDEAS = {
  project: { name: 'Ideas', color: '#ec4899', estimateUnit: 'points' },
  tasks: [
    { ref: 't1', title: 'Dark mode', someday: true, impact: 4, effort: 2 },
    { ref: 't2', title: 'Rewrite it', someday: true, effort: 5 },
    { ref: 't3', title: 'Plain task' }
  ]
}

describe('scores in the project file and templates (N1.1b)', () => {
  const tempDir = useTempDir('ostler-idea-package-')
  let store: ConfigStore
  let planning: PlanningService
  let people: PeopleService
  let service: ProjectPackageService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 17, 10, 0))
    const databasePath = await createMigratedDatabase(tempDir())
    store = new ConfigStore(path.join(tempDir(), 'config.json'))
    planning = new PlanningService(databasePath, () => store.getProjects().map((p) => p.id))
    people = new PeopleService(databasePath)
    people.ensureMe('Me')
    const scaffold = new ProjectScaffoldService(store, () => tempDir())
    service = new ProjectPackageService({
      planning,
      registerProject: async (request, fixed) => scaffold.createProject(request, fixed),
      getProject: (projectId) => {
        const project = store.getProjects().find((entry) => entry.id === projectId)
        if (!project) throw new Error('Project not found')
        return project
      },
      dataDir: tempDir(),
      appVersion: 'test'
    })
  })

  afterEach(() => {
    planning.close()
    people.close()
    vi.useRealTimers()
  })

  it('reads scores from a file, writes them back out, and a template keeps them', async () => {
    const { project } = await service.createProjectFromPackage(packageOf(IDEAS), {}, TODAY)
    const byTitle = (items: { title: string }[], title: string) =>
      items.find((item) => item.title === title)!
    const items = planning.listWorkItems(project.id)
    expect(byTitle(items, 'Dark mode')).toMatchObject({ impact: 4, effort: 2, someday: true })
    expect(byTitle(items, 'Rewrite it')).toMatchObject({ impact: null, effort: 5 })

    for (const kind of ['export', 'template'] as const) {
      const exported = service.exportProjectAsPackage(project.id, {
        kind,
        relativeDates: kind === 'template'
      })
      expect(byTitle(exported.tasks, 'Dark mode')).toMatchObject({ impact: 4, effort: 2 })
      expect(byTitle(exported.tasks, 'Rewrite it')).not.toHaveProperty('impact')
      expect(byTitle(exported.tasks, 'Plain task')).not.toHaveProperty('impact')
      expect(byTitle(exported.tasks, 'Plain task')).not.toHaveProperty('effort')

      const { project: copy } = await service.createProjectFromPackage(exported, {}, TODAY)
      const copied = planning.listWorkItems(copy.id)
      expect(byTitle(copied, 'Dark mode')).toMatchObject({ impact: 4, effort: 2 })
      expect(byTitle(copied, 'Plain task')).toMatchObject({ impact: null, effort: null })
    }
  })

  it('refuses a file whose score is not a whole number from 1 to 5', () => {
    for (const impact of [0, 6, 2.5, 'high']) {
      const result = validateProjectPackage({
        format: 'ostler-project-package',
        version: 1,
        ...IDEAS,
        tasks: [{ ref: 't1', title: 'Bad', impact }]
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/impact must be a whole number from 1 to 5/)
    }
  })
})
