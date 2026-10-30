import { useState } from 'react'
import type { PersonalSpaceState, Result } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'
import { Button, InlineAlert, Spinner } from '../ui'
import { placeOf } from './place'
import './devices.css'

/**
 * Joining the personal space from this PC (people and devices, D16): ask, show the code the other
 * PC shows, wait for it to allow this PC, then wait for the first pull. Settings › Devices and the
 * welcome both show it; the caller decides what happens once `state.pulled` is true. The space is
 * looked for in OneDrive, Google Drive and Dropbox; the person can always choose its folder instead.
 */
export function JoinFromOtherDevice({
  state,
  onState
}: {
  state: PersonalSpaceState
  onState: (next: PersonalSpaceState) => void
}) {
  const [busy, setBusy] = useState<'join' | 'choose' | 'cancel' | 'startNew' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The way out when no device can let this one in, shown only when asked for.
  const [stuckOpen, setStuckOpen] = useState(false)

  const run = async (
    which: 'join' | 'cancel' | 'startNew',
    call: () => Promise<Result<PersonalSpaceState>>
  ) => {
    setBusy(which)
    setError(null)
    const result = await call()
    setBusy(null)
    if (result.ok) {
      setStuckOpen(false)
      onState(result.value)
    } else setError(result.error)
  }
  const join = () => run('join', () => window.ostlerAPI.requestPairing())

  // A null value means the person cancelled the picker.
  const choose = async () => {
    setBusy('choose')
    setError(null)
    const result = await window.ostlerAPI.choosePersonalSpace()
    setBusy(null)
    if (!result.ok) setError(result.error)
    else if (result.value) onState(result.value)
  }

  if (state.on) {
    if (state.pulled) return null
    return <Spinner label={t('settings:devicesSection.gettingProjects')} />
  }

  const errorAlert = error && (
    <InlineAlert tone="danger" onDismiss={() => setError(null)}>
      {error}
    </InlineAlert>
  )

  // The space's devices may all be gone (a PC reset, or one used once): nobody could ever allow
  // this one. Starting a new space moves the old one aside in the same place; nothing is deleted.
  const stuck = state.folder && (
    <div className="ostler-join-stuck">
      {stuckOpen ? (
        <>
          <p>{t('settings:devicesSection.startNewExplain', { place: placeOf(state.folder) })}</p>
          <div className="ostler-devices-actions">
            <Button
              variant="danger"
              loading={busy === 'startNew'}
              disabled={busy !== null}
              onClick={() => void run('startNew', () => window.ostlerAPI.startNewPersonalSpace())}
            >
              {t('settings:devicesSection.startNew')}
            </Button>
            <Button variant="ghost" disabled={busy !== null} onClick={() => setStuckOpen(false)}>
              {t('settings:devicesSection.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <Button variant="ghost" disabled={busy !== null} onClick={() => setStuckOpen(true)}>
          {t('settings:devicesSection.noDeviceCanAllow')}
        </Button>
      )}
    </div>
  )

  if (state.waitingForApproval) {
    return (
      <div className="ostler-join-waiting">
        {errorAlert}
        <p>
          {t('settings:devicesSection.waitingApproval', {
            name: state.thisDeviceName,
            code: state.joinCode ?? ''
          })}
        </p>
        <Spinner label={t('settings:devicesSection.waitingForOther')} />
        <div className="ostler-devices-actions">
          <Button
            variant="ghost"
            loading={busy === 'cancel'}
            disabled={busy !== null}
            onClick={() => void run('cancel', () => window.ostlerAPI.cancelPairing())}
          >
            {t('settings:devicesSection.stopWaiting')}
          </Button>
        </div>
        {stuck}
      </div>
    )
  }

  const chooseButton = (
    <Button
      variant={state.folder ? 'ghost' : 'secondary'}
      loading={busy === 'choose'}
      disabled={busy !== null}
      onClick={() => void choose()}
    >
      {state.folder
        ? t('settings:devicesSection.chooseOtherSpaceFolder')
        : t('settings:devicesSection.chooseSpaceFolder')}
    </Button>
  )

  return (
    <div className="ostler-join-start">
      {errorAlert}
      {state.folder ? (
        <>
          <p>{t('settings:devicesSection.foundIn', { place: placeOf(state.folder) })}</p>
          <div className="ostler-devices-actions">
            <Button loading={busy === 'join'} disabled={busy !== null} onClick={() => void join()}>
              {t('settings:devicesSection.setUpFromOther')}
            </Button>
            {chooseButton}
          </div>
          {stuck}
        </>
      ) : (
        <>
          <p>{t('settings:devicesSection.notFoundYet', { brand: BRAND.name })}</p>
          {chooseButton}
        </>
      )}
    </div>
  )
}
