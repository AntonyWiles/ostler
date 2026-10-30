/**
 * Manual order (D31): each task carries an order key, a string that sorts
 * between its neighbours byte by byte (SQLite's BINARY collation and
 * JavaScript's `<` agree on it). Moving a task writes one key between the two
 * tasks it now sits between, so a move writes one row.
 *
 * Keys are base-62 fractions: digits `0-9A-Za-z`, never empty and never
 * ending in `0` (a key ending in `0` would leave no room just above its
 * prefix). The key is internal: callers place a task before or after another,
 * never send a key.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

/**
 * Keys longer than this are a sign that one spot was split many times: the
 * caller spaces the project's keys out again (`spacedOrderKeys`) and places
 * the task between the new ones.
 */
export const MAX_ORDER_KEY_LENGTH = 32

const digit = (char: string | undefined): number => (char === undefined ? 0 : DIGITS.indexOf(char))

/** A key strictly between `a` and `b` (`a < b`); `a` may be '' for "before everything". */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Keep the common prefix, then split what follows it.
    let n = 0
    while (n < b.length && (a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const low = a ? digit(a[0]) : 0
  const high = b !== null ? digit(b[0]) : BASE
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)]
  // Neighbouring digits: a longer `b` has room under it; otherwise go one digit deeper.
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[low] + midpoint(a.slice(1), null)
}

/** Keys are made at least this long when appending, so appends have room. */
const APPEND_WIDTH = 3

/**
 * The key one step after `a`: `a` read as a number (padded to
 * `APPEND_WIDTH` digits) with its last digit raised by one, carrying.
 * Appending is how most tasks are made, and this way a hundred thousand
 * appends fit in three digits instead of the key growing every few.
 */
function increment(a: string): string {
  const digits = [...a.padEnd(APPEND_WIDTH, DIGITS[0])].map(digit)
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] < BASE - 1) {
      digits[i]++
      // Trailing zeros are dropped: `W00` is `W`.
      return digits
        .slice(0, i + 1)
        .map((value) => DIGITS[value])
        .join('')
    }
  }
  // Every digit is the largest: go one digit deeper.
  return digits.map((value) => DIGITS[value]).join('') + DIGITS[BASE / 2]
}

/**
 * A key between `before` and `after`, either of which may be null for "the
 * start" or "the end". Both null is the first key of an empty list.
 */
export function orderKeyBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) {
    throw new Error(`Order keys out of order: ${before} is not before ${after}`)
  }
  if (after === null) return before === null ? DIGITS[BASE / 2] : increment(before)
  return midpoint(before ?? '', after)
}

/**
 * `count` keys in order, evenly spaced and all the same length, with room
 * between each pair: the migration's backfill and the rebalancing a project
 * gets when its keys grow too long.
 */
export function spacedOrderKeys(count: number): string[] {
  if (count <= 0) return []
  // Room for every key, then two more digits so later moves stay short.
  let width = 1
  while (BASE ** width < count + 1) width++
  width += 1
  const span = BASE ** width
  const step = Math.floor(span / (count + 1))
  const keys: string[] = []
  for (let i = 1; i <= count; i++) {
    let value = i * step
    let key = ''
    for (let place = 0; place < width; place++) {
      key = DIGITS[value % BASE] + key
      value = Math.floor(value / BASE)
    }
    keys.push(key.replace(/0+$/, '') || DIGITS[1])
  }
  return keys
}

/** Whether a key is well formed: the main process checks keys it reads back. */
export function isOrderKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-Za-z]*[1-9A-Za-z]$/.test(value)
}
