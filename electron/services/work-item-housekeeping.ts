import type { ProjectAutoDispatchConfig, WatchedProject } from '@shared/ostler-api'
import { isReadOnlyError } from '@shared/refusal'
import { projectWorkItemStatus } from '@shared/work-item-status'
import type { HarnessService } from './harness-service'
import { archiveWorkItem } from './planning-deletion'
import type { PlanningService } from './planning-service'

const DAY_MS = 24 * 60 * 60 * 1000

export interface HousekeepingResult {
  archived: number
  purged: number
}

/**
 * The periodic tidy-up for one project: empties recycle-bin entries past their
 * 30 days, and -- when the project opts in -- archives Done work that has sat
 * untouched for the configured number of days.
 *
 * "Done" is the Board's own column (projectWorkItemStatus), so work still in
 * review never moves, and archiving goes through the same gate as the menu.
 * "Untouched" is `updatedAt`: any edit to a Done card restarts its clock.
 */
export function runWorkItemHousekeeping(
  planning: PlanningService,
  harness: HarnessService,
  project: WatchedProject,
  config: Pick<ProjectAutoDispatchConfig, 'autoArchiveDoneAfterDays'>,
  now = Date.now()
): HousekeepingResult {
  let purged: number
  try {
    purged = planning.purgeRecycleBin(project.id, now)
  } catch (error) {
    // A Viewer's PC refuses writes to a shared project (D9): there is nothing to tidy here.
    if (isReadOnlyError(error)) return { archived: 0, purged: 0 }
    throw error
  }
  let archived = 0
  const days = config.autoArchiveDoneAfterDays
  if (days > 0) {
    const cutoff = now - days * DAY_MS
    const state = harness.getState(project)
    for (const item of planning.listWorkItems(project.id)) {
      if (item.updatedAt > cutoff) continue
      if (projectWorkItemStatus(item, state) !== 'done') continue
      try {
        archiveWorkItem(planning, harness, project, item.id, { kind: 'system' }, now)
        archived++
      } catch (error) {
        // One item that cannot move (e.g. it just went back into review) must
        // not stop the rest of the sweep.
        console.warn(`[housekeeping] Could not auto-archive ${item.id}:`, error)
      }
    }
  }
  return { archived, purged }
}
