import { useCallback, useEffect, useState } from 'react'
import { usePolicy } from '../../../hooks/usePolicy'
import type {
  AIConnectionDraft,
  AIProvider,
  HarnessReport,
  RendererConfig,
  RendererProject
} from '@shared/ostler-api'
import { presetForSettings } from '@shared/ai-presets'
import { projectFolder } from '@shared/project-folder'
import { useOstler } from '../../../context/OstlerContext'
import { useSavedDraft } from '../../../hooks/useSavedDraft'
import { Badge, Button, type BadgeTone, InlineAlert, Select, Switch, TextField } from '../../../ui'
import { CommittedNumberField, SettingsGroup, useSettings } from '../settings-form'
import { AgentSetupDialog } from '../AgentSetupDialog'
import { AiSetupDialog } from '../AiSetupDialog'
import { EffortField } from '../EffortField'
import { UsagePricesGroup } from '../UsagePricesGroup'
import { AGENT_DEFAULT_MODELS, AGENT_PROVIDER_OPTIONS } from '../agent-model-options'
import { t } from '@shared/i18n'
import { formatRelativeTime } from '@shared/format'
import { projectSelectOptions } from '../../../components/areas/project-options'

const HEALTH: Record<HarnessReport['healthStatus'], { label: string; tone: BadgeTone }> = {
  healthy: {
    get label() {
      return t('agents:agentsSection.healthy')
    },
    tone: 'success'
  },
  warning: {
    get label() {
      return t('agents:agentsSection.needsAttention')
    },
    tone: 'warning'
  },
  error: {
    get label() {
      return t('agents:agentsSection.problem')
    },
    tone: 'danger'
  }
}

/**
 * Settings › Agents (D10): one switch, a short explanation, and the detailed
 * settings only while the switch is on. Each project's own auto-run options
 * and commit rules live in its Project settings.
 */
export function AgentsSection() {
  const { config, saveConfig } = useSettings()
  const on = config.harness.enabled
  // Turning agents on walks through the guided setup first (P7.2); "Set up
  // AI…" in it swaps to Ostler AI's own setup and back.
  const [setup, setSetup] = useState<'agents' | 'ai' | null>(null)
  const policy = usePolicy()

  if (policy?.disableAgents) {
    return (
      <SettingsGroup id="ai-agents">
        <p className="ostler-settings-text">{t('settings:policy.agentsOff')}</p>
      </SettingsGroup>
    )
  }

  return (
    <>
      <SettingsGroup id="ai-agents">
        <Switch
          label={t('agents:agentsSection.useAiAgentsSoftware')}
          checked={on}
          onChange={(event) => {
            if (event.target.checked) setSetup('agents')
            else void saveConfig({ harness: { enabled: false } })
          }}
          aria-describedby="ostler-agents-explainer"
        />
        <p id="ostler-agents-explainer" className="ostler-settings-text">
          {t('agents:agentsSection.agentsAiCodingAssistants')}
        </p>
        {!on && (
          <p className="ostler-settings-hint">{t('agents:agentsSection.whileOffHidesEvery')}</p>
        )}
      </SettingsGroup>
      {on && <AgentDetails />}
      {setup === 'agents' && (
        <AgentSetupDialog
          config={config}
          saveConfig={saveConfig}
          onClose={() => setSetup(null)}
          onSetUpAi={() => setSetup('ai')}
        />
      )}
      {setup === 'ai' && <AiSetupStep onDone={() => setSetup('agents')} />}
    </>
  )
}

/** Ostler AI's setup, opened from the agent setup's checks. */
function AiSetupStep({ onDone }: { onDone: () => void }) {
  const { config, saveConfig, setConfig } = useSettings()
  return (
    <AiSetupDialog
      config={config}
      onClose={onDone}
      saveConfig={saveConfig}
      onKeyCleared={setConfig}
    />
  )
}

/**
 * The connection the built-in agent's own model runs on: its provider with
 * Ostler AI's key, and Ostler AI's address only for a custom provider, as
 * `resolveOpenCodeTarget` does when it starts a session.
 */
function agentEffortDraft(config: RendererConfig): AIConnectionDraft {
  const provider = (config.harness.agentProvider || config.ai.provider) as AIProvider
  return {
    provider,
    model: config.harness.agentModel,
    ...(provider === 'custom' || provider === config.ai.provider
      ? { baseUrl: config.ai.baseUrl }
      : {})
  }
}

