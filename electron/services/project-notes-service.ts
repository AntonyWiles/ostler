import type { WatchedProject } from '@shared/ostler-api'
import { AIStorageService } from './ai-storage-service'

/**
 * Stores human-approved AI status notes in Ostler user data.  This service
 * deliberately never receives a watched-project path, so it cannot write into
 * a project's working tree.
 */
export class ProjectNotesService {
  private readonly storage: AIStorageService

  constructor(dataDir: string) {
    this.storage = new AIStorageService(dataDir)
  }

  saveStatusNote(project: WatchedProject, content: string): string {
    return this.storage.appendProjectStatusNote(project.id, content)
  }
}
