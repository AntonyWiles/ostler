import { useConfig } from '../../hooks/useConfig'
import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_CONFIG,
  type PlanningRecurrence,
  type PlanningReminder,
  type PlanningWorkItem
} from '@shared/ostler-api'
import { isIsoDate, todayIsoDate } from '@shared/dates'
import { describeRecurrence } from '@shared/recurrence'
import { isClockTime, KEEP_REMINDING_MINUTES, localInstant } from '@shared/reminder-settings'
import {
  Button,
  DateField,
  Dialog,
  IconButton,
  InlineAlert,
  NumberField,
  Radio,
  RadioGroup,
  Select,
  Switch,
  TextField,
  useToast
} from '../../ui'
import { Bell, Icon, Plus, Repeat, X } from '../../ui/icons'
import { TaskDrawerSection } from './TaskDrawerSection'
import { TakeTurnsEditor, takeTurnsSummary } from './TakeTurnsEditor'
import { RecurrenceRuleFields, useRuleDraft } from './RecurrenceRuleFields'
import { usePeople } from '../../context/PeopleContext'
import { TYPING_PAUSE_MS } from '../../hooks/planning/drawer-saves'
import { t } from '@shared/i18n'
import { formatDate, formatDateTime } from '@shared/format'

/**
 * The drawer's Repeat and Reminders (P5.6). Both apply at once, like a
 * checklist tick, rather than waiting for Save: they are their own records,
 * not fields of the task. `canGoToAgents` (agents on and the project has a
 * linked folder) offers Go to agents when it comes round (N9.7).
 */
