import { useMemo } from 'react'
import { useConfig } from '../hooks/useConfig'
import { useIpcQuery } from '../hooks/useIpcQuery'
import type { ProjectAutoDispatchConfig } from '@shared/ostler-api'
import type { AgentModelSettings } from '../hooks/planning/useAgentModelSettings'

/** A playbook for every project has no project default: only Settings' applies. */
const NO_PROJECT_DEFAULT: ProjectAutoDispatchConfig = {
  projectId: '',
  enabled: false,
  maxConcurrentEmbeddedSessions: 1,
  aiOverrideEnabled: false,
  defaultProvider: '',
  defaultModel: '',
  defaultEffort: '',
  autoArchiveDoneAfterDays: 0
}

/**
 * What a playbook's model is chosen from (N9.6b): Settings › Agents, and the
 * project's own default when the playbook belongs to one project (null: a
 * playbook for every project). Main checks the choice again on save.
 */
export function usePlaybookModelSettings(projectId: string | null): AgentModelSettings | null {
  const { config } = useConfig()
  const project = useIpcQuery(
    () => window.ostlerAPI.getProjectAutoDispatchConfig(projectId ?? ''),
    [projectId],
    { enabled: !!projectId }
  ).value
  const current = !projectId
    ? NO_PROJECT_DEFAULT
    : project?.projectId === projectId
      ? project
      : undefined
  return useMemo(() => (config && current ? { config, project: current } : null), [config, current])
}
