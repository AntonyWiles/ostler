/**
 * Whether a keyboard event landed in something the user is typing into.
 * Every global shortcut handler has to ask this first, or a single-letter
 * shortcut fires while someone is halfway through a work item title.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

/** Whether a dialog (or the palette, which is one) is open: single-key shortcuts wait for it. */
export function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
}
