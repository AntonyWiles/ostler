import {
  agentEffortConnection,
  agentRunModelChoices,
  resolveAgentModel,
  type AgentModelResolution,
  type AgentRunChoice
} from '@shared/agent-model'
import { getModelOptions } from '@shared/model-options'
import type { HarnessSession, HarnessTask } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Select } from '../../ui'
import { EffortField, effortLabel } from '../settings/EffortField'
import type { AgentModelSettings } from '../../hooks/planning/useAgentModelSettings'

/** The model a run will use, or used, as a card names it. */
export function describeRunModel(resolution: Pick<AgentModelResolution, 'model' | 'effort'>) {
  return resolution.effort
    ? t('agents:runModel.modelWithEffort', {
        model: resolution.model,
        effort: effortLabel(resolution.effort)
      })
    : resolution.model
}

/**
 * The words a queue or run card shows for a task's model (D42): what an
 * embedded run used, "Set in the connected agent" for an external one, and for work
 * still waiting, what the built-in agent would use and where that comes from.
 */
export function runModelLine(
  task: HarnessTask,
  session: HarnessSession | null | undefined,
  settings: AgentModelSettings | null
): string | null {
  if (session?.provenance === 'external') return t('agents:runModel.setInConnectedAgent')
  if (session?.embeddedRuntime?.model) {
    return t('agents:runModel.ranWith', {
      model: describeRunModel({
        model: session.embeddedRuntime.model,
        effort: session.embeddedRuntime.effort ?? ''
      })
    })
  }
  if (session || !settings || task.status !== 'pending') return null
  const resolved = resolveAgentModel(settings.config, settings.project, task)
  if (!resolved.model) return null
  return t(`agents:runModel.willRunWith.${resolved.source}`, {
    model: describeRunModel(resolved)
  })
}

/**
 * Choosing the built-in agent's model and effort for one run (D42). The models
 * are the ones Settings offers for the provider in effect, and the effort is
 * checked with that provider exactly as Settings' Effort field checks it.
 * "Default" leaves the run on the project's model, else Settings'.
 */
export function RunModelPicker({
  settings,
  value,
  onChange,
  label
}: {
  settings: AgentModelSettings
  value: AgentRunChoice
  onChange: (choice: AgentRunChoice) => void
  label?: string
}) {
  const { config, project } = settings
  const fallback = resolveAgentModel(config, project)
  const resolved = resolveAgentModel(config, project, value)
  const listed = getModelOptions(
    resolved.provider,
    resolved.provider === 'custom' ? config.ai.baseUrl : ''
  )
  const choices = agentRunModelChoices(config, project)
  if (value.model && !choices.includes(value.model)) choices.push(value.model)
  const connection = agentEffortConnection(config, resolved.provider, resolved.model)
  return (
    <div className="run-model-picker">
      <Select
        label={label ?? t('agents:runModel.model')}
        value={value.model}
        hint={t('agents:runModel.externalUsesOwn')}
        options={[
          {
            value: '',
            label: t(`agents:runModel.default.${fallback.source}`, {
              model: describeRunModel(fallback)
            })
          },
          ...choices.map((model) => ({
            value: model,
            label: listed.find((option) => option.value === model)?.label ?? model
          }))
        ]}
        onChange={(event) => onChange({ model: event.target.value, effort: '' })}
      />
      {value.model && (
        <EffortField
          model={resolved.model}
          cacheKey={`${connection.provider} ${connection.baseUrl ?? ''}`}
          draft={connection}
          effort={value.effort}
          onChange={(effort) => onChange({ model: value.model, effort })}
        />
      )}
    </div>
  )
}
