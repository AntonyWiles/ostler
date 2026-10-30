import { useState } from 'react'
import { isoWeekday } from '@shared/dates'
import type { RecurrenceRule, RecurrenceUnit } from '@shared/recurrence'
import { Checkbox, NumberField, Select } from '../../ui'
import { t } from '@shared/i18n'
import './WorkItemDrawer.css'

/**
 * The repeat rule picker (P5.6): how often, on which days, every how many.
 * A task's Repeat and a milestone's Repeat this round (N5.7a) both use it,
 * so a rule reads and is chosen the same way everywhere.
 */

export type RulePreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom'

const PRESETS: { value: RulePreset; label: string }[] = [
  {
    value: 'none',
    get label() {
      return t('tasks:taskRepeatSection.doesNotRepeat2')
    }
  },
  {
    value: 'daily',
    get label() {
      return t('tasks:taskRepeatSection.daily')
    }
  },
  {
    value: 'weekdays',
    get label() {
      return t('tasks:taskRepeatSection.everyWeekdayMondayFriday')
    }
  },
  {
    value: 'weekly',
    get label() {
      return t('tasks:taskRepeatSection.weeklyChosenDays')
    }
  },
  {
    value: 'monthly',
    get label() {
      return t('tasks:taskRepeatSection.monthlyDayMonth')
    }
  },
  {
    value: 'yearly',
    get label() {
      return t('tasks:taskRepeatSection.yearly')
    }
  },
  {
    value: 'custom',
    get label() {
      return t('tasks:taskRepeatSection.every2')
    }
  }
]

const UNITS: { value: RecurrenceUnit; label: string }[] = [
  { value: 'day', label: 'days' },
  { value: 'week', label: 'weeks' },
  { value: 'month', label: 'months' },
  { value: 'year', label: 'years' }
]

/** Monday first: how the week reads in most of the world. */
const WEEK = [1, 2, 3, 4, 5, 6, 0]

function weekdayName(day: number): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(2026, 9, 4 + day))
}

function presetOf(rule: RecurrenceRule | undefined, fallback: RulePreset): RulePreset {
  if (!rule) return fallback
  if (rule.interval !== 1) return 'custom'
  if (rule.every === 'day') return 'daily'
  if (rule.every === 'week') return rule.weekdays?.join(',') === '1,2,3,4,5' ? 'weekdays' : 'weekly'
  if (rule.every === 'month') return 'monthly'
  return 'yearly'
}

export interface RuleDraft {
  preset: RulePreset
  setPreset: (preset: RulePreset) => void
  weekdays: number[]
  setWeekdays: (update: (list: number[]) => number[]) => void
  monthDay: number | null
  setMonthDay: (day: number | null) => void
  interval: number | null
  setEvery: (interval: number | null) => void
  unit: RecurrenceUnit
  setUnit: (unit: RecurrenceUnit) => void
  /** The rule as it stands, or null for "Does not repeat". */
  rule: () => RecurrenceRule | null
  /** Every setting, for a "something changed" key. */
  parts: unknown[]
}

/**
 * The picker's settings, opened on `current` (or on `fallback` without one),
 * with the anchor's weekday and day of the month as defaults.
 */
export function useRuleDraft(
  current: RecurrenceRule | undefined,
  anchor: string,
  fallback: RulePreset = 'none'
): RuleDraft {
  const anchorDay = Number(anchor.slice(8, 10))
  const [preset, setPreset] = useState<RulePreset>(presetOf(current, fallback))
  const [weekdays, setWeekdayList] = useState<number[]>(current?.weekdays ?? [isoWeekday(anchor)])
  const [monthDay, setMonthDay] = useState<number | null>(current?.monthDay ?? anchorDay)
  const [interval, setEvery] = useState<number | null>(current?.interval ?? 2)
  const [unit, setUnit] = useState<RecurrenceUnit>(current?.every ?? 'week')

  const rule = (): RecurrenceRule | null => {
    switch (preset) {
      case 'none':
        return null
      case 'daily':
        return { every: 'day', interval: 1 }
      case 'weekdays':
        return { every: 'week', interval: 1, weekdays: [1, 2, 3, 4, 5] }
      case 'weekly':
        return { every: 'week', interval: 1, weekdays }
      case 'monthly':
        return { every: 'month', interval: 1, monthDay: monthDay ?? anchorDay }
      case 'yearly':
        return { every: 'year', interval: 1, monthDay: anchorDay }
      case 'custom':
        return {
          every: unit,
          interval: interval ?? 1,
          ...(unit === 'week' ? { weekdays } : {}),
          ...(unit === 'month' ? { monthDay: monthDay ?? anchorDay } : {})
        }
    }
  }

  return {
    preset,
    setPreset,
    weekdays,
    setWeekdays: (update) => setWeekdayList(update),
    monthDay,
    setMonthDay,
    interval,
    setEvery,
    unit,
    setUnit,
    rule,
    parts: [preset, weekdays, monthDay, interval, unit]
  }
}

/** The picker's fields; `allowNone` offers "Does not repeat" first. */
export function RecurrenceRuleFields({
  draft,
  label,
  allowNone = true
}: {
  draft: RuleDraft
  label: string
  allowNone?: boolean
}) {
  const { preset, unit } = draft
  const showWeekdays = preset === 'weekly' || (preset === 'custom' && unit === 'week')
  const showMonthDay = preset === 'monthly' || (preset === 'custom' && unit === 'month')
  return (
    <>
      <Select
        label={label}
        value={preset}
        onChange={(event) => draft.setPreset(event.target.value as RulePreset)}
        options={allowNone ? PRESETS : PRESETS.filter((option) => option.value !== 'none')}
      />
      {preset === 'custom' && (
        <div className="task-repeat__every">
          <NumberField
            label={t('tasks:taskRepeatSection.every')}
            min={1}
            max={99}
            step={1}
            value={draft.interval}
            onChange={draft.setEvery}
          />
          <Select
            label={t('tasks:taskRepeatSection.unit')}
            value={unit}
            onChange={(event) => draft.setUnit(event.target.value as RecurrenceUnit)}
            options={UNITS}
          />
        </div>
      )}
      {showWeekdays && (
        <fieldset className="task-repeat__days">
          <legend>{t('tasks:taskRepeatSection.on')}</legend>
          {WEEK.map((day) => (
            <Checkbox
              key={day}
              label={weekdayName(day)}
              checked={draft.weekdays.includes(day)}
              onChange={(event) =>
                draft.setWeekdays((list) =>
                  event.target.checked ? [...list, day] : list.filter((entry) => entry !== day)
                )
              }
            />
          ))}
        </fieldset>
      )}
      {showMonthDay && (
        <NumberField
          label={t('tasks:taskRepeatSection.day')}
          hint={t('tasks:taskRepeatSection.shorterMonthLastDay')}
          min={1}
          max={31}
          step={1}
          value={draft.monthDay}
          onChange={draft.setMonthDay}
        />
      )}
    </>
  )
}
