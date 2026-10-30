/**
 * A scrollbar that need not be there: a box that scrolls by a little while
 * the window has room to show all of it. The icon grid in the New project
 * dialog was one, a few pixels of icons hidden under a scrollbar in a dialog
 * with half the window free. Shared by the accessibility walk (tests/e2e) and
 * the monkey's look at every screen.
 */

export interface NeedlessScroll {
  /** The box that scrolls: its tag, class and name. */
  element: string
  /** Pixels of content it hides. */
  hidden: number
  /** Pixels the box could grow without anything else having to scroll. */
  room: number
}

/**
 * Runs in the window (page.evaluate): no imports, nothing from this module's
 * scope. A box counts when it scrolls vertically, hides at least 4 pixels,
 * and the room it could grow into holds everything it hides:
 *   - in a dialog, how much taller it may grow: up to its own max-height, and
 *     no further than its parent's content box (the backdrop for the app's
 *     dialogs);
 *   - elsewhere, the empty space at the bottom of the box's scrolling
 *     container, or of the window.
 * Text areas, menus and lists in popovers are left out: they scroll by design.
 */
export function readNeedlessScroll(): NeedlessScroll[] {
  const minHidden = 4
  const clean = (text: string | null | undefined, max = 60) =>
    (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const describe = (element: HTMLElement): string => {
    const name =
      element.getAttribute('aria-label') ??
      element.querySelector('legend, h2, h3')?.textContent ??
      element.closest('fieldset')?.querySelector('legend')?.textContent ??
      ''
    const className = clean(typeof element.className === 'string' ? element.className : '', 60)
    return `<${element.tagName.toLowerCase()}${className ? ` class="${className}"` : ''}>${
      clean(name) ? ` "${clean(name)}"` : ''
    }`
  }
  const scrollsY = (element: Element): boolean =>
    /(auto|scroll)/.test(getComputedStyle(element).overflowY)
  const contentHeight = (element: HTMLElement): number => {
    const style = getComputedStyle(element)
    return element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  }
  const roomFor = (element: HTMLElement): number => {
    const dialog = element.closest<HTMLElement>('[role=dialog], [role=alertdialog], dialog[open]')
    if (dialog && dialog !== element && dialog.parentElement) {
      // As tall as its own max-height lets it be: asked for a huge height,
      // the dialog stops at its limit. Put back before anything is painted.
      const height = dialog.getBoundingClientRect().height
      const was = dialog.style.height
      dialog.style.height = '100000px'
      const tallest = dialog.getBoundingClientRect().height
      dialog.style.height = was
      return Math.min(tallest, contentHeight(dialog.parentElement)) - height
    }
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break
      if (scrollsY(node)) return Math.max(0, node.clientHeight - node.scrollHeight)
    }
    return Math.max(0, innerHeight - document.documentElement.scrollHeight)
  }
  const out: NeedlessScroll[] = []
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) continue
    if (!scrollsY(element)) continue
    const hidden = element.scrollHeight - element.clientHeight
    if (hidden < minHidden || element.clientHeight < 24) continue
    if (element.closest('[aria-hidden="true"], [inert], [role=menu], [role=listbox], [popover]'))
      continue
    const box = element.getBoundingClientRect()
    if (box.width === 0 || box.bottom <= 0 || box.top >= innerHeight) continue
    const room = Math.floor(roomFor(element))
    if (hidden <= room) out.push({ element: describe(element), hidden, room })
    if (out.length >= 8) break
  }
  return out
}
