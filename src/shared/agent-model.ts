import type {
  AIEffortSetting,
  AIProvider,
  OstlerConfig,
  ProjectAutoDispatchConfig
} from './ostler-api'
import { getModelOptions } from './model-options'

/** A model and effort chosen for one run of a task (D42). '' is "the default". */
export interface AgentRunChoice {
  model: string
  effort: AIEffortSetting
}

/** Where the model a run uses came from, in D42's order. */
export type AgentModelSource = 'run' | 'project' | 'settings'

export interface AgentModelResolution {
  provider: AIProvider
  model: string
  effort: AIEffortSetting
  source: AgentModelSource
}

export type AgentModelConfig = {
  ai: Pick<OstlerConfig['ai'], 'provider' | 'model' | 'effort' | 'baseUrl'>
  harness: Pick<OstlerConfig['harness'], 'agentProvider' | 'agentModel' | 'agentEffort'>
}

type ProjectAgentDefault = Pick<
  ProjectAutoDispatchConfig,
  'aiOverrideEnabled' | 'defaultProvider' | 'defaultModel'
> & { defaultEffort?: AIEffortSetting }

/**
 * The one answer to "which model does the built-in agent run this task with"
 * (D42): the run's own choice, else the project's default (Project settings ›
 * Agents), else Settings › Agents, whose "Same as Ostler AI" uses Ostler AI's.
 * The run chooses a model within the provider in effect; it never changes the
 * provider. The dispatcher, the runner and every screen that names a run's
 * model go through this.
 */
export function resolveAgentModel(
  config: AgentModelConfig,
  project?: ProjectAgentDefault | null,
  run?: Partial<AgentRunChoice> | null
): AgentModelResolution {
  const agent = config.harness
  const override = project?.aiOverrideEnabled ? project : null
  const provider = (override?.defaultProvider ||
    agent.agentProvider ||
    config.ai.provider) as AIProvider
  const base: Omit<AgentModelResolution, 'provider'> = override?.defaultModel
    ? { model: override.defaultModel, effort: override.defaultEffort ?? '', source: 'project' }
    : {
        model: agent.agentModel || config.ai.model,
        effort: agent.agentModel ? agent.agentEffort : config.ai.effort,
        source: 'settings'
      }
  const runModel = run?.model?.trim() ?? ''
  if (runModel) return { provider, model: runModel, effort: run?.effort ?? '', source: 'run' }
  if (run?.effort) return { provider, model: base.model, effort: run.effort, source: 'run' }
  return { provider, ...base }
}

/**
 * The connection a run's effort is checked on, as Settings › Agents checks
 * its own: the provider with Ostler AI's key, and Ostler AI's address only for
 * a custom provider or Ostler AI's own provider.
 */
export function agentEffortConnection(
  config: AgentModelConfig,
  provider: AIProvider,
  model: string
): { provider: AIProvider; model: string; baseUrl?: string } {
  return {
    provider,
    model,
    ...(provider === 'custom' || provider === config.ai.provider
      ? { baseUrl: config.ai.baseUrl }
      : {})
  }
}

/**
 * The models a run may choose: the list Settings offers for the provider in
 * effect, plus the defaults already chosen in Settings and the project, which
 * may be models the list does not name.
 */
export function agentRunModelChoices(
  config: AgentModelConfig,
  project?: ProjectAgentDefault | null
): string[] {
  const { provider, model } = resolveAgentModel(config, project)
  const listed = getModelOptions(provider, provider === 'custom' ? config.ai.baseUrl : '').map(
    (option) => option.value
  )
  return [...new Set([model, ...listed].filter(Boolean))]
}
