import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditDb } from '../../mobile/src/data/edits'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { createMigratedDatabase } = await import('../helpers/database')
const plan = await import('../../mobile/src/data/plan')

// A milestone or decision made on the phone is the row the desktop would write for it.

const PROJECT = '00000000-0000-4000-8000-000000000001'
const NOW = new Date(2026, 9, 16, 9, 0)

describe('milestones and decisions made on the phone', () => {
  const tempDir = useTempDir('ostler-mobile-plan-records-')
  let path: string
  let db: Database.Database

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    path = await createMigratedDatabase(tempDir())
    db = new Database(path)
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  /** A row as stored, without its id. */
  function row(table: string, id: string): Record<string, unknown> {
    const found = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<
      string,
      unknown
    >
    const { id: _id, ...rest } = found
    return rest
  }

  function desktop<T>(run: (planning: InstanceType<typeof PlanningService>) => T): T {
    const planning = new PlanningService(path, () => [PROJECT])
    try {
      return run(planning)
    } finally {
      planning.close()
    }
  }

  it('adds a milestone as createMilestone does', () => {
    const input = { name: '  Kitchen done ', outcome: 'Units in', targetDate: '2026-11-20' }
    const fromDesktop = desktop((planning) => planning.createMilestone(PROJECT, input).id)
    const fromPhone = plan.addMilestone(db as unknown as EditDb, PROJECT, input)
    expect(row('planning_milestones', fromPhone)).toEqual(row('planning_milestones', fromDesktop))
    expect(plan.milestones(db as unknown as QueryDb, PROJECT).map((m) => m.name)).toEqual([
      'Kitchen done',
      'Kitchen done'
    ])
  })

  it('records a decision as createDecision does, dated today', () => {
    const input = {
      title: 'Worktop',
      decision: 'Laminate',
      context:
        'Oak marks, see [tiles](ostler://task/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000aa)',
      alternatives: 'Quartz',
      consequences: ''
    }
    const fromDesktop = desktop(
      (planning) =>
        planning.createDecision(PROJECT, {
          title: input.title,
          decision: input.decision,
          context: input.context,
          alternativesConsidered: input.alternatives,
          consequences: input.consequences
        }).id
    )
    const fromPhone = plan.recordDecision(db as unknown as EditDb, PROJECT, input)
    expect(row('planning_decisions', fromPhone)).toEqual(row('planning_decisions', fromDesktop))
    expect(row('planning_decisions', fromPhone).date).toBe('2026-10-16')
    const links = db
      .prepare('SELECT source_id FROM item_links WHERE source_kind = ?')
      .all('decision') as { source_id: string }[]
    expect(links.map((link) => link.source_id).sort()).toEqual([fromDesktop, fromPhone].sort())
  })

  it('refuses a milestone with no name or a decision with no decision', () => {
    expect(() => plan.addMilestone(db as unknown as EditDb, PROJECT, { name: '  ' })).toThrow(
      'Milestone name is required'
    )
    expect(() =>
      plan.recordDecision(db as unknown as EditDb, PROJECT, { title: 'Tiles', decision: '' })
    ).toThrow('Decision summary is required')
  })
})
