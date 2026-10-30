import { useState } from 'react'
import { DRIVE_PLACE_CHOICE, type SyncPlaceView } from '@shared/ostler-api'
import { Button, Radio, RadioGroup } from '../ui'
import { SYNC_PROVIDER_NAMES } from './place'
import './devices.css'

/** The radio value for a folder the person picks themselves. */
const ANOTHER = ''

/**
 * Where something synced is kept: one of the sync apps' folders on this PC, or a folder the
 * person picks. With no sync app found it goes straight to the folder picker; otherwise it asks
 * in place, the first sync app chosen, so nothing is picked for the person without them seeing
 * it. `onChoose` gets a place's folder, `DRIVE_PLACE_CHOICE` for Google Drive (offered only
 * when `driveHint` is given), or undefined for the picker. The personal space and
 * sharing a project both ask this way.
 */
export function PlaceChooser({
  places,
  busy,
  startLabel,
  legend,
  anotherLabel,
  anotherHint,
  driveHint,
  confirmLabel,
  cancelLabel,
  onChoose
}: {
  places: SyncPlaceView[]
  busy: boolean
  /** The button that starts it. */
  startLabel: string
  /** The question above the places. */
  legend: string
  /** The choice that opens the folder picker, and what it means here. */
  anotherLabel: string
  anotherHint: string
  /** Offers Google Drive as a place (with this hint) when given: Drive sync is ready. */
  driveHint?: string
  /** The button that goes ahead with the chosen place. */
  confirmLabel: string
  cancelLabel: string
  onChoose: (place: string | undefined) => void
}) {
  const [asking, setAsking] = useState(false)
  const drive = driveHint !== undefined
  const first = places[0]?.folder ?? (drive ? DRIVE_PLACE_CHOICE : ANOTHER)
  const [choice, setChoice] = useState<string>(first)
  // A place that went away while the question was open falls back to the first one there is.
  const chosen =
    choice === ANOTHER ||
    (drive && choice === DRIVE_PLACE_CHOICE) ||
    places.some((place) => place.folder === choice)
      ? choice
      : first

  if (!asking || (places.length === 0 && !drive)) {
    return (
      <Button
        variant="primary"
        loading={busy}
        disabled={busy}
        onClick={() => (places.length === 0 && !drive ? onChoose(undefined) : setAsking(true))}
      >
        {startLabel}
      </Button>
    )
  }

  return (
    <div className="ostler-keep-in-step">
      <RadioGroup legend={legend}>
        {places.map((place) => (
          <Radio
            key={place.folder}
            name="ostler-keep-place"
            label={SYNC_PROVIDER_NAMES[place.provider]}
            hint={place.folder}
            checked={chosen === place.folder}
            disabled={busy}
            onChange={() => setChoice(place.folder)}
          />
        ))}
        {drive && (
          <Radio
            name="ostler-keep-place"
            label={SYNC_PROVIDER_NAMES['google-drive']}
            hint={driveHint}
            checked={chosen === DRIVE_PLACE_CHOICE}
            disabled={busy}
            onChange={() => setChoice(DRIVE_PLACE_CHOICE)}
          />
        )}
        <Radio
          name="ostler-keep-place"
          label={anotherLabel}
          hint={anotherHint}
          checked={chosen === ANOTHER}
          disabled={busy}
          onChange={() => setChoice(ANOTHER)}
        />
      </RadioGroup>
      <div className="ostler-devices-actions">
        <Button
          variant="primary"
          loading={busy}
          disabled={busy}
          onClick={() => onChoose(chosen === ANOTHER ? undefined : chosen)}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  )
}
