import { isProjectIcon } from '@shared/project-icons'
import type { WatchedProject } from '@shared/ostler-api'
import type { SnapshotProject } from './snapshot-file'

/** The settings a shared project's members have in common, as this PC sends them (SHARED_PROJECT_FIELDS). */
export function sharedProjectSettings(project: WatchedProject): SnapshotProject {
  return {
    name: project.name,
    color: project.color,
    notes: project.notes,
    tags: project.tags,
    icon: project.icon ?? null,
    ...(project.taskPrefix ? { taskPrefix: project.taskPrefix } : {})
  }
}

/**
 * The project update for settings another member of a shared project sent: name, colour,
 * notes, tags and icon (the task prefix is applied on its own, as another project here may
 * hold it). An icon left out, from an Ostler from before icons were shared, or one this
 * Ostler doesn't know, leaves the icon here as it is.
 */
export function receivedProjectUpdate(settings: SnapshotProject): Partial<WatchedProject> {
  return {
    name: settings.name,
    color: settings.color,
    notes: settings.notes,
    tags: settings.tags,
    ...(settings.icon === null || isProjectIcon(settings.icon) ? { icon: settings.icon } : {})
  }
}
