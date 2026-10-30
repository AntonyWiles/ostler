import { useState } from 'react'
import type {
  PairingRequestView,
  PersonalDeviceView,
  PersonalSpaceState,
  Result
} from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'
import { Badge, Button, InlineAlert, Skeleton, useConfirm } from '../../../ui'
import { SettingsGroup } from '../settings-form'
import { JoinFromOtherDevice } from '../../../devices/JoinFromOtherDevice'
import { KeepInStep } from '../../../devices/KeepInStep'
import { usePersonalSpace } from '../../../devices/usePersonalSpace'
import { placeOf } from '../../../devices/place'

/** How often the open section reads the personal space again (there is no change event for it). */
const REFRESH_MS = 5000

/**
 * Settings › Devices (people and devices, D13, D16, D20): this person's PCs in one personal space.
 * Off, it offers to make the space or join one from another PC. On, it lists the devices, the
 * requests to join (checked by code before Allow), and removes a device after a confirmation.
 */
export function DevicesSection() {
  const { state, setState, error, setError } = usePersonalSpace({
    enabled: true,
    intervalMs: REFRESH_MS
  })
  const [busy, setBusy] = useState<string | null>(null)
  // Requests the person chose "Not now" for: they stay pending in the space, and are hidden here.
  const [notNow, setNotNow] = useState<string[]>([])
  const confirm = useConfirm()

  /** Runs one action at a time; a null value means the person cancelled (a folder picker). */
  const run = async (
    name: string,
    action: () => Promise<Result<PersonalSpaceState | null>>
  ): Promise<void> => {
    setBusy(name)
    setError(null)
    const result = await action()
    setBusy(null)
    if (!result.ok) setError(result.error)
    else if (result.value) setState(result.value)
  }

  if (!state) {
    return (
      <SettingsGroup id="your-pcs">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : <Skeleton lines={2} />}
      </SettingsGroup>
    )
  }

  const alert = error && (
    <InlineAlert tone="danger" onDismiss={() => setError(null)}>
      {error}
    </InlineAlert>
  )

  if (!state.on) {
    return (
      <>
        {alert}
        <SettingsGroup id="your-pcs" description={t('settings:devicesSection.keepInStep')}>
          {state.folder === null && (
            <KeepInStep
              places={state.places}
              driveReady={state.driveReady}
              busy={busy !== null}
              onCreate={(place) =>
                void run('create', () => window.ostlerAPI.createPersonalSpace(undefined, place))
              }
            />
          )}
          <JoinFromOtherDevice state={state} onState={setState} />
        </SettingsGroup>
      </>
    )
  }

  const requests = state.requests.filter((request) => !notNow.includes(request.deviceId))

  const removeDevice = async (device: PersonalDeviceView) => {
    const ok = await confirm({
      title: t('settings:devicesSection.removeTitle', { name: device.name }),
      body: t('settings:devicesSection.removeBody', { name: device.name }),
      confirmLabel: t('settings:devicesSection.removeConfirm'),
      tone: 'danger'
    })
    if (!ok) return
    await run(`remove-${device.deviceId}`, () => window.ostlerAPI.removeDevice(device.deviceId))
  }

  return (
    <>
      {alert}
      <SettingsGroup
        id="your-pcs"
        description={t('settings:devicesSection.addAnother', { brand: BRAND.name })}
      >
        {state.folder && (
          <p className="ostler-settings-hint">
            {t('settings:devicesSection.where', { place: placeOf(state.folder) })}
          </p>
        )}
        <ul className="ostler-settings-list">
          {state.devices.map((device) => (
            <DeviceRow
              key={device.deviceId}
              device={device}
              busy={busy !== null}
              removing={busy === `remove-${device.deviceId}`}
              onRemove={() => void removeDevice(device)}
            />
          ))}
        </ul>
        {requests.map((request) => (
          <RequestRow
            key={request.deviceId}
            request={request}
            busy={busy !== null}
            allowing={busy === `allow-${request.deviceId}`}
            onAllow={() =>
              void run(`allow-${request.deviceId}`, () =>
                window.ostlerAPI.allowDevice(request.deviceId)
              )
            }
            onNotNow={() => setNotNow((current) => [...current, request.deviceId])}
          />
        ))}
      </SettingsGroup>
    </>
  )
}

function DeviceRow({
  device,
  busy,
  removing,
  onRemove
}: {
  device: PersonalDeviceView
  busy: boolean
  removing: boolean
  onRemove: () => void
}) {
  return (
    <li className="ostler-settings-list-row">
      <span className="ostler-settings-list-name">{device.name}</span>
      {device.isThisDevice && <Badge tone="info">{t('settings:devicesSection.thisPc')}</Badge>}
      {device.revoked && <Badge tone="neutral">{t('settings:devicesSection.removed')}</Badge>}
      {!device.isThisDevice && !device.revoked && (
        <Button variant="ghost" loading={removing} disabled={busy} onClick={onRemove}>
          {t('settings:devicesSection.remove')}
        </Button>
      )}
    </li>
  )
}

function RequestRow({
  request,
  busy,
  allowing,
  onAllow,
  onNotNow
}: {
  request: PairingRequestView
  busy: boolean
  allowing: boolean
  onAllow: () => void
  onNotNow: () => void
}) {
  return (
    <div className="ostler-settings-inline-actions">
      <p>
        {t('settings:devicesSection.wantsToJoin', {
          name: request.deviceName,
          code: request.code
        })}
      </p>
      <Button variant="primary" loading={allowing} disabled={busy} onClick={onAllow}>
        {t('settings:devicesSection.allow')}
      </Button>
      <Button variant="ghost" disabled={busy} onClick={onNotNow}>
        {t('settings:devicesSection.notNow')}
      </Button>
    </div>
  )
}
