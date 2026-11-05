import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDateShort } from '@shared/dates'
import { taskPriorityLabel, taskStatusLabel } from '@shared/task-labels'
import type { TaskRowDetails } from '../data/plan'
import { today as todayIso, type TaskSummary } from '../data/queries'
import { SPACE, statusColor, type Theme } from '../theme'

interface Props {
  task: TaskSummary
  theme: Theme
  /** A line under the title, such as the project's name on My Day. */
  note?: string
  /** Labels, checklist, assignee and the rest, where the list has them. */
  details?: TaskRowDetails
  /** Shows the status by name too: for lists not grouped by status. */
  showStatus?: boolean
  onPress: () => void
}

/** The strip down a row's left edge: strong for urgent work, none for medium and low. */
function priorityColor(theme: Theme, priority: TaskSummary['priority']): string | null {
  if (priority === 'critical') return theme.danger
  if (priority === 'high') return theme.warning
  return null
}

/** How soon a date is: past, today, within three days, or later. */
function dueTone(date: string, today: string): 'late' | 'today' | 'soon' | 'later' {
  if (date < today) return 'late'
  if (date === today) return 'today'
  const soon = new Date(`${today}T00:00:00`)
  soon.setDate(soon.getDate() + 3)
  const soonIso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`
  return date <= soonIso ? 'soon' : 'later'
}

/**
 * One task in a list: a status dot and the title, a strip on the left for high and critical
 * priority, and one quiet line of what matters most: how due it is, priority, checklist, what
 * it waits on, labels and who has it.
 */
export function TaskRow({ task, theme, note, details, showStatus, onPress }: Props) {
  const status = taskStatusLabel(task.status)
  const date = task.targetDate === null ? null : formatIsoDateShort(task.targetDate)
  const label =
    date === null
      ? t('mobile:project.taskLabel', { title: task.title, status })
      : t('mobile:project.taskLabelDue', { title: task.title, status, date })
  const done = task.status === 'done'
  const unseen = details?.unseen ?? null
  const unseenWord =
    unseen === 'new' ? t('mobile:list.new') : unseen === 'changed' ? t('mobile:list.changed') : null
  const strip = done ? null : priorityColor(theme, task.priority)
  const tone = task.targetDate === null || done ? null : dueTone(task.targetDate, todayIso())
  const parts: { text: string; color: string; bold?: boolean }[] = []
  if (note) parts.push({ text: note, color: theme.textMuted })
  if (showStatus) parts.push({ text: status, color: statusColor(theme, task.status) })
  if (task.targetDate !== null && date !== null) {
    parts.push(
      tone === 'late'
        ? { text: t('mobile:list.overdue', { date }), color: theme.danger, bold: true }
        : tone === 'today'
          ? { text: t('mobile:list.dueToday'), color: theme.warning, bold: true }
          : tone === 'soon'
            ? { text: t('mobile:project.due', { date }), color: theme.warning }
            : { text: t('mobile:project.due', { date }), color: theme.textMuted }
    )
  }
  if (!done && (task.priority === 'critical' || task.priority === 'high')) {
    parts.push({
      text: taskPriorityLabel(task.priority),
      color: strip ?? theme.textMuted,
      bold: true
    })
  }
  if (details && details.checklist > 0) {
    parts.push({
      text: `☑ ${details.checked}/${details.checklist}`,
      color: details.checked === details.checklist ? theme.success : theme.textMuted
    })
  }
  if (details && details.waitingOn > 0 && !done) {
    parts.push({
      text: t('mobile:list.waiting', { count: details.waitingOn }),
      color: theme.danger
    })
  }
  if (details && details.comments > 0) {
    parts.push({ text: `💬 ${details.comments}`, color: theme.textMuted })
  }
  if (details && details.labels.length > 0) {
    const shown = details.labels.slice(0, 2).map((name) => `#${name}`)
    if (details.labels.length > 2) shown.push(`+${details.labels.length - 2}`)
    parts.push({ text: shown.join(' '), color: theme.textSecondary })
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unseenWord ? `${unseenWord}. ${label}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.surfaceSunken : theme.surface,
          borderColor: theme.border,
          borderLeftColor: strip ?? 'transparent'
        }
      ]}
    >
      <View style={[styles.dot, { backgroundColor: statusColor(theme, task.status) }]} />
      <View style={styles.text}>
        {unseenWord && (
          <Text style={[styles.unseen, { color: theme.accent }]}>
            {unseen === 'new' ? '●' : '○'} {unseenWord}
          </Text>
        )}
        <Text
          numberOfLines={2}
          style={[
            styles.title,
            { color: done ? theme.textMuted : theme.text },
            done && styles.struck
          ]}
        >
          {task.title}
        </Text>
        {parts.length > 0 && (
          <Text numberOfLines={1} style={styles.meta}>
            {parts.map((part, index) => (
              <Text
                key={`${index}:${part.text}`}
                style={[{ color: part.color }, part.bold && styles.bold]}
              >
                {index > 0 ? '  ·  ' : ''}
                {part.text}
              </Text>
            ))}
          </Text>
        )}
      </View>
      {details?.initials ? (
        <View style={[styles.avatar, { backgroundColor: theme.accentSubtle }]}>
          <Text style={[styles.avatarText, { color: theme.accent }]}>{details.initials}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.medium,
    paddingLeft: SPACE.large - 4,
    paddingRight: SPACE.large,
    paddingVertical: SPACE.small + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 4,
    minHeight: 48
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15 },
  struck: { textDecorationLine: 'line-through' },
  meta: { fontSize: 12.5 },
  bold: { fontWeight: '600' },
  unseen: { fontSize: 11.5, fontWeight: '700' },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1
  },
  avatarText: { fontSize: 11, fontWeight: '700' }
})
