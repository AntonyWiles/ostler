import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDate, formatIsoDateShort } from '@shared/dates'
import { taskStatusLabel } from '@shared/task-labels'
import type { QueryDb } from '../data/queries'
import { today } from '../data/queries'
import { schedule, type ScheduleEntry, type ScheduleTask } from '../data/schedule'
import { RADIUS, SPACE, statusColor, type Theme } from '../theme'

/**
 * A project's schedule: overdue work first, then week by week the milestones (with progress) and
 * the tasks due or starting in it. A task opens; a milestone opens the Milestones view.
 */
export function ScheduleList({
  db,
  projectId,
  version,
  theme,
  onOpenTask,
  onOpenMilestones
}: {
  db: QueryDb
  projectId: string
  version: number
  theme: Theme
  onOpenTask: (taskId: string) => void
  onOpenMilestones: () => void
}) {
  const day = today()
  const plan = useMemo(
    () => (version >= 0 ? schedule(db, projectId, day) : null),
    [db, projectId, version, day]
  )
  if (plan === null) return null
  const entry = (item: ScheduleEntry) =>
    item.kind === 'milestone' ? (
      <Pressable
        key={`m${item.id}`}
        accessibilityRole="button"
        onPress={onOpenMilestones}
        style={[
          styles.milestone,
          { borderColor: theme.accent, backgroundColor: theme.accentSubtle }
        ]}
      >
        <Text style={[styles.diamond, { color: theme.accent }]}>◆</Text>
        <View style={styles.grow}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>
            {[
              formatIsoDateShort(item.day),
              item.total > 0
                ? t('mobile:plan.progress', { done: item.done, total: item.total })
                : null
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </Pressable>
    ) : (
      <TaskLine key={item.id} task={item} theme={theme} today={day} onOpen={onOpenTask} />
    )
  return (
    <View style={styles.list}>
      {plan.overdue.length > 0 && (
        <View style={styles.week}>
          <Text style={[styles.weekTitle, { color: theme.danger }]}>
            {t('mobile:schedule.overdue', { count: plan.overdue.length })}
          </Text>
          {plan.overdue.map(entry)}
        </View>
      )}
      {plan.weeks.length === 0 && plan.overdue.length === 0 && (
        <Text style={[styles.empty, { color: theme.textMuted }]}>{t('mobile:schedule.empty')}</Text>
      )}
      {plan.weeks.map((week) => (
        <View key={week.weekStart} style={styles.week}>
          <Text style={[styles.weekTitle, { color: theme.textSecondary }]}>
            {t('mobile:schedule.week', {
              date: formatIsoDate(week.weekStart, { day: 'numeric', month: 'long' })
            })}
          </Text>
          {week.entries.map(entry)}
        </View>
      ))}
      {plan.undated > 0 && (
        <Text style={[styles.meta, { color: theme.textMuted }]}>
          {t('mobile:schedule.undated', { count: plan.undated })}
        </Text>
      )}
    </View>
  )
}

function TaskLine({
  task,
  theme,
  today,
  onOpen
}: {
  task: ScheduleTask
  theme: Theme
  today: string
  onOpen: (taskId: string) => void
}) {
  const late = task.targetDate !== null && task.targetDate < today
  const when =
    task.startDate && task.targetDate && task.startDate !== task.targetDate
      ? `${formatIsoDateShort(task.startDate)} – ${formatIsoDateShort(task.targetDate)}`
      : formatIsoDateShort(task.day)
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpen(task.id)}
      style={({ pressed }) => [
        styles.task,
        {
          borderColor: theme.border,
          backgroundColor: pressed ? theme.surfaceSunken : theme.surface
        }
      ]}
    >
      <View style={[styles.status, { backgroundColor: statusColor(theme, task.status) }]} />
      <View style={styles.grow}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {task.title}
        </Text>
        <Text
          style={[styles.meta, { color: late ? theme.danger : theme.textMuted }]}
          numberOfLines={1}
        >
          {[when, taskStatusLabel(task.status), task.assigneeName].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  list: { gap: SPACE.medium, paddingHorizontal: SPACE.large, paddingTop: SPACE.medium },
  week: { gap: SPACE.small },
  weekTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  empty: { fontSize: 15 },
  milestone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.small,
    borderWidth: 1,
    borderRadius: RADIUS,
    padding: SPACE.medium
  },
  diamond: { fontSize: 16 },
  task: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.small,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingVertical: SPACE.small,
    paddingRight: SPACE.medium,
    paddingLeft: SPACE.small,
    minHeight: 48
  },
  status: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  grow: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12 }
})
