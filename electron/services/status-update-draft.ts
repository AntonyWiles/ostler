import type { WatchedProject } from '@shared/ostler-api'
import { toIsoDate } from '@shared/dates'
import type { StatusUpdatePromptInput } from '@shared/ostler-ai-prompts'
import { STATUS_DRAFT_MAX_ENTRIES, STATUS_DRAFT_WINDOW_MS } from '@shared/status-updates'
import type { PlanningService } from './planning-service'

/** One page of the project feed at a time while reading back to the window's start. */
const PAGE = 100

/**
 * What Draft from activity (N5.5) sends: the project's activity since its
 * last status update (or the last two weeks), each entry worded as the
 * activity feed words it (`activity-summary.ts`), and its milestones'
 * progress. Nothing else: no descriptions, comments' text or files.
 */
export function statusDraftInput(
  planning: PlanningService,
  project: WatchedProject,
  now: number = Date.now()
): StatusUpdatePromptInput & { sinceAt: number } {
  const latest = planning.statusUpdates.latest(project.id)
  const sinceAt = latest ? latest.postedAt : now - STATUS_DRAFT_WINDOW_MS
  const entries: Array<{ at: number; summary: string; task: string }> = []
  let before: string | undefined
  let total = 0
  for (;;) {
    const page = planning.listProjectActivity(project.id, { limit: PAGE, before })
    let reachedStart = false
    for (const entry of page.entries) {
      if (entry.at <= sinceAt) {
        reachedStart = true
        break
      }
      // Updates themselves are what is being written; they are not news.
      if (entry.kind === 'status-update') continue
      total += 1
      if (entries.length < STATUS_DRAFT_MAX_ENTRIES)
        entries.push({ at: entry.at, summary: entry.summary, task: entry.workItemTitle })
    }
    if (reachedStart || !page.nextBefore) break
    before = page.nextBefore
  }
  entries.reverse()

  const items = planning.listWorkItems(project.id)
  const milestones = planning
    .listMilestones(project.id)
    .filter((milestone) => milestone.status === 'planned' || milestone.status === 'active')
    .map((milestone) => {
      const linked = items.filter((item) => item.milestoneId === milestone.id)
      return {
        name: milestone.name,
        status: milestone.status,
        done: linked.filter((item) => item.status === 'done').length,
        total: linked.length,
        targetDate: milestone.targetDate
      }
    })

  return {
    projectName: project.name,
    since: toIsoDate(new Date(sinceAt)),
    sinceAt,
    sinceLastUpdate: latest !== null,
    activity: entries.map((entry) => ({
      date: toIsoDate(new Date(entry.at)),
      summary: entry.summary,
      task: entry.task
    })),
    omitted: total - entries.length,
    milestones
  }
}
