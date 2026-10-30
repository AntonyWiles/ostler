/**
 * Makes a project's entry in the config store when this PC joins its share (docs/plans/people-and-devices,
 * prompt 11). Two paths join a share: a person pastes an invite or follows a join link (the JOIN_SHARE
 * handler), and this PC's personal share lists the share for another device of the person
 * (`SyncService`). Both go through here, so the entry is the same whichever way it was made. The
 * project has no folder here (D4); one can be linked later in its settings.
 */
import { isProjectIcon } from '@shared/project-icons'
import type { ConfigStore } from '../../config-store'
import type { JoinResult } from './sharing'

/** Registers a joined project in the config store unless it is there already; returns its id and name. */
export function registerJoinedProject(
  store: Pick<ConfigStore, 'getProjects' | 'registerProject'>,
  joined: JoinResult,
  fallbackName: string
): { id: string; name: string } {
  const existing = store.getProjects().find((project) => project.id === joined.projectId)
  if (existing) return { id: existing.id, name: existing.name }
  const project = store.registerProject({
    id: joined.projectId,
    name: joined.project?.name ?? fallbackName,
    folder: null,
    color: joined.project?.color,
    notes: joined.project?.notes,
    tags: joined.project?.tags,
    taskPrefix: joined.project?.taskPrefix,
    icon: isProjectIcon(joined.project?.icon) ? joined.project.icon : null
  })
  return { id: project.id, name: project.name }
}
