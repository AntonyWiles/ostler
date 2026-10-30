import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { validateProjectPackage, type ProjectPackage } from '../../src/shared/project-package'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const TODAY = '2026-10-12'

const tempDir = useTempDir('ostler-status-package-')
let store: ConfigStore
let planning: PlanningService
let people: PeopleService
let service: ProjectPackageService

function packageOf(json: Record<string, unknown>): ProjectPackage {
  const result = validateProjectPackage({ format: 'ostler-project-package', version: 1, ...json })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const SITE = packageOf({
  project: { name: 'Website' },
  people: [],
  labels: [],
  goals: [],
  milestones: [],
  tasks: [{ ref: 't1', title: 'Write the copy' }],
  decisions: [],
  library: []
})

beforeEach(async () => {
  const databasePath = await createMigratedDatabase(tempDir())
  store = new ConfigStore(path.join(tempDir(), 'config.json'))
  planning = new PlanningService(databasePath, () => store.getProjects().map((p) => p.id))
  people = new PeopleService(databasePath)
  people.ensureMe('Alex')
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
})

describe('status updates in the project file (N5.5)', () => {
  it('carries every update, oldest first, with health, note, author and times', async () => {
    const { project } = await service.createProjectFromPackage(SITE, {}, TODAY)
    const first = planning.statusUpdates.post(
      project.id,
      { health: 'on-track', note: 'Started' },
      planning.humanActor()
    )
    planning.statusUpdates.post(
      project.id,
      { health: 'at-risk', note: '**Copy** is late' },
      { kind: 'automation' }
    )
    planning.statusUpdates.edit(first.id, { health: 'on-track', note: 'Started well' })
    const gone = planning.statusUpdates.post(
      project.id,
      { health: 'off-track', note: 'Deleted' },
      planning.humanActor()
    )
    planning.statusUpdates.delete(gone.id)

    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.statusUpdates!.map((update) => [update.health, update.note, update.by])).toEqual([
      ['on-track', 'Started well', 'person'],
      ['at-risk', '**Copy** is late', 'automation']
    ])
    expect(file.statusUpdates![0].editedAt).toBeTruthy()
    const checked = validateProjectPackage(JSON.parse(JSON.stringify(file)))
    expect(checked.ok).toBe(true)

    const { project: copy } = await service.createProjectFromPackage(file, {}, TODAY)
    const copied = planning.statusUpdates.list(copy.id)
    expect(copied.map((update) => [update.health, update.note, update.authorKind])).toEqual([
      ['at-risk', '**Copy** is late', 'automation'],
      ['on-track', 'Started well', 'human']
    ])
    expect(copied[1].postedAt).toBe(first.postedAt)
    expect(copied[1].editedAt).not.toBeNull()
  })

  it('leaves updates out when there are none, and refuses a malformed one', async () => {
    const { project } = await service.createProjectFromPackage(SITE, {}, TODAY)
    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.statusUpdates).toBeUndefined()
    const json = JSON.parse(JSON.stringify(file))
    expect(
      validateProjectPackage({
        ...json,
        statusUpdates: [{ health: 'green', postedAt: '2026-10-01T10:00:00.000Z' }]
      }).ok
    ).toBe(false)
    expect(
      validateProjectPackage({
        ...json,
        statusUpdates: [{ health: 'on-track', note: 'x'.repeat(2001), postedAt: '2026-10-01' }]
      }).ok
    ).toBe(false)
  })
})
