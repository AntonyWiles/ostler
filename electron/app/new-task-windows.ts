import { isNewTaskProjectId, isPassableDraft, type NewTaskDraft } from '@shared/new-task-window'

/**
 * New task in a window of its own: at most one window per project, and the draft each
 * hand-over carries. A draft lives here in memory only, from the moment one window gives it up
 * until the other takes it; nothing is kept on disk, and a window closed without going back
 * takes its draft with it (the person cancelled or created the task).
 */

/** What this needs of a window: Electron's `BrowserWindow`, or a test's fake. */
export interface NewTaskWindowLike {
  on(event: 'closed', listener: () => void): unknown
  isDestroyed(): boolean
  close(): void
  readonly webContents: unknown
}

export interface NewTaskWindowsDependencies<W extends NewTaskWindowLike> {
  /** Opens a window on `projectId`'s New task (through `createNewTaskWindow`). */
  create(projectId: string): W
  /** Brings an open window forward. */
  focus(win: W): void
  /** Whether a project is registered. */
  projectExists(projectId: string): boolean
  /** A draft came back for the main window: bring it forward and tell it. */
  returned(projectId: string): void
}

export class NewTaskWindows<W extends NewTaskWindowLike> {
  private readonly windows = new Map<string, W>()
  /** Drafts waiting for a New task window to take them, by project. */
  private readonly outgoing = new Map<string, NewTaskDraft>()
  /** Drafts waiting for the main window to take them back, by project. */
  private readonly returning = new Map<string, NewTaskDraft>()

  constructor(private readonly deps: NewTaskWindowsDependencies<W>) {}

  /** The project a window shows, or null when it is not a New task window. */
  projectOf(contents: unknown): string | null {
    for (const [projectId, win] of this.windows) {
      if (!win.isDestroyed() && win.webContents === contents) return projectId
    }
    return null
  }

  /**
   * Opens New task in its own window with `draft`: true. With one already open for the project,
   * brings it forward and leaves `draft` where it was (false), so the main window keeps it.
   */
  open(projectId: unknown, draft: unknown): boolean {
    if (!isNewTaskProjectId(projectId)) throw new Error('Open New task for one project')
    if (!isPassableDraft(draft)) throw new Error('That task draft cannot be moved')
    if (!this.deps.projectExists(projectId)) {
      throw new Error('That project is not in Ostler any more')
    }
    const already = this.windows.get(projectId)
    if (already && !already.isDestroyed()) {
      this.deps.focus(already)
      return false
    }
    this.outgoing.set(projectId, draft)
    const win = this.deps.create(projectId)
    this.windows.set(projectId, win)
    win.on('closed', () => {
      this.windows.delete(projectId)
      this.outgoing.delete(projectId)
    })
    return true
  }

  /** The draft a New task window opened with; given once. */
  takeOutgoing(contents: unknown): NewTaskDraft | null {
    const projectId = this.projectOf(contents)
    if (!projectId) throw new Error('Only a New task window takes its draft')
    const draft = this.outgoing.get(projectId) ?? null
    this.outgoing.delete(projectId)
    return draft
  }

  /** A New task window hands its draft back to the main window and closes. */
  giveBack(contents: unknown, draft: unknown): void {
    const projectId = this.projectOf(contents)
    if (!projectId) throw new Error('Only a New task window goes back to the main window')
    if (!isPassableDraft(draft)) throw new Error('That task draft cannot be moved')
    this.returning.set(projectId, draft)
    this.deps.returned(projectId)
    this.windows.get(projectId)?.close()
  }

  /** The draft that came back for `projectId`; given once. */
  takeReturned(projectId: unknown): NewTaskDraft | null {
    if (!isNewTaskProjectId(projectId)) throw new Error('Take back New task for one project')
    const draft = this.returning.get(projectId) ?? null
    this.returning.delete(projectId)
    return draft
  }
}
