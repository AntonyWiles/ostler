import { MAX_PLAYBOOK_INSTRUCTIONS, type TaskTemplateAgent } from '@shared/ostler-api'
import type { PlanFirstChoice } from '@shared/plan-first'
import { t } from '@shared/i18n'
import { Select, TextArea } from '../ui'
import { RunModelPicker } from '../views/planning/RunModelPicker'
import type { AgentModelSettings } from '../hooks/planning/useAgentModelSettings'

export const EMPTY_PLAYBOOK_AGENT: TaskTemplateAgent = {
  model: '',
  effort: '',
  planFirst: 'default',
  instructions: ''
}

/**
 * A playbook's agent part (N9.6b): the built-in agent's model and effort, as
 * a run's are chosen (D42), plan first, and extra instructions for the agent.
 * Used by Save as playbook… and the Playbooks group's Edit.
 */
export function PlaybookAgentFields({
  settings,
  value,
  onChange
}: {
  settings: AgentModelSettings | null
  value: TaskTemplateAgent
  onChange: (agent: TaskTemplateAgent) => void
}) {
  return (
    <>
      {settings ? (
        <RunModelPicker
          settings={settings}
          value={{ model: value.model, effort: value.effort }}
          onChange={(choice) => onChange({ ...value, ...choice })}
        />
      ) : (
        <p className="agents-muted">{t('agents:playbooks.loading')}</p>
      )}
      <Select
        label={t('agents:playbooks.planFirst')}
        hint={t('agents:playbooks.planFirstHint')}
        value={value.planFirst}
        options={[
          { value: 'default', label: t('agents:playbooks.planFirstDefault') },
          { value: 'yes', label: t('agents:playbooks.planFirstYes') },
          { value: 'no', label: t('agents:playbooks.planFirstNo') }
        ]}
        onChange={(event) =>
          onChange({ ...value, planFirst: event.target.value as PlanFirstChoice })
        }
      />
      <TextArea
        label={t('agents:playbooks.instructions')}
        hint={t('agents:playbooks.instructionsHint', { max: MAX_PLAYBOOK_INSTRUCTIONS })}
        value={value.instructions}
        maxLength={MAX_PLAYBOOK_INSTRUCTIONS}
        rows={4}
        onChange={(event) => onChange({ ...value, instructions: event.target.value })}
      />
    </>
  )
}
