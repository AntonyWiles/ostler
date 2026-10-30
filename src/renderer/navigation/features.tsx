import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useConfig } from '../hooks/useConfig'
import type {
  ProjectUsage,
  ProjectUsageFact,
  RendererConfig,
  RendererProject
} from '@shared/ostler-api'
import { isAiConfigured } from '@shared/ai-configured'
import { projectFolder } from '@shared/project-folder'
import { normalizeProjectStage } from '@shared/project-stages'
import type { ViewContext } from './registry'
import { effectiveTabPrefs, useTabPrefs } from './tab-prefs'

/**
 * The feature switches every view's `isAvailable` reads (information-
 * architecture.md, "Progressive disclosure"). Components ask
 * `features.agents` and `features.ai`, never the config fields.
 */
export interface Features {
  /** "Use AI agents": `config.harness.enabled` (D10), not a second flag. */
  agents: boolean
  /** A model plus a key, or a keyless local provider (`isAiConfigured`). */
  ai: boolean
  /**
   * Inside a project: whether its AI plans for coding agents ('software') or
   * people ('general'), `projectAiProfile` as main works it out. Unknown
   * (undefined) until read.
   */
  aiProfile?: 'software' | 'general'
  /** False until the config has been read: nothing is hidden for good before then. */
  loaded: boolean
  /**
   * The projects with a task waiting in To triage, kept up to date as tasks
   * change. Absent until read: To triage is offered.
   */
  triageWaiting?: ReadonlySet<string>
  /**
   * What each project holds that its views care about (`getProjectUsage`),
   * kept up to date as tasks change: which views earn a tab. Absent until read.
   */
  usage?: ProjectUsage
}

const NOT_LOADED: Features = { agents: false, ai: false, loaded: false }

export function featuresFromConfig(config: Pick<RendererConfig, 'harness' | 'ai'>): Features {
  return { agents: config.harness.enabled, ai: isAiConfigured(config.ai), loaded: true }
}

const FeaturesContext = createContext<Features>(NOT_LOADED)

/**
 * Reads the config once, and again whenever main says a setting changed; and
 * which projects have a task waiting in To triage, again whenever tasks change.
 */
export function FeaturesProvider({ children }: { children: ReactNode }) {
  const { config } = useConfig()
  const features = useMemo(() => (config ? featuresFromConfig(config) : NOT_LOADED), [config])
  const [usage, setUsage] = useState<ProjectUsage | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const loadUsage = async () => {
      try {
        const result = await window.ostlerAPI.getProjectUsage()
        if (cancelled || !result.ok) return
        // The same facts keep the same object, so nothing re-renders for nothing.
        const next = result.value
        setUsage((current) =>
          current && JSON.stringify(current) === JSON.stringify(next) ? current : next
        )
      } catch {
        // Not known: To triage stays offered, and views keep their own places.
      }
    }
    void loadUsage()
    const unsubscribe = window.ostlerAPI.onProjectStateChange((update) => {
      // Costs, budgets, the shopping list and time say 'home'; tasks say 'planning'.
      if (update.field === 'planning' || update.field === 'home') {
        // A burst of changes reads once.
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void loadUsage(), 150)
      }
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [])

  const value = useMemo<Features>(
    () =>
      usage ? { ...features, usage, triageWaiting: projectsHolding(usage, 'triage') } : features,
    [features, usage]
  )
  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>
}

/** Fixed switches, for a component rendered on its own (tests, the component gallery). */
export function StaticFeaturesProvider({
  value,
  children
}: {
  value: Pick<Features, 'agents' | 'ai' | 'triageWaiting' | 'usage'>
  children: ReactNode
}) {
  return (
    <FeaturesContext.Provider value={{ ...value, loaded: true }}>
      {children}
    </FeaturesContext.Provider>
  )
}

/** The switches inside one project, where the project's AI profile is known. Wraps a project's workspace. */
export function ProjectFeaturesProvider({
  project,
  children
}: {
  project: Pick<RendererProject, 'id' | 'path' | 'aiProfile'>
  children: ReactNode
}) {
  const features = useFeatures()
  const [aiProfile, setAiProfile] = useState<'software' | 'general' | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void window.ostlerAPI.getProjectAISettings(project.id).then((result) => {
      if (!cancelled && result.ok) setAiProfile(result.value.profile)
    })
    return () => {
      cancelled = true
    }
  }, [project.id, project.path, project.aiProfile])

  const value = useMemo<Features>(
    () => ({
      ...features,
      aiProfile
    }),
    [features, aiProfile]
  )
  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>
}

/** "Plan and split" writes tasks for coding agents: software projects with agents on (P7.1). */
export function canPlanAndSplit(features: Features): boolean {
  return features.ai && features.agents && features.aiProfile === 'software'
}

/** The app's feature switches. */
export function useFeatures(): Features {
  return useContext(FeaturesContext)
}

/** The projects whose usage holds `fact`. */
export function projectsHolding(usage: ProjectUsage, fact: ProjectUsageFact): ReadonlySet<string> {
  return new Set(Object.keys(usage).filter((id) => usage[id].includes(fact)))
}

/** The context a view's `isAvailable` reads, for one project or none. */
export function viewContext(features: Features, project?: ViewProject | null): ViewContext {
  const triage = project ? triageOffered(project, features.triageWaiting) : undefined
  const uses = project?.id !== undefined ? features.usage?.[project.id] : undefined
  return {
    hasFolder: project ? projectFolder(project) !== null : false,
    agents: features.agents,
    ai: features.ai,
    ...(triage === undefined ? {} : { triage }),
    ...(uses === undefined ? {} : { uses }),
    ...(project ? { planning: normalizeProjectStage(project.stage) === 'planning' } : {}),
    tabPrefs: effectiveTabPrefs(project?.id ?? undefined)
  }
}

/** What `viewContext` reads of a project. Without `id`, To triage is offered. */
export type ViewProject = Pick<RendererProject, 'path'> &
  Partial<Pick<RendererProject, 'id' | 'triageCaptures' | 'stage'>>

/**
 * To triage is offered only when it can hold something: the project's
 * Triage new captures is on, or a task waits in it. Undefined (offered)
 * while that is not known.
 */
export function triageOffered(
  project: ViewProject,
  waiting: ReadonlySet<string> | undefined
): boolean | undefined {
  if (project.triageCaptures === true) return true
  if (project.id === undefined || waiting === undefined) return undefined
  return waiting.has(project.id)
}

/** `viewContext` for a project, memoised. */
export function useViewContext(project?: ViewProject | null): ViewContext {
  const features = useFeatures()
  const path = project?.path ?? null
  const id = project?.id
  const triageCaptures = project?.triageCaptures
  const stage = project?.stage
  const tabPrefs = useTabPrefs(id)
  return useMemo(
    () => ({
      ...viewContext(features, project ? { path, id, triageCaptures, stage } : null),
      tabPrefs
    }),
    [features, project ? 1 : 0, path, id, triageCaptures, stage, tabPrefs]
  )
}
