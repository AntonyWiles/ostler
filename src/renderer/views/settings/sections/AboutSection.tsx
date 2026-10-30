import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/ostler-api'
import { CopyDiagnosticsButton } from '../../../components/CopyDiagnosticsButton'
import { useUpdateState } from '../../../hooks/useUpdateState'
import { Button, Dialog, ErrorText, ProgressBar, Switch, useConfirm } from '../../../ui'
import { absoluteTimeText } from '../../../ui/date-text'
import { SettingsGroup, useSettings } from '../settings-form'
import { t } from '@shared/i18n'

/** One plain sentence for where updating stands. */
export function updateStatusText(state: UpdateState | null): string {
  if (!state) return t('settings:aboutSection.looking')
  switch (state.status) {
    case 'off':
      return state.reason === 'portable'
        ? t('settings:aboutSection.portableWhichDoesNot')
        : t('settings:aboutSection.updatesOffDevelopmentBuilds')
    case 'idle':
      return t('settings:aboutSection.notCheckedYet')
    case 'checking':
      return t('settings:aboutSection.checkingUpdates')
    case 'up-to-date':
      return t('settings:aboutSection.upDateChecked', {
        absoluteTimeText: absoluteTimeText(state.checkedAt)
      })
    case 'available':
      return t('settings:aboutSection.versionAvailable', { version: state.version })
    case 'downloading':
      return t('settings:aboutSection.downloadingVersion', { version: state.version })
    case 'ready':
      if (state.restartWhenAgentsFinish) {
        return t('settings:aboutSection.versionInstallsWhenAgents', {
          count: state.agentsRunning,
          version: state.version
        })
      }
      return state.agentsRunning > 0
        ? t('settings:aboutSection.versionReadyAgentsWorking', {
            count: state.agentsRunning,
            version: state.version
          })
        : t('settings:aboutSection.versionReadyRestartUpdate', { version: state.version })
    case 'error':
      return state.message
  }
}

/** Settings › About › Updates (P10.1). */
function UpdatesGroup() {
  const { config, saveConfig } = useSettings()
  const { state, error, run } = useUpdateState()
  const confirm = useConfirm()
  const updates = config.updates
  const off = state?.status === 'off'

  const restartNow = async () => {
    if (state?.status === 'ready' && state.agentsRunning > 0) {
      const ok = await confirm({
        title: t('settings:aboutSection.restartNow2'),
        body: t('settings:aboutSection.agentsWorkingWillStop', { count: state.agentsRunning }),
        confirmLabel: t('settings:aboutSection.restartNow'),
        tone: 'danger'
      })
      if (!ok) return
    }
    await run(window.ostlerAPI.restartToUpdate('now'))
  }

  return (
    <SettingsGroup id="updates">
      <p className="ostler-settings-text" role="status">
        {updateStatusText(state)}
      </p>
      {state?.status === 'downloading' && (
        <ProgressBar label={t('settings:aboutSection.download')} value={state.percent} showLabel />
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {!off && (
        <div className="ostler-settings-inline-actions">
          {state?.status === 'ready' ? (
            <>
              {state.agentsRunning > 0 && !state.restartWhenAgentsFinish && (
                <Button
                  onClick={() => void run(window.ostlerAPI.restartToUpdate('when-agents-finish'))}
                >
                  {t('settings:aboutSection.restartWhenAgentsFinish')}
                </Button>
              )}
              <Button
                variant={state.agentsRunning > 0 ? 'secondary' : 'primary'}
                onClick={() => void restartNow()}
              >
                {t('settings:aboutSection.restartNow')}
              </Button>
            </>
          ) : state?.status === 'available' ? (
            <Button onClick={() => void run(window.ostlerAPI.downloadUpdate())}>
              {t('settings:aboutSection.downloadVersion', { version: state.version })}
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={state?.status === 'checking' || state?.status === 'downloading'}
              onClick={() => void run(window.ostlerAPI.checkForUpdates())}
            >
              {t('settings:aboutSection.checkUpdates')}
            </Button>
          )}
        </div>
      )}
      {state && 'notes' in state && state.notes && (
        <details className="ostler-settings-details">
          <summary>{t('settings:aboutSection.whatsNew', { version: state.version })}</summary>
          <p className="ostler-settings-text ostler-settings-notes">{state.notes}</p>
        </details>
      )}
      {!off && (
        <>
          <Switch
            label={t('settings:aboutSection.checkUpdatesAutomatically')}
            hint={t('settings:aboutSection.looksNewVersionEach')}
            checked={updates.checkAutomatically}
            onChange={(event) =>
              void saveConfig({ updates: { checkAutomatically: event.target.checked } })
            }
          />
          <Switch
            label={t('settings:aboutSection.downloadUpdatesAutomatically')}
            hint={t('settings:aboutSection.newVersionDownloadsBackground')}
            checked={updates.downloadAutomatically}
            onChange={(event) =>
              void saveConfig({ updates: { downloadAutomatically: event.target.checked } })
            }
          />
          <Switch
            label={t('settings:aboutSection.receiveBetaUpdates')}
            hint={t('settings:aboutSection.tryNewVersionsBefore')}
            checked={updates.receiveBeta}
            onChange={(event) =>
              void saveConfig({ updates: { receiveBeta: event.target.checked } })
            }
          />
        </>
      )}
    </SettingsGroup>
  )
}

/** Settings › About › Open source licences (P10.2): the notices the installer ships. */
function LicencesGroup() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const show = async () => {
    setOpen(true)
    if (text !== null) return
    const result = await window.ostlerAPI.getThirdPartyNotices()
    if (result.ok) {
      setText(result.value)
      setError(null)
    } else setError(t('settings:aboutSection.licencesCouldNotRead', { error: result.error }))
  }

  return (
    <SettingsGroup id="licences" description={t('settings:aboutSection.builtOpenSourcePackages')}>
      <div>
        <Button variant="secondary" onClick={() => void show()}>
          {t('settings:aboutSection.openSourceLicences')}
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('settings:aboutSection.openSourceLicences')}
        size="lg"
      >
        {error ? (
          <ErrorText>{error}</ErrorText>
        ) : (
          <pre
            className="ostler-settings-licences"
            tabIndex={0}
            aria-label={t('settings:aboutSection.licenceTexts')}
          >
            {text ?? t('settings:aboutSection.loading')}
          </pre>
        )}
      </Dialog>
    </SettingsGroup>
  )
}

/** Settings › About: version, updates (P10.1), what the app promises, and Copy diagnostics (P1.2). */
export function AboutSection() {
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.ostlerAPI.getAppVersion().then((result) => {
      if (result.ok) setVersion(result.value)
    })
  }, [])

  return (
    <>
      <SettingsGroup id="about-ostler">
        <dl className="ostler-settings-stats">
          <div className="ostler-settings-stat">
            <dt>{t('settings:aboutSection.version')}</dt>
            <dd className="tabular-nums">{version || '…'}</dd>
          </div>
        </dl>
        <p className="ostler-settings-text">{t('settings:aboutSection.projectManagerKeepsData')}</p>
      </SettingsGroup>

      <UpdatesGroup />

      <LicencesGroup />

      <SettingsGroup
        id="diagnostics"
        description={t('settings:aboutSection.copiesVersionsCountsEnd')}
      >
        <div>
          <CopyDiagnosticsButton />
        </div>
      </SettingsGroup>
    </>
  )
}
