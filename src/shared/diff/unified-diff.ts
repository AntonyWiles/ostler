/**
 * A parsed unified diff, as `git diff` writes it and Review changes shows it
 * (N9.1). Pure code, no Node or DOM: the renderer numbers and highlights
 * lines with it, and later work (comments on lines, N9.2a) addresses lines
 * through the same numbers.
 *
 * The parser never throws. Anything it does not recognise stays in the file
 * it belongs to as a `meta` line, so every line of the patch is still shown,
 * in order, and a patch cut short mid-hunk parses up to where it stops.
 */

export type DiffLineKind = 'add' | 'remove' | 'context' | 'hunk' | 'meta' | 'no-newline'

export interface DiffLine {
  kind: DiffLineKind
  /** The line as the patch has it, prefix included. */
  text: string
  /** The line's number in the old file: removed and context lines. */
  oldLine: number | null
  /** The line's number in the new file: added and context lines. */
  newLine: number | null
  /** The line's index in the whole patch, from 0. */
  index: number
}

export interface DiffHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  /** The text after the second `@@`, often the enclosing function. */
  heading: string
  /** The `@@` line first, then its body. */
  lines: DiffLine[]
}

export interface DiffFile {
  /** The path before the change; null for an added file. */
  oldPath: string | null
  /** The path after the change; null for a deleted file. */
  newPath: string | null
  /** The path to show and to match on: the new path, or the old one for a deleted file. */
  path: string
  added: boolean
  deleted: boolean
  renamed: boolean
  binary: boolean
  /** `diff --git`, `index`, `---`, `+++` and the other header lines. */
  header: DiffLine[]
  hunks: DiffHunk[]
}

