/**
 * Finding what a tip points at. An element counts when it is on screen and
 * not behind an open dialog: with one open, only what is inside it.
 */
export function canPointAt(element: Element): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false
  if (element.closest('[inert], [aria-hidden="true"], [hidden]')) return false
  const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
  const topModal = modals[modals.length - 1]
  return !topModal || topModal.contains(element)
}

/** Every element matching `selector` a tip can point at, in page order. */
export function findTargets(selector: string): Element[] {
  return Array.from(document.querySelectorAll(selector)).filter(canPointAt)
}

/** The first element matching `selector` a tip can point at. */
export function findTarget(selector: string): Element | null {
  return findTargets(selector)[0] ?? null
}

/**
 * Marks work in hand that a tip would sit over, such as an open whiteboard's
 * editor: while one is on the page, no invitation or tip is offered, and one
 * showing goes until it closes. A walkthrough the person started carries on.
 */
export const TIPS_WAIT_ATTRIBUTE = 'data-tips-wait'

export function tipsShouldWait(): boolean {
  return document.querySelector(`[${TIPS_WAIT_ATTRIBUTE}]`) !== null
}
