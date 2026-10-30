/**
 * The whiteboard open on each project's Plan, for the session: switching to
 * another view and back to the Plan opens it again, until Back to the plan
 * closes it.
 */
const openBoards = new Map<string, string>()

/** The board left open on the project's Plan, or null. */
export function rememberedWhiteboard(projectId: string): string | null {
  return openBoards.get(projectId) ?? null
}

/** Keeps (or with null, forgets) the board open on the project's Plan. */
export function rememberWhiteboard(projectId: string, whiteboardId: string | null) {
  if (whiteboardId === null) openBoards.delete(projectId)
  else openBoards.set(projectId, whiteboardId)
}

/** Forgets every remembered board (tests start each case clean). */
export function forgetOpenWhiteboards() {
  openBoards.clear()
}
