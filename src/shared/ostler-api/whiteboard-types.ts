// Whiteboard IPC payloads (plan `docs/plans/whiteboards/`): defined in the pure whiteboard model.
export type {
  CreateWhiteboardInput,
  WhiteboardDocument,
  WhiteboardObject,
  WhiteboardObjectInput,
  WhiteboardSaveInput,
  WhiteboardSaveResult
} from '../whiteboard/model'
export type {
  MakeWhiteboardTasksInput,
  MakeWhiteboardTasksResult,
  UndoWhiteboardTasksInput,
  WhiteboardTaskDraft
} from '../whiteboard/tasks'

/** A picture of a whiteboard the renderer drew, for main to save where the person chooses (prompt 16). */
export interface SaveWhiteboardImageInput {
  whiteboardId: string
  kind: 'png' | 'svg'
  bytes: Uint8Array
}

/** Print a whiteboard or save it as a PDF (prompt 17, D15), as Compare rounds does. */
export interface WhiteboardPrintRequest {
  projectId: string
  whiteboardId: string
  output: 'pdf' | 'printer'
}

/** Export a whiteboard file: where it went (null when cancelled) and the pictures left out. */
export interface ExportWhiteboardFileResult {
  path: string | null
  missingPictures: number
}
