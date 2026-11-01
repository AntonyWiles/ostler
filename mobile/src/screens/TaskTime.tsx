import { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDateShort, shiftIsoDate, toIsoDate } from '@shared/dates'
import type { TimeEntry } from '@shared/ostler-api'
import type { EditDb } from '../data/edits'
import { today, type QueryDb } from '../data/queries'
import {
  deleteTimeEntry,
  hoursAndMinutes,
  logTime,
  runningTimer,
  startTimer,
  stopTimer,
  taskTime
} from '../data/time'
import { RADIUS, SPACE, type Theme } from '../theme'
import { Chip, editErrorText } from './EditBits'

/** "1:02:05" for a running timer, so it visibly ticks. */
export function elapsedText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Re-renders every second while `on`, for a running timer. */
export function useTick(on: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [on])
  return now
}

const QUICK_MINUTES = [15, 30, 60, 120] as const

/**
 * A task's time on the task screen: the total logged, Start or Stop the timer (one runs at a time,
 * as on the PC), log time by hand, and the entries, the newest first, each deletable.
 */
export function TaskTime({
  db,
  taskId,
  projectId,
  version,
  theme,
  open,
  onEdited
}: {
  db: EditDb & QueryDb
  taskId: string
  projectId: string
  version: number
  theme: Theme
  /** False for an archived or binned task: its time can be read, not added to. */
  open: boolean
  onEdited: () => void
}) {
  const [logging, setLogging] = useState(false)
  const [minutes, setMinutes] = useState('')
  const [day, setDay] = useState(today())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const time = useMemo(() => (version >= 0 ? taskTime(db, taskId) : null), [db, taskId, version])
  const now = useTick(time?.running != null)
  if (time === null) return null

  const attempt = (run: () => void): boolean => {
    try {
      run()
    } catch (failure) {
      setError(editErrorText(failure))
      return false
    }
    setError(null)
    onEdited()
    return true
  }
  const running = time.running
  const runningSeconds = running ? (now - running.startedAt) / 1000 : 0
  const typed = Number(minutes.replace(',', '.'))
  const log = (value: number) => {
    if (!(value > 0)) return
    if (attempt(() => void logTime(db, projectId, taskId, value, day, note))) {
      setLogging(false)
      setMinutes('')
      setNote('')
    }
  }
  const remove = (entry: TimeEntry) =>
    Alert.alert(t('mobile:time.deleteTitle'), entryLine(entry), [
      { text: t('mobile:taskMenu.cancel'), style: 'cancel' },
      {
        text: t('mobile:status.delete'),
        style: 'destructive',
        onPress: () => attempt(() => void deleteTimeEntry(db, projectId, entry.id))
      }
    ])

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={[styles.heading, { color: theme.textSecondary }]}>
          {t('mobile:time.title')}
        </Text>
        <Text style={[styles.total, { color: theme.textSecondary }]}>
          {t('mobile:time.logged', { time: hoursAndMinutes(time.loggedSeconds) })}
        </Text>
      </View>
      {error !== null && (
        <Text style={[styles.error, { color: theme.danger, backgroundColor: theme.dangerSubtle }]}>
          {error}
        </Text>
      )}
      {running ? (
        <View
          style={[
            styles.running,
            { borderColor: theme.accent, backgroundColor: theme.accentSubtle }
          ]}
        >
          <Text style={[styles.clock, { color: theme.accent }]}>{elapsedText(runningSeconds)}</Text>
          <Chip
            label={t('mobile:time.stop')}
            theme={theme}
            selected
            onPress={() => attempt(() => void stopTimer(db))}
          />
        </View>
      ) : (
        open && (
          <View style={styles.row}>
            <Chip
              label={t('mobile:time.start')}
              theme={theme}
              selected
              onPress={() => attempt(() => void startTimer(db, projectId, taskId))}
            />
            <Chip
              label={t('mobile:time.log')}
              theme={theme}
              selected={logging}
              onPress={() => setLogging(!logging)}
            />
          </View>
        )
      )}
      {logging && !running && (
        <View style={[styles.panel, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <View style={styles.row}>
            {QUICK_MINUTES.map((value) => (
              <Chip
                key={value}
                label={hoursAndMinutes(value * 60)}
                theme={theme}
                onPress={() => log(value)}
              />
            ))}
          </View>
          <View style={styles.row}>
            <TextInput
              accessibilityLabel={t('mobile:time.minutes')}
              placeholder={t('mobile:time.minutes')}
              placeholderTextColor={theme.textMuted}
              keyboardType="numeric"
              value={minutes}
              onChangeText={setMinutes}
              onSubmitEditing={() => log(typed)}
              style={[
                styles.input,
                styles.minutes,
                { color: theme.text, borderColor: theme.borderStrong }
              ]}
            />
            <Chip label={t('mobile:time.add')} theme={theme} selected onPress={() => log(typed)} />
          </View>
          <View style={styles.row}>
            {[0, -1, -2].map((offset) => {
              const value = shiftIsoDate(today(), offset)
              return (
                <Chip
                  key={value}
                  label={
                    offset === 0
                      ? t('mobile:edit.today')
                      : offset === -1
                        ? t('mobile:time.yesterday')
                        : formatIsoDateShort(value)
                  }
                  theme={theme}
                  selected={day === value}
                  onPress={() => setDay(value)}
                />
              )
            })}
          </View>
          <TextInput
            accessibilityLabel={t('mobile:time.note')}
            placeholder={t('mobile:time.note')}
            placeholderTextColor={theme.textMuted}
            value={note}
            onChangeText={setNote}
            style={[styles.input, { color: theme.text, borderColor: theme.borderStrong }]}
          />
        </View>
      )}
      {time.entries
        .filter((entry) => entry.durationSeconds !== null)
        .slice(0, 10)
        .map((entry) => (
          <View key={entry.id} style={styles.entry}>
            <Text style={[styles.entryText, { color: theme.text }]} numberOfLines={2}>
              {entryLine(entry)}
            </Text>
            {entry.billingId === null && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobile:time.deleteTitle')}
                onPress={() => remove(entry)}
                hitSlop={SPACE.small}
                style={styles.remove}
              >
                <Text style={{ color: theme.textMuted, fontSize: 16 }}>✕</Text>
              </Pressable>
            )}
          </View>
        ))}
    </View>
  )
}

