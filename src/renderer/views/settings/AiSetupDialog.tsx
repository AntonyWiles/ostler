import { useEffect, useMemo, useState } from 'react'
import type {
  AIConnectionDraft,
  AIModelInfo,
  LocalAiDetection,
  RendererConfig,
  RendererConfigUpdate
} from '@shared/ostler-api'
import { AI_PRESETS, aiPreset, presetForSettings, type AiPreset } from '@shared/ai-presets'
import {
  Button,
  Combobox,
  Dialog,
  InlineAlert,
  Radio,
  RadioGroup,
  Spinner,
  TextField
} from '../../ui'
import { getModelOptions } from '@shared/model-options'
import './AiSetupDialog.css'
import { t } from '@shared/i18n'
import { Trans } from '../../i18n/Trans'

type Step = 1 | 2 | 3 | 4

const STEP_TITLES: Record<Step, string> = {
  get 1() {
    return t('ai:aiSetupDialog.chooseProvider')
  },
  get 2() {
    return t('ai:aiSetupDialog.stepConnect')
  },
  get 3() {
    return t('ai:aiSetupDialog.chooseModel')
  },
  get 4() {
    return t('ai:aiSetupDialog.stepTest')
  }
}

const KIND_LEGENDS = {
  get local() {
    return t('ai:aiSetupDialog.pcFreeNothingLeaves')
  },
  get cloud() {
    return t('ai:aiSetupDialog.cloud')
  },
  get other() {
    return t('ai:aiSetupDialog.somethingElse')
  }
} as const

interface AiSetupDialogProps {
  config: RendererConfig
  onClose: () => void
  /** Saves the finished setup. The key, when one was typed, goes to main only. */
  saveConfig: (updates: RendererConfigUpdate) => Promise<void>
  /** Called after the saved key is removed, with the config main returns. */
  onKeyCleared: (config: RendererConfig) => void
  /** Where focus goes on close when the opener has gone ("Set up AI" becomes "Change"). */
  returnFocusTo?: () => HTMLElement | null
}

/**
 * "Set up AI" (P7.1): a provider, a connection, a model and a test, in four
 * steps. Nothing is saved until Done. A local provider is looked for only
 * when "Find it" is pressed; a key is write-only and never shown again.
 */
