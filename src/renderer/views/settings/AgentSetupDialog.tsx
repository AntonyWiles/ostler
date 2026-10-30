import { useCallback, useEffect, useState } from 'react'
import type { AgentRequirements, RendererConfig, RendererConfigUpdate } from '@shared/ostler-api'
import { presetForSettings } from '@shared/ai-presets'
import {
  Badge,
  Button,
  Dialog,
  InlineAlert,
  NumberField,
  Radio,
  RadioGroup,
  Select,
  Spinner,
  Switch,
  TextField
} from '../../ui'
import { useAgentColumnsNotice } from '../../components/agent-columns-notice'
import { AGENT_DEFAULT_MODELS, AGENT_PROVIDER_OPTIONS } from './agent-model-options'
import './AgentSetupDialog.css'
import { t } from '@shared/i18n'

type Step = 1 | 2 | 3 | 4

const STEP_TITLES: Record<Step, string> = {
  get 1() {
    return t('agents:agentSetupDialog.whatAgentsDo')
  },
  get 2() {
    return t('agents:agentSetupDialog.checkWhatAgentsNeed')
  },
  get 3() {
    return t('agents:agentSetupDialog.chooseModel')
  },
  get 4() {
    return t('agents:agentSetupDialog.chooseHowAgentsRun')
  }
}

interface AgentSetupDialogProps {
  config: RendererConfig
  onClose: () => void
  /** Saves the choices and turns agents on, in one change. */
  saveConfig: (updates: RendererConfigUpdate) => Promise<void>
  /** Opens Ostler AI's own setup; the dialog checks again when it is shown next. */
  onSetUpAi: () => void
}

/**
 * The guided start for "Use AI agents" (P7.2): what agents do and how Ostler
 * keeps them safe, what they need, which model the built-in agent uses, and
 * how many run at once. Agents go on only at "Turn on agents"; closing the
 * dialog leaves them off.
 */
