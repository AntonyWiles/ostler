import type { DueReminderMode, FocusSettings, InAppNotificationDuration } from '@shared/ostler-api'
import {
  DEFAULT_FOCUS_SETTINGS,
  IN_APP_NOTIFICATION_DURATIONS,
  FOCUS_BREAK_MAX_MINUTES,
  FOCUS_BREAK_MIN_MINUTES,
  FOCUS_MAX_MINUTES,
  FOCUS_MIN_MINUTES
} from '@shared/ostler-api'
import { normalizeFocusSettings } from '@shared/focus'
import { isClockTime, KEEP_REMINDING_MINUTES } from '@shared/reminder-settings'
import { formatIsoDate, shiftIsoDate } from '@shared/dates'
import { Select, Switch, TextField } from '../../../ui'
import { useFeatures } from '../../../navigation/features'
import { CommittedNumberField, SettingsGroup, useSettings } from '../settings-form'
import { t } from '@shared/i18n'

const DUE_REMINDER_OPTIONS: { value: DueReminderMode; label: string }[] = [
  {
    value: 'off',
    get label() {
      return t('settings:notificationsSection.off')
    }
  },
  {
    value: 'dueDate',
    get label() {
      return t('settings:notificationsSection.dueDate')
    }
  },
  {
    value: 'dayBefore',
    get label() {
      return t('settings:notificationsSection.dayBefore')
    }
  },
  {
    value: 'both',
    get label() {
      return t('settings:notificationsSection.dayBeforeDueDate')
    }
  }
]

const IN_APP_DURATION_LABEL_KEYS: Record<InAppNotificationDuration, string> = {
  short: 'settings:notificationsSection.inAppShort',
  normal: 'settings:notificationsSection.inAppNormal',
  long: 'settings:notificationsSection.inAppLong',
  untilClosed: 'settings:notificationsSection.inAppUntilClosed'
}

/** A Sunday, so day `n` after it is weekday `n` (0 Sunday to 6 Saturday). */
const A_SUNDAY = '2026-10-18'

/** Off, then Monday to Sunday in the interface language (N1.5). */
function weeklyReviewDayOptions(): { value: string; label: string }[] {
  const days = [1, 2, 3, 4, 5, 6, 0].map((day) => ({
    value: String(day),
    label: formatIsoDate(shiftIsoDate(A_SUNDAY, day), { weekday: 'long' })
  }))
  return [{ value: 'off', label: t('settings:notificationsSection.off') }, ...days]
}

/** A time field that saves a whole `HH:MM` once it is one. */
function TimeField({
  label,
  hint,
  value,
  disabled,
  onCommit
}: {
  label: string
  hint?: string
  value: string
  disabled?: boolean
  onCommit: (value: string) => void
}) {
  return (
    <TextField
      label={label}
      hint={hint}
      type="time"
      className="settings-time-field"
      value={value}
      disabled={disabled}
      onChange={(event) => {
        if (isClockTime(event.target.value) && event.target.value !== value)
          onCommit(event.target.value)
      }}
    />
  )
}

/**
 * Settings › Notifications: in-app notifications (the toasts inside the
 * window), reminders, quiet hours and which Windows notifications to show.
 */
export function NotificationsSection() {
  return (
    <>
      <InAppGroup />
      <RemindersGroup />
      <DesktopGroup />
      <FocusGroup />
    </>
  )
}

/** In-app notifications: the toasts in the window's corner, and how long they stay. */
function InAppGroup() {
  const { config, saveConfig } = useSettings()
  const value = config.notifications.inAppDuration
  return (
    <SettingsGroup
      id="in-app-notifications"
      description={t('settings:notificationsSection.inAppDescription')}
    >
      <Select
        label={t('settings:notificationsSection.inAppDuration')}
        hint={t('settings:notificationsSection.inAppDurationHint')}
        value={IN_APP_NOTIFICATION_DURATIONS.includes(value) ? value : 'normal'}
        onChange={(event) =>
          void saveConfig({
            notifications: { inAppDuration: event.target.value as InAppNotificationDuration }
          })
        }
        options={IN_APP_NOTIFICATION_DURATIONS.map((duration) => ({
          value: duration,
          label: t(IN_APP_DURATION_LABEL_KEYS[duration])
        }))}
      />
      <Switch
        label={t('settings:notificationsSection.inAppUndo')}
        hint={t('settings:notificationsSection.inAppUndoHint')}
        checked={config.notifications.inAppUndo !== false}
        onChange={(event) =>
          void saveConfig({ notifications: { inAppUndo: event.target.checked } })
        }
      />
    </SettingsGroup>
  )
}

