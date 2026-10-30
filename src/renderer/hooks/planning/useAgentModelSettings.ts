import { useMemo } from 'react'
import { useConfig } from '../useConfig'
import { useIpcQuery } from '../useIpcQuery'
import type { AgentModelConfig } from '@shared/agent-model'
import type { ProjectAutoDispatchConfig } from '@shared/ostler-api'

/** What a run's model is chosen and named from (D42): Settings, and this project's default. */
export interface AgentModelSettings {
  config: AgentModelConfig
  project: ProjectAutoDispatchConfig
}

/**
 * Settings › Agents (kept live) and the project's own default, read once per project, for
 * the run model picker and the model a queue or run card names.
 */
export function useAgentModelSettings(projectId: string): AgentModelSettings | null {
  const { config } = useConfig({ enabled: !!projectId })
  const project = useIpcQuery(
    () => window.ostlerAPI.getProjectAutoDispatchConfig(projectId),
    [projectId],
    { enabled: !!projectId }
  ).value
  // A project's settings never stand in for another's while its own load.
  const current = project?.projectId === projectId ? project : undefined
  return useMemo(() => (config && current ? { config, project: current } : null), [config, current])
}