export function TaskRepeatSection({
  item,
  canGoToAgents = false
}: {
  item: PlanningWorkItem
  canGoToAgents?: boolean
}) {
  const { toast } = useToast()
  const people = usePeople()
  const [recurrence, setRecurrence] = useState<PlanningRecurrence | null>(null)
  const [reminders, setReminders] = useState<PlanningReminder[]>([])
  const [editingRepeat, setEditingRepeat] = useState(false)
  const [addingReminder, setAddingReminder] = useState(false)

  const load = async () => {
    const [repeat, pending] = await Promise.all([
      window.ostlerAPI.getPlanningRecurrence(item.id),
      window.ostlerAPI.getPlanningReminders(item.id)
    ])
    if (repeat.ok) setRecurrence(repeat.value)
    // A reminder still nudging shows in the drawer's bar, not here (N1.7).
    if (pending.ok) setReminders(pending.value.filter((reminder) => reminder.deliveredAt === null))
  }

  // Again after every save: a new due date re-plans the due reminders.
  useEffect(() => {
    void load()
  }, [item.id, item.updatedAt, item.targetDate, item.status])

  const removeReminder = async (reminder: PlanningReminder) => {
    const result = await window.ostlerAPI.deletePlanningReminder(item.id, reminder.id)
    if (!result.ok)
      toast({
        title: t('tasks:taskRepeatSection.couldntRemoveReminder'),
        body: result.error,
        tone: 'danger'
      })
    void load()
  }

  const finished = item.status === 'done' || Boolean(item.archivedAt) || Boolean(item.deletedAt)

  return (
    <>
      <TaskDrawerSection
        title={t('tasks:taskRepeatSection.repeat')}
        description={t('tasks:taskRepeatSection.whenMarkTaskDone')}
        part={{ id: 'repeat', inUse: recurrence !== null, start: () => setEditingRepeat(true) }}
        actions={
          <Button size="sm" variant="ghost" icon={Repeat} onClick={() => setEditingRepeat(true)}>
            {recurrence
              ? t('tasks:taskRepeatSection.change')
              : t('tasks:taskRepeatSection.repeat2')}
          </Button>
        }
      >
        <p className="task-drawer__muted">
          {recurrence ? repeatSummary(recurrence) : t('tasks:taskRepeatSection.doesNotRepeat')}
        </p>
        {recurrence?.rotation && (
          <p className="task-drawer__muted" data-testid="take-turns-summary">
            {takeTurnsSummary(recurrence.rotation, recurrence.nextIndex, people)}
          </p>
        )}
        {canGoToAgents && recurrence?.goToAgents && (
          <p className="task-drawer__muted" data-testid="goes-to-agents-summary">
            {t('tasks:taskRepeatSection.goesToAgents')}
          </p>
        )}
      </TaskDrawerSection>

      {/* A finished task can't be reminded of: with none left, nothing to show or add. */}
      {(!finished || reminders.length > 0) && (
        <TaskDrawerSection
          title={t('tasks:taskRepeatSection.reminders')}
          description={t('tasks:taskRepeatSection.remindersArriveWindowsNotification')}
          // The due date's own reminder comes with the due date; one the person set is theirs.
          part={{
            id: 'reminders',
            inUse: reminders.some((reminder) => reminder.kind !== 'due'),
            start: finished ? undefined : () => setAddingReminder(true)
          }}
          actions={
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              disabled={finished}
              title={finished ? t('tasks:taskRepeatSection.finishedTaskHasNo') : undefined}
              onClick={() => setAddingReminder(true)}
            >
              {t('tasks:taskRepeatSection.remindMe')}
            </Button>
          }
        >
          {reminders.length === 0 ? (
            <p className="task-drawer__muted">
              {item.targetDate && !finished
                ? t('tasks:taskRepeatSection.noRemindersComeDue')
                : t('tasks:taskRepeatSection.noReminders')}
            </p>
          ) : (
            <ul className="task-reminders">
              {reminders.map((reminder) => (
                <li key={reminder.id} className="task-reminders__row">
                  <Icon icon={Bell} />
                  <span>
                    {formatDateTime(new Date(reminder.remindAt), {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit'
                    })}
                  </span>
                  <span className="task-drawer__muted">
                    {reminder.kind === 'due'
                      ? t('tasks:taskRepeatSection.dueDateReminder')
                      : reminder.keepReminding
                        ? t('tasks:taskRepeatSection.keepsRemindingEvery', {
                            count: reminder.intervalMinutes ?? 0
                          })
                        : t('tasks:taskRepeatSection.reminder')}
                  </span>
                  {reminder.kind === 'custom' && (
                    <IconButton
                      size="sm"
                      label={t('tasks:taskRepeatSection.removeReminder')}
                      icon={X}
                      onClick={() => void removeReminder(reminder)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </TaskDrawerSection>
      )}

      {editingRepeat && (
        <RepeatDialog
          item={item}
          current={recurrence}
          canGoToAgents={canGoToAgents}
          onClose={() => setEditingRepeat(false)}
          onSaved={setRecurrence}
        />
      )}
      {addingReminder && (
        <ReminderDialog
          item={item}
          onClose={() => setAddingReminder(false)}
          onAdded={() => {
            setAddingReminder(false)
            void load()
          }}
        />
      )}
    </>
  )
}

/** "Weekly on Mon and Thu, 3 more times", "Daily, until 31 Dec". */
export function repeatSummary(
  recurrence: Pick<PlanningRecurrence, 'rule' | 'endsOn' | 'remaining'>
): string {
  const head = describeRecurrence(recurrence.rule)
  if (recurrence.endsOn) {
    const [y, m, d] = recurrence.endsOn.split('-').map(Number)
    const until = formatDate(new Date(y, m - 1, d), {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
    return t('tasks:taskRepeatSection.until', { head, until })
  }
  if (recurrence.remaining !== null)
    return recurrence.remaining === 1
      ? t('tasks:taskRepeatSection.n1MoreTime', { head })
      : t('tasks:taskRepeatSection.moreTimes2', { head, remaining: recurrence.remaining })
  return head
}

function RepeatDialog({
  item,
  current,
  canGoToAgents,
  onClose,
  onSaved
}: {
  item: PlanningWorkItem
  current: PlanningRecurrence | null
  canGoToAgents: boolean
  onClose: () => void
  onSaved: (next: PlanningRecurrence | null) => void
}) {
  const anchor = item.targetDate && isIsoDate(item.targetDate) ? item.targetDate : todayIsoDate()
  // A task that does not repeat opens on "Does not repeat"; one that does, on its own rule.
  const draft = useRuleDraft(current?.rule, anchor)
  const { preset } = draft
  const [ends, setEnds] = useState<'never' | 'on' | 'after'>(
    current?.endsOn ? 'on' : current?.remaining !== null && current ? 'after' : 'never'
  )
  const [endsOn, setEndsOn] = useState(current?.endsOn ?? '')
  const [remaining, setRemaining] = useState<number | null>(current?.remaining ?? 5)
  const [rotation, setRotation] = useState<string[] | null>(current?.rotation ?? null)
  const [goToAgents, setGoToAgents] = useState(current?.goToAgents ?? false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** The rule's settings as one value: a change to any of them is a change to save. */
  const draftKey = JSON.stringify([...draft.parts, ends, endsOn, remaining, rotation, goToAgents])
  /** The settings the record holds, as of the last save (or as the dialog opened). */
  const savedKey = useRef(draftKey)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attempts = useRef(0)

  /**
   * Saves the rule as it stands and says whether it is saved. A rule that cannot
   * be saved yet says why, and the dialog stays open until it can.
   */
  const save = async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (draftKey === savedKey.current) return true
    const next = draft.rule()
    if (next?.every === 'week' && next.weekdays?.length === 0) {
      setError(t('tasks:taskRepeatSection.chooseLeastOneDay'))
      return false
    }
    if (next && ends === 'on' && !isIsoDate(endsOn)) {
      setError(t('tasks:taskRepeatSection.chooseDayEnds'))
      return false
    }
    const attempt = ++attempts.current
    setBusy(true)
    const result = await window.ostlerAPI.setPlanningRecurrence(
      item.id,
      next
        ? {
            rule: next,
            endsOn: ends === 'on' ? endsOn : null,
            remaining: ends === 'after' ? (remaining ?? 0) : null,
            // No nextIndex: the service keeps the person who was next as next.
            rotation: rotation && rotation.length > 0 ? rotation : null,
            // Hidden without agents or a folder: left out, it stays as it was.
            ...(canGoToAgents ? { goToAgents } : {})
          }
        : null
    )
    if (attempt === attempts.current) setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    savedKey.current = draftKey
    setError(null)
    onSaved(result.value)
    return true
  }
  const latestSave = useRef(save)
  latestSave.current = save

  // Each change saves once the person pauses (D30), not on every keystroke.
  useEffect(() => {
    if (draftKey === savedKey.current) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void latestSave.current(), TYPING_PAUSE_MS)
  }, [draftKey])
  // Leaving the dialog, by any route, saves what is left.
  useEffect(() => () => void latestSave.current(), [])

  const close = async () => {
    if (await latestSave.current()) onClose()
  }

  const stopRepeating = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const previous = savedKey.current
    savedKey.current = draftKey
    setBusy(true)
    void (async () => {
      const result = await window.ostlerAPI.setPlanningRecurrence(item.id, null)
      setBusy(false)
      if (!result.ok) {
        savedKey.current = previous
        setError(result.error)
        return
      }
      onSaved(null)
      onClose()
    })()
  }

  return (
    <Dialog
      open
      onClose={() => void close()}
      title={t('tasks:taskRepeatSection.repeat')}
      description={
        item.targetDate
          ? t('tasks:taskRepeatSection.nextTaskDueFirst')
          : t('tasks:taskRepeatSection.taskHasNoDue')
      }
      footer={
        <>
          {current && (
            <Button variant="ghost" disabled={busy} onClick={stopRepeating}>
              {t('tasks:taskRepeatSection.stopRepeating')}
            </Button>
          )}
          <Button variant="primary" disabled={busy} onClick={() => void close()}>
            {t('tasks:taskRepeatSection.done')}
          </Button>
        </>
      }
    >
      <div className="task-repeat">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <RecurrenceRuleFields draft={draft} label={t('tasks:taskRepeatSection.repeats')} />
        {preset !== 'none' && (
          <RadioGroup legend={t('tasks:taskRepeatSection.ends')}>
            <Radio
              name="repeat-ends"
              label={t('tasks:taskRepeatSection.never')}
              checked={ends === 'never'}
              onChange={() => setEnds('never')}
            />
            <Radio
              name="repeat-ends"
              label={t('tasks:taskRepeatSection.date')}
              checked={ends === 'on'}
              onChange={() => setEnds('on')}
            />
            {ends === 'on' && (
              <DateField
                label={t('tasks:taskRepeatSection.lastDay')}
                value={endsOn}
                onChange={setEndsOn}
                due={false}
              />
            )}
            <Radio
              name="repeat-ends"
              label={t('tasks:taskRepeatSection.afterNumberTimes')}
              checked={ends === 'after'}
              onChange={() => setEnds('after')}
            />
            {ends === 'after' && (
              <NumberField
                label={t('tasks:taskRepeatSection.moreTimes')}
                hint={t('tasks:taskRepeatSection.howManyMoreTasks')}
                min={0}
                max={999}
                step={1}
                value={remaining}
                onChange={setRemaining}
              />
            )}
          </RadioGroup>
        )}
        {preset !== 'none' && (
          <TakeTurnsEditor projectId={item.projectId} rotation={rotation} onChange={setRotation} />
        )}
        {preset !== 'none' && canGoToAgents && (
          <Switch
            label={t('tasks:taskRepeatSection.goToAgents')}
            hint={t('tasks:taskRepeatSection.goToAgentsHint')}
            checked={goToAgents}
            onChange={(event) => setGoToAgents(event.target.checked)}
          />
        )}
      </div>
    </Dialog>
  )
}

function ReminderDialog({
  item,
  onClose,
  onAdded
}: {
  item: PlanningWorkItem
  onClose: () => void
  onAdded: () => void
}) {
  const [date, setDate] = useState(item.targetDate ?? todayIsoDate())
  const [time, setTime] = useState('09:00')
  const [keep, setKeep] = useState(false)
  // Null until the person picks one: the Settings › Notifications default.
  const [intervalMinutes, setIntervalMinutes] = useState<number | null>(null)
  const defaultInterval =
    useConfig().config?.notifications.keepRemindingMinutes ??
    DEFAULT_CONFIG.notifications.keepRemindingMinutes
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!isIsoDate(date) || !isClockTime(time)) {
      setError(t('tasks:taskRepeatSection.chooseDayTime'))
      return
    }
    setBusy(true)
    const result = await window.ostlerAPI.addPlanningReminder(
      item.id,
      localInstant(date, time),
      keep
        ? { keepReminding: true, intervalMinutes: intervalMinutes ?? defaultInterval }
        : undefined
    )
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onAdded()
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={t('tasks:taskRepeatSection.remindMe2')}
      description={t('tasks:taskRepeatSection.about', { itemTitle: item.title })}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('tasks:taskRepeatSection.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={busy} onClick={() => void add()}>
            {t('tasks:taskRepeatSection.addReminder')}
          </Button>
        </>
      }
    >
      <div className="task-repeat">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <DateField
          label={t('tasks:taskRepeatSection.day2')}
          value={date}
          onChange={setDate}
          due={false}
        />
        <TextField
          label={t('tasks:taskRepeatSection.time')}
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
        <Switch
          label={t('tasks:taskRepeatSection.keepRemindingMe')}
          hint={t('tasks:taskRepeatSection.keepRemindingHint')}
          checked={keep}
          onChange={(event) => setKeep(event.target.checked)}
        />
        {keep && (
          <Select
            label={t('tasks:taskRepeatSection.every')}
            value={String(intervalMinutes ?? defaultInterval)}
            onChange={(event) => setIntervalMinutes(Number(event.target.value))}
            options={KEEP_REMINDING_MINUTES.map((minutes) => ({
              value: String(minutes),
              label: t('tasks:taskRepeatSection.minutes', { count: minutes })
            }))}
          />
        )}
      </div>
    </Dialog>
  )
}