/** "Mon 3 Nov · 1:30 · the note". */
function entryLine(entry: TimeEntry): string {
  return [
    formatIsoDateShort(toIsoDate(new Date(entry.startedAt))),
    hoursAndMinutes(entry.durationSeconds ?? 0),
    entry.note || null
  ]
    .filter(Boolean)
    .join(' · ')
}

const styles = StyleSheet.create({
  section: { gap: SPACE.small, marginTop: SPACE.medium },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 13, fontWeight: '600' },
  total: { fontSize: 13, fontWeight: '600' },
  error: { padding: SPACE.small, borderRadius: RADIUS, fontSize: 14 },
  running: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: RADIUS,
    padding: SPACE.medium
  },
  clock: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small, alignItems: 'center' },
  panel: { borderWidth: 1, borderRadius: RADIUS, padding: SPACE.medium, gap: SPACE.small },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.medium,
    fontSize: 15
  },
  minutes: { flex: 1 },
  entry: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  entryText: { flex: 1, fontSize: 15 },
  remove: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }
})

/**
 * The timer running now, as a bar under the home tabs: the task, the time so far, and Stop.
 * Nothing shows when no timer runs.
 */
export function RunningTimerBar({
  db,
  version,
  theme,
  onOpenTask,
  onEdited
}: {
  db: EditDb & QueryDb
  version: number
  theme: Theme
  onOpenTask: (taskId: string) => void
  onEdited: () => void
}) {
  const running = useMemo(() => (version >= 0 ? runningTimer(db) : null), [db, version])
  const now = useTick(running !== null)
  if (running === null) return null
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpenTask(running.workItemId)}
      style={[barStyles.bar, { backgroundColor: theme.accentSubtle, borderColor: theme.accent }]}
    >
      <Text style={[barStyles.barClock, { color: theme.accent }]}>
        {elapsedText((now - running.startedAt) / 1000)}
      </Text>
      <Text style={[barStyles.barTitle, { color: theme.text }]} numberOfLines={1}>
        {running.workItemTitle}
      </Text>
      <Chip
        label={t('mobile:time.stop')}
        theme={theme}
        selected
        onPress={() => {
          try {
            stopTimer(db)
            onEdited()
          } catch {
            // The task screen shows why; the bar stays.
          }
        }}
      />
    </Pressable>
  )
}

const barStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.medium,
    paddingHorizontal: SPACE.large,
    paddingVertical: SPACE.small,
    borderBottomWidth: 1
  },
  barClock: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  barTitle: { flex: 1, fontSize: 15 }
})
