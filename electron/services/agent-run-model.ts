import type {
  AIConnectionDraft,
  AIModelEffortSupport,
  OstlerConfig,
  WatchedProject
} from '@shared/ostler-api'
import { isAIEffortLevel } from '@shared/ostler-api'
import {
  agentEffortConnection,
  agentRunModelChoices,
  resolveAgentModel,
  type AgentRunChoice
} from '@shared/agent-model'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import { aiModelEffortSupport } from './ai-access'

/** Asks the model's provider which effort levels it takes, as Settings does. */
export type EffortSupportCheck = (draft: AIConnectionDraft) => Promise<AIModelEffortSupport>

/**
 * Checks a model and effort chosen for one run (D42), for the desktop app and
 * the automation API alike, so both refuse the same choice with the same
 * words. The model must be one Settings offers for the provider in effect (or
 * a default already chosen); the effort must be one the model's provider
 * takes, asked exactly as Settings' Effort field asks. Returns the choice
 * normalised; `{ model: '', effort: '' }` is "the default".
 */
export async function validateAgentRunChoice(
  config: OstlerConfig,
  /** Null for a playbook every project can use (N9.6b): only Settings' default applies. */
  project: Pick<WatchedProject, 'autoDispatch'> | null,
  input: unknown,
  effortSupport: EffortSupportCheck = (draft) => aiModelEffortSupport(config, draft)
): Promise<AgentRunChoice> {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  if (raw.model !== undefined && raw.model !== null && typeof raw.model !== 'string') {
    throw new Refusal(t('errors:agentRunModel.modelNotText'))
  }
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  const effortInput = raw.effort ?? ''
  if (effortInput !== '' && !isAIEffortLevel(effortInput)) {
    throw new Refusal(t('errors:agentRunModel.unknownEffort', { effort: String(effortInput) }))
  }
  const effort = effortInput === '' ? '' : effortInput

  const projectDefault = project?.autoDispatch
  const resolved = resolveAgentModel(config, projectDefault, { model, effort })
  if (model && !agentRunModelChoices(config, projectDefault).includes(model)) {
    throw new Refusal(
      t('errors:agentRunModel.modelNotOffered', { model, provider: resolved.provider })
    )
  }
  if (effort) {
    const support = await effortSupport(
      agentEffortConnection(config, resolved.provider, resolved.model)
    )
    if (!support.levels.includes(effort)) {
      throw new Refusal(t('errors:agentRunModel.effortNotTaken', { model: resolved.model, effort }))
    }
  }
  return { model, effort }
}

/**
 * "Run again with…" (D42): a rejection that sends the task back to the queue
 * may name the next run's model. Left out, the task keeps the choice it had.
 */
export async function validateRunAgainChoice(
  config: OstlerConfig,
  project: WatchedProject,
  disposition: unknown,
  input: unknown,
  effortSupport?: EffortSupportCheck
): Promise<AgentRunChoice | undefined> {
  if (input === undefined || input === null) return undefined
  if (disposition !== 'retry') throw new Refusal(t('errors:agentRunModel.runAgainRetryOnly'))
  return validateAgentRunChoice(config, project, input, effortSupport)
}
