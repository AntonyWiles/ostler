import type { UpdateReminder, UpdateReminderCadence } from '@shared/ostler-api'
import { normalizeUpdateReminder, UPDATE_REMINDER_CADENCES } from '@shared/status-updates'
import { dateTimeFormat } from '@shared/format'
import { t } from '@shared/i18n'
import { Select } from '../../ui'

/** A weekday's name in the interface language, 0 for Sunday (7 January 2024 was one). */
function weekdayLabel(day: number): string {
  return dateTimeFormat({ weekday: 'long' }).format(new Date(2024, 0, 7 + day))
}

const CADENCE_KEY: Record<UpdateReminderCadence, string> = {
  off: 'projects:statusUpdates.reminder.off',
  weekly: 'projects:statusUpdates.reminder.weekly',
  fortnightly: 'projects:statusUpdates.reminder.fortnightly'
}

/**
 * The status update reminder (N5.5) in Project settings: off, weekly or
 * fortnightly, and the weekday. It saves as it is chosen, like the stage.
 */
export function StatusUpdateReminderFields({
  value,
  onChange
}: {
  value: unknown
  /** The new setting; main works out when it starts (`since`). */
  onChange: (reminder: UpdateReminder) => void
}) {
  const reminder = normalizeUpdateReminder(value)
  return (
    <>
      <Select
        label={t('projects:statusUpdates.reminder.label')}
        hint={t('projects:statusUpdates.reminder.hint')}
        value={reminder.cadence}
        onChange={(event) =>
          onChange({ ...reminder, cadence: event.target.value as UpdateReminderCadence })
        }
        options={UPDATE_REMINDER_CADENCES.map((cadence) => ({
          value: cadence,
          label: t(CADENCE_KEY[cadence])
        }))}
      />
      {reminder.cadence !== 'off' && (
        <Select
          label={t('projects:statusUpdates.reminder.weekday')}
          value={String(reminder.weekday)}
          onChange={(event) => onChange({ ...reminder, weekday: Number(event.target.value) })}
          options={[1, 2, 3, 4, 5, 6, 0].map((day) => ({
            value: String(day),
            label: weekdayLabel(day)
          }))}
        />
      )}
    </>
  )
}
