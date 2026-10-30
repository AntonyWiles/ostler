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

const BUGS = {
  project: { name: 'Bugs', color: '#ec4899', estimateUnit: 'points' },
  fields: [
    { ref: 'f1', name: 'Version', type: 'text' },
    { ref: 'f2', name: 'Customer', type: 'text' }
  ],
  taskTemplates: [{ name: 'Bug report', body: { title: 'Bug: ' }, assigneeRef: null }],
  taskTypes: [
    { ref: 'y1', name: 'Bug', icon: 'bug', fieldRefs: ['f1'], templateName: 'Bug report' },
    { ref: 'y2', name: 'Chore' }
  ],
  tasks: [{ ref: 't1', title: 'Crash', typeRef: 'y1', fieldValues: { f2: 'Acme' } }]
}

describe('task type fields and templates in the project file (N2.7b)', () => {
  const tempDir = useTempDir('ostler-type-fields-package-')
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

  it('reads each type’s fields and template, and writes them back out', async () => {
    const { project } = await service.createProjectFromPackage(packageOf(BUGS), {}, TODAY)
    const fields = planning.listFields(project.id)
    const [bug, chore] = planning.taskTypes.list(project.id)
    const template = planning.taskTemplates.listOwn(project.id)[0]
    expect(bug.fieldIds).toEqual([fields.find((field) => field.name === 'Version')!.id])
    expect(bug.templateId).toBe(template.id)
    expect(chore).toMatchObject({ fieldIds: null, templateId: null })
    // The hidden field's value came in all the same.
    const crash = planning.listWorkItems(project.id)[0]
    expect(Object.values(crash.fieldValues ?? {})).toEqual(['Acme'])

    const exported = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(validateProjectPackage(exported).ok).toBe(true)
    const versionRef = exported.fields!.find((field) => field.name === 'Version')!.ref
    expect(exported.taskTypes).toMatchObject([
      { name: 'Bug', fieldRefs: [versionRef], templateName: 'Bug report' },
      { name: 'Chore' }
    ])
    expect(exported.taskTypes![1]).not.toHaveProperty('fieldRefs')
    // Without its task templates, the file names no template.
    const bare = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false,
      include: { taskTemplates: false }
    })
    expect(bare.taskTypes![0]).not.toHaveProperty('templateName')
    expect(validateProjectPackage(bare).ok).toBe(true)
  })

  it('reads a file from before N2.7b as every field, and refuses refs it does not have', () => {
    const old = packageOf({ ...BUGS, taskTypes: [{ ref: 'y1', name: 'Bug' }], tasks: [] })
    expect(old.taskTypes![0]).not.toHaveProperty('fieldRefs')
    expect(
      validateProjectPackage({
        format: 'ostler-project-package',
        version: 1,
        ...BUGS,
        taskTypes: [{ ref: 'y1', name: 'Bug', fieldRefs: ['f9'] }]
      }).ok
    ).toBe(false)
    expect(
      validateProjectPackage({
        format: 'ostler-project-package',
        version: 1,
        ...BUGS,
        taskTypes: [{ ref: 'y1', name: 'Bug', templateName: 'Nothing' }]
      }).ok
    ).toBe(false)
  })
})
