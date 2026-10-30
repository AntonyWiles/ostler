import {
  pragmaSql,
  replaceNamedParameters,
  simplePragmaValue,
  toPositional,
  transactionSql
} from '../src/db/sql-helpers'

describe('toPositional', () => {
  it('passes positional values through and turns undefined into null', () => {
    expect(toPositional('SELECT ?, ?', ['a', undefined])).toEqual({
      sql: 'SELECT ?, ?',
      params: ['a', null]
    })
  })

  it('accepts one array of values', () => {
    expect(toPositional('SELECT ?, ?', [[1, 2]]).params).toEqual([1, 2])
  })

  it('turns named values into positional ones in order of appearance, repeats included', () => {
    const query = toPositional('UPDATE t SET a = @a, b = :b WHERE a = @a AND k = $k', [
      { a: 1, b: 'two', k: 'key' }
    ])
    expect(query.sql).toBe('UPDATE t SET a = ?, b = ? WHERE a = ? AND k = ?')
    expect(query.params).toEqual([1, 'two', 1, 'key'])
  })

  it('reports a missing named value', () => {
    expect(() => toPositional('SELECT @gone', [{ other: 1 }])).toThrow('gone')
  })

  it('refuses values SQLite cannot bind and converts bigint', () => {
    expect(() => toPositional('SELECT ?, ?', [1, { x: 1 }])).toThrow(TypeError)
    expect(toPositional('SELECT ?', [BigInt(5)]).params).toEqual([5])
  })

  it('keeps binary values as they are', () => {
    const bytes = new Uint8Array([1, 2])
    expect(toPositional('SELECT ?', [bytes]).params[0]).toBe(bytes)
  })
})

describe('replaceNamedParameters', () => {
  it('leaves names inside strings, identifiers and comments alone', () => {
    const { sql, names } = replaceNamedParameters(
      "SELECT '@no', \"$no\", x -- :no\n, @yes /* :no */ FROM t WHERE y = 'it''s :no'"
    )
    expect(names).toEqual(['yes'])
    expect(sql).toBe("SELECT '@no', \"$no\", x -- :no\n, ? /* :no */ FROM t WHERE y = 'it''s :no'")
  })
})

describe('pragmaSql', () => {
  it('builds reads and sets', () => {
    expect(pragmaSql('user_version')).toEqual({ sql: 'PRAGMA user_version', isSet: false })
    expect(pragmaSql('foreign_keys = ON;')).toEqual({
      sql: 'PRAGMA foreign_keys = ON',
      isSet: true
    })
    expect(pragmaSql('table_info(people)').isSet).toBe(true)
  })

  it('refuses anything that is not one pragma', () => {
    expect(() => pragmaSql('user_version; DROP TABLE t')).toThrow(SyntaxError)
  })
})

describe('simplePragmaValue', () => {
  it('takes the first column of the first row', () => {
    expect(simplePragmaValue([{ user_version: 84 }])).toBe(84)
    expect(simplePragmaValue([])).toBeUndefined()
  })
})

describe('transactionSql', () => {
  it('is a real transaction at the top and savepoints inside', () => {
    expect(transactionSql(0)).toEqual({ begin: 'BEGIN', commit: 'COMMIT', rollback: 'ROLLBACK' })
    expect(transactionSql(2).begin).toBe('SAVEPOINT ostler_sp_2')
    expect(transactionSql(2).commit).toBe('RELEASE ostler_sp_2')
    expect(transactionSql(2).rollback).toBe('ROLLBACK TO ostler_sp_2; RELEASE ostler_sp_2')
  })
})
