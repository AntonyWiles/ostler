/**
 * Whiteboard text layout (plan `docs/plans/whiteboards/`, prompt 02b). SVG
 * does not wrap text, so this one wrap rule is used by the editor, the
 * Library preview, the print page and export, and a note looks the same on
 * all of them. Every function takes a measure: the renderer passes a canvas
 * measure, tests and the main process use `estimateTextWidth`. Pure: no DOM,
 * Electron, Node or interface words. Sizes are in board units.
 */

/** Width in board units of one line of text at a font size. */
export type MeasureText = (text: string, fontSize: number) => number

export const LINE_HEIGHT_RATIO = 1.3
export const NOTE_PADDING = 16
export const SHAPE_PADDING = 12
export const MIN_FIT_FONT_SIZE = 10

export interface FittedText {
  lines: string[]
  fontSize: number
  overflow: boolean
}

const ELLIPSIS = '…'

/** The fallback measure, and the tests' measure: an average character is 0.55 of the font size wide. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55
}

export function lineHeight(fontSize: number): number {
  return fontSize * LINE_HEIGHT_RATIO
}

export function textBlockHeight(lineCount: number, fontSize: number): number {
  return lineCount * lineHeight(fontSize)
}

/** One paragraph (no newlines) wrapped at spaces, long words broken between characters. */
function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  fontSize: number,
  measure: MeasureText
): string[] {
  const lines: string[] = []
  const fits = (candidate: string) => measure(candidate, fontSize) <= maxWidth
  let line = ''
  const finish = () => {
    lines.push(line.trimEnd())
    line = ''
  }
  for (const word of paragraph.split(' ')) {
    const joined = line === '' ? word : `${line} ${word}`
    if (fits(joined)) {
      line = joined
      continue
    }
    if (fits(word)) {
      finish()
      line = word
      continue
    }
    // Wider than a whole line (or text with no spaces, such as Japanese):
    // carry on from the current line and break between characters.
    if (line !== '') line = `${line} `
    for (const char of Array.from(word)) {
      if (line.trim() === '' || fits(line + char)) {
        line = line.trim() === '' ? char : line + char
      } else {
        finish()
        line = char
      }
    }
  }
  lines.push(line.trimEnd())
  return lines
}

/**
 * Lines of `text` no wider than `maxWidth`: split on `\n`, wrapped at spaces,
 * a word wider than a line broken between characters. Trailing spaces are
 * trimmed from each line; empty text gives `['']`.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  measure: MeasureText = estimateTextWidth
): string[] {
  return text
    .split('\n')
    .flatMap((paragraph) => wrapParagraph(paragraph, maxWidth, fontSize, measure))
}

/**
 * `text` wrapped inside `box` less `padding` on every side. When the lines are
 * too tall the size steps down one unit at a time to `MIN_FIT_FONT_SIZE`; if
 * they still do not fit, the lines that fit are kept, the last ending in an
 * ellipsis, and `overflow` is true.
 */
export function fitText(
  text: string,
  box: { width: number; height: number },
  fontSize: number,
  padding: number,
  measure: MeasureText = estimateTextWidth
): FittedText {
  const width = Math.max(0, box.width - 2 * padding)
  const height = Math.max(0, box.height - 2 * padding)
  const smallest = Math.min(fontSize, MIN_FIT_FONT_SIZE)
  let size = fontSize
  for (;;) {
    const lines = wrapText(text, width, size, measure)
    if (textBlockHeight(lines.length, size) <= height)
      return { lines, fontSize: size, overflow: false }
    if (size <= smallest) break
    size = Math.max(smallest, size - 1)
  }

  const lines = wrapText(text, width, size, measure)
  const kept = lines.slice(0, Math.max(1, Math.floor(height / lineHeight(size))))
  let last = Array.from(kept[kept.length - 1].trimEnd())
  while (last.length > 0 && measure(last.join('') + ELLIPSIS, size) > width) {
    last = last.slice(0, -1)
  }
  kept[kept.length - 1] = last.join('').trimEnd() + ELLIPSIS
  return { lines: kept, fontSize: size, overflow: true }
}

/** The height of a `text` object, which grows to its words: its wrapped lines at `width`, at least one. */
export function autoTextHeight(
  text: string,
  width: number,
  fontSize: number,
  measure: MeasureText = estimateTextWidth
): number {
  return textBlockHeight(Math.max(1, wrapText(text, width, fontSize, measure).length), fontSize)
}
