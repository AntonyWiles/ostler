import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDateShort } from '@shared/dates'
import { taskStatusLabel } from '@shared/task-labels'
import type { TaskSummary } from '../data/queries'
import { SPACE, statusColor, type Theme } from '../theme'

interface Props {
  task: TaskSummary
  theme: Theme
  /** A line under the title, such as the project's name on My Day. */
  note?: string
  onPress: () => void
}

/** One task in a flat list: a status dot, the title, and a line with the note and due date. */
export function TaskRow({ task, theme, note, onPress }: Props) {
  const status = taskStatusLabel(task.status)
  const date = task.targetDate === null ? null : formatIsoDateShort(task.targetDate)
  const label =
    date === null
      ? t('mobile:project.taskLabel', { title: task.title, status })
      : t('mobile:project.taskLabelDue', { title: task.title, status, date })
  const done = task.status === 'done'
  // The note and the due date share one quiet line under the title.
  const meta = [note, date === null ? undefined : t('mobile:project.due', { date })]
    .filter((part): part is string => part !== undefined)
    .join(' · ')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.surfaceSunken : theme.surface,
          borderColor: theme.border
        }
      ]}
    >
      <View style={[styles.dot, { backgroundColor: statusColor(theme, task.status) }]} />
      <View style={styles.text}>
        <Text
          style={[
            styles.title,
            { color: done ? theme.textMuted : theme.text },
            done && styles.struck
          ]}
        >
          {task.title}
        </Text>
        {meta !== '' && (
          <Text numberOfLines={1} style={[styles.meta, { color: theme.textMuted }]}>
            {meta}
          </Text>
        )}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.medium,
    paddingHorizontal: SPACE.large,
    paddingVertical: SPACE.medium,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15 },
  struck: { textDecorationLine: 'line-through' },
  meta: { fontSize: 13 }
})
