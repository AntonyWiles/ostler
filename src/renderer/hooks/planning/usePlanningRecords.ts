import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assertResult } from '../../utils/unwrap-result'
import { shownCache } from '../../lib/shown-cache'
import { paletteColorFor } from '@shared/project-colors'
import { inManualOrder } from '@shared/planning/board'
import type {
  PlanningTaskType,
  HarnessProjectState,
  PlanningAggregateMetrics,
  PlanningBlockerWithWorkItem,
  PlanningDecision,
  PlanningFieldDefinition,
  PlanningGoal,
  PlanningIteration,
  PlanningMilestone,
  PlanningWipLimits,
  PlanningWorkItem,
  ProjectStateUpdate
} from '@shared/ostler-api'
import { t } from '@shared/i18n'
import type { TaskContactMarks } from '@shared/contacts'

/** Pushes for the same records within this window load them once. */
export const REFRESH_COALESCE_MS = 100
/**
 * A slow safety net only, and only while agents are on (P9.1). Every change
 * Ostler makes pushes an update, which reloads what it touched; agents write
 * planning records through the harness too, and this catches any of those a
 * push slipped past. With agents off nothing else writes, so nothing polls.
 */
export const PLANNING_POLL_MS = 60_000

/**
 * The harness pushed a queue holding work the Board's copy does not reflect:
 * an item it has not loaded (queued from the automation API or another
 * window), or one whose link changed (auto-queue). Without this the card only
 * caught up at the next poll.
 */
export function harnessOutpacesBoard(
  state: HarnessProjectState,
  links: Map<string, string | null>
): boolean {
  return state.taskQueue.some(
    (task) =>
      (task.status === 'pending' || task.status === 'claimed') &&
      !!task.planningWorkItemId &&
      links.get(task.planningWorkItemId) !== task.id
  )
}

/** What a project's views last showed: going back to it shows this at once. */
interface ShownRecords {
  goals: PlanningGoal[]
  milestones: PlanningMilestone[]
  workItems: PlanningWorkItem[]
  lastStatusChangeAt: Map<string, number>
  projectMetrics: PlanningAggregateMetrics | null
  decisions: PlanningDecision[]
  wipLimits: PlanningWipLimits
  harnessState: HarnessProjectState | null
  openBlockers: PlanningBlockerWithWorkItem[]
  changedSourceWorkItemIds: Set<string>
  attachmentCounts: Record<string, number>
  commentCounts: Record<string, number>
  taskContacts: TaskContactMarks
  labelColors: Map<string, string>
  fields: PlanningFieldDefinition[]
  iterations: PlanningIteration[]
  taskTypes: PlanningTaskType[]
  timeTotals: Record<string, number>
}

/** The records last shown for each recently opened project. */
const shownRecords = shownCache<ShownRecords>()

/**
 * Loads and refreshes everything the planning workspace reads from main:
 * goals, milestones, work items, decisions, WIP limits, metrics,
 * the harness state, open blockers, and the library markers on cards.
 *
 * Refreshes are targeted: a push for another project is ignored, a push
 * reloads only the records its field affects, pushes arriving together are
 * coalesced into one load, and the data on screen stays there until the new
 * data replaces it. A project opened again shows what it showed last at once
 * and refreshes behind it, as a push does: reloading it from nothing put a
 * spinner in place of the whole view on every project switch, and the app
 * flickered as the person moved between projects. Depends on nothing but the
 * runner's error setter.
 */
