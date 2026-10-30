import { describe, expect, it } from 'vitest'
import {
  MIN_FIT_FONT_SIZE,
  autoTextHeight,
  estimateTextWidth,
  fitText,
  lineHeight,
  textBlockHeight,
  wrapText
} from '../../src/shared/whiteboard/text-layout'

/** Whiteboard text wrapping and fitting (docs/plans/whiteboards/, prompt 02b). */

/** One unit per character, so widths are character counts. */
const chars = (text: string) => text.length

describe('wrapText', () => {
  it('wraps at spaces and trims trailing spaces', () => {
    expect(wrapText('the quick brown fox', 10, 1, chars)).toEqual(['the quick', 'brown fox'])
    expect(wrapText('ab   ', 10, 1, chars)).toEqual(['ab'])
  })

  it('keeps an explicit newline', () => {
    expect(wrapText('one\ntwo', 100, 1, chars)).toEqual(['one', 'two'])
    expect(wrapText('one\n\ntwo', 100, 1, chars)).toEqual(['one', '', 'two'])
  })

  it('breaks a word longer than the width between characters', () => {
    expect(wrapText('abcdefghij', 4, 1, chars)).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrapText('go abcdefgh', 4, 1, chars)).toEqual(['go a', 'bcde', 'fgh'])
  })

  it('wraps Japanese, which has no spaces', () => {
    const lines = wrapText('今日は天気がとても良いので公園に行きます', 5, 1, chars)
    expect(lines).toEqual(['今日は天気', 'がとても良', 'いので公園', 'に行きます'])
  })

  it('gives one empty line for empty text', () => {
    expect(wrapText('', 100, 18)).toEqual([''])
  })

  it('keeps every line within the width with the estimate', () => {
    const lines = wrapText('a fairly long sentence that must wrap inside a note', 120, 18)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(estimateTextWidth(line, 18)).toBeLessThanOrEqual(120)
  })
})

describe('sizes', () => {
  it('measures lines and blocks', () => {
    expect(estimateTextWidth('abcd', 10)).toBeCloseTo(22)
    expect(lineHeight(10)).toBeCloseTo(13)
    expect(textBlockHeight(3, 10)).toBeCloseTo(39)
  })
})

describe('fitText', () => {
  it('keeps the size when the text fits', () => {
    expect(fitText('short', { width: 200, height: 200 }, 18, 16)).toEqual({
      lines: ['short'],
      fontSize: 18,
      overflow: false
    })
  })

  it('shrinks the size until the lines fit', () => {
    // Inner box 20 wide, 30 tall. The text takes two lines at every size here:
    // 52 tall at 20, 28.6 tall at 11, the first size that fits.
    const text = 'aaaa bbbb'
    const measure = (line: string, size: number) => (line.length * size) / 4
    const fitted = fitText(text, { width: 40, height: 50 }, 20, 10, measure)
    expect(fitted.overflow).toBe(false)
    expect(fitted.fontSize).toBe(11)
    expect(fitted.lines).toEqual(['aaaa', 'bbbb'])
  })

  it('overflows with an ellipsis at the smallest size', () => {
    const text = Array.from({ length: 50 }, () => 'word').join(' ')
    const fitted = fitText(text, { width: 100, height: 60 }, 18, 10)
    expect(fitted.overflow).toBe(true)
    expect(fitted.fontSize).toBe(MIN_FIT_FONT_SIZE)
    // 40 tall inside, 13 per line: three lines.
    expect(fitted.lines).toHaveLength(3)
    const last = fitted.lines[fitted.lines.length - 1]
    expect(last.endsWith('…')).toBe(true)
    expect(estimateTextWidth(last, MIN_FIT_FONT_SIZE)).toBeLessThanOrEqual(80)
  })
})

describe('autoTextHeight', () => {
  it('is one line for empty text', () => {
    expect(autoTextHeight('', 200, 18)).toBeCloseTo(lineHeight(18))
  })

  it('grows with the wrapped lines', () => {
    expect(autoTextHeight('aaa bbb ccc', 3, 1, chars)).toBeCloseTo(textBlockHeight(3, 1))
  })
})
