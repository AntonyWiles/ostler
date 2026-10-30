import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { isoWeekday, shiftIsoDate } from '@shared/dates'
import { dateTimeFormat } from '@shared/format'
import { RADIUS, SPACE, type Theme } from '../theme'
import { Icon, type IconName } from './Icon'

interface Props {
  theme: Theme
  /** The chosen day, `YYYY-MM-DD`, or null for none. */
  value: string | null
  today: string
  onPick: (date: string) => void
}

/** The first day of the month `months` away from the month `date` is in. */
function monthStart(date: string, months = 0): string {
  const [year, month] = date.split('-').map(Number)
  const index = year * 12 + (month - 1) + months
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}-01`
}

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

/** A month of days, Monday first, to pick a due date from. */
export function DatePicker({ theme, value, today, onPick }: Props) {
  const [month, setMonth] = useState(monthStart(value ?? today))
  const title = dateTimeFormat({ month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    utc(month)
  )
  const weekdayName = dateTimeFormat({ weekday: 'narrow', timeZone: 'UTC' })
  const dayLabel = dateTimeFormat({ dateStyle: 'full', timeZone: 'UTC' })
  // The grid starts on the Monday on or before the 1st and runs whole weeks past the month's end.
  const first = shiftIsoDate(month, -((isoWeekday(month) + 6) % 7))
  const next = monthStart(month, 1)
  const days: string[] = []
  for (let day = first; day < next || days.length % 7 !== 0; day = shiftIsoDate(day, 1)) {
    days.push(day)
  }
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7))
  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Step
          icon="chevron-left"
          label={t('mobile:edit.previousMonth')}
          theme={theme}
          onPress={() => setMonth(monthStart(month, -1))}
        />
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        <Step
          icon="chevron-right"
          label={t('mobile:edit.nextMonth')}
          theme={theme}
          onPress={() => setMonth(next)}
        />
      </View>
      <View style={styles.week}>
        {weeks[0].map((day) => (
          <Text key={day} style={[styles.weekday, { color: theme.textMuted }]}>
            {weekdayName.format(utc(day))}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]} style={styles.week}>
          {week.map((day) => {
            const chosen = day === value
            const outside = day < month || day >= next
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityLabel={dayLabel.format(utc(day))}
                accessibilityState={{ selected: chosen }}
                onPress={() => onPick(day)}
                style={[
                  styles.day,
                  chosen && { backgroundColor: theme.accent },
                  !chosen && day === today && { borderColor: theme.accent, borderWidth: 1 }
                ]}
              >
                <Text
                  style={{
                    fontSize: 14,
                    color: chosen ? theme.accentContrast : outside ? theme.textMuted : theme.text
                  }}
                >
                  {Number(day.slice(8))}
                </Text>
              </Pressable>
            )
          })}
        </View>
      ))}
    </View>
  )
}

function Step({
  icon,
  label,
  theme,
  onPress
}: {
  icon: IconName
  label: string
  theme: Theme
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.step}
    >
      <Icon name={icon} color={theme.textSecondary} size={22} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  box: { gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '600' },
  step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 12, paddingVertical: SPACE.small / 2 },
  day: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS
  }
})
