import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GettingStartedProgress } from '../../src/shared/ostler-api'
import { gettingStarted } from '../../src/shared/getting-started'
import { PlanningService } from '../../electron/services/planning-service'
import { GettingStartedService } from '../../electron/services/getting-started-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const human = { kind: 'human' as const }
const NOTHING: GettingStartedProgress = {
  dismissed: false,
  triedView: false,
  usedSearch: false,
  sawBackups: false
}

describe('getting started (P8.1)', () => {
  it('is complete when every step that is not optional is done', () => {
    const state = {
      createdTask: true,
      datedTask: true,
      aiConfigured: false,
      progress: { ...NOTHING, triedView: true, usedSearch: true, sawBackups: true }
    }
    expect(gettingStarted(state)).toMatchObject({ complete: true, visible: false })
    expect(gettingStarted({ ...state, datedTask: false })).toMatchObject({
      complete: false,
      visible: true
    })
    expect(
      gettingStarted({
        ...state,
        datedTask: false,
        progress: { ...state.progress, dismissed: true }
      })
    ).toMatchObject({ complete: false, visible: false })
  })

  describe('GettingStartedService', () => {
    const tempDir = useTempDir('ostler-getting-started-')
    let planning: PlanningService
    let progress: GettingStartedProgress
    let service: GettingStartedService

    beforeEach(async () => {
      const databasePath = await createMigratedDatabase(tempDir())
      planning = new PlanningService(databasePath, () => ['p1'])
      progress = { ...NOTHING }
      service = new GettingStartedService({
        db: planning.database,
        getProjectIds: () => ['p1'],
        aiConfigured: () => false,
        getProgress: () => progress,
        saveProgress: (next) => {
          progress = next
        }
      })
    })

    afterEach(() => {
      planning.close()
    })

    const done = (id: string) => service.read().steps.find((step) => step.id === id)!.done

    it('ticks "Create a task" and "due date" from the tasks the person made', () => {
      expect(done('createTask')).toBe(false)
      planning.createWorkItem('p1', { title: 'Plan the party' }, human)
      expect(done('createTask')).toBe(true)
      expect(done('dueDate')).toBe(false)
      planning.createWorkItem('p1', { title: 'Book the hall', targetDate: '2026-11-01' }, human)
      expect(done('dueDate')).toBe(true)
    })

    it('does not count tasks from a template, the sample project or an import', () => {
      planning.createWorkItem(
        'p1',
        { title: 'Welcome', targetDate: '2026-11-01' },
        { kind: 'human', template: 'Welcome to Ostler' }
      )
      planning.createWorkItem('p1', { title: 'Imported' }, human, 'human', 'batch-1')
      expect(done('createTask')).toBe(false)
      expect(done('dueDate')).toBe(false)
    })

    it('records what the person did, never unticks, and dismisses', () => {
      expect(service.record('usedSearch').steps.find((s) => s.id === 'search')!.done).toBe(true)
      expect(() => service.record('somethingElse' as never)).toThrow('Unknown')
      expect(service.dismiss()).toMatchObject({ dismissed: true, visible: false })
      expect(progress).toMatchObject({ usedSearch: true, dismissed: true })
    })
  })
})
