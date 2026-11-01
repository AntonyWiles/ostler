import { useMemo, useState } from 'react'
import {
  Alert,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDateShort } from '@shared/dates'
import { TASK_STATUSES, taskStatusLabel } from '@shared/task-labels'
import { projectColor, projectName } from '../data/project-display'
import type { PlanningWorkItemStatus } from '@shared/ostler-api'
import {
  acceptTaskFromTriage,
  addTask,
  closeTaskAsWontDo,
  restoreTaskFromBin,
  setTaskSomeday,
  type EditDb
} from '../data/edits'
import {
  answerSignOff,
  decisions,
  addMilestone,
  doFirstOrder,
  dueOrder,
  goals,
  milestones,
  milestoneTasks,
  priorityOrder,
  recordDecision,
  recordGoalCheckIn,
  signOffs,
  somedayTasks,
  taskRowDetails,
  triageTasks
} from '../data/plan'
import { DecisionList, GoalList, MilestoneList, SignOffList } from './ProjectPlan'
import { StatusList } from './ProjectStatus'
import { ShoppingList } from './ProjectShopping'
import { LibraryList } from './ProjectLibrary'
import { addLibraryNote } from '../data/library'
import { capabilitiesOf } from '@shared/share-roles'
import { ScheduleList } from './ProjectSchedule'
import { deleteStatusUpdate, postStatusUpdate, statusUpdates } from '../data/status-updates'
import {
  archivedTasks,
  binnedTasks,
  projectLabels,
  projectOverview,
  taskIdsWithLabel,
  tasksByStatus,
  shareRole,
  today,
  type QueryDb,
  type TaskSummary
} from '../data/queries'
import { RADIUS, SPACE, statusColor, useTheme, type Theme } from '../theme'
import { Chip, editErrorText, editStyles, TextSender } from './EditBits'
import { TopBar } from './TopBar'
import { TaskRow } from './TaskRow'

