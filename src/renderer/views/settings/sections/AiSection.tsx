import { useRef, useState, type RefObject } from 'react'
import { usePolicy } from '../../../hooks/usePolicy'
import type { RendererConfig } from '@shared/ostler-api'
import { DEFAULT_OSTLER_AI_SYSTEM_PROMPT } from '@shared/ostler-api'
import { presetForSettings } from '@shared/ai-presets'
import { useFeatures } from '../../../navigation/features'
import { Button, InlineAlert, Select, Switch, TextArea } from '../../../ui'
import { Sparkles } from '../../../ui/icons'
import { AiSetupDialog } from '../AiSetupDialog'
import { EffortField } from '../EffortField'
import { CommittedNumberField, SettingsGroup, useSettings } from '../settings-form'
import { t } from '@shared/i18n'

/** Settings › AI: the provider status first, then the options. */
export function AiSection() {
  const { config, saveConfig, setConfig } = useSettings()
  const features = useFeatures()
  const [settingUp, setSettingUp] = useState(false)
  // Once set up, "Set up AI" gives way to "Change", where focus goes back to.
  const changeRef = useRef<HTMLButtonElement>(null)
  const policy = usePolicy()

  const dialog = settingUp && (
    <AiSetupDialog
      config={config}
      onClose={() => setSettingUp(false)}
      returnFocusTo={() => changeRef.current}
      saveConfig={saveConfig}
      onKeyCleared={setConfig}
    />
  )

  if (policy?.disableAi) {
    return (
      <SettingsGroup id="ai-not-set-up">
        <p className="ostler-settings-text">{t('settings:policy.aiOff')}</p>
      </SettingsGroup>
    )
  }

  if (!features.ai) {
    return (
      <>
        <SettingsGroup id="ai-not-set-up">
          <p className="ostler-settings-text">{t('ai:aiSection.canSuggestTasksBreak')}</p>
          <div>
            <Button variant="primary" icon={Sparkles} onClick={() => setSettingUp(true)}>
              {t('ai:aiSection.setUpAi')}
            </Button>
          </div>
        </SettingsGroup>
        {dialog}
      </>
    )
  }

  return (
    <>
      <ConnectionGroup config={config} changeRef={changeRef} onChange={() => setSettingUp(true)} />
      <OptionsGroup config={config} />
      {dialog}
    </>
  )
}

/** The current provider, model and key, with "Change…" and a test. */
function ConnectionGroup({
  config,
  changeRef,
  onChange
}: {
  config: RendererConfig
  changeRef: RefObject<HTMLButtonElement | null>
  onChange: () => void
}) {
  const { setConfig, setError } = useSettings()
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const preset = presetForSettings(config.ai)
  const address = config.ai.baseUrl || preset.defaultBaseUrl

  const testConnection = async () => {
    setTesting(true)
    setTest(null)
    const result = await window.ostlerAPI.testAIConnection()
    setTesting(false)
    setTest(
      result.ok
        ? {
            ok: true,
            text: t('ai:aiSection.connectedAnsweredMs', {
              model: result.value.model,
              responseMs: result.value.responseMs
            })
          }
        : { ok: false, text: result.error }
    )
  }

  const removeKey = async () => {
    setError(null)
    const result = await window.ostlerAPI.clearAiApiKey()
    if (result.ok) setConfig(result.value)
    else setError(result.error)
  }

  return (
    <SettingsGroup
      id="ai-set-up"
      actions={
        <Button ref={changeRef} size="sm" onClick={onChange}>
          {t('ai:aiSection.change')}
        </Button>
      }
    >
      <dl className="ostler-settings-facts">
        <div>
          <dt>{t('ai:aiSection.provider')}</dt>
          <dd>
            {preset.label}
            {preset.kind === 'local' ? t('ai:aiSection.pc') : ''}
          </dd>
        </div>
        <div>
          <dt>{t('ai:aiSection.model')}</dt>
          <dd>{config.ai.model}</dd>
        </div>
        <div>
          <dt>{t('ai:aiSection.address')}</dt>
          <dd>
            <code>{address}</code>
          </dd>
        </div>
        <div>
          <dt>{t('ai:aiSection.key')}</dt>
          <dd>
            {config.ai.hasApiKey
              ? t('ai:aiSection.savedEnding', { hint: config.ai.apiKeyHint || '••••' })
              : t('ai:aiSection.noneNeeded')}
          </dd>
        </div>
      </dl>
      <div className="ostler-settings-inline-actions">
        <Button loading={testing} onClick={() => void testConnection()}>
          {t('ai:aiSection.testConnection')}
        </Button>
        {config.ai.hasApiKey && (
          <Button variant="ghost" onClick={() => void removeKey()}>
            {t('ai:aiSection.removeKey')}
          </Button>
        )}
      </div>
      {test && (
        <InlineAlert tone={test.ok ? 'success' : 'danger'} onDismiss={() => setTest(null)}>
          {test.text}
        </InlineAlert>
      )}
    </SettingsGroup>
  )
}

