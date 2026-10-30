import { useEffect, useState } from 'react'
import type { InboxSnooze, PlanningReminder, PlanningWorkItem } from '@shared/ostler-api'
import { formatTime } from '@shared/format'
import { t } from '@shared/i18n'
import { Button, InlineAlert, Menu, useToast } from '../../ui'
import { BellOff, Check, Clock } from '../../ui/icons'

/** A reminder that keeps reminding and has not stopped (N1.7). */
export function isNudging(reminder: PlanningReminder): boolean {
  return reminder.keepReminding && reminder.deliveredAt !== null && reminder.stoppedAt === null
}

/**
 * The drawer's bar while a task has a reminder that keeps reminding (N1.7):
 * "Reminder: 10:00, keeps reminding" with Snooze, Done and Stop reminding.
 * Windows notifications carry no buttons, so clicking one opens the task
 * here. Snoozing goes through the Inbox's snooze, the one place it is done.
 */
export function ReminderNudgeBar({
  item,
  onDone
}: {
  item: PlanningWorkItem
  /** Marks the task done, as the drawer's status does. */
  onDone: () => void
}) {
  const { toast } = useToast()
  const [nudging, setNudging] = useState<PlanningReminder | null>(null)

  const load = async () => {
    const result = await window.ostlerAPI.getPlanningReminders(item.id)
    setNudging(result.ok ? (result.value.find(isNudging) ?? null) : null)
  }

  useEffect(() => {
    void load()
  }, [item.id, item.updatedAt, item.status])

  if (!nudging || item.status === 'done') return null
  const time = formatTime(nudging.remindAt)

  const snooze = async (until: InboxSnooze) => {
    const result = await window.ostlerAPI.snoozeInboxReminder(`reminder:${nudging.id}`, until)
    if (!result.ok) {
      toast({ title: t('tasks:keepReminding.couldntSnooze'), body: result.error, tone: 'danger' })
      return
    }
    toast({
      title:
        until === 'hour'
          ? t('tasks:keepReminding.snoozedHour')
          : t('tasks:keepReminding.snoozedTomorrow', { time }),
      tone: 'success'
    })
    void load()
  }

  const stop = async () => {
    const result = await window.ostlerAPI.stopPlanningReminder(item.id, nudging.id)
    if (!result.ok) {
      toast({ title: t('tasks:keepReminding.couldntStop'), body: result.error, tone: 'danger' })
      return
    }
    toast({ title: t('tasks:keepReminding.stopped'), tone: 'success' })
    void load()
  }

  return (
    <InlineAlert tone="info" title={t('tasks:keepReminding.bar', { time })}>
      <span className="task-drawer__nudge-actions">
        <Menu
          label={t('tasks:keepReminding.snooze')}
          renderTrigger={(trigger) => (
            <Button {...trigger} size="sm" variant="secondary" icon={Clock}>
              {t('tasks:keepReminding.snooze')}
            </Button>
          )}
          items={[
            { label: t('tasks:keepReminding.forAnHour'), onSelect: () => void snooze('hour') },
            {
              label: t('tasks:keepReminding.tomorrowAt', { time }),
              onSelect: () => void snooze('tomorrow')
            }
          ]}
        />
        <Button size="sm" variant="secondary" icon={Check} onClick={onDone}>
          {t('tasks:keepReminding.done')}
        </Button>
        <Button size="sm" variant="secondary" icon={BellOff} onClick={() => void stop()}>
          {t('tasks:keepReminding.stop')}
        </Button>
      </span>
    </InlineAlert>
  )
}