export function AgentSetupDialog({
  config,
  onClose,
  saveConfig,
  onSetUpAi
}: AgentSetupDialogProps) {
  const harness = config.harness
  const agentColumns = useAgentColumnsNotice()
  const [step, setStep] = useState<Step>(1)
  const [checks, setChecks] = useState<AgentRequirements | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [ownModel, setOwnModel] = useState(Boolean(harness.agentModel))
  const [provider, setProvider] = useState(harness.agentProvider || config.ai.provider)
  const [model, setModel] = useState(harness.agentModel)
  const [concurrency, setConcurrency] = useState<number | null>(harness.maxConcurrentAgents || 1)
  const [autoRun, setAutoRun] = useState(harness.autoRunQueued)
  const [saving, setSaving] = useState(false)

  const check = useCallback(async () => {
    setChecking(true)
    setCheckError(null)
    const result = await window.ostlerAPI.checkAgentRequirements()
    setChecking(false)
    if (result.ok) setChecks(result.value)
    else setCheckError(result.error)
  }, [])

  useEffect(() => {
    if (step === 2) void check()
  }, [step, check])

  const aiPreset = presetForSettings(config.ai)
  const sameAsAi = config.ai.model
    ? `${aiPreset.label}, ${config.ai.model}`
    : t('agents:agentSetupDialog.notSetUpYet')
  const modelReady = !ownModel || model.trim() !== ''
  const concurrencyReady = concurrency !== null && concurrency >= 1 && concurrency <= 4
  const failing = checks
    ? [checks.gitVersion === null, !checks.aiConfigured, !checks.runtimePresent].filter(Boolean)
        .length
    : 0

  const finish = async () => {
    if (!concurrencyReady || !modelReady) return
    setSaving(true)
    const hiding = await agentColumns.hiding()
    await saveConfig({
      harness: {
        enabled: true,
        agentProvider: ownModel ? provider : '',
        agentModel: ownModel ? model.trim() : '',
        maxConcurrentAgents: concurrency,
        autoRunQueued: autoRun
      }
    })
    await agentColumns.tellShown(hiding)
    setSaving(false)
    onClose()
  }

  const canGoOn = step === 3 ? modelReady : step === 4 ? concurrencyReady : !checking

  return (
    <Dialog
      open
      size="md"
      title={t('agents:agentSetupDialog.turnAiAgents')}
      description={t('agents:agentSetupDialog.step4', { step, STEP_TITLES: STEP_TITLES[step] })}
      onClose={onClose}
      canDismiss={!saving}
      closeOnBackdrop={false}
      footer={
        <>
          {step > 1 && (
            <Button onClick={() => setStep((step - 1) as Step)} disabled={saving}>
              {t('agents:agentSetupDialog.back')}
            </Button>
          )}
          {step < 4 ? (
            <Button
              variant="primary"
              disabled={!canGoOn}
              onClick={() => setStep((step + 1) as Step)}
            >
              {t('agents:agentSetupDialog.next')}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!canGoOn}
              loading={saving}
              onClick={() => void finish()}
            >
              {t('agents:agentSetupDialog.turnAgents')}
            </Button>
          )}
        </>
      }
    >
      <div className="ostler-agent-setup">
        {step === 1 && (
          <>
            <p className="ostler-agent-setup__text">
              {t('agents:agentSetupDialog.agentsAiCodingAssistants')}
            </p>
            <ul className="ostler-agent-setup__list">
              <li>{t('agents:agentSetupDialog.eachAgentWorksOwn')}</li>
              <li>{t('agents:agentSetupDialog.nothingReachesFolderUntil')}</li>
              <li>{t('agents:agentSetupDialog.stopAllAiStatus')}</li>
            </ul>
          </>
        )}

        {step === 2 && (
          <>
            {checking && !checks && <Spinner label={t('agents:agentSetupDialog.checking')} />}
            {checkError && (
              <InlineAlert tone="danger" title={t('agents:agentSetupDialog.couldntCheck')}>
                {checkError}
              </InlineAlert>
            )}
            {checks && (
              <ul
                className="ostler-agent-setup__checks"
                aria-label={t('agents:agentSetupDialog.requirements')}
              >
                <Requirement
                  label={t('agents:agentSetupDialog.gitInstalled')}
                  ok={checks.gitVersion !== null}
                  detail={checks.gitVersion ?? t('agents:agentSetupDialog.agentsKeepTheirWork')}
                />
                <Requirement
                  label={t('agents:agentSetupDialog.setUp')}
                  ok={checks.aiConfigured}
                  detail={
                    checks.aiConfigured
                      ? t('agents:agentSetupDialog.builtAgentCanUse', { sameAsAi })
                      : t('agents:agentSetupDialog.builtAgentNeedsModel')
                  }
                  action={
                    checks.aiConfigured ? undefined : (
                      <Button size="sm" onClick={onSetUpAi}>
                        {t('agents:agentSetupDialog.setUpAi')}
                      </Button>
                    )
                  }
                />
                <Requirement
                  label={t('agents:agentSetupDialog.builtAgentInstalled')}
                  ok={checks.runtimePresent}
                  detail={
                    checks.runtimePresent
                      ? t('agents:agentSetupDialog.comes')
                      : t('agents:agentSetupDialog.comesButMissingReinstall')
                  }
                />
              </ul>
            )}
            {failing > 0 && (
              <p className="ostler-agent-setup__hint">
                {t('agents:agentSetupDialog.canTurnAgentsNow', { count: failing })}
              </p>
            )}
            <div>
              <Button size="sm" variant="ghost" loading={checking} onClick={() => void check()}>
                {t('agents:agentSetupDialog.checkAgain')}
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <RadioGroup legend={t('agents:agentSetupDialog.builtAgentUses')}>
              <Radio
                name="agent-setup-model"
                label={t('agents:agentSetupDialog.same')}
                hint={sameAsAi}
                checked={!ownModel}
                onChange={() => setOwnModel(false)}
              />
              <Radio
                name="agent-setup-model"
                label={t('agents:agentSetupDialog.anotherModel')}
                checked={ownModel}
                onChange={() => {
                  setOwnModel(true)
                  if (!model) setModel(AGENT_DEFAULT_MODELS[provider] ?? '')
                }}
              />
            </RadioGroup>
            {ownModel && (
              <div className="ostler-agent-setup__pair">
                <Select
                  label={t('agents:agentSetupDialog.provider')}
                  options={AGENT_PROVIDER_OPTIONS}
                  value={provider}
                  onChange={(event) => {
                    setProvider(event.target.value)
                    setModel(AGENT_DEFAULT_MODELS[event.target.value] ?? '')
                  }}
                />
                <TextField
                  label={t('agents:agentSetupDialog.model')}
                  value={model}
                  placeholder={t('agents:agentSetupDialog.exampleGptO')}
                  onChange={(event) => setModel(event.target.value)}
                />
              </div>
            )}
            <p className="ostler-agent-setup__hint">
              {t('agents:agentSetupDialog.agentsNeedModelGood')}
            </p>
          </>
        )}

        {step === 4 && (
          <>
            <NumberField
              label={t('agents:agentSetupDialog.agentsOnce')}
              min={1}
              max={4}
              value={concurrency}
              onChange={setConcurrency}
              hint={t('agents:agentSetupDialog.eachProjectUp4')}
            />
            <Switch
              label={t('agents:agentSetupDialog.runQueuedTasksAutomatically')}
              hint={t('agents:agentSetupDialog.offAgentStartsOnly')}
              checked={autoRun}
              onChange={(event) => setAutoRun(event.target.checked)}
            />
          </>
        )}
      </div>
    </Dialog>
  )
}

function Requirement({
  label,
  ok,
  detail,
  action
}: {
  label: string
  ok: boolean
  detail: string
  action?: React.ReactNode
}) {
  return (
    <li className="ostler-agent-setup__check">
      <div className="ostler-agent-setup__check-head">
        <strong>{label}</strong>
        <Badge tone={ok ? 'success' : 'warning'}>
          {ok ? t('agents:agentSetupDialog.ready') : t('agents:agentSetupDialog.needsAttention')}
        </Badge>
      </div>
      <p className="ostler-agent-setup__hint">{detail}</p>
      {action}
    </li>
  )
}