/** Focus (N3.5): the two lengths offered, the break and the chime. */
function FocusGroup() {
  const { config, saveConfig } = useSettings()
  const focus = normalizeFocusSettings(config.notifications.focus)
  const save = (changes: Partial<FocusSettings>) =>
    void saveConfig({ notifications: { focus: { ...focus, ...changes } } })
  const setLength = (index: number, minutes: number) => {
    const lengths = [...focus.lengths]
    lengths[index] = minutes
    save({ lengths })
  }
  return (
    <SettingsGroup
      id="focus-notifications"
      description={t('settings:notificationsSection.focusDescription')}
    >
      {[0, 1].map((index) => (
        <CommittedNumberField
          key={index}
          label={t(
            index === 0
              ? 'settings:notificationsSection.focusFirstLength'
              : 'settings:notificationsSection.focusSecondLength'
          )}
          hint={t('settings:notificationsSection.focusLengthHint')}
          unit={t('settings:notificationsSection.minutesUnit')}
          min={FOCUS_MIN_MINUTES}
          max={FOCUS_MAX_MINUTES}
          step={5}
          value={focus.lengths[index] ?? DEFAULT_FOCUS_SETTINGS.lengths[index]}
          onCommit={(minutes) => setLength(index, minutes)}
        />
      ))}
      <CommittedNumberField
        label={t('settings:notificationsSection.focusBreak')}
        unit={t('settings:notificationsSection.minutesUnit')}
        min={FOCUS_BREAK_MIN_MINUTES}
        max={FOCUS_BREAK_MAX_MINUTES}
        value={focus.breakMinutes}
        onCommit={(breakMinutes) => save({ breakMinutes })}
      />
      <Switch
        label={t('settings:notificationsSection.focusChime')}
        hint={t('settings:notificationsSection.focusChimeHint')}
        checked={focus.chime}
        onChange={(event) => save({ chime: event.target.checked })}
      />
    </SettingsGroup>
  )
}

/** Reminders (P5.6). */
function RemindersGroup() {
  const { config, saveConfig } = useSettings()
  const notifications = config.notifications
  return (
    <SettingsGroup
      id="reminders"
      description={t('settings:notificationsSection.remindersArriveWindowsNotification')}
    >
      <Select
        label={t('settings:notificationsSection.remindMeAboutDue')}
        value={notifications.dueReminders}
        onChange={(event) =>
          void saveConfig({
            notifications: { dueReminders: event.target.value as DueReminderMode }
          })
        }
        options={DUE_REMINDER_OPTIONS}
      />
      <TimeField
        label={t('settings:notificationsSection.at')}
        hint={t('settings:notificationsSection.localTime')}
        value={notifications.reminderTime}
        disabled={notifications.dueReminders === 'off'}
        onCommit={(reminderTime) => void saveConfig({ notifications: { reminderTime } })}
      />
      <Select
        label={t('settings:notificationsSection.weeklyReviewReminder')}
        hint={t('settings:notificationsSection.weeklyReviewHint')}
        value={
          notifications.weeklyReviewDay === null ? 'off' : String(notifications.weeklyReviewDay)
        }
        onChange={(event) =>
          void saveConfig({
            notifications: {
              weeklyReviewDay: event.target.value === 'off' ? null : Number(event.target.value)
            }
          })
        }
        options={weeklyReviewDayOptions()}
      />
      <TimeField
        label={t('settings:notificationsSection.weeklyReviewAt')}
        hint={t('settings:notificationsSection.localTime')}
        value={notifications.weeklyReviewTime}
        disabled={notifications.weeklyReviewDay === null}
        onCommit={(weeklyReviewTime) => void saveConfig({ notifications: { weeklyReviewTime } })}
      />
      <Select
        label={t('settings:notificationsSection.keepRemindingEvery')}
        hint={t('settings:notificationsSection.keepRemindingHint')}
        value={String(notifications.keepRemindingMinutes)}
        onChange={(event) =>
          void saveConfig({
            notifications: { keepRemindingMinutes: Number(event.target.value) }
          })
        }
        options={KEEP_REMINDING_MINUTES.map((minutes) => ({
          value: String(minutes),
          label: t('settings:notificationsSection.minutes', { count: minutes })
        }))}
      />
      <Switch
        label={t('settings:notificationsSection.quietHours')}
        hint={t('settings:notificationsSection.noWindowsNotificationsBetween')}
        checked={notifications.quietHoursEnabled}
        onChange={(event) =>
          void saveConfig({ notifications: { quietHoursEnabled: event.target.checked } })
        }
      />
      <TimeField
        label={t('settings:notificationsSection.quiet')}
        value={notifications.quietHoursStart}
        disabled={!notifications.quietHoursEnabled}
        onCommit={(quietHoursStart) => void saveConfig({ notifications: { quietHoursStart } })}
      />
      <TimeField
        label={t('settings:notificationsSection.until')}
        value={notifications.quietHoursEnd}
        disabled={!notifications.quietHoursEnabled}
        onCommit={(quietHoursEnd) => void saveConfig({ notifications: { quietHoursEnd } })}
      />
    </SettingsGroup>
  )
}

