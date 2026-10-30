import type { SyncPlaceView } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'
import { PlaceChooser } from './PlaceChooser'

/**
 * Turning on the personal space on the first PC: where it is kept. `onCreate` gets a place's
 * folder, `DRIVE_PLACE_CHOICE` for Google Drive, or undefined for the picker.
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
  return (
    <PlaceChooser
      places={places}
      busy={busy}
      startLabel={t('settings:devicesSection.keepButton')}
      legend={t('settings:devicesSection.whereToKeep', { brand: BRAND.name })}
      anotherLabel={t('settings:devicesSection.anotherFolder')}
      anotherHint={t('settings:devicesSection.anotherFolderHint')}
      driveHint={driveReady ? t('settings:devicesSection.driveHint') : undefined}
      confirmLabel={t('settings:devicesSection.keepHere')}
      cancelLabel={t('settings:devicesSection.cancel')}
      onChoose={onCreate}
    />
  )
}