function agentEffortCacheKey(config: RendererConfig): string {
  const draft = agentEffortDraft(config)
  return `${draft.provider} ${draft.baseUrl ?? ''}`
}

/** Which model the built-in agent uses, and how agents run where a project has not chosen. */
function BuiltInAgentGroup() {
  const { config, saveConfig } = useSettings()
  const harness = config.harness
  const ownModel = harness.agentModel !== ''
  const aiModel = config.ai.model
    ? `${presetForSettings(config.ai).label}, ${config.ai.model}`
    : t('agents:agentsSection.isntSetUpYet')
  return (
    <SettingsGroup id="built-in-agent" description={t('agents:agentsSection.agentComesProjectCan')}>
      <Select
        label={t('agents:agentsSection.model')}
        value={ownModel ? 'own' : 'same'}
        options={[
          { value: 'same', label: t('agents:agentsSection.same', { aiModel }) },
          { value: 'own', label: t('agents:agentsSection.anotherModel') }
        ]}
        hint={t('agents:agentsSection.agentsNeedModelGood')}
        onChange={(event) =>
          void saveConfig({
            harness:
              event.target.value === 'own'
                ? {
                    agentProvider: config.ai.provider,
                    agentModel:
                      AGENT_DEFAULT_MODELS[config.ai.provider] || config.ai.model || 'gpt-4o'
                  }
                : { agentProvider: '', agentModel: '' }
          })
        }
      />
      {ownModel && (
        <div className="ostler-settings-inline-actions">
          <Select
            label={t('agents:agentsSection.provider')}
            options={AGENT_PROVIDER_OPTIONS}
            value={harness.agentProvider || config.ai.provider}
            onChange={(event) =>
              void saveConfig({
                harness: {
                  agentProvider: event.target.value,
                  agentModel: AGENT_DEFAULT_MODELS[event.target.value] || harness.agentModel
                }
              })
            }
          />
          <CommittedTextField
            label={t('agents:agentsSection.modelId')}
            value={harness.agentModel}
            onCommit={(agentModel) => void saveConfig({ harness: { agentModel } })}
          />
        </div>
      )}
      {ownModel && (
        <EffortField
          model={harness.agentModel}
          cacheKey={agentEffortCacheKey(config)}
          draft={agentEffortDraft(config)}
          effort={harness.agentEffort}
          onChange={(agentEffort) => void saveConfig({ harness: { agentEffort } })}
        />
      )}
      <CommittedNumberField
        label={t('agents:agentsSection.agentsOnce')}
        min={1}
        max={4}
        value={harness.maxConcurrentAgents}
        hint={t('agents:agentsSection.eachProjectEachRun')}
        onCommit={(maxConcurrentAgents) => void saveConfig({ harness: { maxConcurrentAgents } })}
      />
      <Switch
        label={t('agents:agentsSection.runQueuedTasksAutomatically')}
        checked={harness.autoRunQueued}
        onChange={(event) => void saveConfig({ harness: { autoRunQueued: event.target.checked } })}
      />
    </SettingsGroup>
  )
}

/** Text saved when the field loses focus or Enter is pressed; empty is refused. */
function CommittedTextField({
  label,
  value,
  onCommit
}: {
  label: string
  value: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useSavedDraft(value)
  const commit = () => {
    const next = draft.trim()
    if (next && next !== value) onCommit(next)
    else setDraft(value)
  }
  return (
    <TextField
      label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
      }}
    />
  )
}