export interface ParsedDiff {
  files: DiffFile[]
  /** Lines before the first file (rare: a preamble), kept so nothing is lost. */
  preamble: DiffLine[]
  /** How many lines the patch has. */
  lineCount: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

/** `a/src/x.ts` -> `src/x.ts`; `/dev/null` -> null; quoted paths unquoted. */
function stripPrefix(raw: string): string | null {
  let value = raw.trim()
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  // A tab separates a timestamp in diffs that are not Git's.
  value = value.split('\t')[0]
  if (value === '/dev/null') return null
  if (value.startsWith('a/') || value.startsWith('b/')) return value.slice(2)
  return value
}

/** The two paths of a `diff --git a/x b/y` line, when they can be told apart. */
function gitHeaderPaths(line: string): { oldPath: string; newPath: string } | null {
  const rest = line.slice('diff --git '.length)
  const quoted = rest.match(/^"((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"$/)
  if (quoted) {
    return {
      oldPath: stripPrefix(`"${quoted[1]}"`) ?? '',
      newPath: stripPrefix(`"${quoted[2]}"`) ?? ''
    }
  }
  // Unquoted: the same path twice is the usual case, so split in the middle.
  const half = (rest.length - 1) / 2
  if (Number.isInteger(half) && rest[half] === ' ') {
    const left = rest.slice(0, half)
    const right = rest.slice(half + 1)
    if (left.slice(2) === right.slice(2)) {
      return { oldPath: stripPrefix(left) ?? '', newPath: stripPrefix(right) ?? '' }
    }
  }
  const split = rest.indexOf(' b/')
  if (rest.startsWith('a/') && split > 0) {
    return { oldPath: rest.slice(2, split), newPath: rest.slice(split + 3) }
  }
  return null
}

function newFile(): DiffFile {
  return {
    oldPath: null,
    newPath: null,
    path: '',
    added: false,
    deleted: false,
    renamed: false,
    binary: false,
    header: [],
    hunks: []
  }
}

function finishFile(file: DiffFile): DiffFile {
  if (file.added) file.oldPath = null
  if (file.deleted) file.newPath = null
  if (file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath) {
    file.renamed = true
  }
  file.path = file.newPath ?? file.oldPath ?? ''
  return file
}

export function parseUnifiedDiff(patch: string): ParsedDiff {
  const rawLines = patch.length === 0 ? [] : patch.replace(/\r\n/g, '\n').split('\n')
  // A trailing newline leaves one empty string that is not a line of the patch.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop()

  const files: DiffFile[] = []
  const preamble: DiffLine[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNext = 0
  let newNext = 0
  // Lines left in the current hunk, so a body line that starts with "---"
  // or "diff" is read as a line, not as a header.
  let oldLeft = 0
  let newLeft = 0

  const line = (kind: DiffLineKind, text: string, index: number): DiffLine => ({
    kind,
    text,
    oldLine: null,
    newLine: null,
    index
  })

  rawLines.forEach((text, index) => {
    const inHunkBody = hunk !== null && (oldLeft > 0 || newLeft > 0)
    if (inHunkBody && hunk) {
      const prefix = text[0]
      if (prefix === '+' && newLeft > 0) {
        hunk.lines.push({ ...line('add', text, index), newLine: newNext++ })
        newLeft--
        return
      }
      if (prefix === '-' && oldLeft > 0) {
        hunk.lines.push({ ...line('remove', text, index), oldLine: oldNext++ })
        oldLeft--
        return
      }
      if ((prefix === ' ' || text === '') && oldLeft > 0 && newLeft > 0) {
        hunk.lines.push({
          ...line('context', text, index),
          oldLine: oldNext++,
          newLine: newNext++
        })
        oldLeft--
        newLeft--
        return
      }
      if (prefix === '\\') {
        hunk.lines.push(line('no-newline', text, index))
        return
      }
      // A line that does not fit the hunk's counts ends it.
      oldLeft = 0
      newLeft = 0
    }

    if (text.startsWith('\\') && hunk) {
      // "\ No newline at end of file" after the hunk's last line.
      hunk.lines.push(line('no-newline', text, index))
      return
    }

    if (text.startsWith('diff --git ')) {
      if (file) files.push(finishFile(file))
      file = newFile()
      hunk = null
      const paths = gitHeaderPaths(text)
      if (paths) {
        file.oldPath = paths.oldPath
        file.newPath = paths.newPath
      }
      file.header.push(line('meta', text, index))
      return
    }

    const match = HUNK_HEADER.exec(text)
    if (match) {
      if (!file) file = newFile()
      hunk = {
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        heading: match[5] ?? '',
        lines: [line('hunk', text, index)]
      }
      file.hunks.push(hunk)
      oldNext = hunk.oldStart
      newNext = hunk.newStart
      oldLeft = hunk.oldCount
      newLeft = hunk.newCount
      return
    }

    if (!file) {
      // "--- a/x" with no "diff --git" before it starts a plain unified diff.
      if (text.startsWith('--- ')) {
        file = newFile()
      } else {
        preamble.push(line('meta', text, index))
        return
      }
    }

    const current: DiffFile = file
    hunk = null
    current.header.push(line('meta', text, index))
    if (text.startsWith('--- ')) {
      const oldPath = stripPrefix(text.slice(4))
      if (oldPath === null) current.added = true
      else current.oldPath = oldPath
    } else if (text.startsWith('+++ ')) {
      const newPath = stripPrefix(text.slice(4))
      if (newPath === null) current.deleted = true
      else current.newPath = newPath
    } else if (text.startsWith('new file mode')) {
      current.added = true
    } else if (text.startsWith('deleted file mode')) {
      current.deleted = true
    } else if (text.startsWith('rename from ')) {
      current.oldPath = text.slice('rename from '.length)
      current.renamed = true
    } else if (text.startsWith('rename to ')) {
      current.newPath = text.slice('rename to '.length)
      current.renamed = true
    } else if (text.startsWith('Binary files ') || text === 'GIT binary patch') {
      current.binary = true
    }
  })
  if (file) files.push(finishFile(file))
  return { files, preamble, lineCount: rawLines.length }
}

/** Every line of a parsed diff in patch order: preamble, then each file's header and hunks. */
export function diffLines(parsed: ParsedDiff): DiffLine[] {
  const lines = [...parsed.preamble]
  for (const file of parsed.files) {
    lines.push(...file.header)
    for (const hunk of file.hunks) lines.push(...hunk.lines)
  }
  return lines
}

/**
 * The lines of a file's new version from `first` to `last` that the diff
 * shows (added or context lines), for scrolling to and highlighting a span.
 * For a deleted file, its old lines. Empty when the diff shows none of them.
 */
export function linesInRange(file: DiffFile, first: number, last: number): DiffLine[] {
  const lo = Math.min(first, last)
  const hi = Math.max(first, last)
  const useOld = file.deleted
  const found: DiffLine[] = []
  for (const hunk of file.hunks) {
    for (const entry of hunk.lines) {
      const number = useOld ? entry.oldLine : entry.newLine
      if (number !== null && number >= lo && number <= hi) found.push(entry)
    }
  }
  return found
}

/** The file a path names, matched on its new or old path. */
export function findDiffFile(parsed: ParsedDiff, path: string): DiffFile | null {
  const wanted = normalizeDiffPath(path)
  return (
    parsed.files.find(
      (file) =>
        (file.newPath !== null && normalizeDiffPath(file.newPath) === wanted) ||
        (file.oldPath !== null && normalizeDiffPath(file.oldPath) === wanted)
    ) ?? null
  )
}

/** Forward slashes, no leading `./`: how Git writes a path. */
export function normalizeDiffPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
}
