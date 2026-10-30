import { AsyncLocalStorage } from 'node:async_hooks'
import { v4 as uuidv4 } from 'uuid'

/**
 * The step a write belongs to (undo history). `handleIpc` runs every call
 * from a window inside one, so the recorder's triggers (`recorder.ts`) know
 * which entry a row change is part of. Writes outside one (housekeeping,
 * agents, the automation API, start-up) are not the person's steps and are
 * not recorded.
 */
export interface ChangeContext {
  entryId: string
  channel: string
  /** A trigger recorded a row for this step. */
  touched: boolean
  /** The call has returned: anything it left running is no longer this step. */
  closed: boolean
  /** Already turned into an entry (an undo finishes its own, to return it). */
  finished: boolean
  /** For an undo or redo: the entry it undoes. */
  undoes: string | null
}

const storage = new AsyncLocalStorage<ChangeContext>()

type Finisher = (context: ChangeContext) => void

let finisher: Finisher | null = null

/** Set by the history service: turns a finished call's recorded rows into an entry. */
export function setChangeFinisher(next: Finisher | null): void {
  finisher = next
}

/** The step the running code belongs to, while it is still open. */
export function openChangeContext(): ChangeContext | null {
  const context = storage.getStore()
  return context && !context.closed ? context : null
}

/**
 * Runs one IPC call as one step: whatever it writes through a connection
 * with the recorder attached is recorded, and becomes an entry once it
 * returns (or fails after writing).
 */
export async function recordChanges<T>(channel: string, run: () => Promise<T>): Promise<T> {
  const context: ChangeContext = {
    entryId: uuidv4(),
    channel,
    touched: false,
    closed: false,
    finished: false,
    undoes: null
  }
  try {
    return await storage.run(context, run)
  } finally {
    context.closed = true
    if (context.touched && !context.finished && finisher) {
      try {
        finisher(context)
      } catch (error) {
        console.error(`Saving the undo history for ${channel} failed:`, error)
      }
    }
  }
}
