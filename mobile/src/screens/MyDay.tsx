import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDate, formatIsoDateShort } from '@shared/dates'
import type { HomeTask, PlanningWorkItemStatus } from '@shared/ostler-api'
import { setTaskStatus, type EditDb } from '../data/edits'
import { myWork } from '../data/home'
import { projectColor, projectName } from '../data/project-display'
import { today as todayOf, type QueryDb } from '../data/queries'
import { RADIUS, SPACE, statusColor, useTheme, type Theme } from '../theme'
import { editErrorText } from './EditBits'

interface Props {
  db: QueryDb & EditDb
  version: number
  onOpenTask: (taskId: string) => void
  onEdited: () => void
}

const UNDO_MS = 5000

const info = {
  name: (id: string) => projectName({ id, name: null }),
  color: (id: string) => projectColor({ id, color: null })
}

/** A task's line under its title: project, why it is here, its date. */
function reasonText(task: HomeTask): string | null {
  switch (task.reason) {
    case 'overdue':
      return task.targetDate
        ? t('mobile:list.overdue', { date: formatIsoDateShort(task.targetDate) })
        : null
    case 'today':
      return t('mobile:list.dueToday')
    case 'in-progress':
      return t('mobile:home.inProgress')
    case 'new-today':
      return t('mobile:home.newToday')
    default:
      return task.targetDate ? formatIsoDateShort(task.targetDate) : null
  }
}

/**
 * My Day, as Home on the PC: today's planned list (in the person's order), then Today (overdue, due
 * today, in progress, new today: Me's or nobody's) and the next seven days, day by day. A task's
 * circle marks it done, with Undo; the row opens it.
 */
export function MyDay({ db, version, onOpenTask, onEdited }: Props) {
  const theme = useTheme()
  const day = todayOf()
  const work = useMemo(() => (version >= 0 ? myWork(db, info, day) : null), [db, day, version])
  const [done, setDone] = useState<{
    title: string
    id: string
    was: PlanningWorkItemStatus
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (done === null) return
    const timer = setTimeout(() => setDone(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [done])
  if (work === null) return null

  const finish = (task: HomeTask) => {
    try {
      setTaskStatus(db, task.id, 'done')
    } catch (failure) {
      setError(editErrorText(failure))
      return
    }
    setError(null)
    setDone({ title: task.title, id: task.id, was: task.status })
    onEdited()
  }
  const undo = () => {
    if (done === null) return
    const back = done
    setDone(null)
    try {
      setTaskStatus(db, back.id, back.was)
      onEdited()
    } catch (failure) {
      setError(editErrorText(failure))
    }
  }

  const planned = new Set(work.myDay.map((task) => task.id))
  const todayTasks = work.today.filter((task) => !planned.has(task.id))
  const row = (task: HomeTask, note: string | null) => (
    <Row key={task.id} task={task} note={note} theme={theme} onOpen={onOpenTask} onDone={finish} />
  )
  const nothing = work.myDay.length === 0 && todayTasks.length === 0 && work.upcoming.length === 0

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.date, { color: theme.textSecondary }]}>
          {t('mobile:myDay.today', { date: formatIsoDateShort(day) })}
        </Text>
        {error !== null && (
          <Text
            style={[styles.error, { color: theme.danger, backgroundColor: theme.dangerSubtle }]}
          >
            {error}
          </Text>
        )}
        {nothing && (
          <Text style={[styles.empty, { color: theme.textMuted }]}>
            {t('mobile:home.allClear')}
          </Text>
        )}
        {work.myDay.length > 0 && (
          <Section title={t('mobile:home.planned')} theme={theme}>
            {work.myDay.map((task) => row(task, reasonText(task)))}
          </Section>
        )}
        {todayTasks.length > 0 && (
          <Section title={t('mobile:home.today', { count: todayTasks.length })} theme={theme}>
            {todayTasks.map((task) => row(task, reasonText(task)))}
          </Section>
        )}
        {work.upcoming.map((upcoming) => (
          <Section
            key={upcoming.date}
            title={formatIsoDate(upcoming.date, { weekday: 'long', day: 'numeric', month: 'long' })}
            theme={theme}
          >
            {upcoming.tasks.map((task) => row(task, null))}
          </Section>
        ))}
      </ScrollView>
      {done !== null && (
        <View style={[styles.snack, { backgroundColor: theme.text }]}>
          <Text style={[styles.snackText, { color: theme.surface }]} numberOfLines={2}>
            {t('mobile:home.marked', { title: done.title })}
          </Text>
          <Pressable accessibilityRole="button" onPress={undo} hitSlop={8}>
            <Text style={[styles.snackAction, { color: theme.accentSubtle }]}>
              {t('mobile:inbox.undo')}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

function Section({ title, theme, children }: { title: string; theme: Theme; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.textSecondary }]}
      >
        {title}
      </Text>
      {children}
    </View>
  )
}

function Row({
  task,
  note,
  theme,
  onOpen,
  onDone
}: {
  task: HomeTask
  note: string | null
  theme: Theme
  onOpen: (taskId: string) => void
  onDone: (task: HomeTask) => void
}) {
  const late = task.reason === 'overdue'
  const finished = task.status === 'done'
  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: finished, disabled: finished }}
        accessibilityLabel={t('mobile:home.markDone', { title: task.title })}
        disabled={finished}
        onPress={() => onDone(task)}
        hitSlop={SPACE.small}
        style={[
          styles.circle,
          {
            borderColor: statusColor(theme, task.status),
            backgroundColor: finished ? statusColor(theme, task.status) : 'transparent'
          }
        ]}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => onOpen(task.id)}
        style={({ pressed }) => [styles.open, pressed && { opacity: 0.6 }]}
      >
        <Text
          style={[
            styles.title,
            { color: finished ? theme.textMuted : theme.text },
            finished && styles.struck
          ]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.swatch, { backgroundColor: task.projectColor }]} />
          <Text
            style={[styles.meta, { color: late ? theme.danger : theme.textMuted }]}
            numberOfLines={1}
          >
            {[task.projectName, note].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { padding: SPACE.large, gap: SPACE.medium, paddingBottom: 96 },
  date: { fontSize: 13, fontWeight: '600' },
  error: { padding: SPACE.small, borderRadius: RADIUS, fontSize: 14 },
  empty: { fontSize: 15 },
  section: { gap: SPACE.small },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.medium,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingLeft: SPACE.medium,
    minHeight: 56
  },
  circle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2 },
  open: { flex: 1, paddingVertical: SPACE.small, paddingRight: SPACE.medium, gap: 2 },
  title: { fontSize: 15, fontWeight: '600' },
  struck: { textDecorationLine: 'line-through' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.small },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  meta: { flex: 1, fontSize: 12 },
  snack: {
    position: 'absolute',
    left: SPACE.large,
    right: SPACE.large,
    bottom: SPACE.large,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.medium,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.large,
    minHeight: 48,
    elevation: 4
  },
  snackText: { flex: 1, fontSize: 15 },
  snackAction: { fontSize: 15, fontWeight: '700' }
})
