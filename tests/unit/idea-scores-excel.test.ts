import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { ImportService } from '../../electron/services/import-service'
import { buildTasksCsv } from '../../electron/services/export-service'
import type { CsvUpdatePreview, CsvUpdateResult, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }
}))

describe('scores through Edit in Excel (N1.1b)', () => {
  const tempDir = useTempDir('ostler-idea-excel-')
  let store: ConfigStore
  let planning: PlanningService
  let people: PeopleService
  let imports: ImportService
  let project: WatchedProject

  beforeEach(async () => {
    const databasePath = await createMigratedDatabase(tempDir())
    store = new ConfigStore(path.join(tempDir(), 'config.json'))
    planning = new PlanningService(databasePath, () => store.getProjects().map((p) => p.id))
    people = new PeopleService(databasePath)
    people.ensureMe('Me')
    const scaffold = new ProjectScaffoldService(store, () => tempDir())
    const packages = new ProjectPackageService({
      planning,
      registerProject: async (request, fixed) => scaffold.createProject(request, fixed),
      getProject: (projectId) => store.getProjects().find((entry) => entry.id === projectId)!,
      projectNames: () => store.getProjects().map((entry) => entry.name),
      dataDir: tempDir(),
      appVersion: 'test',
      libraryFilePath: () => ''
    })
    imports = new ImportService({
      planning,
      packages,
      getProjects: () => store.getProjects(),
      locale: () => 'en-GB'
    })
    project = (
      await scaffold.createProject({ name: 'Ideas', color: '', notes: '', tags: [], folder: null })
    ).project
  })

  afterEach(() => {
    planning.close()
    people.close()
  })

  const human = () => planning.humanActor()

  it('brings changed scores back, clears an emptied one, and refuses one out of range', () => {
    const task = planning.createWorkItem(
      project.id,
      { title: 'Dark mode', someday: true, impact: 4, effort: 2 },
      human()
    )
    const { text } = buildTasksCsv(planning, project, {
      withIds: true,
      columns: ['title', 'impact', 'effort']
    })
    const rows = text
      .replace(/^\ufeff/, '')
      .trimEnd()
      .split('\r\n')
    expect(rows[0]).toBe('ID,Title,Impact (1-5),Effort (1-5)')
    expect(rows[1]).toBe(`${task.id},Dark mode,4,2`)

    const edited = `${rows[0]}\r\n${task.id},Dark mode,5,\r\n`
    const preview = imports.updateCsvText(
      project.id,
      edited,
      'tasks.csv',
      {},
      true,
      human()
    ) as CsvUpdatePreview
    expect(preview.changed).toHaveLength(1)
    imports.updateCsvText(project.id, edited, 'tasks.csv', {}, false, human()) as CsvUpdateResult
    expect(planning.getWorkItem(task.id)).toMatchObject({ impact: 5, effort: null })

    const bad = imports.updateCsvText(
      project.id,
      `${rows[0]}\r\n${task.id},Dark mode,9,1\r\n`,
      'tasks.csv',
      {},
      true,
      human()
    ) as CsvUpdatePreview
    expect(JSON.stringify(bad)).toContain('\\"9\\" is not a score from 1 to 5')
  })
})
