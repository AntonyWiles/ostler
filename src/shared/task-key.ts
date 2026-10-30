import { t } from './i18n'

/**
 * Task IDs (N9.8a, N66): each project has a short prefix, two to five capital
 * letters, and each task a number that is never reused, so a task reads as
 * SHOP-12. IDs are for people: the database's ids stay the keys everywhere,
 * and an ID is always worked out from the project's prefix and the task's
 * number, never stored in place of an id.
 */

export const TASK_PREFIX_MIN = 2
export const TASK_PREFIX_MAX = 5
/** The longest branch name Copy branch name gives. */
export const BRANCH_NAME_MAX = 50

const PREFIX_PATTERN = /^[A-Z]{2,5}$/

/** Whether `value` is a prefix as stored: two to five letters A to Z, capitals. */
export function isTaskPrefix(value: unknown): value is string {
  return typeof value === 'string' && PREFIX_PATTERN.test(value)
}

/**
 * The one check for a prefix the person typed, whichever surface sends it:
 * trimmed and made capital, then two to five letters A to Z. Returns the
 * prefix as it is stored, or null when it is not one.
 */
export function parseTaskPrefix(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const prefix = value.trim().toUpperCase()
  return isTaskPrefix(prefix) ? prefix : null
}

/** Letters A to Z only, accents taken off: "Café Ünïon" → ["CAFE", "UNION"]. */
function nameWords(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((word) => word !== '')
}

/**
 * A prefix from a project's name: the first letters of up to three words, or
 * the first three letters of a single word, made unique among `taken` by
 * adding a letter. "Shop" → SHO, "Online shop" → OS, "Big online shop" → BOS.
 * A name with no letters gives TASK.
 */
export function prefixFromName(name: string, taken: Iterable<string> = []): string {
  const used = new Set([...taken].map((prefix) => prefix.toUpperCase()))
  const words = nameWords(name)
  const letters = words.join('')
  let base: string
  if (words.length >= 2)
    base = words
      .slice(0, 3)
      .map((word) => word[0])
      .join('')
  else base = letters.slice(0, 3)
  // A one-letter name ("X") or none at all: TASK.
  if (base.length < TASK_PREFIX_MIN) base = 'TASK'
  if (!used.has(base)) return base
  // Taken: add a letter, the name's own next letters first, then A to Z.
  const extra = [...new Set(letters.slice(base.length) + ALPHABET)]
  let stem = base
  while (stem.length < TASK_PREFIX_MAX) {
    for (const letter of extra) if (!used.has(stem + letter)) return stem + letter
    stem += extra[0]
  }
  // Every such form taken: two letters counted through the alphabet.
  const head = base.slice(0, 3)
  for (const a of ALPHABET)
    for (const b of ALPHABET) if (!used.has(head + a + b)) return head + a + b
  return base
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** A task's ID, SHOP-12, or null for a task with no number (one built outside the database). */
export function taskKey(
  prefix: string | null | undefined,
  number: number | null | undefined
): string | null {
  if (!prefix || typeof number !== 'number' || !Number.isInteger(number) || number < 1) return null
  return `${prefix}-${number}`
}

/** A task's ID as the interface shows it, through its message so a language can place it. */
export function taskIdLabel(id: string): string {
  return t('tasks:taskId.shown', { id })
}

/**
 * Reads a task ID out of what a person typed: "SHOP-12", "shop-12" and
 * "shop 12" all read as { prefix: "SHOP", number: 12 }. Anything else, null.
 */
export function parseTaskKey(text: unknown): { prefix: string; number: number } | null {
  if (typeof text !== 'string') return null
  const match = /^\s*([A-Za-z]{2,5})[\s-]*#?(\d{1,9})\s*$/.exec(text)
  if (!match) return null
  const number = Number(match[2])
  if (!Number.isSafeInteger(number) || number < 1) return null
  return { prefix: match[1].toUpperCase(), number }
}

/**
 * A title as a slug: letters and digits, accents taken off, small letters,
 * words joined with dashes.
 */
export function titleSlug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Copy branch name: the prefix in small letters, the number, and the title as
 * a slug, at most 50 characters in all, never ending in a dash:
 * `shop-12-fix-the-login`. An empty title gives just `shop-12`.
 */
export function taskBranchName(prefix: string, number: number, title: string): string {
  const key = `${prefix.toLowerCase()}-${number}`
  const slug = titleSlug(title)
  if (slug === '') return key
  const room = BRANCH_NAME_MAX - key.length - 1
  if (room <= 0) return key
  let cut = slug.slice(0, room)
  // Cut at a word's end when the title is too long, where there is one.
  if (slug.length > room) {
    const lastDash = cut.lastIndexOf('-')
    cut = slug[room] === '-' ? cut : lastDash > 0 ? cut.slice(0, lastDash) : cut
  }
  cut = cut.replace(/-+$/g, '')
  return cut === '' ? key : `${key}-${cut}`
}