export function usePlanningRecords(
  projectId: string,
  setError: (error: string | null) => void,
  { safetyPoll = true }: { safetyPoll?: boolean } = {}
) {
  const [goals, setGoals] = useState<PlanningGoal[]>([])
  const [milestones, setMilestones] = useState<PlanningMilestone[]>([])
  const [storedWorkItems, setWorkItems] = useState<PlanningWorkItem[]>([])
  // Always in the manual order (D31), wherever a change put an item in the
  // array: every view reads this, and the Board's Manual sort is this order.
  const workItems = useMemo(() => inManualOrder(storedWorkItems), [storedWorkItems])
  const [projectMetrics, setProjectMetrics] = useState<PlanningAggregateMetrics | null>(null)
  /**
   * When each work item last changed status, which is all the board actually
   * reads: it colours a card by how long it has sat where it is.
   */
  const [lastStatusChangeAt, setLastStatusChangeAt] = useState<Map<string, number>>(new Map())
  const [decisions, setDecisions] = useState<PlanningDecision[]>([])
  const [wipLimits, setWipLimits] = useState<PlanningWipLimits>({})
  const [harnessState, setHarnessState] = useState<HarnessProjectState | null>(null)
  /** Open agent-reported blockers for the project, so a board card can say it. */
  const [openBlockers, setOpenBlockers] = useState<PlanningBlockerWithWorkItem[]>([])
  // The board's changed-source marker and, beside it, the "N attached" chip.
  const [changedSourceWorkItemIds, setChangedSourceWorkItemIds] = useState<Set<string>>(
    () => new Set()
  )
  const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({})
  /** Comments per task, for the card's comment count (P5.2). */
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  /** The contacts each task names (N6.5), for the card's mark and the Contact filter. */
  const [taskContacts, setTaskContacts] = useState<TaskContactMarks>({})
  /** Chosen label colours; a label without one gets its stable default. */
  const [labelColors, setLabelColors] = useState<Map<string, string>>(() => new Map())
  /** The project's custom fields (R2.2), in their order. */
  const [fields, setFields] = useState<PlanningFieldDefinition[]>([])
  /** The project's iterations (R6.1), oldest first; empty for most projects. */
  const [iterations, setIterations] = useState<PlanningIteration[]>([])
  /** The project's task types (N2.7a), in its order; empty for most projects. */
  const [taskTypes, setTaskTypes] = useState<PlanningTaskType[]>([])
  const [loading, setLoading] = useState(false)
  /** The project whose records are loaded: `loaded` is true once the first load lands. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  /**
   * Which project the newest load was started for, and whether one is already
   * running. A load writes about ten pieces of state at the end, and without
   * these a slow load for a project the user has since navigated away from
   * would land on top of the one they are actually looking at.
   */
  const loadEpoch = useRef(0)
  const inFlightProjectId = useRef<string | null>(null)
  const loadedProjectId = useRef<string | null>(null)

  // Time logged per task (R2.3), for the cards: loaded with the other markers below.
  const [timeTotals, setTimeTotals] = useState<Record<string, number>>({})

  // A project opened (first render, or a switch): what it showed last, before
  // anything paints, so its view never empties to a spinner on the way.
  const [shownFor, setShownFor] = useState<string | null>(null)
  if (shownFor !== projectId) {
    const switching = shownFor !== null
    setShownFor(projectId)
    const shown = shownRecords.get(projectId)
    if (shown) {
      setGoals(shown.goals)
      setMilestones(shown.milestones)
      setWorkItems(shown.workItems)
      setLastStatusChangeAt(shown.lastStatusChangeAt)
      setProjectMetrics(shown.projectMetrics)
      setDecisions(shown.decisions)
      setWipLimits(shown.wipLimits)
      setHarnessState(shown.harnessState)
      setOpenBlockers(shown.openBlockers)
      setChangedSourceWorkItemIds(shown.changedSourceWorkItemIds)
      setAttachmentCounts(shown.attachmentCounts)
      setCommentCounts(shown.commentCounts)
      setTaskContacts(shown.taskContacts)
      setLabelColors(shown.labelColors)
      setFields(shown.fields)
      setIterations(shown.iterations)
      setTaskTypes(shown.taskTypes)
      setTimeTotals(shown.timeTotals)
      setLoadedFor(projectId)
    } else if (switching) {
      setTimeTotals({})
    }
  }

  /**
   * Loads the planning records and, unless `harness` is false, the harness
   * state with them. A `'planning'` push has nothing to say about the
   * harness, so it skips that read.
   */
  const loadRecords = useCallback(
    async ({ harness = true }: { harness?: boolean } = {}) => {
      if (!projectId) {
        setGoals([])
        setMilestones([])
        setWorkItems([])
        setLastStatusChangeAt(new Map())
        setProjectMetrics(null)
        setDecisions([])
        setWipLimits({})
        setHarnessState(null)
        setOpenBlockers([])
        return
      }
      // Skip only a duplicate load of the same project: switching projects must
      // always start a fresh load, and the epoch below retires the old one.
      if (inFlightProjectId.current === projectId) return
      inFlightProjectId.current = projectId
      loadEpoch.current += 1
      const epoch = loadEpoch.current
      const isCurrent = (): boolean => epoch === loadEpoch.current
      // Only the first load of a project is "loading". The board hides its empty
      // column placeholders while loading, so flagging every background load made
      // empty columns blink out and back. A project shown from what it showed
      // last is not loading either.
      if (loadedProjectId.current !== projectId && !shownRecords.has(projectId)) setLoading(true)
      setError(null)
      try {
        const [
          goalResult,
          milestoneResult,
          workItemResult,
          decisionResult,
          wipLimitResult,
          harnessResult,
          blockerResult,
          labelResult,
          commentCountResult,
          fieldResult,
          iterationResult,
          taskTypeResult,
          taskContactResult
        ] = await Promise.all([
          window.ostlerAPI.getPlanningGoals(projectId),
          window.ostlerAPI.getPlanningMilestones(projectId),
          window.ostlerAPI.getPlanningWorkItems(projectId),
          window.ostlerAPI.getPlanningDecisions(projectId),
          window.ostlerAPI.getPlanningWipLimits(projectId),
          harness ? window.ostlerAPI.getHarnessState(projectId) : null,
          window.ostlerAPI.listOpenBlockers(projectId),
          typeof window.ostlerAPI.getPlanningLabels === 'function'
            ? window.ostlerAPI.getPlanningLabels(projectId)
            : null,
          typeof window.ostlerAPI.getPlanningCommentCounts === 'function'
            ? window.ostlerAPI.getPlanningCommentCounts(projectId)
            : null,
          typeof window.ostlerAPI.getPlanningFields === 'function'
            ? window.ostlerAPI.getPlanningFields(projectId)
            : null,
          typeof window.ostlerAPI.getPlanningIterations === 'function'
            ? window.ostlerAPI.getPlanningIterations(projectId)
            : null,
          typeof window.ostlerAPI.getPlanningTaskTypes === 'function'
            ? window.ostlerAPI.getPlanningTaskTypes(projectId)
            : null,
          typeof window.ostlerAPI.projectTaskContacts === 'function'
            ? window.ostlerAPI.projectTaskContacts(projectId)
            : null
        ])
        assertResult(goalResult)
        assertResult(milestoneResult)
        assertResult(workItemResult)
        assertResult(decisionResult)
        if (!isCurrent()) return
        setGoals(goalResult.value)
        setMilestones(milestoneResult.value)
        setWorkItems(workItemResult.value)
        // One call for the whole project, not one per work item.
        const changesResult = await window.ostlerAPI.getPlanningLatestStatusChanges(projectId)
        if (!isCurrent()) return
        setLastStatusChangeAt(
          changesResult.ok
            ? new Map(Object.entries(changesResult.value).map(([id, at]) => [id, Number(at)]))
            : new Map()
        )
        if (typeof window.ostlerAPI.getPlanningProjectMetrics === 'function') {
          const metricsResult = await window.ostlerAPI.getPlanningProjectMetrics(projectId)
          if (!isCurrent()) return
          setProjectMetrics(metricsResult.ok ? metricsResult.value : null)
        }
        setDecisions(decisionResult.value)
        setWipLimits(wipLimitResult.ok ? wipLimitResult.value : {})
        if (harnessResult) setHarnessState(harnessResult.ok ? harnessResult.value : null)
        setOpenBlockers(blockerResult.ok ? blockerResult.value : [])
        if (labelResult?.ok) {
          setLabelColors(
            new Map(
              labelResult.value
                .filter((label) => label.hasColor)
                .map((label) => [label.name, label.color])
            )
          )
        }
        if (commentCountResult?.ok) setCommentCounts(commentCountResult.value)
        setFields(fieldResult?.ok ? fieldResult.value : [])
        setIterations(iterationResult?.ok ? iterationResult.value : [])
        setTaskTypes(taskTypeResult?.ok ? taskTypeResult.value : [])
        setTaskContacts(taskContactResult?.ok ? taskContactResult.value : {})
        loadedProjectId.current = projectId
        setLoadedFor(projectId)
      } catch (loadError) {
        if (isCurrent()) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t('tasks:usePlanningRecords.couldntLoadProjectTry')
          )
        }
      } finally {
        // A load that has already been superseded must not clear the flag out
        // from under the one that replaced it.
        if (isCurrent()) {
          inFlightProjectId.current = null
          setLoading(false)
        }
      }
    },
    [projectId]
  )

  /** Everything, harness included: first load, the poll, and actions that change both. */
  const loadPlanning = useCallback(() => loadRecords(), [loadRecords])

  useEffect(() => {
    void loadPlanning()
  }, [loadPlanning])

  useEffect(() => {
    if (!safetyPoll) return
    const interval = setInterval(() => void loadPlanning(), PLANNING_POLL_MS)
    return () => clearInterval(interval)
  }, [loadPlanning, safetyPoll])

  // Read inside the push listener without resubscribing on every change.
  const workItemLinks = useRef(new Map<string, string | null>())
  workItemLinks.current = new Map(workItems.map((item) => [item.id, item.linkedHarnessTaskId]))
  const loadRecordsRef = useRef(loadRecords)
  loadRecordsRef.current = loadRecords

  useEffect(() => {
    if (!projectId) return
    let active = true
    const loadLibraryMarkers = () => {
      void window.ostlerAPI.listWorkItemsWithChangedSources(projectId).then((result) => {
        if (active && result.ok) setChangedSourceWorkItemIds(new Set(result.value))
      })
      void window.ostlerAPI.countWorkItemAttachments(projectId).then((result) => {
        if (active && result.ok) setAttachmentCounts(result.value)
      })
    }
    loadLibraryMarkers()

    // One timer per kind of reload: a burst of pushes becomes one load.
    const timers = new Map<'records' | 'library', ReturnType<typeof setTimeout>>()
    const schedule = (kind: 'records' | 'library', load: () => void) => {
      if (timers.has(kind)) return
      timers.set(
        kind,
        setTimeout(() => {
          timers.delete(kind)
          if (active) load()
        }, REFRESH_COALESCE_MS)
      )
    }
    const reloadRecords = () => void loadRecordsRef.current({ harness: false })

    const unsubscribe = window.ostlerAPI.onProjectStateChange((update: ProjectStateUpdate) => {
      if (update.projectId !== projectId) return
      switch (update.field) {
        case 'harness': {
          // The push carries the new state, so there is nothing to fetch.
          const state = update.data as HarnessProjectState
          setHarnessState(state)
          if (harnessOutpacesBoard(state, workItemLinks.current)) {
            schedule('records', reloadRecords)
          }
          break
        }
        // Housekeeping, the automation API and task reviews change records
        // in the background.
        case 'planning':
        case 'taskReview':
          schedule('records', reloadRecords)
          break
        // A library edit, or a re-draft re-linking its sources.
        case 'library':
          schedule('library', loadLibraryMarkers)
          break
      }
    })
    return () => {
      active = false
      for (const timer of timers.values()) clearTimeout(timer)
      unsubscribe()
    }
  }, [projectId])

  // Time logged per task (R2.3): one call per project, again whenever main
  // says time changed in this project.
  useEffect(() => {
    if (!projectId || typeof window.ostlerAPI.getTimeTotals !== 'function') return
    let cancelled = false
    const load = () =>
      void window.ostlerAPI.getTimeTotals(projectId).then((result) => {
        if (!cancelled && result.ok) setTimeTotals(result.value)
      })
    load()
    const unsubscribe =
      typeof window.ostlerAPI.onTimeChange === 'function'
        ? window.ostlerAPI.onTimeChange((change) => {
            if (change.projectId === projectId) load()
          })
        : () => {}
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [projectId])

  // What this project shows now, kept for going back to it.
  useEffect(() => {
    if (!projectId || loadedFor !== projectId) return
    shownRecords.set(projectId, {
      goals,
      milestones,
      workItems: storedWorkItems,
      lastStatusChangeAt,
      projectMetrics,
      decisions,
      wipLimits,
      harnessState,
      openBlockers,
      changedSourceWorkItemIds,
      attachmentCounts,
      commentCounts,
      taskContacts,
      labelColors,
      fields,
      iterations,
      taskTypes,
      timeTotals
    })
  }, [
    projectId,
    loadedFor,
    goals,
    milestones,
    storedWorkItems,
    lastStatusChangeAt,
    projectMetrics,
    decisions,
    wipLimits,
    harnessState,
    openBlockers,
    changedSourceWorkItemIds,
    attachmentCounts,
    commentCounts,
    taskContacts,
    labelColors,
    fields,
    iterations,
    taskTypes,
    timeTotals
  ])

  /** Each type by id, built once per load: a card looks its type up, never searches (N2.7a). */
  const taskTypeById = useMemo(() => new Map(taskTypes.map((type) => [type.id, type])), [taskTypes])

  const labelColor = useCallback(
    (name: string) => labelColors.get(name) ?? paletteColorFor(name),
    [labelColors]
  )

  return {
    goals,
    milestones,
    workItems,
    fields,
    iterations,
    taskTypes,
    taskTypeById,
    labelColor,
    lastStatusChangeAt,
    projectMetrics,
    wipLimits,
    harnessState,
    decisions,
    changedSourceWorkItemIds,
    attachmentCounts,
    commentCounts,
    taskContacts,
    timeTotals,
    loading,
    loaded: loadedFor === projectId,
    loadPlanning,
    internal: {
      setGoals,
      setMilestones,
      setIterations,
      setWorkItems,
      setDecisions,
      setWipLimits,
      setHarnessState,
      openBlockers
    }
  }
}

export type PlanningRecords = ReturnType<typeof usePlanningRecords>
