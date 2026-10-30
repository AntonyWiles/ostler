/**
 * Whether the person's last input was the keyboard. Focus that follows a
 * key (Tab, an arrow, a shortcut) is theirs; focus a page or the window gives
 * itself, on opening or when the window comes back, is not, and neither is
 * focus after a click. Kept from the first import, for the whole window.
 */
let keyboard = false

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => (keyboard = true), true)
  window.addEventListener('pointerdown', () => (keyboard = false), true)
  // Coming back to the window puts focus back where it was, unasked.
  window.addEventListener('blur', () => (keyboard = false))
}

export function lastInputWasKeyboard(): boolean {
  return keyboard
}