function OptionsGroup({ config }: { config: RendererConfig }) {
  const { saveConfig } = useSettings()
  const ai = config.ai
  return (
    <>
      <SettingsGroup id="ai-chat">
        <Select
          label={t('ai:aiSection.sendMessage')}
          value={config.ui.sendMessageOn}
          options={[
            { value: 'enter', label: t('ai:aiSection.enterShiftEnterNew') },
            { value: 'ctrlEnter', label: t('ai:aiSection.ctrlEnter') }
          ]}
          hint={t('ai:aiSection.appliesChatProjectNotes')}
          onChange={(event) =>
            void saveConfig({
              ui: { sendMessageOn: event.target.value as RendererConfig['ui']['sendMessageOn'] }
            })
          }
        />
        <TextArea
          label={t('ai:aiSection.instructions')}
          value={ai.systemPrompt}
          rows={4}
          placeholder={DEFAULT_OSTLER_AI_SYSTEM_PROMPT}
          hint={t('ai:aiSection.whatToldBeforeEvery')}
          onChange={(event) => void saveConfig({ ai: { systemPrompt: event.target.value } })}
        />
      </SettingsGroup>

      <SettingsGroup id="ai-privacy">
        <Select
          label={t('ai:aiSection.modelCanReadImages')}
          value={ai.vision}
          options={[
            { value: 'auto', label: t('ai:aiSection.automaticSendImagesFall') },
            { value: 'on', label: t('ai:aiSection.yes') },
            { value: 'off', label: t('ai:aiSection.no') }
          ]}
          hint={t('ai:aiSection.libraryImagesGoAi')}
          onChange={(event) =>
            void saveConfig({
              ai: { vision: event.target.value as RendererConfig['ai']['vision'] }
            })
          }
        />
        <Switch
          label={t('ai:aiSection.scheduledImprovementReviews')}
          hint={t('ai:aiSection.whenSendsEachProjects')}
          checked={ai.improvementReviewEnabled}
          onChange={(event) =>
            void saveConfig({ ai: { improvementReviewEnabled: event.target.checked } })
          }
        />
        {ai.improvementReviewEnabled && (
          <CommittedNumberField
            label={t('ai:aiSection.reviewEvery')}
            unit={t('common:unit.minutes')}
            min={15}
            max={24 * 60}
            value={Math.round(ai.improvementReviewIntervalMs / 60000)}
            onCommit={(minutes) =>
              void saveConfig({ ai: { improvementReviewIntervalMs: minutes * 60000 } })
            }
          />
        )}
      </SettingsGroup>

      <SettingsGroup id="ai-response">
        <EffortField
          model={ai.model}
          cacheKey={`${ai.provider} ${ai.baseUrl}`}
          effort={ai.effort}
          onChange={(effort) => void saveConfig({ ai: { effort } })}
        />
        <CommittedNumberField
          label={t('ai:aiSection.creativityTemperature')}
          min={0}
          max={2}
          step={0.1}
          value={ai.temperature}
          hint={t('ai:aiSection.lowerGivesSteadierAnswers')}
          onCommit={(temperature) => void saveConfig({ ai: { temperature } })}
        />
        <CommittedNumberField
          label={t('ai:aiSection.longestAnswer')}
          unit={t('common:unit.tokens')}
          min={256}
          max={200000}
          step={256}
          value={ai.maxTokens}
          onCommit={(maxTokens) => void saveConfig({ ai: { maxTokens: Math.floor(maxTokens) } })}
        />
      </SettingsGroup>
    </>
  )
}
