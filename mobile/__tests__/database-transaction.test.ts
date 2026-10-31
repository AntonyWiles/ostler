import type { DB } from '@op-engineering/op-sqlite'
import { wrapDatabase } from '../src/db/database'

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }))

/** A fake op-sqlite handle that records each statement and can fail on a chosen one. */
function fakeRaw(failOn?: string) {
  const statements: string[] = []
  const raw = {
    executeSync(sql: string) {
      statements.push(sql)
      if (failOn !== undefined && sql === failOn) {
        failOn = undefined
        throw new Error('FOREIGN KEY constraint failed')
      }
      return { rows: [], rowsAffected: 0 }
    },
    close() {}
  }
  return { raw: raw as unknown as DB, statements }
}

describe('wrapDatabase transaction', () => {
  it('rolls back when COMMIT fails and leaves later transactions at the top level', () => {
    const { raw, statements } = fakeRaw('COMMIT')
    const db = wrapDatabase(raw)

    expect(() => db.transaction(() => 'loaded')()).toThrow('FOREIGN KEY constraint failed')
    expect(statements).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK'])

    statements.length = 0
    expect(db.transaction(() => 'next')()).toBe('next')
    expect(statements).toEqual(['BEGIN', 'COMMIT'])
  })

  it('uses a savepoint inside an outer transaction and rolls it back on error', () => {
    const { raw, statements } = fakeRaw()
    const db = wrapDatabase(raw)

    db.transaction(() => {
      expect(() =>
        db.transaction(() => {
          throw new Error('inner failed')
        })()
      ).toThrow('inner failed')
    })()

    expect(statements).toEqual([
      'BEGIN',
      'SAVEPOINT ostler_sp_1',
      'ROLLBACK TO ostler_sp_1; RELEASE ostler_sp_1',
      'COMMIT'
    ])
  })

  it('reports the original error when the rollback fails too', () => {
    const { raw } = fakeRaw('ROLLBACK')
    const db = wrapDatabase(raw)

    expect(() =>
      db.transaction(() => {
        throw new Error('original')
      })()
    ).toThrow('original')
    expect(db.transaction(() => 1)()).toBe(1)
  })
})
