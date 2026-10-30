/** One line of a comparison: in both texts, only in the newer, or only in the older. */
export interface ComparedLine {
  kind: 'same' | 'added' | 'removed'
  text: string
}

/**
 * Above this many line pairs left after trimming what both texts share at
 * the start and end, the lines between are shown as removed then added
 * rather than matched one by one, so a huge description never stalls.
 */
const MAX_MATCHED_PAIRS = 2_000_000

/**
 * A simple line comparison of `older` with `newer` (description history,
 * N2.6): the lines they share, and those only one has. Matches the longest
 * run of common lines; shared starts and ends are trimmed first, so a typical
 * edit compares only the lines around it.
 */
export function compareLines(older: string, newer: string): ComparedLine[] {
  const a = older.split('\n')
  const b = newer.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }
  const same = (text: string): ComparedLine => ({ kind: 'same', text })
  const middle = matchLines(a.slice(start, endA), b.slice(start, endB))
  return [...a.slice(0, start).map(same), ...middle, ...a.slice(endA).map(same)]
}

function matchLines(a: string[], b: string[]): ComparedLine[] {
  const removed = (text: string): ComparedLine => ({ kind: 'removed', text })
  const added = (text: string): ComparedLine => ({ kind: 'added', text })
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_MATCHED_PAIRS)
    return [...a.map(removed), ...b.map(added)]
  // lengths[i * width + j]: the longest common run of a[i..] and b[j..].
  const width = b.length + 1
  const lengths = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      lengths[i * width + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1])
  const lines: ComparedLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] })
      i += 1
      j += 1
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
      lines.push(removed(a[i]))
      i += 1
    } else {
      lines.push(added(b[j]))
      j += 1
    }
  }
  return [...lines, ...a.slice(i).map(removed), ...b.slice(j).map(added)]
}
