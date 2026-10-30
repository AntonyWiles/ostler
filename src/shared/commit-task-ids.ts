import { isTaskPrefix } from './task-key'

/**
 * Smart commits (N9.8b, N66): the task IDs a commit's message names. An ID is
 * the project's prefix, a dash or a space, and a number, in any case, as a
 * whole word, so "SHOP-12", "shop 12" and the branch in "Merge branch
 * 'shop-12-fix-the-login'" all name task 12, and "SHOP-123" never does. An ID
 * right after a fixing word ("Fixes SHOP-12", "closed: shop-12") is a fixes
 * mention; any other is a plain mention. Only the given prefix counts.
 */

export type CommitMentionKind = 'mention' | 'fixes'

export interface CommitTaskMention {
  number: number
  kind: CommitMentionKind
}

const FIXING_WORD = 'fix(?:es|ed)?|close[sd]?|resolve[sd]?'

/** The one pattern for a prefix, built once per prefix and kept. */
const patterns = new Map<string, RegExp>()

function patternFor(prefix: string): RegExp {
  let pattern = patterns.get(prefix)
  if (!pattern) {
    pattern = new RegExp(
      `(?:(?<![A-Za-z0-9])(${FIXING_WORD}):?\\s+)?(?<![A-Za-z0-9])${prefix}[- ](\\d{1,9})(?![A-Za-z0-9])`,
      'gi'
    )
    patterns.set(prefix, pattern)
  }
  return pattern
}

/**
 * The tasks a commit names, once each, in the order first named; a task both
 * mentioned and fixed counts as fixes. One pass over the message's text.
 */
export function findCommitTaskMentions(
  prefix: string | null | undefined,
  subject: string,
  body = ''
): CommitTaskMention[] {
  if (!prefix || !isTaskPrefix(prefix)) return []
  const text = body ? `${subject}\n${body}` : subject
  const found = new Map<number, CommitMentionKind>()
  const pattern = patternFor(prefix)
  pattern.lastIndex = 0
  for (const match of text.matchAll(pattern)) {
    const number = Number(match[2])
    if (!Number.isSafeInteger(number) || number < 1) continue
    const kind: CommitMentionKind = match[1] ? 'fixes' : 'mention'
    if (found.get(number) !== 'fixes') found.set(number, kind)
  }
  return [...found].map(([number, kind]) => ({ number, kind }))
}
