import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDate, formatIsoDateShort, shiftIsoDate } from '@shared/dates'
import type { EditDb } from '../data/edits'
import { projectColor, projectName } from '../data/project-display'
import { today, type QueryDb } from '../data/queries'
import { hoursAndMinutes, stopTimer, timesheet, weekStartOf } from '../data/time'
import { RADIUS, SPACE, useTheme } from '../theme'
import { Chip, editErrorText } from './EditBits'
import { elapsedText, useTick } from './TaskTime'
import { TopBar } from './TopBar'

interface Props {
  db: EditDb & QueryDb
  version: number
  onBack: () => void
  onOpenTask: (taskId: string) => void
  onEdited: () => void
}

/**
 * Your time, a week at a time (the PC's Timesheet): the week's total and each project's share, then
 * each day with its entries. A running timer counts up to now and can be stopped here.
 */
export function Timesheet({ db, version, onBack, onOpenTask, onEdited }: Props) {
  const theme = useTheme()
  const [week, setWeek] = useState(weekStartOf(today()))
  const [error, setError] = useState<string | null>(null)
  const sheet = useMemo(() => (version >= 0 ? timesheet(db, week) : null), [db, week, version])
  const running = sheet?.days.flatMap((day) => day.entries).find((e) => e.durationSeconds === null)
  const now = useTick(running !== undefined)
  if (sheet === null) return null
  const thisWeek = weekStartOf(today())
  const secondsOf = (seconds: number | null, startedAt: number) =>
    seconds ?? Math.max(0, (now - startedAt) / 1000)

  return (
    <View style={styles.page}>
      <TopBar theme={theme} title={t('mobile:time.timesheet')} onBack={onBack} />
      <View style={[styles.weekBar, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <Chip label="‹" theme={theme} onPress={() => setWeek(shiftIsoDate(week, -7))} />
        <Pressable
          accessibilityRole="button"
          onPress={() => setWeek(thisWeek)}
          style={styles.weekTitle}
        >
          <Text style={[styles.weekText, { color: theme.text }]}>
            {week === thisWeek
              ? t('mobile:time.thisWeek')
              : t('mobile:time.weekOf', { date: formatIsoDateShort(week) })}
          </Text>
          <Text style={[styles.weekTotal, { color: theme.accent }]}>
            {hoursAndMinutes(sheet.seconds)}
          </Text>
        </Pressable>
        <Chip
          label="›"
          theme={theme}
          onPress={() => week < thisWeek && setWeek(shiftIsoDate(week, 7))}
        />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {error !== null && (
          <Text
            style={[styles.error, { color: theme.danger, backgroundColor: theme.dangerSubtle }]}
          >
            {error}
          </Text>
        )}
        {running && (
          <View
            style={[
              styles.running,
              { borderColor: theme.accent, backgroundColor: theme.accentSubtle }
            ]}
          >
            <View style={styles.grow}>
              <Text style={[styles.meta, { color: theme.accent }]}>{t('mobile:time.running')}</Text>
              <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                {running.workItemTitle}
              </Text>
            </View>
            <Text style={[styles.clock, { color: theme.accent }]}>
              {elapsedText((now - running.startedAt) / 1000)}
            </Text>
            <Chip
              label={t('mobile:time.stop')}
              theme={theme}
              selected
              onPress={() => {
                try {
                  stopTimer(db)
                  setError(null)
                  onEdited()
                } catch (failure) {
                  setError(editErrorText(failure))
                }
              }}
            />
          </View>
        )}
        {sheet.byProject.length > 0 && (
          <View
            style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}
          >
            {sheet.byProject.map((entry) => (
              <View key={entry.projectId} style={styles.line}>
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: projectColor({ id: entry.projectId, color: null }) }
                  ]}
                />
                <Text style={[styles.lineText, { color: theme.text }]} numberOfLines={1}>
                  {projectName({ id: entry.projectId, name: null })}
                </Text>
                <Text style={[styles.hours, { color: theme.textSecondary }]}>
                  {hoursAndMinutes(entry.seconds)}
                </Text>
              </View>
            ))}
          </View>
        )}
        {sheet.seconds === 0 && !running && (
          <Text style={[styles.empty, { color: theme.textMuted }]}>{t('mobile:time.empty')}</Text>
        )}
        {sheet.days.map((day) => (
          <View key={day.day} style={styles.day}>
            <View style={styles.line}>
              <Text
                style={[
                  styles.dayName,
                  { color: day.day === today() ? theme.accent : theme.textSecondary }
                ]}
              >
                {formatIsoDate(day.day, { weekday: 'long', day: 'numeric', month: 'short' })}
              </Text>
              <Text style={[styles.hours, { color: theme.textSecondary }]}>
                {day.entries.length > 0 ? hoursAndMinutes(day.seconds) : '–'}
              </Text>
            </View>
            {day.entries.map((entry) => (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                onPress={() => onOpenTask(entry.workItemId)}
                style={({ pressed }) => [
                  styles.entry,
                  {
                    borderColor: theme.border,
                    backgroundColor: pressed ? theme.surfaceSunken : theme.surface
                  }
                ]}
              >
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: projectColor({ id: entry.projectId, color: null }) }
                  ]}
                />
                <View style={styles.grow}>
                  <Text style={[styles.lineText, { color: theme.text }]} numberOfLines={1}>
                    {entry.workItemTitle}
                  </Text>
                  {entry.note !== '' && (
                    <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
                      {entry.note}
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.hours,
                    { color: entry.durationSeconds === null ? theme.accent : theme.text }
                  ]}
                >
                  {hoursAndMinutes(secondsOf(entry.durationSeconds, entry.startedAt))}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  weekBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.small,
    padding: SPACE.small,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  weekTitle: { flex: 1, alignItems: 'center' },
  weekText: { fontSize: 15, fontWeight: '600' },
  weekTotal: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  body: { padding: SPACE.large, gap: SPACE.medium, paddingBottom: 48 },
  error: { padding: SPACE.small, borderRadius: RADIUS, fontSize: 14 },
  running: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.medium,
    borderWidth: 1,
    borderRadius: RADIUS,
    padding: SPACE.medium
  },
  clock: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  card: { borderWidth: 1, borderRadius: RADIUS, padding: SPACE.medium, gap: SPACE.small },
  line: { flexDirection: 'row', alignItems: 'center', gap: SPACE.small },
  lineText: { flex: 1, fontSize: 15 },
  hours: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  grow: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12 },
  empty: { fontSize: 15 },
  day: { gap: SPACE.small },
  dayName: { flex: 1, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.small,
    borderWidth: 1,
    borderRadius: RADIUS,
    padding: SPACE.medium,
    minHeight: 48
  }
})
