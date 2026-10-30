import { todayIsoDate } from '@shared/dates'
import { Refusal } from '@shared/refusal'
import {
  buildReleaseNotes,
  RELEASE_NOTES_GROUP_BY,
  type ReleaseNotes,
  type ReleaseNotesOptions,
  type ReleaseNotesSource
} from '@shared/release-notes'
import type { PlanningService } from './planning-service'

/** What release notes are for, by id: a milestone or an iteration of the project. */
export interface ReleaseNotesTarget {
  kind: 'milestone' | 'iteration'
  id: string
}

/** Refuses options that are not the builder's, so every caller checks them the same way. */
export function checkReleaseNotesOptions(options: unknown): ReleaseNotesOptions {
  const value = (options ?? {}) as Partial<ReleaseNotesOptions>
  if (!RELEASE_NOTES_GROUP_BY.includes(value.groupBy as ReleaseNotesOptions['groupBy']))
    throw new Refusal('groupBy must be type, label or none')
  return {
    groupBy: value.groupBy as ReleaseNotesOptions['groupBy'],
    descriptions: value.descriptions === true,
    subtasks: value.subtasks === true
  }
}

/**
 * Release notes (N9.9) from the database: the milestone or iteration, checked
 * against the project, and its live and archived tasks, through the one
 * builder the app's dialog uses. The automation API and Polish with AI both
 * come here, so the draft an agent reads and the draft Ostler AI is sent are
 * the same.
 */
export function releaseNotesFor(
  planning: PlanningService,
  projectId: string,
  target: ReleaseNotesTarget,
  options: ReleaseNotesOptions
): ReleaseNotes {
  let source: ReleaseNotesSource
  if (target.kind === 'milestone') {
    const milestone = planning.listMilestones(projectId).find((entry) => entry.id === target.id)
    if (!milestone) throw new Refusal('Milestone not found in this project')
    source = { kind: 'milestone', milestone }
  } else if (target.kind === 'iteration') {
    source = {
      kind: 'iteration',
      iteration: planning.iterations.requireInProject(target.id, projectId)
    }
  } else {
    throw new Refusal('Release notes are for a milestone or an iteration')
  }
  return buildReleaseNotes(
    {
      source,
      items: [
        ...planning.listWorkItems(projectId, 'live'),
        ...planning.listWorkItems(projectId, 'archived')
      ],
      taskTypes: planning.taskTypes.list(projectId),
      today: todayIsoDate()
    },
    options
  )
}
