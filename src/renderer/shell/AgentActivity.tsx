import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { projectFolder } from '@shared/project-folder'
import { useOstler } from '../context/OstlerContext'
import { useFeatures } from '../navigation/features'
import { useAnnounce } from '../ui'
import { agentRunAnnouncements, type RunSnapshot, type RunSnapshots } from './agent-announcements'

/** Agent sessions running now, per project, while agents are on. */
export interface AgentActivity {
  running: number
  byProject: Record<string, number>
}

const NONE: AgentActivity = { running: 0, byProject: {} }
const AgentActivityContext = createContext<AgentActivity>(NONE)

/**
 * Counts running agent sessions across projects for the sidebar's Agents
 * entry and the status bar. Read on start, then again (coalesced) whenever
 * main pushes a harness change. Nothing is read while agents are off. A run
 * starting, stopping or getting blocked is said aloud (P9.2).
 */
export function AgentActivityProvider({ children }: { children: ReactNode }) {
  const { projects } = useOstler()
  const { agents } = useFeatures()
  const [activity, setActivity] = useState<AgentActivity>(NONE)
  const announce = useAnnounce()
  // The runs last seen; null until the first read, which says nothing.
  const lastRuns = useRef<RunSnapshots | null>(null)

  useEffect(() => {
    if (!agents) {
      setActivity(NONE)
      lastRuns.current = null
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const withFolder = projects.filter((project) => projectFolder(project) !== null)
    const load = async () => {
      const runs = new Map<string, RunSnapshot>()
      const counts = await Promise.all(
        withFolder.map(async (project) => {
          const result = await window.ostlerAPI.getHarnessState(project.id)
          const sessions = result.ok ? result.value.activeSessions : []
          for (const session of sessions) {
            runs.set(session.id, {
              title: session.title,
              projectName: project.name,
              status: session.status
            })
          }
          return [project.id, sessions.length] as const
        })
      )
      if (cancelled) return
      if (lastRuns.current) {
        announce(agentRunAnnouncements(lastRuns.current, runs).join(' '))
      }
      lastRuns.current = runs
      const byProject = Object.fromEntries(counts)
      setActivity({
        running: counts.reduce((sum, [, count]) => sum + count, 0),
        byProject
      })
    }
    void load()
    const unsubscribe = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field !== 'harness') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(), 500)
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [projects, agents])

  return <AgentActivityContext.Provider value={activity}>{children}</AgentActivityContext.Provider>
}

export function useAgentActivity(): AgentActivity {
  return useContext(AgentActivityContext)
}
