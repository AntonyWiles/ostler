/**
 * How a tip marks a control: by turning the control's own border the accent
 * colour (`data-tip-mark`, styled in Coachmark.css), not by drawing a ring over
 * the page. The mark then has the control's exact shape and is cut off, scrolled
 * and covered exactly as the control is.
 */

export type TipMark = 'target' | 'click' | 'drop'

const ATTRIBUTE = 'data-tip-mark'

/** Whether `inner` fills `outer`: inside it, with at most a few pixels to spare on each side. */
function fills(outer: DOMRect, inner: DOMRect): boolean {
  const spare = 4
  return (
    inner.left >= outer.left - 1 &&
    inner.top >= outer.top - 1 &&
    inner.right <= outer.right + 1 &&
    inner.bottom <= outer.bottom + 1 &&
    inner.left - outer.left <= spare &&
    inner.top - outer.top <= spare &&
    outer.right - inner.right <= spare &&
    outer.bottom - inner.bottom <= spare
  )
}

function cornerOf(element: Element): number {
  return parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
}

/**
 * The element whose border shows the mark: the element itself, or, for a plain
 * square wrapper, the rounded control that fills it (a status menu's select
 * inside its box), so the mark is the shape the person sees.
 */
export function shapeOf(element: Element): Element {
  if (cornerOf(element) > 0) return element
  const box = element.getBoundingClientRect()
  // Any depth: wrappers nest (a field round a select round its box). Only one that fills
  // the box counts, so content inside the control never takes the mark.
  return (
    Array.from(element.querySelectorAll('*')).find(
      (child) => fills(box, child.getBoundingClientRect()) && cornerOf(child) > 0
    ) ?? element
  )
}

/**
 * Keeps marks on exactly the elements given: marks new ones, clears ones no
 * longer wanted. Returns what is marked now, to pass back on the next call;
 * `clearMarks` takes them all off.
 */
export function applyMarks(
  previous: ReadonlyMap<Element, TipMark>,
  next: ReadonlyMap<Element, TipMark>
): Map<Element, TipMark> {
  for (const element of previous.keys()) {
    if (!next.has(element)) element.removeAttribute(ATTRIBUTE)
  }
  for (const [element, mark] of next) {
    // Set every time: a re-render that replaced the element's attributes loses nothing for long.
    if (element.getAttribute(ATTRIBUTE) !== mark) element.setAttribute(ATTRIBUTE, mark)
  }
  return new Map(next)
}

export function clearMarks(marked: ReadonlyMap<Element, TipMark>): void {
  for (const element of marked.keys()) element.removeAttribute(ATTRIBUTE)
}
