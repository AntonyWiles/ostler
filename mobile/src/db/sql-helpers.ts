/**
 * The pure parts of the database adapter: turning better-sqlite3-style calls into what
 * op-sqlite takes. Nothing here touches the native module, so it runs under plain jest.
 */

export type SqlValue = string | number | boolean | null | ArrayBuffer | ArrayBufferView

/** Binds the engine passes: nothing, positional values, one array, or one object of named values. */
export type BindArgs = unknown[]

export interface PositionalQuery {
  sql: string
  params: SqlValue[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return false
  }
  return true
}

function toSqlValue(value: unknown): SqlValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
    throw new TypeError('SQLite can only bind numbers, strings, booleans, null and binary values.')
  }
  return value as SqlValue
}

/**
 * Names (`@name`, `:name`, `$name`) in `sql` in order of appearance, skipping quoted text
 * and comments. Returns the SQL with each name replaced by `?` plus the names found.
 */
export function replaceNamedParameters(sql: string): { sql: string; names: string[] } {
  let out = ''
  const names: string[] = []
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) j += 2
          else break
        } else j++
      }
      out += sql.slice(i, j + 1)
      i = j + 1
    } else if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end
      out += sql.slice(i, stop)
      i = stop
    } else if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? sql.length : end + 2
      out += sql.slice(i, stop)
      i = stop
    } else if (ch === '@' || ch === ':' || ch === '$') {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i + 1))
      if (match) {
        names.push(match[0])
        out += '?'
        i += 1 + match[0].length
      } else {
        out += ch
        i++
      }
    } else {
      out += ch
      i++
    }
  }
  return { sql: out, names }
}

/**
 * Turns the arguments of `statement.run/get/all(...)` into op-sqlite's `(sql, params[])`.
 * better-sqlite3 accepts positional values, an array, or one object of named values.
 */
export function toPositional(sql: string, args: BindArgs): PositionalQuery {
  if (args.length === 1 && isPlainObject(args[0])) {
    const named = args[0]
    const replaced = replaceNamedParameters(sql)
    const params = replaced.names.map((name) => {
      if (!(name in named)) throw new RangeError(`Missing named parameter "${name}"`)
      return toSqlValue(named[name])
    })
    return { sql: replaced.sql, params }
  }
  const flat = args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args
  return { sql, params: flat.map(toSqlValue) }
}

export interface PragmaCall {
  /** What to run. */
  sql: string
  /** True when the pragma sets a value (`name = value`). */
  isSet: boolean
}

/** `pragma('user_version')` and `pragma('foreign_keys = ON')`, as SQL. */
export function pragmaSql(text: string): PragmaCall {
  const trimmed = text.trim().replace(/;$/, '')
  if (!/^[A-Za-z_][A-Za-z0-9_.]*(\s*(=\s*[^;]+|\([^;]*\)))?$/.test(trimmed)) {
    throw new SyntaxError(`Not a PRAGMA statement: ${text}`)
  }
  return { sql: `PRAGMA ${trimmed}`, isSet: /[=(]/.test(trimmed) }
}

/** The value `pragma(text, { simple: true })` gives: first column of the first row. */
export function simplePragmaValue(rows: Record<string, unknown>[]): unknown {
  const first = rows[0]
  if (!first) return undefined
  return Object.values(first)[0]
}

export interface TransactionSql {
  begin: string
  commit: string
  rollback: string
}

/**
 * The statements for a transaction at nesting `depth`: the outermost is a real transaction,
 * inner ones are savepoints, as better-sqlite3 does.
 */
export function transactionSql(depth: number): TransactionSql {
  if (depth === 0) return { begin: 'BEGIN', commit: 'COMMIT', rollback: 'ROLLBACK' }
  const name = `ostler_sp_${depth}`
  return {
    begin: `SAVEPOINT ${name}`,
    commit: `RELEASE ${name}`,
    rollback: `ROLLBACK TO ${name}; RELEASE ${name}`
  }
}
