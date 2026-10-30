import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { showAgentColumnsWhereNeeded } from '../../electron/services/agents-switch'
import { DEFAULT_CONFIG, type WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/** A project's columns as the planning service keeps them (R2.4, D34). */
describe('PlanningService columns', () => {
  const tempDir = useTempDir('ostler-columns-')
  let service: PlanningService
  const human = { kind: 'human' } as const
  const free = { agentsLocked: false }

  beforeEach(async () => {
    service = new PlanningService(await createMigratedDatabase(tempDir()), () => ['p1', 'p2'])
  })

  afterEach(() => {
    service.close()
  })

  it('starts standard, and keeps names and hidden columns per project', () => {
    expect(service.columns.get('p1')).toEqual({ names: {}, hidden: [] })
    const saved = service.columns.update(
      'p1',
      { names: { backlog: 'To do' }, hidden: ['blocked', 'review'] },
      free
    )
    expect(saved).toEqual({ names: { backlog: 'To do' }, hidden: ['blocked', 'review'] })
    expect(service.columns.get('p1')).toEqual(saved)
    expect(service.columns.get('p2')).toEqual({ names: {}, hidden: [] })
    expect(service.columns.all()).toEqual({ p1: saved })
    // Only the names sent change.
    service.columns.update('p1', { names: { active: 'Doing' } }, free)
    expect(service.columns.get('p1').names).toEqual({ backlog: 'To do', active: 'Doing' })
    expect(() => service.columns.get('gone')).toThrow('Project not found')
  })

  it('refuses to hide a column while live tasks are in it, and says how many', () => {
    const first = service.createWorkItem('p1', { title: 'Wait', status: 'blocked' }, human)
    const second = service.createWorkItem('p1', { title: 'Wait too', status: 'blocked' }, human)
    expect(() => service.columns.update('p1', { hidden: ['blocked'] }, free)).toThrow(
      'Blocked can’t be hidden while 2 tasks are in it'
    )
    // An archived task is not live.
    service.archiveWorkItem(first.id, human)
    expect(() => service.columns.update('p1', { hidden: ['blocked'] }, free)).toThrow(
      'while 1 task is in it'
    )
    service.updateWorkItem(second.id, { status: 'done' }, human)
    expect(service.columns.update('p1', { hidden: ['blocked'] }, free).hidden).toEqual(['blocked'])
    // A column hidden already stays hidden when a task comes in from elsewhere.
    service.createWorkItem('p1', { title: 'From the API', status: 'blocked' }, human)
    expect(service.columns.update('p1', { names: { done: 'Finished' } }, free).hidden).toEqual([
      'blocked'
    ])
  })

  it('names the column in the refusal by its project name', () => {
    service.createWorkItem('p1', { title: 'Check', status: 'review' }, human)
    service.columns.update('p1', { names: { review: 'Check it' } }, free)
    expect(() => service.columns.update('p1', { hidden: ['review'] }, free)).toThrow(
      /^Check it can’t be hidden/
    )
  })

  it('keeps Ready and In review while agents are on and the project has a folder', () => {
    const locked = { agentsLocked: true }
    expect(() => service.columns.update('p1', { hidden: ['ready'] }, locked)).toThrow(
      'agents are on'
    )
    expect(() => service.columns.update('p1', { hidden: ['review'] }, locked)).toThrow(
      'agents are on'
    )
    expect(service.columns.update('p1', { hidden: ['blocked'] }, locked).hidden).toEqual([
      'blocked'
    ])
  })

  it('shows hidden Ready and In review again when agents need them', () => {
    service.columns.update('p1', { hidden: ['ready', 'blocked', 'review'] }, free)
    expect(service.columns.showAgentColumns('p1')).toEqual(['ready', 'review'])
    expect(service.columns.get('p1').hidden).toEqual(['blocked'])
    expect(service.columns.showAgentColumns('p1')).toEqual([])
  })

  it('turning agents on shows them in projects with a folder only', () => {
    service.columns.update('p1', { hidden: ['ready', 'review'] }, free)
    service.columns.update('p2', { hidden: ['ready', 'review'] }, free)
    const projects = [
      { id: 'p1', path: 'C:\\work\\site' },
      { id: 'p2', path: null }
    ] as unknown as WatchedProject[]
    const show = (projectId: string) => service.columns.showAgentColumns(projectId)
    const harness = (enabled: boolean) => ({ ...DEFAULT_CONFIG.harness, enabled })
    showAgentColumnsWhereNeeded({ harness: harness(false), projects }, show)
    expect(service.columns.get('p1').hidden).toEqual(['ready', 'review'])
    showAgentColumnsWhereNeeded({ harness: harness(true), projects }, show)
    expect(service.columns.get('p1').hidden).toEqual([])
    expect(service.columns.get('p2').hidden).toEqual(['ready', 'review'])
  })

  it('adopts a file’s settings, leaving shown a column a task is in or agents use', () => {
    service.createWorkItem('p1', { title: 'Next', status: 'blocked' }, human)
    const adopted = service.columns.adopt(
      'p1',
      { names: { active: 'Doing' }, hidden: ['ready', 'blocked', 'review'] },
      { agentsLocked: true }
    )
    expect(adopted).toEqual({ names: { active: 'Doing' }, hidden: [] })
    expect(
      service.columns.adopt('p2', { hidden: ['ready', 'blocked'] }, { agentsLocked: false })
    ).toEqual({ names: {}, hidden: ['ready', 'blocked'] })
  })
})
