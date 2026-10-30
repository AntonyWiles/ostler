import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const human = { kind: 'human' as const }

describe('PlanningService waits-on types and lag (N7.2a)', () => {
  const tempDir = useTempDir('ostler-dependency-links-')
  let service: PlanningService

  beforeEach(async () => {
    service = new PlanningService(await createMigratedDatabase(tempDir()), () => ['project-one'])
  })

  afterEach(() => {
    service.close()
  })

  const make = (title: string, extra = {}) =>
    service.createWorkItem('project-one', { title, status: 'ready', ...extra }, human)

  it('stores links with their type and lag, and reads them back in order', () => {
    const plaster = make('Plaster')
    const data = make('Data')
    const paint = make('Paint', {
      dependencyLinks: [{ id: plaster.id, type: 'start-to-start', lagDays: 2 }, { id: data.id }]
    })
    const expected = [
      { id: plaster.id, type: 'start-to-start', lagDays: 2 },
      { id: data.id, type: 'finish-to-start', lagDays: 0 }
    ]
    expect(paint.dependencyIds).toEqual([plaster.id, data.id])
    expect(paint.dependencyLinks).toEqual(expected)
    expect(service.getWorkItem(paint.id).dependencyLinks).toEqual(expected)
    expect(
      service.listWorkItems('project-one').find((item) => item.id === paint.id)!.dependencyLinks
    ).toEqual(expected)
  })

  it('keeps a link’s type and lag when only dependencyIds is sent, and adds new ones plain', () => {
    const plaster = make('Plaster')
    const data = make('Data')
    const paint = make('Paint', {
      dependencyLinks: [{ id: plaster.id, type: 'finish-to-finish', lagDays: -3 }]
    })
    const updated = service.updateWorkItem(
      paint.id,
      { dependencyIds: [plaster.id, data.id] },
      human
    )
    expect(updated.dependencyLinks).toEqual([
      { id: plaster.id, type: 'finish-to-finish', lagDays: -3 },
      { id: data.id, type: 'finish-to-start', lagDays: 0 }
    ])
    // Another field changing leaves the links alone.
    expect(
      service.updateWorkItem(paint.id, { title: 'Paint walls' }, human).dependencyLinks
    ).toEqual(updated.dependencyLinks)
    // dependencyLinks replaces every link.
    expect(
      service.updateWorkItem(paint.id, { dependencyLinks: [{ id: data.id, lagDays: 1 }] }, human)
        .dependencyLinks
    ).toEqual([{ id: data.id, type: 'finish-to-start', lagDays: 1 }])
  })

  it('refuses an unknown type, a lag out of range or not whole, and checks ids as before', () => {
    const plaster = make('Plaster')
    const paint = make('Paint')
    const update = (dependencyLinks: unknown) =>
      service.updateWorkItem(paint.id, { dependencyLinks: dependencyLinks as never }, human)
    expect(() => update([{ id: plaster.id, type: 'start-to-finish' }])).toThrow(/type/)
    expect(() => update([{ id: plaster.id, lagDays: 366 }])).toThrow(/lag/)
    expect(() => update([{ id: plaster.id, lagDays: 1.5 }])).toThrow(/lag/)
    expect(() => update([{ id: paint.id }])).toThrow()
    expect(() => update('nope')).toThrow(/array/)
    expect(update([{ id: plaster.id, lagDays: -365 }]).dependencyLinks).toEqual([
      { id: plaster.id, type: 'finish-to-start', lagDays: -365 }
    ])
  })

  it('holds work back from the agent queue only on finish-to-start links', () => {
    const plaster = make('Plaster')
    const data = make('Data')
    const paint = make('Paint', {
      dependencyLinks: [
        { id: plaster.id, type: 'start-to-start' },
        { id: data.id, type: 'finish-to-finish', lagDays: 1 }
      ]
    })
    expect(service.unmetDependencyCount('project-one', paint.id)).toBe(0)
    const report = make('Report', { dependencyIds: [data.id] })
    expect(service.unmetDependencyCount('project-one', report.id)).toBe(1)
  })

  it('writes a type or lag change to the task’s activity, as an id change is', () => {
    const plaster = make('Plaster')
    const paint = make('Paint', { dependencyIds: [plaster.id] })
    service.updateWorkItem(
      paint.id,
      { dependencyLinks: [{ id: plaster.id, type: 'start-to-start', lagDays: 2 }] },
      human
    )
    service.updateWorkItem(
      paint.id,
      { dependencyLinks: [{ id: plaster.id, type: 'start-to-start', lagDays: -1 }] },
      human
    )
    const changes = service
      .listActivity('project-one', paint.id)
      .entries.filter((entry) => entry.field === 'dependencyLink')
    expect(changes.map((entry) => entry.summary)).toEqual([
      'Someone made it wait like this: Starts 1 day before “Plaster” starts',
      'Someone made it wait like this: Starts 2 days after “Plaster” starts'
    ])
    // Nothing is written when neither changed.
    service.updateWorkItem(
      paint.id,
      { dependencyLinks: [{ id: plaster.id, type: 'start-to-start', lagDays: -1 }] },
      human
    )
    expect(
      service
        .listActivity('project-one', paint.id)
        .entries.filter((entry) => entry.field === 'dependencyLink')
    ).toHaveLength(2)
  })
})