function DesktopGroup() {
  const { config, saveConfig } = useSettings()
  const features = useFeatures()
  const notifications = config.notifications
  const off = !notifications.enabled

  return (
    <SettingsGroup
      id="desktop-notifications"
      description={t('settings:notificationsSection.notificationsAppearCornerScreen')}
    >
      <Switch
        label={t('settings:notificationsSection.showNotifications')}
        checked={notifications.enabled}
        onChange={(event) => void saveConfig({ notifications: { enabled: event.target.checked } })}
      />
      <Switch
        label={t('settings:notificationsSection.whenBuildFails')}
        hint={t('settings:notificationsSection.projectsLinkedFolder')}
        checked={notifications.onBuildFailure}
        disabled={off}
        onChange={(event) =>
          void saveConfig({ notifications: { onBuildFailure: event.target.checked } })
        }
      />
      <Switch
        label={t('settings:notificationsSection.whenManyFilesChange')}
        hint={t('settings:notificationsSection.projectsLinkedFolder')}
        checked={notifications.onLargeChangeset}
        disabled={off}
        onChange={(event) =>
          void saveConfig({ notifications: { onLargeChangeset: event.target.checked } })
        }
      />
      <CommittedNumberField
        label={t('settings:notificationsSection.manyFilesMeansLeast')}
        unit={t('common:unit.files')}
        min={5}
        max={100}
        step={5}
        value={notifications.largeChangesetThreshold}
        disabled={off || !notifications.onLargeChangeset}
        onCommit={(largeChangesetThreshold) =>
          void saveConfig({ notifications: { largeChangesetThreshold } })
        }
      />
      <Switch
        label={t('settings:notificationsSection.whenReminderFires')}
        checked={notifications.onReminder}
        disabled={off}
        onChange={(event) =>
          void saveConfig({ notifications: { onReminder: event.target.checked } })
        }
      />
      <Switch
        label={t('settings:notificationsSection.whenBlockerReported')}
        checked={notifications.onBlocker}
        disabled={off}
        onChange={(event) =>
          void saveConfig({ notifications: { onBlocker: event.target.checked } })
        }
      />
      <Switch
        label={t('settings:notificationsSection.whenMentioned')}
        checked={notifications.onMentioned}
        disabled={off}
        onChange={(event) =>
          void saveConfig({ notifications: { onMentioned: event.target.checked } })
        }
      />
      <Switch
        label={t('settings:notificationsSection.whenSignOff')}
        checked={notifications.onSignOff}
        disabled={off}
        onChange={(event) =>
          void saveConfig({ notifications: { onSignOff: event.target.checked } })
        }
      />
      <Switch
        label={t('settings:notificationsSection.whenFollowedTaskChanged')}
        checked={notifications.onFollowedTaskChanged}
        disabled={off}
        onChange={(event) =>
          void saveConfig({ notifications: { onFollowedTaskChanged: event.target.checked } })
        }
      />
      {features.agents && (
        <Switch
          label={t('settings:notificationsSection.whenAgentStartsFinishes')}
          checked={notifications.onAgentSessionChange}
          disabled={off}
          onChange={(event) =>
            void saveConfig({ notifications: { onAgentSessionChange: event.target.checked } })
          }
        />
      )}
      {features.agents && (
        <Switch
          label={t('settings:notificationsSection.whenAgentAsksQuestion')}
          checked={notifications.onAgentQuestion}
          disabled={off}
          onChange={(event) =>
            void saveConfig({ notifications: { onAgentQuestion: event.target.checked } })
          }
        />
      )}
      {features.agents && (
        <Switch
          label={t('settings:notificationsSection.whenAgentsWorkWaiting')}
          checked={notifications.onReviewWaiting}
          disabled={off}
          onChange={(event) =>
            void saveConfig({ notifications: { onReviewWaiting: event.target.checked } })
          }
        />
      )}
    </SettingsGroup>
  )
}
