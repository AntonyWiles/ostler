import { useEffect, useState } from 'react'
import type { SetR2SyncInput, SyncPlaceView } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'
import { Button, InlineAlert, TextField } from '../ui'
import { PlaceChooser } from './PlaceChooser'

/** The bucket fields this step asks for; the rest of Advanced sync keeps its saved values or defaults. */
type R2Draft = Pick<SetR2SyncInput, 'accountId' | 'accessKeyId' | 'secretAccessKey' | 'bucket'>

const EMPTY_DRAFT: R2Draft = { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '' }

/**
 * Turning on the personal space on the first PC: where it is kept. `onCreate` gets a place's
 * folder, `DRIVE_PLACE_CHOICE` for Google Drive, `R2_PLACE_CHOICE` for the person's own R2 bucket
 * (saved first, as Advanced sync's bucket), or undefined for the picker.
 */
export function KeepInStep({
  places,
  driveReady,
  busy,
  onCreate
}: {
  places: SyncPlaceView[]
  /** Google Drive sync is ready: offer Google Drive as a place. */
  driveReady: boolean
  busy: boolean
  onCreate: (place: string | undefined) => void
}) {
  const [draft, setDraft] = useState<R2Draft>(EMPTY_DRAFT)
  const [hasSecret, setHasSecret] = useState(false)
  const [r2Error, setR2Error] = useState<string | null>(null)
  const [r2Notice, setR2Notice] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  // A bucket already saved under Advanced sync (or from a setup code) fills the fields.
  useEffect(() => {
    void window.ostlerAPI.getR2Sync().then((result) => {
      if (!result.ok || !result.value.configured) return
      setDraft({
        accountId: result.value.accountId,
        accessKeyId: result.value.accessKeyId,
        secretAccessKey: '',
        bucket: result.value.bucket
      })
      setHasSecret(result.value.hasSecret)
    })
  }, [])

  const input = async (): Promise<SetR2SyncInput> => {
    const saved = await window.ostlerAPI.getR2Sync()
    const state = saved.ok && saved.value.configured ? saved.value : null
    return {
      ...draft,
      prefix: state?.prefix ?? '',
      endpoint: state?.endpoint ?? '',
      checkMinutes: state?.checkMinutes ?? 5,
      uploadSoon: state?.uploadSoon ?? true,
      // With the space itself in the bucket there is no folder to copy.
      enabled: false
    }
  }

  const test = async () => {
    setTesting(true)
    setR2Error(null)
    setR2Notice(null)
    const result = await window.ostlerAPI.testR2Sync(await input())
    setTesting(false)
    if (result.ok) setR2Notice(t('settings:advancedSync.testOk'))
    else setR2Error(result.error)
  }

  const prepare = async (): Promise<boolean> => {
    setR2Error(null)
    setR2Notice(null)
    const result = await window.ostlerAPI.setR2Sync(await input())
    if (!result.ok) setR2Error(result.error)
    return result.ok
  }

  const set = (patch: Partial<R2Draft>) => setDraft({ ...draft, ...patch })
  const form = (
    <div className="ostler-devices-r2">
      <p className="ostler-settings-hint">{t('settings:advancedSync.how')}</p>
      <TextField
        label={t('settings:advancedSync.accountId')}
        value={draft.accountId}
        onChange={(event) => set({ accountId: event.target.value })}
        spellCheck={false}
      />
      <TextField
        label={t('settings:advancedSync.accessKeyId')}
        value={draft.accessKeyId}
        onChange={(event) => set({ accessKeyId: event.target.value })}
        spellCheck={false}
        autoComplete="off"
      />
      <TextField
        label={t('settings:advancedSync.secret')}
        type="password"
        value={draft.secretAccessKey ?? ''}
        hint={hasSecret ? t('settings:advancedSync.secretSaved') : undefined}
        onChange={(event) => set({ secretAccessKey: event.target.value })}
        autoComplete="off"
      />
      <TextField
        label={t('settings:advancedSync.bucket')}
        value={draft.bucket}
        onChange={(event) => set({ bucket: event.target.value })}
        spellCheck={false}
      />
      {r2Error && (
        <InlineAlert tone="danger" onDismiss={() => setR2Error(null)}>
          {r2Error}
        </InlineAlert>
      )}
      {r2Notice && (
        <InlineAlert tone="success" onDismiss={() => setR2Notice(null)}>
          {r2Notice}
        </InlineAlert>
      )}
      <div className="ostler-settings-inline-actions">
        <Button loading={testing} disabled={testing || busy} onClick={() => void test()}>
          {t('settings:advancedSync.test')}
        </Button>
      </div>
    </div>
  )

  return (
    <PlaceChooser
      places={places}
      busy={busy}
      startLabel={t('settings:devicesSection.keepButton')}
      legend={t('settings:devicesSection.whereToKeep', { brand: BRAND.name })}
      anotherLabel={t('settings:devicesSection.anotherFolder')}
      anotherHint={t('settings:devicesSection.anotherFolderHint')}
      driveHint={driveReady ? t('settings:devicesSection.driveHint') : undefined}
      r2={{
        label: t('settings:devicesSection.r2Bucket'),
        hint: t('settings:devicesSection.r2Hint'),
        form,
        prepare
      }}
      confirmLabel={t('settings:devicesSection.keepHere')}
      cancelLabel={t('settings:devicesSection.cancel')}
      onChoose={onCreate}
    />
  )
}
