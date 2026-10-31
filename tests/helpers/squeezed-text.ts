/**
 * Text squeezed into a column a word or two wide, so it reads down the page
 * instead of across: the description beside the invite buttons in a project's
 * Settings › Sharing was one, when the buttons took the whole row and left the
 * text a few letters of room. Shared by the accessibility walk (tests/e2e) and
 * the monkey's look at every screen.
 */

export interface SqueezedText {
  /** The element holding the text: its tag, class and the text's start. */
  element: string
  /** Lines the text wraps onto. */
  lines: number
  /** Width of its widest line, in pixels. */
  width: number
}

/**
 * Runs in the window (page.evaluate): no imports, nothing from this module's
 * scope. A text counts when it has at least 24 letters, wraps onto at least 4
 * lines, and its widest line is under 7 times its font size (about a dozen
 * letters): wide enough for a word or two, too narrow for a sentence. Text that
 * is hidden, off screen, or in a menu or popover is left out.
 */
export function readSqueezedText(): SqueezedText[] {
  const minLetters = 24
  const minLines = 4
  const maxEms = 7
  const clean = (text: string | null | undefined, max = 60) =>
    (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const out: SqueezedText[] = []
  const seen = new Set<Element>()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!parent || seen.has(parent)) continue
    if ((node.textContent ?? '').replace(/\s/g, '').length < minLetters) continue
    if (parent.closest('[aria-hidden="true"], [inert], [role=menu], [role=listbox], [popover]'))
      continue
    const style = getComputedStyle(parent)
    if (style.visibility === 'hidden' || !style.writingMode.startsWith('horizontal')) continue
    range.selectNodeContents(node)
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0)
    if (rects.length < minLines) continue
    const box = range.getBoundingClientRect()
    if (box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth)
      continue
    const lines = new Set(rects.map((rect) => Math.round(rect.top))).size
    const width = Math.max(...rects.map((rect) => rect.width))
    if (lines < minLines || width >= maxEms * parseFloat(style.fontSize)) continue
    seen.add(parent)
    const className = clean(typeof parent.className === 'string' ? parent.className : '')
    out.push({
      element: `<${parent.tagName.toLowerCase()}${className ? ` class="${className}"` : ''}> "${clean(node.textContent, 40)}"`,
      lines,
      width: Math.round(width)
    })
    if (out.length >= 8) break
  }
  return out
}