export function AiSetupDialog({
  config,
  onClose,
  saveConfig,
  onKeyCleared,
  returnFocusTo
}: AiSetupDialogProps) {
  const saved = presetForSettings(config.ai)
  const [step, setStep] = useState<Step>(1)
  const [presetId, setPresetId] = useState(saved.id)
  const preset = aiPreset(presetId)!
  const [baseUrl, setBaseUrl] = useState(config.ai.baseUrl || saved.defaultBaseUrl)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState<string | null>(config.ai.model || null)
  const [models, setModels] = useState<AIModelInfo[] | null>(null)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [detection, setDetection] = useState<LocalAiDetection | null>(null)
  const [finding, setFinding] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [testRun, setTestRun] = useState(0)
  const [saving, setSaving] = useState(false)

  const address = preset.kind === 'other' ? baseUrl.trim() : preset.defaultBaseUrl
  // The saved key may be kept only for the provider and address it was saved for.
  const canKeepKey =
    config.ai.hasApiKey &&
    preset.provider === config.ai.provider &&
    trimSlash(address) === trimSlash(config.ai.baseUrl || saved.defaultBaseUrl)
  const keyReady = !preset.needsKey || apiKey.trim() !== '' || canKeepKey

  const draft = (withModel?: string | null): AIConnectionDraft => ({
    presetId: preset.id,
    provider: preset.provider,
    baseUrl: address,
    ...(withModel ? { model: withModel } : {}),
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
  })

  const choosePreset = (next: AiPreset) => {
    setPresetId(next.id)
    setBaseUrl(
      next.id === saved.id ? config.ai.baseUrl || next.defaultBaseUrl : next.defaultBaseUrl
    )
    setApiKey('')
    setDetection(null)
    setModels(null)
    setModelsError(null)
    setModel(next.id === saved.id ? config.ai.model || null : null)
    setTest(null)
  }

  const findIt = async () => {
    setFinding(true)
    setDetection(null)
    const result = await window.ostlerAPI.findLocalAI(preset.id)
    setFinding(false)
    if (!result.ok) {
      setDetection({
        status: 'wrong-service',
        baseUrl: preset.defaultBaseUrl,
        message: result.error
      })
      return
    }
    setDetection(result.value)
    if (result.value.status === 'found') {
      setModels(result.value.models)
      setModel(pickModel(result.value.models, preset, model))
    }
  }

  // Step 3 asks the provider for its models, once per connection.
  useEffect(() => {
    if (step !== 3 || models !== null) return
    let cancelled = false
    setLoadingModels(true)
    setModelsError(null)
    void window.ostlerAPI.listAIModels(draft()).then((result) => {
      if (cancelled) return
      setLoadingModels(false)
      if (result.ok) {
        setModels(result.value)
        setModel(pickModel(result.value, preset, model))
      } else {
        setModels([])
        setModelsError(result.error)
        setModel((current) => current ?? (preset.recommendedModel || null))
      }
    })
    return () => {
      cancelled = true
    }
  }, [step])

  // Step 4 tests at once, with the chosen model.
  useEffect(() => {
    if (step !== 4 || !model) return
    let cancelled = false
    setTesting(true)
    setTest(null)
    void window.ostlerAPI.testAIConnection(draft(model)).then((result) => {
      if (cancelled) return
      setTesting(false)
      setTest(
        result.ok
          ? {
              ok: true,
              text: t('ai:aiSetupDialog.answeredMs', {
                model: result.value.model,
                responseMs: result.value.responseMs
              })
            }
          : { ok: false, text: result.error }
      )
    })
    return () => {
      cancelled = true
    }
  }, [step, testRun])

  const modelOptions = useMemo(() => {
    const listed = models && models.length > 0 ? models : null
    const options = listed
      ? listed.map((entry) => ({ value: entry.id, label: entry.label }))
      : preset.kind === 'cloud'
        ? getModelOptions(preset.provider, address)
        : []
    const withRecommended = options.map((option) =>
      option.value === preset.recommendedModel
        ? { ...option, description: t('ai:aiSetupDialog.recommended') }
        : option
    )
    if (model && !withRecommended.some((option) => option.value === model)) {
      withRecommended.unshift({ value: model, label: model })
    }
    return withRecommended
  }, [models, preset, address, model])

  const finish = async () => {
    if (!model) return
    setSaving(true)
    // A key typed here replaces the saved one. A saved key that belongs to a
    // different provider or address is removed, so it is never sent elsewhere.
    if (!apiKey.trim() && config.ai.hasApiKey && !canKeepKey) {
      const cleared = await window.ostlerAPI.clearAiApiKey()
      if (cleared.ok) onKeyCleared(cleared.value)
    }
    await saveConfig({
      ai: {
        provider: preset.provider,
        baseUrl: address,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
      }
    })
    setSaving(false)
    onClose()
  }

  const canGoOn =
    step === 1
      ? true
      : step === 2
        ? keyReady &&
          (preset.kind === 'other'
            ? /^https?:\/\/\S+$/i.test(address)
            : preset.kind !== 'local' || detection?.status === 'found')
        : step === 3
          ? Boolean(model?.trim())
          : test?.ok === true

  return (
    <Dialog
      open
      size="md"
      title={t('ai:aiSetupDialog.setUp')}
      description={t('ai:aiSetupDialog.step4', { step, STEP_TITLES: STEP_TITLES[step] })}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      canDismiss={!saving}
      closeOnBackdrop={false}
      footer={
        <>
          {step > 1 && (
            <Button onClick={() => setStep((step - 1) as Step)} disabled={saving}>
              {t('ai:aiSetupDialog.back')}
            </Button>
          )}
          {step < 4 ? (
            <Button
              variant="primary"
              disabled={!canGoOn}
              onClick={() => {
                if (step === 2) {
                  // A new connection lists its own models.
                  if (preset.kind !== 'local') setModels(null)
                }
                setStep((step + 1) as Step)
              }}
            >
              {t('ai:aiSetupDialog.next')}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!canGoOn}
              loading={saving}
              onClick={() => void finish()}
            >
              {t('ai:aiSetupDialog.done')}
            </Button>
          )}
        </>
      }
    >
      <div className="ostler-ai-setup">
        {step === 1 && (
          <>
            <p className="ostler-ai-setup__text">{t('ai:aiSetupDialog.noModelIncluded')}</p>
            {(['local', 'cloud', 'other'] as const).map((kind) => (
              <RadioGroup key={kind} legend={KIND_LEGENDS[kind]}>
                {AI_PRESETS.filter((entry) => entry.kind === kind).map((entry) => (
                  <Radio
                    key={entry.id}
                    name="ai-setup-provider"
                    label={entry.label}
                    hint={entry.description}
                    checked={presetId === entry.id}
                    onChange={() => choosePreset(entry)}
                  />
                ))}
              </RadioGroup>
            ))}
          </>
        )}

        {step === 2 && preset.kind === 'local' && (
          <>
            <p className="ostler-ai-setup__text">
              <Trans
                i18nKey="ai:aiSetupDialog.looksForAt"
                values={{ provider: preset.label, url: preset.defaultBaseUrl }}
                components={{ code: <code /> }}
              />
            </p>
            <div>
              <Button variant="primary" loading={finding} onClick={() => void findIt()}>
                {t('ai:aiSetupDialog.find')}
              </Button>
            </div>
            {detection?.status === 'found' && (
              <InlineAlert
                tone="success"
                title={t('ai:aiSetupDialog.found', { presetLabel: preset.label })}
              >
                {detection.models.length === 0
                  ? t('ai:aiSetupDialog.hasNoModelsYet', { presetLabel: preset.label })
                  : t('ai:aiSetupDialog.hasModels', { count: detection.models.length })}
              </InlineAlert>
            )}
            {detection && detection.status !== 'found' && (
              <InlineAlert
                tone="warning"
                title={
                  detection.status === 'not-found'
                    ? t('ai:aiSetupDialog.isntAnswering', { presetLabel: preset.label })
                    : t('ai:aiSetupDialog.isnt', { presetLabel: preset.label })
                }
                action={
                  detection.status === 'not-found'
                    ? {
                        label: t('ai:aiSetupDialog.download', { presetLabel: preset.label }),
                        onClick: () => void window.ostlerAPI.openAIProviderPage(preset.id)
                      }
                    : undefined
                }
              >
                {detection.message}
              </InlineAlert>
            )}
          </>
        )}

        {step === 2 && preset.kind !== 'local' && (
          <>
            {preset.kind === 'other' && (
              <TextField
                label={t('ai:aiSetupDialog.address')}
                value={baseUrl}
                placeholder={t('ai:aiSetupDialog.exampleHttpLocalhost8080')}
                hint={t('ai:aiSetupDialog.openaiCompatibleAddressServer')}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            )}
            <TextField
              label={
                preset.needsKey
                  ? t('ai:aiSetupDialog.apiKey')
                  : t('ai:aiSetupDialog.apiKeyIfServer')
              }
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={
                canKeepKey
                  ? t('ai:aiSetupDialog.keepSavedKey', { apiKeyHint: config.ai.apiKeyHint })
                  : t('ai:aiSetupDialog.pasteKey')
              }
              hint={t('ai:aiSetupDialog.storedEncryptedWindowsUser')}
              onChange={(event) => setApiKey(event.target.value)}
            />
            {preset.docsUrl && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void window.ostlerAPI.openAIProviderPage(preset.id)}
                >
                  {t('ai:aiSetupDialog.getKey', { presetLabel: preset.label })}
                </Button>
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            {loadingModels ? (
              <Spinner label={t('ai:aiSetupDialog.askingModels')} />
            ) : (
              <Combobox
                label={t('ai:aiSetupDialog.model')}
                options={modelOptions}
                value={model}
                onChange={setModel}
                onCreate={(text) => setModel(text.trim())}
                createLabel={(text) => t('ai:aiSetupDialog.use', { text })}
                placeholder={t('ai:aiSetupDialog.searchModels')}
                hint={
                  preset.recommendedModel
                    ? t('ai:aiSetupDialog.goodPlaceStart', {
                        recommendedModel: preset.recommendedModel
                      })
                    : t('ai:aiSetupDialog.typeSearchEnterModel')
                }
              />
            )}
            {modelsError && (
              <InlineAlert tone="warning" title={t('ai:aiSetupDialog.couldntListModels')}>
                {modelsError}
              </InlineAlert>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <p className="ostler-ai-setup__text">
              {preset.label}, {model}
              {preset.kind === 'local' ? t('ai:aiSetupDialog.everythingStaysPc') : '.'}
            </p>
            {testing && <Spinner label={t('ai:aiSetupDialog.testingConnection')} />}
            {test && (
              <InlineAlert
                tone={test.ok ? 'success' : 'danger'}
                title={test.ok ? t('ai:aiSetupDialog.works') : t('ai:aiSetupDialog.didntWork')}
                action={
                  test.ok
                    ? undefined
                    : {
                        label: t('ai:aiSetupDialog.tryAgain'),
                        onClick: () => setTestRun((run) => run + 1)
                      }
                }
              >
                {test.text}
              </InlineAlert>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

function trimSlash(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase()
}

/** The recommended model when it is offered, else the current one, else the first. */
function pickModel(models: AIModelInfo[], preset: AiPreset, current: string | null): string | null {
  if (models.some((entry) => entry.id === preset.recommendedModel)) return preset.recommendedModel
  if (current && models.some((entry) => entry.id === current)) return current
  return models[0]?.id ?? current
}
