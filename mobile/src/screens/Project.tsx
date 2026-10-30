import { useMemo, useState } from 'react'
import { SectionList, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDateShort } from '@shared/dates'
import { TASK_STATUSES, taskStatusLabel } from '@shared/task-labels'
import { projectColor, projectName } from '../data/project-display'
import { addTask, type EditDb } from '../data/edits'
import { projectOverview, tasksByStatus, type QueryDb } from '../data/queries'
import { SPACE, statusColor, useTheme, type Theme } from '../theme'
import { editErrorText, editStyles, TextSender } from './EditBits'
import { TopBar } from './TopBar'
import { TaskRow } from './TaskRow'

interface Props {
  db: QueryDb & EditDb
  projectId: string
  version: number
  onBack: () => void
  onOpenTask: (taskId: string) => void
  /** Called after a task is added, so the change is pushed and the screens re-read. */
  onEdited: () => void
}

/** One of the Overview's numbers, in a compact row of four. */
function Figure({
  label,
  value,
  theme,
  warn
}: {
  label: string
  value: number
  theme: Theme
  warn?: boolean
}) {
  return (
    <View
      accessible
      accessibilityLabel={t('mobile:project.figure', { label, value })}
      style={styles.figure}
    >
      <Text style={[styles.figureValue, { color: warn && value > 0 ? theme.danger : theme.text }]}>
        {value}
      </Text>
      <Text numberOfLines={2} style={[styles.figureLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
    </View>
  )
}

/** One project: the Overview's figures, then its tasks grouped by status; + adds a task. */
export function Project({ db, projectId, version, onBack, onOpenTask, onEdited }: Props) {
  const theme = useTheme()
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const data = useMemo(
    () =>
      version >= 0
        ? { overview: projectOverview(db, projectId), groups: tasksByStatus(db, projectId) }
        : null,
    [db, projectId, version]
  )
  const sections = useMemo(
    () =>
      TASK_STATUSES.map((status) => ({ status, data: data?.groups[status] ?? [] })).filter(
        (section) => section.data.length > 0
      ),
    [data]
  )
  const reference = { id: projectId, name: null, color: null }
  const overview = data?.overview
  const milestone = overview?.nextMilestone ?? null
  const addTitle = t('mobile:edit.addTask')
  return (
    <>
      <TopBar
        theme={theme}
        title={projectName(reference)}
        onBack={onBack}
        actions={[
          {
            icon: 'plus',
            label: addTitle,
            onPress: () => {
              setError(null)
              setAdding(!adding)
            }
          }
        ]}
      />
      <SectionList
        sections={sections}
        keyExtractor={(task) => task.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            {adding && (
              <View
                style={[
                  styles.adder,
                  { backgroundColor: theme.surface, borderColor: theme.border }
                ]}
              >
                <TextSender
                  theme={theme}
                  placeholder={t('mobile:edit.newTaskLabel')}
                  button={t('mobile:edit.add')}
                  autoFocus
                  onSend={(text) => {
                    try {
                      addTask(db, projectId, text)
                    } catch (failure) {
                      setError(editErrorText(failure))
                      throw failure
                    }
                    setError(null)
                    setAdding(false)
                    onEdited()
                  }}
                />
              </View>
            )}
            {error !== null && (
              <Text
                accessibilityRole="alert"
                style={[
                  editStyles.error,
                  styles.inset,
                  { color: theme.danger, backgroundColor: theme.dangerSubtle }
                ]}
              >
                {error}
              </Text>
            )}
            {overview !== undefined && (
              <View
                style={[
                  styles.overview,
                  { backgroundColor: theme.surface, borderColor: theme.border }
                ]}
              >
                <View style={styles.titleRow}>
                  <View style={[styles.swatch, { backgroundColor: projectColor(reference) }]} />
                  <Text
                    numberOfLines={1}
                    style={[styles.milestone, { color: theme.textSecondary }]}
                  >
                    {milestone === null
                      ? t('mobile:project.noMilestone')
                      : t('mobile:project.nextMilestone', {
                          name: milestone.name,
                          date: formatIsoDateShort(milestone.targetDate)
                        })}
                  </Text>
                </View>
                <View style={styles.figures}>
                  <Figure
                    label={t('mobile:project.open')}
                    value={overview.keyNumbers.open}
                    theme={theme}
                  />
                  <Figure
                    label={t('mobile:project.done')}
                    value={overview.keyNumbers.doneInRange}
                    theme={theme}
                  />
                  <Figure
                    label={t('mobile:project.overdue')}
                    value={overview.keyNumbers.overdueNow}
                    theme={theme}
                    warn
                  />
                  <Figure
                    label={t('mobile:project.dueSoon')}
                    value={overview.keyNumbers.dueNext7Days}
                    theme={theme}
                  />
                </View>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, styles.inset, { color: theme.textMuted }]}>
            {t('mobile:project.noTasks')}
          </Text>
        }
        renderSectionHeader={({ section }) => {
          const heading = t('mobile:project.groupHeading', {
            status: taskStatusLabel(section.status),
            count: section.data.length
          })
          return (
            <View style={[styles.sectionHeader, { borderColor: theme.border }]}>
              <View
                style={[styles.sectionDot, { backgroundColor: statusColor(theme, section.status) }]}
              />
              <Text
                accessibilityRole="header"
                accessibilityLabel={heading}
                style={[styles.sectionTitle, { color: theme.textSecondary }]}
              >
                {heading}
              </Text>
            </View>
          )
        }}
        renderItem={({ item }) => (
          <TaskRow task={item} theme={theme} onPress={() => onOpenTask(item.id)} />
        )}
      />
    </>
  )
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACE.large },
  inset: { marginHorizontal: SPACE.large, marginTop: SPACE.small },
  adder: { padding: SPACE.medium, borderBottomWidth: StyleSheet.hairlineWidth },
  overview: {
    paddingHorizontal: SPACE.large,
    paddingVertical: SPACE.medium,
    gap: SPACE.small,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.small },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  milestone: { fontSize: 13, flex: 1 },
  figures: { flexDirection: 'row', gap: SPACE.small },
  figure: { flex: 1 },
  figureValue: { fontSize: 20, fontWeight: '700' },
  figureLabel: { fontSize: 12 },
  empty: { fontSize: 15 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.small,
    paddingHorizontal: SPACE.large,
    paddingTop: SPACE.large,
    paddingBottom: SPACE.small,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '600' }
})