interface Props {
  db: QueryDb & EditDb
  projectId: string
  version: number
  onBack: () => void
  onOpenTask: (taskId: string) => void
  /** Opens a Library item to read. */
  onOpenLibraryItem: (itemId: string) => void
  /** Called after a task is added, so the change is pushed and the screens re-read. */
  onEdited: () => void
  /** The view it opens on; a link to a milestone or decision opens that list. */
  initialView?: ProjectView
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

export type ProjectView =
  | 'tasks'
  | 'triage'
  | 'someday'
  | 'milestones'
  | 'decisions'
  | 'goals'
  | 'signOffs'
  | 'status'
  | 'shopping'
  | 'library'
  | 'schedule'
  | 'archive'
  | 'bin'

/** The views whose rows are tasks, listed under the overview. */
const TASK_VIEWS: readonly ProjectView[] = ['tasks', 'triage', 'someday', 'archive', 'bin']

/** A status's tasks, or (status null) the archive's or the bin's, under no heading. */
interface Section {
  status: PlanningWorkItemStatus | null
  data: TaskSummary[]
  /** How many tasks the section holds, shown when it is folded away. */
  count: number
}

/** How the Tasks view orders its tasks. Do first is one list, not grouped by status. */
type TaskSort = 'doFirst' | 'board' | 'due' | 'priority'
const SORTS: readonly TaskSort[] = ['doFirst', 'board', 'due', 'priority']

/**
 * One project: the Overview's figures, then its tasks grouped by status; + adds a task. Its
 * archive and recycle bin are a tap away; a task in the bin is restored from there.
 */
export function Project({
  db,
  projectId,
  version,
  onBack,
  onOpenTask,
  onOpenLibraryItem,
  onEdited,
  initialView = 'tasks'
}: Props) {
  const theme = useTheme()
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ProjectView>(initialView)
  /** Words a task's title must hold, and a label it must carry, to be listed. */
  const [words, setWords] = useState('')
  const [label, setLabel] = useState<string | null>(null)
  const [filtering, setFiltering] = useState(false)
  const [sort, setSort] = useState<TaskSort>('doFirst')
  /** Status groups folded away; Done starts folded. */
  const [folded, setFolded] = useState<ReadonlySet<PlanningWorkItemStatus>>(
    () => new Set<PlanningWorkItemStatus>(['done'])
  )
  const fold = (status: PlanningWorkItemStatus) =>
    setFolded((now) => {
      const next = new Set(now)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  const details = useMemo(
    () => (version >= 0 ? taskRowDetails(db, projectId) : new Map()),
    [db, projectId, version]
  )
  const labels = useMemo(
    () => (version >= 0 ? projectLabels(db, projectId) : []),
    [db, projectId, version]
  )
  const labelled = useMemo(
    () => (label !== null && version >= 0 ? taskIdsWithLabel(db, projectId, label) : null),
    [db, projectId, label, version]
  )
  const data = useMemo(
    () =>
      version >= 0
        ? {
            overview: projectOverview(db, projectId),
            groups: tasksByStatus(db, projectId),
            archived: view === 'archive' ? archivedTasks(db, projectId) : [],
            binned: view === 'bin' ? binnedTasks(db, projectId) : [],
            triage: triageTasks(db, projectId),
            someday: view === 'someday' ? somedayTasks(db, projectId) : [],
            milestones: view === 'milestones' ? milestones(db, projectId) : [],
            decisions: view === 'decisions' ? decisions(db, projectId) : [],
            goals: view === 'goals' ? goals(db, projectId) : [],
            status: view === 'status' ? statusUpdates(db, projectId) : [],
            meId:
              (
                db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
                  { id: string } | undefined
              )?.id ?? null,
            signOffs: signOffs(db, projectId)
          }
        : null,
    [db, projectId, version, view]
  )
  const sections = useMemo((): Section[] => {
    const wanted = words.trim().toLowerCase()
    const shown = (tasks: TaskSummary[]) =>
      tasks.filter(
        (task) =>
          (!wanted || task.title.toLowerCase().includes(wanted)) &&
          (labelled === null || labelled.has(task.id))
      )
    const flat = (tasks: TaskSummary[]): Section[] => {
      const list = shown(tasks)
      return [{ status: null, data: list, count: list.length }]
    }
    if (view === 'archive') return flat(data?.archived ?? [])
    if (view === 'bin') return flat(data?.binned ?? [])
    if (view === 'triage') return flat(data?.triage ?? [])
    if (view === 'someday') return flat(data?.someday ?? [])
    if (!TASK_VIEWS.includes(view)) return []
    if (sort === 'doFirst') {
      const open = TASK_STATUSES.filter((status) => status !== 'done').flatMap(
        (status) => data?.groups[status] ?? []
      )
      return flat(doFirstOrder(open, today()))
    }
    const order = (tasks: TaskSummary[]) =>
      sort === 'due' ? dueOrder(tasks) : sort === 'priority' ? priorityOrder(tasks) : tasks
    return TASK_STATUSES.map((status) => {
      const list = order(shown(data?.groups[status] ?? []))
      return { status, data: folded.has(status) ? [] : list, count: list.length }
    }).filter((section) => section.count > 0)
  }, [data, view, words, labelled, sort, folded])
  const confirmRestore = (taskId: string, title: string) =>
    Alert.alert(t('mobile:project.restoreTitle'), title, [
      { text: t('mobile:taskMenu.cancel'), style: 'cancel' },
      {
        text: t('mobile:project.restore'),
        onPress: () => {
          try {
            restoreTaskFromBin(db, taskId)
          } catch (failure) {
            setError(editErrorText(failure))
            return
          }
          setError(null)
          onEdited()
        }
      }
    ])
  /** Runs one of the views' edits, then shows its refusal or pushes the change. */
  const edit = (run: () => void) => {
    try {
      run()
    } catch (failure) {
      setError(editErrorText(failure))
      return
    }
    setError(null)
    onEdited()
  }
  /** As `edit`, saying whether the edit went in, so a form knows to close. */
  const saved = (run: () => void): boolean => {
    let ok = false
    edit(() => {
      run()
      ok = true
    })
    return ok
  }
  const waitingSignOffs = (data?.signOffs ?? []).filter((item) => item.canAnswer).length
  const triageCount = data?.triage.length ?? 0
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
                    let id: string
                    try {
                      id = addTask(db, projectId, text)
                    } catch (failure) {
                      setError(editErrorText(failure))
                      throw failure
                    }
                    setError(null)
                    setAdding(false)
                    onEdited()
                    // The new task opens, so its date, person and the rest are set right away.
                    onOpenTask(id)
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
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.viewsLine}
                >
                  <Chip
                    label={t('mobile:project.tasksView')}
                    theme={theme}
                    selected={view === 'tasks'}
                    onPress={() => setView('tasks')}
                  />
                  <Chip
                    label={t('mobile:status.view')}
                    theme={theme}
                    selected={view === 'status'}
                    onPress={() => setView('status')}
                  />
                  <Chip
                    label={
                      triageCount > 0
                        ? t('mobile:plan.triageCount', { count: triageCount })
                        : t('mobile:plan.triageView')
                    }
                    theme={theme}
                    selected={view === 'triage'}
                    onPress={() => setView('triage')}
                  />
                  <Chip
                    label={t('mobile:plan.somedayView')}
                    theme={theme}
                    selected={view === 'someday'}
                    onPress={() => setView('someday')}
                  />
                  <Chip
                    label={t('mobile:schedule.view')}
                    theme={theme}
                    selected={view === 'schedule'}
                    onPress={() => setView('schedule')}
                  />
                  <Chip
                    label={t('mobile:plan.milestonesView')}
                    theme={theme}
                    selected={view === 'milestones'}
                    onPress={() => setView('milestones')}
                  />
                  <Chip
                    label={t('mobile:plan.goalsView')}
                    theme={theme}
                    selected={view === 'goals'}
                    onPress={() => setView('goals')}
                  />
                  <Chip
                    label={t('mobile:plan.decisionsView')}
                    theme={theme}
                    selected={view === 'decisions'}
                    onPress={() => setView('decisions')}
                  />
                  <Chip
                    label={
                      waitingSignOffs > 0
                        ? t('mobile:plan.signOffsCount', { count: waitingSignOffs })
                        : t('mobile:plan.signOffsView')
                    }
                    theme={theme}
                    selected={view === 'signOffs'}
                    onPress={() => setView('signOffs')}
                  />
                  <Chip
                    label={t('mobile:library.view')}
                    theme={theme}
                    selected={view === 'library'}
                    onPress={() => setView('library')}
                  />
                  <Chip
                    label={t('mobile:shopping.view')}
                    theme={theme}
                    selected={view === 'shopping'}
                    onPress={() => setView('shopping')}
                  />
                  <Chip
                    label={t('mobile:project.archiveView')}
                    theme={theme}
                    selected={view === 'archive'}
                    onPress={() => setView('archive')}
                  />
                  <Chip
                    label={t('mobile:project.binView')}
                    theme={theme}
                    selected={view === 'bin'}
                    onPress={() => setView('bin')}
                  />
                </ScrollView>
                {TASK_VIEWS.includes(view) && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.viewsLine}
                  >
                    {view === 'tasks' &&
                      SORTS.map((name) => (
                        <Chip
                          key={name}
                          label={t(`mobile:list.sort.${name}`)}
                          theme={theme}
                          selected={sort === name}
                          onPress={() => setSort(name)}
                        />
                      ))}
                    <Chip
                      label={
                        words.trim() || label !== null
                          ? t('mobile:list.filterOn')
                          : t('mobile:list.filter')
                      }
                      theme={theme}
                      selected={filtering || Boolean(words.trim()) || label !== null}
                      onPress={() => setFiltering(!filtering)}
                    />
                  </ScrollView>
                )}
                {filtering && TASK_VIEWS.includes(view) && (
                  <TextInput
                    accessibilityLabel={t('mobile:project.filter')}
                    placeholder={t('mobile:project.filter')}
                    placeholderTextColor={theme.textMuted}
                    value={words}
                    onChangeText={setWords}
                    returnKeyType="search"
                    style={[
                      styles.filter,
                      {
                        color: theme.text,
                        borderColor: theme.borderStrong,
                        backgroundColor: theme.surface
                      }
                    ]}
                  />
                )}
                {filtering && TASK_VIEWS.includes(view) && labels.length > 0 && (
                  <View style={styles.views}>
                    {labels.map((name) => (
                      <Chip
                        key={name}
                        label={name}
                        theme={theme}
                        selected={label === name}
                        onPress={() => setLabel(label === name ? null : name)}
                      />
                    ))}
                  </View>
                )}
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
            {view === 'milestones' && (
              <MilestoneList
                theme={theme}
                items={data?.milestones ?? []}
                tasksOf={(milestoneId) => milestoneTasks(db, milestoneId)}
                onOpenTask={onOpenTask}
                onAdd={(input) => saved(() => addMilestone(db, projectId, input))}
              />
            )}
            {view === 'decisions' && (
              <DecisionList
                theme={theme}
                items={data?.decisions ?? []}
                onRecord={(input) => saved(() => recordDecision(db, projectId, input))}
              />
            )}
            {view === 'goals' && (
              <GoalList
                theme={theme}
                items={data?.goals ?? []}
                onCheckIn={(goalId, value) =>
                  edit(() => recordGoalCheckIn(db, goalId, value, today()))
                }
              />
            )}
            {view === 'schedule' && (
              <ScheduleList
                db={db}
                projectId={projectId}
                version={version}
                theme={theme}
                onOpenTask={onOpenTask}
                onOpenMilestones={() => setView('milestones')}
              />
            )}
            {view === 'library' && (
              <LibraryList
                db={db}
                projectId={projectId}
                version={version}
                theme={theme}
                onOpen={onOpenLibraryItem}
                onAddNote={
                  capabilitiesOf(shareRole(db, projectId)).editLibrary
                    ? (title, body) => {
                        let id: string | null = null
                        const ok = saved(() => {
                          id = addLibraryNote(db, projectId, { title, body }).id
                        })
                        if (id !== null) onOpenLibraryItem(id)
                        return ok
                      }
                    : undefined
                }
              />
            )}
            {view === 'shopping' && (
              <ShoppingList
                db={db}
                projectId={projectId}
                version={version}
                theme={theme}
                onEdited={onEdited}
              />
            )}
            {view === 'status' && (
              <StatusList
                key={projectId}
                theme={theme}
                items={data?.status ?? []}
                meId={data?.meId ?? null}
                onPost={(health, note) => {
                  try {
                    postStatusUpdate(db, projectId, health, note)
                  } catch (failure) {
                    setError(editErrorText(failure))
                    return false
                  }
                  setError(null)
                  onEdited()
                  return true
                }}
                onDelete={(update) =>
                  Alert.alert(t('projects:statusUpdates.delete'), undefined, [
                    { text: t('mobile:taskMenu.cancel'), style: 'cancel' },
                    {
                      text: t('mobile:status.delete'),
                      style: 'destructive',
                      onPress: () => edit(() => deleteStatusUpdate(db, update.id))
                    }
                  ])
                }
              />
            )}
            {view === 'signOffs' && (
              <SignOffList
                theme={theme}
                items={data?.signOffs ?? []}
                onOpenTask={onOpenTask}
                onAnswer={(id, answer, note) => edit(() => answerSignOff(db, id, answer, note))}
              />
            )}
          </View>
        }
        ListEmptyComponent={
          !TASK_VIEWS.includes(view) ? undefined : (
            <Text style={[styles.empty, styles.inset, { color: theme.textMuted }]}>
              {words.trim() || label !== null
                ? t('mobile:project.noMatches')
                : view === 'archive'
                  ? t('mobile:project.archiveEmpty')
                  : view === 'bin'
                    ? t('mobile:project.binEmpty')
                    : view === 'triage'
                      ? t('mobile:plan.triageEmpty')
                      : view === 'someday'
                        ? t('mobile:plan.somedayEmpty')
                        : t('mobile:project.noTasks')}
            </Text>
          )
        }
        renderSectionHeader={({ section }) => {
          if (section.status === null) {
            const note =
              view === 'bin'
                ? t('mobile:project.binNote')
                : view === 'triage'
                  ? t('mobile:plan.triageNote')
                  : view === 'someday'
                    ? t('mobile:plan.somedayNote')
                    : view === 'tasks' && sort === 'doFirst'
                      ? t('mobile:list.doFirstNote')
                      : null
            return note !== null && section.data.length > 0 ? (
              <Text style={[styles.note, styles.inset, { color: theme.textMuted }]}>{note}</Text>
            ) : null
          }
          const heading = t('mobile:project.groupHeading', {
            status: taskStatusLabel(section.status),
            count: section.count
          })
          const status = section.status
          const open = !folded.has(status)
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={heading}
              accessibilityState={{ expanded: open }}
              onPress={() => fold(status)}
              style={({ pressed }) => [
                styles.sectionHeader,
                {
                  borderColor: theme.border,
                  backgroundColor: pressed ? theme.surfaceSunken : theme.bg
                }
              ]}
            >
              <Text style={[styles.chevron, { color: theme.textMuted }]}>{open ? '▾' : '▸'}</Text>
              <View style={[styles.sectionDot, { backgroundColor: statusColor(theme, status) }]} />
              <Text
                accessibilityRole="header"
                style={[styles.sectionTitle, { color: theme.textSecondary }]}
              >
                {heading}
              </Text>
            </Pressable>
          )
        }}
        renderItem={({ item }) => (
          <View>
            <TaskRow
              task={item}
              theme={theme}
              details={details.get(item.id)}
              showStatus={view === 'tasks' && sort === 'doFirst'}
              onPress={() =>
                view === 'bin' ? confirmRestore(item.id, item.title) : onOpenTask(item.id)
              }
            />
            {view === 'triage' && (
              <View style={styles.rowActions}>
                <Chip
                  label={t('mobile:plan.accept')}
                  theme={theme}
                  onPress={() => edit(() => acceptTaskFromTriage(db, item.id))}
                />
                <Chip
                  label={t('mobile:plan.someday')}
                  theme={theme}
                  onPress={() => edit(() => setTaskSomeday(db, item.id, true))}
                />
                <Chip
                  label={t('mobile:plan.wontDo')}
                  theme={theme}
                  onPress={() => edit(() => closeTaskAsWontDo(db, item.id, ''))}
                />
              </View>
            )}
            {view === 'someday' && (
              <View style={styles.rowActions}>
                <Chip
                  label={t('mobile:plan.bringBack')}
                  theme={theme}
                  onPress={() => edit(() => setTaskSomeday(db, item.id, false))}
                />
              </View>
            )}
          </View>
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
  views: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small },
  viewsLine: { flexDirection: 'row', gap: SPACE.small },
  chevron: { fontSize: 13, width: 12 },
  note: { fontSize: 13 },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.small,
    paddingHorizontal: SPACE.large,
    paddingBottom: SPACE.small
  },
  filter: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.medium,
    fontSize: 15
  },
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
