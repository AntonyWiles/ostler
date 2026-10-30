/**
 * Whether the human has pressed the emergency stop and not yet resumed.
 *
 * Cancelling what is running is not enough on its own: the auto-dispatcher would
 * launch the next queued task on its very next evaluation, which is exactly the
 * activity the stop was meant to end. This flag is what holds automatic starts
 * off. It is deliberately in-memory only -- a restart begins un-halted, and the
 * human's own explicit actions (a chat message, starting a session by hand) are
 * never blocked by it.
 */
let halted = false

export function isAiHalted(): boolean {
  return halted
}

export function setAiHalted(next: boolean): void {
  halted = next
}
