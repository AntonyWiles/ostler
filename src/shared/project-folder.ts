import { t } from './i18n'
import { Refusal } from './refusal'

/**
 * The one gate for a project's folder (D4). A project may live only in Ostler,
 * with no folder on disk, so every reader of `WatchedProject.path` goes through
 * one of these two functions instead of reading the field. No Node imports:
 * main, the renderer and the HTTP servers all share it.
 */

/** Thrown when a feature that needs a folder is used on a project without one. */
export class FolderRequiredError extends Refusal {
  constructor(purpose: string) {
    super(t('errors:folderRequired', { purpose }))
    this.name = 'FolderRequiredError'
  }
}

/**
 * The project's linked folder, or null when it has none. Configs written
 * before folders were optional always hold a string, so an empty one is
 * treated as "no folder" too.
 */
export function projectFolder(project: { path: string | null | undefined }): string | null {
  return typeof project.path === 'string' && project.path.trim() !== '' ? project.path : null
}

/** The project's linked folder; throws a user-ready `FolderRequiredError` when there is none. */
export function requireProjectFolder(
  project: { path: string | null | undefined },
  purpose: string
): string {
  const folder = projectFolder(project)
  if (folder === null) throw new FolderRequiredError(purpose)
  return folder
}

export function isFolderRequiredError(error: unknown): error is FolderRequiredError {
  return error instanceof FolderRequiredError
}
