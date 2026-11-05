import { useState, type ReactNode } from 'react'
import { DRIVE_PLACE_CHOICE, R2_PLACE_CHOICE, type SyncPlaceView } from '@shared/ostler-api'
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
 * when `driveHint` is given), `R2_PLACE_CHOICE` for an R2 bucket (offered only when `r2` is
 * given, after its `prepare` succeeds), or undefined for the picker. The personal space and
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
  r2,
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
  /**
   * Offers the person's own R2 bucket as a place when given: `form` shows while it is chosen, and
   * `prepare` saves it before `onChoose` (false stops there; the form says why).
   */
  r2?: { label: string; hint: string; form: ReactNode; prepare: () => Promise<boolean> }
  /** The button that goes ahead with the chosen place. */
  confirmLabel: string
  cancelLabel: string
  onChoose: (place: string | undefined) => void
}) {
  const [asking, setAsking] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const drive = driveHint !== undefined
  const first = places[0]?.folder ?? (drive ? DRIVE_PLACE_CHOICE : ANOTHER)
  const [choice, setChoice] = useState<string>(first)
  // A place that went away while the question was open falls back to the first one there is.
  const chosen =
    choice === ANOTHER ||
    (drive && choice === DRIVE_PLACE_CHOICE) ||
    (r2 !== undefined && choice === R2_PLACE_CHOICE) ||
    places.some((place) => place.folder === choice)
      ? choice
      : first

  const onlyPicker = places.length === 0 && !drive && !r2
  const waiting = busy || preparing

  const confirm = async () => {
    if (chosen === R2_PLACE_CHOICE && r2) {
      setPreparing(true)
      const ready = await r2.prepare()
      setPreparing(false)
      if (!ready) return
    }
    onChoose(chosen === ANOTHER ? undefined : chosen)
  }

  if (!asking || onlyPicker) {
    return (
      <Button
        variant="primary"
        loading={busy}
        disabled={busy}
        onClick={() => (onlyPicker ? onChoose(undefined) : setAsking(true))}
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
        {r2 && (
          <Radio
            name="ostler-keep-place"
            label={r2.label}
            hint={r2.hint}
            checked={chosen === R2_PLACE_CHOICE}
            disabled={waiting}
            onChange={() => setChoice(R2_PLACE_CHOICE)}
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
      {r2 && chosen === R2_PLACE_CHOICE && r2.form}
      <div className="ostler-devices-actions">
        <Button
          variant="primary"
          loading={waiting}
          disabled={waiting}
          onClick={() => void confirm()}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" disabled={waiting} onClick={() => setAsking(false)}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  )
}
