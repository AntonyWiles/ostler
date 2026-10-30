import { projectIpcHandlers } from './handle-ipc'
import { broadcastToWindows } from '../services/send-to-window'
import { IPC_CHANNELS } from '@shared/ostler-api'
import type { CreateWhiteboardInput, WatchedProject, WhiteboardSaveInput } from '@shared/ostler-api'
import type { LibraryService } from '../services/library-service'

export interface WhiteboardHandlerDependencies {
  libraryService: LibraryService
  getProject(projectId: string): WatchedProject
}

/**
 * Whiteboard IPC (plan `docs/plans/whiteboards/`): make, open and save a whiteboard, a Library
 * item of kind 'whiteboard'. Every channel resolves the project first (the access check).
 * Create pushes `ON_PROJECT_STATE_CHANGE` with field 'library', as the Library's own channels
 * do. Save pushes nothing on purpose: the editor reloads a board when it hears a 'library'
 * change, and its own saves must not make it reload itself. Changes from sync still broadcast
 * 'library' when they are applied.
 */
export function registerWhiteboardHandlers({
  libraryService,
  getProject
}: WhiteboardHandlerDependencies): void {
  const notifyLibrary = (project: WatchedProject): void => {
    broadcastToWindows(IPC_CHANNELS.ON_PROJECT_STATE_CHANGE, {
      projectId: project.id,
      field: 'library',
      data: null
    })
  }
  const { projectApi, mutatingApi } = projectIpcHandlers(getProject, notifyLibrary)

  mutatingApi('createWhiteboard', (project, input: CreateWhiteboardInput) =>
    libraryService.whiteboards.create(project.id, input)
  )
  projectApi('getWhiteboard', (project, whiteboardId: string) =>
    libraryService.whiteboards.get(project.id, whiteboardId)
  )
  projectApi('saveWhiteboard', (project, whiteboardId: string, input: WhiteboardSaveInput) =>
    libraryService.whiteboards.save(project.id, whiteboardId, input)
  )
}