function AgentDetails() {
  const { config, saveConfig } = useSettings()
  const harness = config.harness

  return (
    <>
      <BuiltInAgentGroup />
      <UsagePricesGroup />
      <SettingsGroup id="agent-monitoring">
        <CommittedNumberField
          label={t('agents:agentsSection.checkAgentStateEvery')}
          unit={t('common:unit.seconds')}
          min={1}
          max={60}
          value={Math.round(harness.pollIntervalMs / 1000)}
          onCommit={(seconds) => void saveConfig({ harness: { pollIntervalMs: seconds * 1000 } })}
        />
        <CommittedNumberField
          label={t('agents:agentsSection.updateHealthReportEvery')}
          unit={t('common:unit.seconds')}
          min={10}
          max={300}
          value={Math.round(harness.reportIntervalMs / 1000)}
          onCommit={(seconds) => void saveConfig({ harness: { reportIntervalMs: seconds * 1000 } })}
        />
        <CommittedNumberField
          label={t('agents:agentsSection.treatAgentStuckAfter')}
          unit={t('common:unit.minutes')}
          min={5}
          max={120}
          value={Math.round(harness.staleSessionThresholdMs / 60000)}
          hint={t('agents:agentsSection.agentHasntReportedLong')}
          onCommit={(minutes) =>
            void saveConfig({ harness: { staleSessionThresholdMs: minutes * 60000 } })
          }
        />
        <CommittedNumberField
          label={t('agents:agentsSection.keepHealthReports')}
          unit={t('common:unit.days')}
          min={1}
          max={90}
          value={harness.reportRetentionDays}
          onCommit={(reportRetentionDays) => void saveConfig({ harness: { reportRetentionDays } })}
        />
      </SettingsGroup>

      {/* The agent API's port, beside agents' own switch, as the automation
          API's port is beside its switch in Connections. */}
      <SettingsGroup id="agent-api" description={t('agents:agentsSection.agentApiDescription')}>
        <CommittedNumberField
          label={t('agents:agentsSection.agentApiPort')}
          min={1024}
          max={65535}
          value={harness.port}
          hint={t('agents:agentsSection.agentApiPortHint')}
          onCommit={(port) => void saveConfig({ harness: { port } })}
        />
      </SettingsGroup>

      <ProjectAgentSettings />
    </>
  )
}

/** Each project's agent health, one project at a time. */
function ProjectAgentSettings() {
  const { projects, areas } = useOstler()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const project = projects.find((candidate) => candidate.id === projectId) ?? projects[0]

  if (!project) return null

  return (
    <SettingsGroup
      id="agent-projects"
      description={t('agents:agentsSection.connectionDetailsHealthRecovery')}
    >
      <Select
        label={t('agents:agentsSection.project')}
        value={project.id}
        options={projectSelectOptions(projects, areas)}
        onChange={(event) => setProjectId(event.target.value)}
      />
      <ProjectAgentHealth key={project.id} project={project} />
    </SettingsGroup>
  )
}

function ProjectAgentHealth({ project }: { project: RendererProject }) {
  const [report, setReport] = useState<HarnessReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = project.id
  const hasFolder = projectFolder(project) !== null

  const load = useCallback(async () => {
    if (!hasFolder) return
    setBusy(true)
    try {
      const result = await window.ostlerAPI.getHarnessReport(id)
      if (result.ok) setReport(result.value)
      else setError(result.error)
    } finally {
      setBusy(false)
    }
  }, [id, hasFolder])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="ostler-settings-subsections">
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}

      {!hasFolder && (
        <p className="ostler-settings-hint">{t('agents:agentsSection.agentsWorkProjectsFolder')}</p>
      )}

      {hasFolder && (
        <section className="ostler-settings-subsection" aria-labelledby={`health-${id}`}>
          <h4 id={`health-${id}`}>
            {t('agents:agentsSection.health')}{' '}
            {report && (
              <Badge tone={HEALTH[report.healthStatus].tone}>
                {HEALTH[report.healthStatus].label}
              </Badge>
            )}
          </h4>
          {report ? (
            <>
              <p className="ostler-settings-text">{report.summary}</p>
              <p className="ostler-settings-hint">
                {t('agents:agentsSection.workingWaitingReviewQueued', {
                  reviewSessions: report.metrics.reviewSessions,
                  when: formatRelativeTime(new Date(report.generatedAt).getTime()),
                  agentCount: report.metrics.activeSessions,
                  runCount: report.metrics.pendingTasks
                })}
              </p>
              {report.alerts.length > 0 && (
                <ul className="ostler-settings-list">
                  {report.alerts.map((alert) => (
                    <li key={alert.code}>
                      <strong>{alert.title}</strong> {alert.detail}
                    </li>
                  ))}
                </ul>
              )}
              <div className="ostler-settings-inline-actions">
                <Button size="sm" disabled={busy} onClick={() => void load()}>
                  {t('agents:agentsSection.refresh')}
                </Button>
              </div>
            </>
          ) : (
            <p className="ostler-settings-hint">
              {t('agents:agentsSection.firstReportAppearsWithin')}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
