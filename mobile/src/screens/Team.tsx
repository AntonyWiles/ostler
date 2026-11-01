import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDateShort } from '@shared/dates'
import { formatRelativeTime } from '@shared/format'
import { personTasks, teamOverview, type TeamRow } from '../data/people'
import { projectColor } from '../data/project-display'
import { today, type QueryDb } from '../data/queries'
import { RADIUS, SPACE, statusColor, useTheme, type Theme } from '../theme'
import { TopBar } from './TopBar'

interface Props {
  db: QueryDb
  version: number
  onBack: () => void
  onOpenTask: (taskId: string) => void
}

/**
 * The Team (the PC's, D4): a card per person across projects with what needs attention (open,
 * overdue, due this week, blocked, stalled, hours this week, away soon). A card opens to that
 * person's open tasks.
 */
export function Team({ db, version, onBack, onOpenTask }: Props) {
  const theme = useTheme()
  const [opened, setOpened] = useState<string | null>(null)
  const rows = useMemo(() => (version >= 0 ? teamOverview(db, today()) : []), [db, version])
  return (
    <View style={styles.page}>
      <TopBar theme={theme} title={t('views:team.title')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {t('views:team.subtitle')}
        </Text>
        {rows.length === 0 && (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {t('views:team.emptyTitle')}
            </Text>
          </View>
        )}
        {rows.map((row) => (
          <PersonCard
            key={row.personId}
            row={row}
            theme={theme}
            open={opened === row.personId}
            onToggle={() => setOpened(opened === row.personId ? null : row.personId)}
            tasks={opened === row.personId ? personTasks(db, row.personId) : []}
            onOpenTask={onOpenTask}
          />
        ))}
      </ScrollView>
    </View>
  )
}

function PersonCard({
  row,
  theme,
  open,
  onToggle,
  tasks,
  onOpenTask
}: {
  row: TeamRow
  theme: Theme
  open: boolean
  onToggle: () => void
  tasks: ReturnType<typeof personTasks>
  onOpenTask: (taskId: string) => void
}) {
  const figures: { label: string; value: string; tone?: string }[] = [
    { label: t('views:team.open'), value: String(row.open) },
    {
      label: t('views:team.overdue'),
      value: String(row.overdue),
      tone: row.overdue > 0 ? theme.danger : undefined
    },
    { label: t('views:team.dueThisWeek'), value: String(row.dueThisWeek) },
    {
      label: t('views:team.blocked'),
      value: String(row.blocked),
      tone: row.blocked > 0 ? theme.warning : undefined
    },
    {
      label: t('views:team.stalled'),
      value: String(row.stalled),
      tone: row.stalled > 0 ? theme.warning : undefined
    }
  ]
  const hours =
    row.capacityThisWeek === null
      ? t('views:team.hoursOnly', { hours: round(row.hoursThisWeek) })
      : t('views:team.hoursOf', {
          hours: round(row.hoursThisWeek),
          capacity: round(row.capacityThisWeek)
        })
  const away = row.awayDays[0]
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('views:team.showTasks', { name: row.person.name })}
        onPress={onToggle}
        style={styles.head}
      >
        <View style={[styles.avatar, { backgroundColor: row.person.color }]}>
          <Text style={styles.initials}>{row.person.initials}</Text>
        </View>
        <View style={styles.grow}>
          <Text style={[styles.name, { color: theme.text }]}>{row.person.name}</Text>
          <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
            {[
              `${t('views:team.hours')}: ${hours}`,
              row.lastActiveAt !== null
                ? `${t('views:team.lastActive')}: ${formatRelativeTime(row.lastActiveAt)}`
                : t('views:team.never')
            ].join(' · ')}
          </Text>
        </View>
        <View style={styles.projects}>
          {row.projectIds.slice(0, 4).map((id) => (
            <View
              key={id}
              style={[styles.dot, { backgroundColor: projectColor({ id, color: null }) }]}
            />
          ))}
        </View>
      </Pressable>
      <View style={styles.figures}>
        {figures.map((figure) => (
          <View
            key={figure.label}
            style={[styles.figure, { backgroundColor: theme.surfaceSunken }]}
          >
            <Text style={[styles.value, { color: figure.tone ?? theme.text }]}>{figure.value}</Text>
            <Text style={[styles.label, { color: theme.textMuted }]} numberOfLines={1}>
              {figure.label}
            </Text>
          </View>
        ))}
      </View>
      {away && (
        <Text style={[styles.meta, { color: theme.warning }]}>
          {away.firstDate === away.lastDate
            ? t('views:team.awayOn', { date: formatIsoDateShort(away.firstDate) })
            : t('views:team.awayRange', {
                first: formatIsoDateShort(away.firstDate),
                last: formatIsoDateShort(away.lastDate)
              })}
        </Text>
      )}
      {open && (
        <View style={styles.tasks}>
          {tasks.length === 0 && (
            <Text style={[styles.meta, { color: theme.textMuted }]}>{t('views:team.noTasks')}</Text>
          )}
          {tasks.map((task) => (
            <Pressable
              key={task.id}
              accessibilityRole="button"
              accessibilityLabel={t('views:team.openTask', { title: task.title })}
              onPress={() => onOpenTask(task.id)}
              style={({ pressed }) => [
                styles.task,
                { backgroundColor: pressed ? theme.surfaceSunken : 'transparent' }
              ]}
            >
              <View style={[styles.status, { backgroundColor: statusColor(theme, task.status) }]} />
              <Text style={[styles.taskTitle, { color: theme.text }]} numberOfLines={1}>
                {task.title}
              </Text>
              {task.targetDate && (
                <Text
                  style={[
                    styles.meta,
                    { color: task.targetDate < today() ? theme.danger : theme.textMuted }
                  ]}
                >
                  {formatIsoDateShort(task.targetDate)}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}

function round(hours: number): string {
  return String(Math.round(hours * 10) / 10)
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { padding: SPACE.large, gap: SPACE.medium, paddingBottom: 48 },
  subtitle: { fontSize: 14 },
  empty: { paddingVertical: SPACE.medium },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: RADIUS, padding: SPACE.medium, gap: SPACE.small },
  head: { flexDirection: 'row', alignItems: 'center', gap: SPACE.medium },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center'
  },
  initials: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  grow: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 12 },
  projects: { flexDirection: 'row', gap: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  figures: { flexDirection: 'row', gap: SPACE.small },
  figure: { flex: 1, borderRadius: RADIUS, paddingVertical: SPACE.small, alignItems: 'center' },
  value: { fontSize: 18, fontWeight: '700' },
  label: { fontSize: 10 },
  tasks: { gap: 2 },
  task: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.small,
    minHeight: 40,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.small
  },
  status: { width: 4, height: 20, borderRadius: 2 },
  taskTitle: { flex: 1, fontSize: 15 }
})
