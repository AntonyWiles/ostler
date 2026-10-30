import { Fragment, useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import {
  diffLines,
  findDiffFile,
  linesInRange,
  parseUnifiedDiff,
  type DiffFile,
  type DiffLine,
  type ParsedDiff
} from '@shared/diff/unified-diff'
import { commentedLines, sideOfLine } from '@shared/review-comments'
import { t } from '@shared/i18n'
import { cx } from '../ui/cx'
import './DiffPatch.css'

/** The kind of one line in a unified diff, for its colour. */
export function diffLineKind(line: string): 'add' | 'remove' | 'hunk' | 'file' | 'context' {
  if (line.startsWith('+++') || line.startsWith('---')) return 'file'
  if (line.startsWith('diff --git') || line.startsWith('index ')) return 'file'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'remove'
  return 'context'
}

function lineClass(line: DiffLine): string {
  switch (line.kind) {
    case 'add':
    case 'remove':
    case 'hunk':
    case 'context':
      return line.kind
    case 'no-newline':
      return 'meta'
    case 'meta':
      return 'file'
  }
}

/** Lines of a file to scroll to and highlight: a path and its first and last line. */
export interface DiffHighlight {
  path: string
  startLine: number
  endLine: number
  /**
   * A line comment's side (N9.2a): 'old' numbers removed lines in the old
   * version. Absent: the new version's lines, as a walkthrough names them.
   */
  side?: 'new' | 'old'
}

/** A span of lines picked for a comment: one file, one side. */
export interface DiffLineSelection {
  file: string
  side: 'new' | 'old'
  firstLine: number
  lastLine: number
}

/**
 * Commenting on lines (N9.2a): line numbers become buttons, a span shows as
 * selected, and `after` puts comments and the comment form under a line.
 */
export interface DiffCommenting {
  selection: DiffLineSelection | null
  /** A line number was clicked, or Enter pressed on it; `extend` with Shift. */
  onPick: (file: DiffFile, line: DiffLine, extend: boolean) => void
  /** What to show under the patch line with this index. */
  after: (index: number) => ReactNode
}

/**
 * The patch lines a highlight covers, by index; empty when the shown diff
 * does not hold those lines (the file did not change there, or the patch was
 * cut short before them).
 */
export function highlightedIndexes(parsed: ParsedDiff, highlight: DiffHighlight): Set<number> {
  const file = findDiffFile(parsed, highlight.path)
  if (!file) return new Set()
  if (highlight.side) {
    return new Set(
      commentedLines(parsed, {
        file: highlight.path,
        side: highlight.side,
        firstLine: highlight.startLine,
        lastLine: highlight.endLine
      }).map((line) => line.index)
    )
  }
  return new Set(
    linesInRange(file, highlight.startLine, highlight.endLine).map((line) => line.index)
  )
}

/**
 * A unified diff, read-only: added lines on the success subtle colour,
 * removed lines on the danger subtle colour, with each line's old and new
 * line number (N9.1). A highlight scrolls to its lines and marks them.
 * Session review and a commit's file diff share it.
 */
export function DiffPatch({
  patch,
  className,
  highlight,
  commenting
}: {
  patch: string
  className?: string
  highlight?: DiffHighlight | null
  commenting?: DiffCommenting
}) {
  const parsed = useMemo(() => parseUnifiedDiff(patch), [patch])
  const lines = useMemo(() => diffLines(parsed), [parsed])
  const marked = useMemo(
    () => (highlight ? highlightedIndexes(parsed, highlight) : new Set<number>()),
    [parsed, highlight]
  )
  // Which file each hunk line belongs to, for commenting.
  const fileOf = useMemo(() => {
    const map = new Map<number, DiffFile>()
    for (const file of parsed.files) {
      for (const hunk of file.hunks) for (const line of hunk.lines) map.set(line.index, file)
    }
    return map
  }, [parsed])
  const selection = commenting?.selection ?? null
  const selected = useMemo(
    () =>
      selection
        ? new Set(commentedLines(parsed, selection).map((line) => line.index))
        : new Set<number>(),
    [parsed, selection]
  )
  // One line number is a tab stop (roving): the selection's last line, or the first one.
  const tabStop = useMemo(() => {
    if (!commenting) return -1
    if (selected.size > 0) return Math.max(...selected)
    return lines.find((line) => fileOf.has(line.index) && sideOfLine(line) !== null)?.index ?? -1
  }, [commenting, selected, lines, fileOf])
  const firstMarked = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    firstMarked.current?.scrollIntoView?.({ block: 'center' })
  }, [marked])

  // Arrow keys move between line-number buttons; Shift extends the selection.
  const onKeyDown = (event: KeyboardEvent<HTMLPreElement>) => {
    if (!commenting || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
    const target = event.target as HTMLElement
    if (!target.matches('[data-comment-line]')) return
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-comment-line]')
    )
    const next =
      buttons[buttons.indexOf(target as HTMLButtonElement) + (event.key === 'ArrowDown' ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    next.focus()
    if (event.shiftKey) {
      const index = Number(next.dataset.commentLine)
      const line = lines.find((entry) => entry.index === index)
      const file = fileOf.get(index)
      if (line && file) commenting.onPick(file, line, true)
    }
  }

  const first = marked.size > 0 ? Math.min(...marked) : -1
  return (
    <pre className={cx('diff-patch', className)} onKeyDown={onKeyDown}>
      {lines.map((line) => {
        const file = commenting ? fileOf.get(line.index) : undefined
        const side = file ? sideOfLine(line) : null
        const number = side === 'old' ? line.oldLine : line.newLine
        // The number on the comment's side is a button; the other stays text.
        const numberCell = (value: number | null, commentable: boolean) =>
          commentable && file && side && number !== null ? (
            <button
              type="button"
              className="diff-patch__number diff-patch__number--button"
              data-comment-line={line.index}
              tabIndex={line.index === tabStop ? 0 : -1}
              aria-label={t(
                side === 'old'
                  ? 'agents:lineComments.removedNumberLabel'
                  : 'agents:lineComments.numberLabel',
                { line: number, file: file.path }
              )}
              aria-pressed={selected.has(line.index)}
              onClick={(event) => commenting!.onPick(file, line, event.shiftKey)}
            >
              {value ?? ''}
            </button>
          ) : (
            <span className="diff-patch__number" aria-hidden="true">
              {value ?? ''}
            </span>
          )
        return (
          <Fragment key={line.index}>
            <div
              ref={line.index === first ? firstMarked : undefined}
              data-diff-line={line.index}
              className={cx(
                'diff-patch__line',
                `diff-patch__line--${lineClass(line)}`,
                marked.has(line.index) && 'diff-patch__line--highlight',
                selected.has(line.index) && 'diff-patch__line--selected'
              )}
            >
              {numberCell(line.oldLine, side === 'old')}
              {numberCell(line.newLine, side === 'new')}
              <span className="diff-patch__text">{line.text.length > 0 ? line.text : ' '}</span>
            </div>
            {commenting?.after(line.index)}
          </Fragment>
        )
      })}
    </pre>
  )
}

/** "+12 -3", toned. */
export function DiffStat({ insertions, deletions }: { insertions: number; deletions: number }) {
  return (
    <span className="diff-stat">
      <span className="diff-stat__add">+{insertions}</span>{' '}
      <span className="diff-stat__remove">-{deletions}</span>
    </span>
  )
}
