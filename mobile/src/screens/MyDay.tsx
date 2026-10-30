import { useMemo } from 'react'
import { FlatList, StyleSheet, Text } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDateShort } from '@shared/dates'
import { projectName } from '../data/project-display'
import { myDay, today, type QueryDb } from '../data/queries'
import { SPACE, useTheme } from '../theme'
import { TaskRow } from './TaskRow'

interface Props {
  db: QueryDb
  version: number
  onOpenTask: (taskId: string) => void
}

/** Today's My Day list, in the order the person set on their computer. Read only. */
export function MyDay({ db, version, onOpenTask }: Props) {
  const theme = useTheme()
  const day = today()
  const tasks = useMemo(() => (version >= 0 ? myDay(db, day) : []), [db, day, version])
  return (
    <FlatList
      data={tasks}
      keyExtractor={(task) => task.id}
      ListHeaderComponent={
        <Text style={[styles.date, { color: theme.textSecondary }]}>
          {t('mobile:myDay.today', { date: formatIsoDateShort(day) })}
        </Text>
      }
      ListEmptyComponent={
        <Text style={[styles.empty, { color: theme.textMuted }]}>{t('mobile:myDay.empty')}</Text>
      }
      renderItem={({ item }) => (
        <TaskRow
          task={item}
          theme={theme}
          note={projectName({ id: item.projectId, name: null })}
          onPress={() => onOpenTask(item.id)}
        />
      )}
    />
  )
}

const styles = StyleSheet.create({
  date: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: SPACE.large,
    paddingTop: SPACE.large,
    paddingBottom: SPACE.small
  },
  empty: { fontSize: 15, paddingHorizontal: SPACE.large }
})
