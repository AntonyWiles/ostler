import { useEffect, useState } from 'react'
import type {
  OstlerAPI,
  PlanningReadinessReport,
  PlanningWorkItemMetrics,
  RendererProject
} from '@shared/ostler-api'
import { buildReadinessReport } from '@shared/planning-readiness'
import { t } from '@shared/i18n'
import {
  aggregatePortfolio,
  type PortfolioProjectInput,
  type PortfolioSummary
} from './portfolio-aggregation'

/** How long a project's loaded summary is reused when nothing about it has changed. */
export const PORTFOLIO_REUSE_MS = 5 * 60_000

/**
 * Each project's loaded summary input, kept between visits to Home. Reading
 * every project's tasks, metrics and agent state again on each visit cost main
 * about a second on a big dataset, and whatever was opened next from Home
 * waited behind it. An entry goes when main says its project changed (or
 * something Home shows changed anywhere), and after `PORTFOLIO_REUSE_MS`.
 * Kept per `window.ostlerAPI`, so a new one (a test's) starts empty.
 */
const reuse: {
  api: OstlerAPI | null
  entries: Map<string, { input: PortfolioProjectInput; at: number }>
  /** Bumped by every change that drops entries, so a load in flight is not kept. */
  generation: number
  /** Mounted summaries that reload on a change. */
  listeners: Set<() => void>
} = { api: null, entries: new Map(), generation: 0, listeners: new Set() }

function reuseFor(api: OstlerAPI): typeof reuse {
  if (reuse.api === api) return reuse
  reuse.api = api
  reuse.entries.clear()
  reuse.generation += 1
  // One subscription for as long as this API lives, so a change while Home
  // is closed still drops what it changed.
  api.onProjectStateChange((update) => {
    if (reuse.api !== api) return
    const { field, projectId } = update
    if (!['planning', 'home', 'harness', 'projects'].includes(field)) return
    if (projectId) reuse.entries.delete(projectId)
    else reuse.entries.clear()
    reuse.generation += 1
    // An open Home reloads on task changes, as it always has; agent state and
    // project settings are read again on the next visit.
    if (field === 'planning' || field === 'home') for (const listener of reuse.listeners) listener()
  })
  return reuse
}

/** Forgets every reused summary: for tests. */
export function forgetPortfolioSummaries(): void {
  reuse.api = null
  reuse.entries.clear()
  reuse.listeners.clear()
}

/** One project's summary input: five calls, the task metrics in one (P9.1). */
async function loadProject(project: RendererProject): Promise<PortfolioProjectInput> {
  const [itemsRes, milestonesRes, metricsRes, harnessRes, itemMetricsRes] = await Promise.all([
    window.ostlerAPI.getPlanningWorkItems(project.id),
    window.ostlerAPI.getPlanningMilestones(project.id),
    window.ostlerAPI.getPlanningProjectMetrics(project.id),
    window.ostlerAPI.getHarnessState(project.id),
    window.ostlerAPI.getPlanningProjectWorkItemMetrics(project.id)
  ])
  if (!itemsRes.ok || !milestonesRes.ok || !metricsRes.ok)
    throw new Error(t('tasks:portfolioView.couldntLoadProject', { project: project.name }))
  const items = itemsRes.value
  const milestones = milestonesRes.value
  const metricsByItem = new Map<string, PlanningWorkItemMetrics>(
    itemMetricsRes.ok ? Object.entries(itemMetricsRes.value) : []
  )
  const readiness: PlanningReadinessReport[] = milestones.map((milestone) =>
    buildReadinessReport(milestone.id, {
      items: items.filter((item) => item.milestoneId === milestone.id),
      metrics: metricsByItem,
      reviewCount: harnessRes.ok ? harnessRes.value.reviewSessions.length : 0,
      pendingQuestionCount: harnessRes.ok
        ? harnessRes.value.questions.filter((question) => question.status === 'pending').length
        : 0,
      gitDirty: false,
      gitConflicted: 0
    })
  )
  return {
    projectId: project.id,
    projectName: project.name,
    workItems: items,
    milestones,
    metrics: metricsRes.value,
    readiness,
    harness: harnessRes.ok ? harnessRes.value : null
  }
}

/**
 * Home's project summaries (progress, blockers, risks, next milestone), loaded
 * once for the cards and the board of projects (N5.3) alike. Reloads when main
 * says a task changed anywhere, or the projects change. A project nothing has
 * changed in since the last visit is not read again, and projects are read one
 * at a time, stopping when Home closes, so leaving Home never waits behind them.
 */
export function usePortfolioSummary(projects: RendererProject[]): {
  summary: PortfolioSummary | null
  error: string | null
} {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Reload when main says a task changed anywhere, as the rest of Home does
  // (useHomeFeed); otherwise the counts stay at whatever they were on first load.
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const shared = reuseFor(window.ostlerAPI)
    const listener = () => setVersion((v) => v + 1)
    shared.listeners.add(listener)
    return () => {
      shared.listeners.delete(listener)
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    const shared = reuseFor(window.ostlerAPI)
    async function load() {
      const inputs: PortfolioProjectInput[] = []
      for (const project of projects) {
        const kept = shared.entries.get(project.id)
        if (kept && Date.now() - kept.at < PORTFOLIO_REUSE_MS) {
          inputs.push({ ...kept.input, projectName: project.name })
          continue
        }
        const generation = shared.generation
        const input = await loadProject(project)
        if (cancelled) return
        // A change while it loaded may have made it stale: use it, keep it not.
        if (generation === shared.generation)
          shared.entries.set(project.id, { input, at: Date.now() })
        inputs.push(input)
      }
      if (!cancelled) setSummary(aggregatePortfolio(inputs))
    }
    load().catch((reason: unknown) => {
      if (!cancelled)
        setError(
          reason instanceof Error ? reason.message : t('tasks:portfolioView.couldntLoadProjectsTry')
        )
    })
    return () => {
      cancelled = true
    }
  }, [projects, version])
  return { summary, error }
}
