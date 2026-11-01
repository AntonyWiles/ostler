import { useMemo, useState, type ReactNode } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDateShort, shiftIsoDate } from '@shared/dates'
import { formatDateTime, formatRelativeTime } from '@shared/format'
import { TASK_STATUSES, taskPriorityLabel, taskStatusLabel } from '@shared/task-labels'
import { projectName } from '../data/project-display'
import {
  addTaskComment,
  addTaskToMyDay,
  archiveTask,
  closeTaskAsWontDo,
  inMyDay,
  moveTaskToBin,
  removeTaskFromMyDay,
  renameTask,
  setChecklistTick,
  setTaskAssignee,
  setTaskChecklist,
  setTaskDescription,
  setTaskDueDate,
  setTaskEstimate,
  setTaskLabels,
  setTaskMilestone,
  setTaskPriority,
  setTaskSomeday,
  setTaskStartDate,
  setTaskStatus,
  TASK_PRIORITIES,
  unarchiveTask,
  type EditDb
} from '../data/edits'
import {
  assignablePeople,
  milestoneChoices,
  projectLabels,
  task as readTask,
  today,
  type QueryDb
} from '../data/queries'
import { Chip, editErrorText, editStyles, TextSender } from './EditBits'
import { RADIUS, SPACE, statusColor, useTheme } from '../theme'
import { DatePicker } from './DatePicker'
import { Markdown } from './Markdown'
import { TopBar, type MenuItem } from './TopBar'

interface Props {
  db: QueryDb & EditDb
  taskId: string
  version: number
  onBack: () => void
  /** Called after every edit that was saved, so the change is pushed and the screens re-read. */
  onEdited: () => void
}

type Panel =
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'start'
  | 'due'
  | 'estimate'
  | 'milestone'
  | 'labels'
  | 'checklist'
  | 'wontDo'
  | null

/**
 * One task's details; tapping the title, the description or a field opens its edit in place.
 * The ⋮ menu holds what is done to the task as a whole, as the PC's task menu does.
 */
export function TaskDetail({ db, taskId, version, onBack, onEdited }: Props) {
  const theme = useTheme()
  const [panel, setPanel] = useState<Panel>(null)
  const [error, setError] = useState<string | null>(null)
  /** The checklist line being renamed, by its place in the list. */
  const [renaming, setRenaming] = useState<number | null>(null)
  const task = useMemo(() => (version >= 0 ? readTask(db, taskId) : null), [db, taskId, version])

  const people = useMemo(
    () => (task !== null && panel === 'assignee' ? assignablePeople(db, task.projectId) : []),
    [db, task, panel]
  )
  const milestones = useMemo(
    () => (task !== null && panel === 'milestone' ? milestoneChoices(db, task.projectId) : []),
    [db, task, panel]
  )
  const labelChoices = useMemo(() => {
    if (task === null || panel !== 'labels') return []
    const names = new Set([...projectLabels(db, task.projectId), ...task.labels])
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [db, task, panel])
  /** Runs one edit; true when it was saved. A refusal (a Viewer, a bad date) is shown, not thrown. */
  const attempt = (edit: () => void): boolean => {
    try {
      edit()
    } catch (failure) {
      setError(editErrorText(failure))
      return false
    }
    setError(null)
    onEdited()
    return true
  }
  const toggle = (name: Exclude<Panel, null>) => {
    setError(null)
    setPanel(panel === name ? null : name)
  }
  const setDue = (date: string | null) => {
    if (task !== null && attempt(() => setTaskDueDate(db, task.id, date))) setPanel(null)
  }
  const setStart = (date: string | null) => {
    if (task !== null && attempt(() => setTaskStartDate(db, task.id, date))) setPanel(null)
  }
  const day = today()
  const picked = useMemo(
    () => version >= 0 && task !== null && inMyDay(db, task.id, day),
    [db, task, day, version]
  )

  if (task === null) {
    return (
      <>
        <TopBar theme={theme} title="" onBack={onBack} />
        <Text style={[styles.body, styles.page, styles.missing, { color: theme.textMuted }]}>
          {t('mobile:task.notFound')}
        </Text>
      </>
    )
  }

  const confirmBin = () =>
    Alert.alert(t('mobile:taskMenu.binTitle'), t('mobile:taskMenu.binBody'), [
      { text: t('mobile:taskMenu.cancel'), style: 'cancel' },
      {
        text: t('mobile:taskMenu.bin'),
        style: 'destructive',
        onPress: () => {
          if (attempt(() => moveTaskToBin(db, task.id))) onBack()
        }
      }
    ])
  const open = !task.archived
  const menu: MenuItem[] = [
    ...(open && !task.inTriage
      ? [
          picked
            ? {
                label: t('mobile:taskMenu.removeMyDay'),
                onPress: () => attempt(() => removeTaskFromMyDay(db, task.id, day))
              }
            : {
                label: t('mobile:taskMenu.addMyDay'),
                onPress: () => attempt(() => addTaskToMyDay(db, task.id, day))
              }
        ]
      : []),
    ...(open
      ? [
          {
            label: task.someday ? t('mobile:taskMenu.bringBack') : t('mobile:taskMenu.someday'),
            onPress: () => attempt(() => setTaskSomeday(db, task.id, !task.someday))
          }
        ]
      : []),
    ...(open && task.status !== 'done'
      ? [{ label: t('mobile:taskMenu.wontDo'), onPress: () => toggle('wontDo') }]
      : []),
    open
      ? {
          label: t('mobile:taskMenu.archive'),
          onPress: () => attempt(() => archiveTask(db, task.id))
        }
      : {
          label: task.wontDo ? t('mobile:taskMenu.reopen') : t('mobile:taskMenu.unarchive'),
          onPress: () => attempt(() => unarchiveTask(db, task.id))
        },
    ...(!task.agentLinked
      ? [{ label: t('mobile:taskMenu.bin'), danger: true, onPress: confirmBin }]
      : [])
  ]

  const due = task.targetDate === null ? null : formatIsoDateShort(task.targetDate)
  const start = task.startDate === null ? null : formatIsoDateShort(task.startDate)
  const divider = { borderColor: theme.border }
  const valueText = (text: string, muted = false) => (
    <Text style={[styles.factValue, { color: muted ? theme.textMuted : theme.text }]}>{text}</Text>
  )
  /** A field that opens its choices in place, under it, when tapped. */
  const field = (
    name: Exclude<Panel, 'title' | 'description' | 'checklist' | 'wontDo' | null>,
    label: string,
    hint: string,
    value: ReactNode
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      accessibilityState={{ expanded: panel === name }}
      onPress={() => toggle(name)}
      style={({ pressed }) => [
        styles.fact,
        divider,
        pressed && { backgroundColor: theme.surfaceSunken }
      ]}
    >
      <Text style={[styles.factLabel, { color: theme.textMuted }]}>{label}</Text>
      <View style={styles.factValueRow}>{value}</View>
      <Text style={[styles.chevron, { color: theme.textMuted }]}>{panel === name ? '▴' : '▾'}</Text>
    </Pressable>
  )
  const lines = task.checklist.map((line) => line.text)
  /** Saves the checklist's lines; `renamed` maps an old text to its new one. */
  const saveChecklist = (next: string[], renamed?: ReadonlyMap<string, string>) =>
    attempt(() => setTaskChecklist(db, task.id, next, renamed))
  const moveLine = (from: number, to: number) => {
    const next = [...lines]
    const [line] = next.splice(from, 1)
    next.splice(to, 0, line)
    saveChecklist(next)
  }
  /** A square button with a glyph, for moving and removing a checklist line. */
  const lineButton = (glyph: string, label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.lineButton,
        { borderColor: theme.border },
        pressed && { backgroundColor: theme.surfaceSunken }
      ]}
    >
      <Text style={[styles.lineGlyph, { color: disabled ? theme.border : theme.textSecondary }]}>
        {glyph}
      </Text>
    </Pressable>
  )
  /** Quick dates and a calendar, for the due date and the start date. */
  const datePanel = (
    value: string | null,
    clearLabel: string,
    pick: (date: string | null) => void
  ) => (
    <View style={[styles.panel, divider]}>
      <View style={styles.chips}>
        <Chip label={t('mobile:edit.today')} theme={theme} onPress={() => pick(today())} />
        <Chip
          label={t('mobile:edit.tomorrow')}
          theme={theme}
          onPress={() => pick(shiftIsoDate(today(), 1))}
        />
        <Chip
          label={t('mobile:edit.nextWeek')}
          theme={theme}
          onPress={() => pick(shiftIsoDate(today(), 7))}
        />
        {value !== null && <Chip label={clearLabel} theme={theme} onPress={() => pick(null)} />}
      </View>
      <DatePicker theme={theme} value={value} today={today()} onPick={pick} />
    </View>
  )

  return (
    <>
      <TopBar
        theme={theme}
        title={projectName({ id: task.projectId, name: null })}
        onBack={onBack}
        menu={menu}
      />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.page}>
          {panel === 'title' ? (
            <TextSender
              theme={theme}
              placeholder={t('mobile:edit.titleLabel')}
              button={t('mobile:edit.save')}
              initial={task.title}
              autoFocus
              onSend={(text) => {
                if (!attempt(() => renameTask(db, task.id, text))) throw new Error('refused')
                setPanel(null)
              }}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityHint={t('mobile:edit.rename')}
              onPress={() => toggle('title')}
            >
              <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
                {task.title}
              </Text>
            </Pressable>
          )}
          {task.archived && (
            <Text
              style={[
                styles.notice,
                { color: theme.warning, backgroundColor: theme.warningSubtle }
              ]}
            >
              {task.wontDo ? t('mobile:task.wontDo') : t('mobile:task.archived')}
            </Text>
          )}
          {task.someday && !task.archived && (
            <Text
              style={[
                styles.notice,
                { color: theme.textSecondary, backgroundColor: theme.surfaceSunken }
              ]}
            >
              {t('mobile:task.someday')}
            </Text>
          )}
          {panel === 'wontDo' && (
            <View
              style={[styles.wontDo, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <Text accessibilityRole="header" style={[styles.body, { color: theme.text }]}>
                {t('mobile:taskMenu.wontDoTitle')}
              </Text>
              <TextSender
                theme={theme}
                placeholder={t('mobile:taskMenu.wontDoReason')}
                button={t('mobile:taskMenu.wontDoClose')}
                multiline
                autoFocus
                onSend={(text) => {
                  if (!attempt(() => closeTaskAsWontDo(db, task.id, text)))
                    throw new Error('refused')
                  setPanel(null)
                }}
              />
              <Chip
                label={t('mobile:taskMenu.cancel')}
                theme={theme}
                onPress={() => setPanel(null)}
              />
            </View>
          )}
          {error !== null && (
            <Text
              accessibilityRole="alert"
              style={[
                editStyles.error,
                { color: theme.danger, backgroundColor: theme.dangerSubtle }
              ]}
            >
              {error}
            </Text>
          )}
        </View>

        <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {field(
            'status',
            t('mobile:task.status'),
            t('mobile:edit.changeStatus'),
            <>
              <View style={[styles.dot, { backgroundColor: statusColor(theme, task.status) }]} />
              {valueText(taskStatusLabel(task.status))}
            </>
          )}
          {panel === 'status' && (
            <View style={[styles.panel, divider]}>
              {TASK_STATUSES.map((status) => (
                <Pressable
                  key={status}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: status === task.status }}
                  onPress={() => {
                    if (status === task.status) setPanel(null)
                    else if (attempt(() => setTaskStatus(db, task.id, status))) setPanel(null)
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    status === task.status && { backgroundColor: theme.accentSubtle },
                    pressed && { backgroundColor: theme.surfaceSunken }
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: statusColor(theme, status) }]} />
                  {valueText(taskStatusLabel(status))}
                </Pressable>
              ))}
            </View>
          )}
          {field(
            'assignee',
            t('mobile:task.assignee'),
            t('mobile:edit.changeAssignee'),
            valueText(task.assigneeName ?? t('mobile:edit.nobody'), task.assigneeName === null)
          )}
          {panel === 'assignee' && (
            <View style={[styles.panel, styles.chips, divider]}>
              <Chip
                label={t('mobile:edit.nobody')}
                theme={theme}
                selected={task.assigneeId === null}
                onPress={() => {
                  if (task.assigneeId === null) setPanel(null)
                  else if (attempt(() => setTaskAssignee(db, task.id, null))) setPanel(null)
                }}
              />
              {people.map((person) => (
                <Chip
                  key={person.id}
                  label={person.name}
                  theme={theme}
                  selected={person.id === task.assigneeId}
                  onPress={() => {
                    if (person.id === task.assigneeId) setPanel(null)
                    else if (attempt(() => setTaskAssignee(db, task.id, person.id))) setPanel(null)
                  }}
                />
              ))}
            </View>
          )}
          {field(
            'due',
            t('mobile:task.due'),
            t('mobile:edit.changeDue'),
            valueText(due ?? t('mobile:edit.clearDate'), due === null)
          )}
          {panel === 'due' && datePanel(task.targetDate, t('mobile:edit.clearDate'), setDue)}
          {field(
            'priority',
            t('mobile:task.priority'),
            t('mobile:edit.changePriority'),
            valueText(taskPriorityLabel(task.priority))
          )}
          {panel === 'priority' && (
            <View style={[styles.panel, styles.chips, divider]}>
              {TASK_PRIORITIES.map((priority) => (
                <Chip
                  key={priority}
                  label={taskPriorityLabel(priority)}
                  theme={theme}
                  selected={priority === task.priority}
                  onPress={() => {
                    if (priority === task.priority) setPanel(null)
                    else if (attempt(() => setTaskPriority(db, task.id, priority))) setPanel(null)
                  }}
                />
              ))}
            </View>
          )}
          {field(
            'start',
            t('mobile:task.start'),
            t('mobile:edit.changeStart'),
            valueText(start ?? t('mobile:edit.noStart'), start === null)
          )}
          {panel === 'start' && datePanel(task.startDate, t('mobile:edit.noStart'), setStart)}
          {field(
            'estimate',
            t('mobile:task.estimate'),
            t('mobile:edit.changeEstimate'),
            valueText(
              task.estimate === null ? t('mobile:edit.noEstimate') : String(task.estimate),
              task.estimate === null
            )
          )}
          {panel === 'estimate' && (
            <View style={[styles.panel, divider]}>
              <TextSender
                theme={theme}
                placeholder={t('mobile:task.estimate')}
                button={t('mobile:edit.save')}
                initial={task.estimate === null ? '' : String(task.estimate)}
                keyboardType="decimal-pad"
                autoFocus
                onSend={(text) => {
                  const typed = text.trim().replace(',', '.')
                  const value = typed === '' ? null : Number(typed)
                  if (!attempt(() => setTaskEstimate(db, task.id, value)))
                    throw new Error('refused')
                  setPanel(null)
                }}
              />
            </View>
          )}
          {field(
            'milestone',
            t('mobile:task.milestone'),
            t('mobile:edit.changeMilestone'),
            valueText(task.milestoneName ?? t('mobile:edit.noMilestone'), task.milestoneId === null)
          )}
          {panel === 'milestone' && (
            <View style={[styles.panel, styles.chips, divider]}>
              <Chip
                label={t('mobile:edit.noMilestone')}
                theme={theme}
                selected={task.milestoneId === null}
                onPress={() => {
                  if (task.milestoneId === null) setPanel(null)
                  else if (attempt(() => setTaskMilestone(db, task.id, null))) setPanel(null)
                }}
              />
              {milestones.map((milestone) => (
                <Chip
                  key={milestone.id}
                  label={milestone.name}
                  theme={theme}
                  selected={milestone.id === task.milestoneId}
                  onPress={() => {
                    if (milestone.id === task.milestoneId) setPanel(null)
                    else if (attempt(() => setTaskMilestone(db, task.id, milestone.id)))
                      setPanel(null)
                  }}
                />
              ))}
            </View>
          )}
          {field(
            'labels',
            t('mobile:task.labels'),
            t('mobile:edit.changeLabels'),
            valueText(
              task.labels.length === 0 ? t('mobile:edit.noLabels') : task.labels.join(', '),
              task.labels.length === 0
            )
          )}
          {panel === 'labels' && (
            <View style={[styles.panel, divider]}>
              <View style={styles.chips}>
                {labelChoices.map((label) => {
                  const on = task.labels.includes(label)
                  return (
                    <Chip
                      key={label}
                      label={label}
                      theme={theme}
                      selected={on}
                      onPress={() =>
                        attempt(() =>
                          setTaskLabels(
                            db,
                            task.id,
                            on
                              ? task.labels.filter((name) => name !== label)
                              : [...task.labels, label]
                          )
                        )
                      }
                    />
                  )
                })}
              </View>
              <TextSender
                theme={theme}
                placeholder={t('mobile:edit.newLabel')}
                button={t('mobile:edit.add')}
                onSend={(text) => {
                  if (!attempt(() => setTaskLabels(db, task.id, [...task.labels, text])))
                    throw new Error('refused')
                }}
              />
            </View>
          )}
        </View>

        <View style={styles.page}>
          <View style={styles.headingRow}>
            <Text
              accessibilityRole="header"
              style={[styles.heading, styles.headingText, { color: theme.textSecondary }]}
            >
              {t('mobile:task.description')}
            </Text>
            {panel !== 'description' && (
              <Pressable
                accessibilityRole="button"
                onPress={() => toggle('description')}
                hitSlop={SPACE.medium}
              >
                <Text style={[styles.headingAction, { color: theme.accent }]}>
                  {t('mobile:edit.editDescription')}
                </Text>
              </Pressable>
            )}
          </View>
          {panel === 'description' ? (
            <>
              <TextSender
                theme={theme}
                placeholder={t('mobile:task.description')}
                button={t('mobile:edit.save')}
                initial={task.description}
                multiline
                autoFocus
                onSend={(text) => {
                  if (!attempt(() => setTaskDescription(db, task.id, text)))
                    throw new Error('refused')
                  setPanel(null)
                }}
              />
              <Chip
                label={t('mobile:taskMenu.cancel')}
                theme={theme}
                onPress={() => setPanel(null)}
              />
            </>
          ) : task.description.trim() ? (
            <Markdown theme={theme}>{task.description}</Markdown>
          ) : (
            <Text style={[styles.body, { color: theme.textMuted }]}>
              {t('mobile:task.noDescription')}
            </Text>
          )}

          <View style={styles.headingRow}>
            <Text
              accessibilityRole="header"
              style={[styles.heading, styles.headingText, { color: theme.textSecondary }]}
            >
              {t('mobile:task.checklist')}
            </Text>
            {lines.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  panel === 'checklist' ? t('mobile:edit.done') : t('mobile:edit.editChecklist')
                }
                onPress={() => {
                  setRenaming(null)
                  toggle('checklist')
                }}
                hitSlop={SPACE.medium}
              >
                <Text style={[styles.headingAction, { color: theme.accent }]}>
                  {panel === 'checklist' ? t('mobile:edit.done') : t('mobile:edit.editDescription')}
                </Text>
              </Pressable>
            )}
          </View>
          {panel === 'checklist' &&
            task.checklist.map((line, index) => (
              <View key={`${index}:${line.text}`} style={styles.checkRow}>
                {renaming === index ? (
                  <View style={styles.checkText}>
                    <TextSender
                      theme={theme}
                      placeholder={t('mobile:edit.checklistItem')}
                      button={t('mobile:edit.save')}
                      initial={line.text}
                      autoFocus
                      onSend={(text) => {
                        const next = [...lines]
                        next[index] = text
                        if (!saveChecklist(next, new Map([[line.text, text.trim()]])))
                          throw new Error('refused')
                        setRenaming(null)
                      }}
                    />
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityHint={t('mobile:edit.rename')}
                    onPress={() => setRenaming(index)}
                    style={styles.checkText}
                  >
                    <Text style={[styles.body, { color: theme.text }]}>{line.text}</Text>
                  </Pressable>
                )}
                {lineButton(
                  '↑',
                  t('mobile:edit.moveUp'),
                  () => moveLine(index, index - 1),
                  index === 0
                )}
                {lineButton(
                  '↓',
                  t('mobile:edit.moveDown'),
                  () => moveLine(index, index + 1),
                  index === lines.length - 1
                )}
                {lineButton('✕', t('mobile:edit.removeItem'), () => {
                  setRenaming(null)
                  saveChecklist(lines.filter((_, at) => at !== index))
                })}
              </View>
            ))}
          {panel !== 'checklist' &&
            task.checklist.map((line, index) => (
              <Pressable
                key={`${index}:${line.text}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: line.checked }}
                accessibilityLabel={line.text}
                onPress={() =>
                  attempt(() => setChecklistTick(db, task.id, line.text, !line.checked))
                }
                style={styles.checkRow}
              >
                <View
                  style={[
                    styles.box,
                    line.checked
                      ? { backgroundColor: theme.accent, borderColor: theme.accent }
                      : { backgroundColor: theme.surface, borderColor: theme.borderStrong }
                  ]}
                >
                  {line.checked && (
                    <Text style={[styles.tick, { color: theme.accentContrast }]}>✓</Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.body,
                    styles.checkText,
                    { color: line.checked ? theme.textMuted : theme.text },
                    line.checked && styles.struck
                  ]}
                >
                  {line.text}
                </Text>
              </Pressable>
            ))}
          <TextSender
            theme={theme}
            placeholder={t('mobile:edit.addChecklistItem')}
            button={t('mobile:edit.add')}
            onSend={(text) => {
              if (!saveChecklist([...lines, text])) throw new Error('refused')
            }}
          />

          <Text accessibilityRole="header" style={[styles.heading, { color: theme.textSecondary }]}>
            {t('mobile:task.comments')}
          </Text>
          {task.comments.length === 0 && (
            <Text style={[styles.body, { color: theme.textMuted }]}>
              {t('mobile:task.noComments')}
            </Text>
          )}
          {task.comments.map((comment) => (
            <View
              key={comment.id}
              style={[
                styles.comment,
                { backgroundColor: theme.surface, borderColor: theme.border }
              ]}
            >
              <View
                accessible
                accessibilityLabel={`${comment.author}, ${formatDateTime(comment.createdAt)}`}
                style={styles.commentHead}
              >
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: comment.byPerson ? theme.accentSubtle : theme.surfaceSunken }
                  ]}
                >
                  <Text
                    style={[
                      styles.avatarText,
                      { color: comment.byPerson ? theme.accent : theme.textMuted }
                    ]}
                  >
                    {comment.author.trim().charAt(0).toUpperCase() || '?'}
                  </Text>
                </View>
                <Text numberOfLines={1} style={[styles.author, { color: theme.text }]}>
                  {comment.author}
                </Text>
                <Text style={[styles.when, { color: theme.textMuted }]}>
                  {formatRelativeTime(comment.createdAt)}
                </Text>
              </View>
              <Markdown theme={theme}>{comment.body}</Markdown>
            </View>
          ))}
          <TextSender
            theme={theme}
            placeholder={t('mobile:edit.commentLabel')}
            button={t('mobile:edit.post')}
            multiline
            onSend={(text) => {
              if (!attempt(() => void addTaskComment(db, task.id, text))) throw new Error('refused')
            }}
          />
        </View>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { paddingVertical: SPACE.large, gap: SPACE.large },
  page: { paddingHorizontal: SPACE.large, gap: SPACE.small },
  missing: { paddingTop: SPACE.large },
  title: { fontSize: 20, fontWeight: '700' },
  notice: { padding: SPACE.small, borderRadius: RADIUS, fontSize: 14 },
  wontDo: {
    gap: SPACE.small,
    padding: SPACE.medium,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    alignItems: 'flex-start'
  },
  group: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.medium,
    minHeight: 48,
    paddingHorizontal: SPACE.large,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: -StyleSheet.hairlineWidth
  },
  factLabel: { fontSize: 13, width: 104 },
  factValueRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.small },
  factValue: { fontSize: 15, flexShrink: 1 },
  chevron: { fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  panel: {
    paddingHorizontal: SPACE.large,
    paddingVertical: SPACE.small,
    gap: SPACE.small,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.medium,
    minHeight: 44,
    paddingHorizontal: SPACE.medium,
    borderRadius: RADIUS
  },
  heading: { fontSize: 13, fontWeight: '600', marginTop: SPACE.small },
  headingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACE.medium },
  headingText: { flex: 1 },
  headingAction: { fontSize: 14, fontWeight: '600' },
  body: { fontSize: 15 },
  checkRow: { flexDirection: 'row', gap: SPACE.medium, alignItems: 'center', minHeight: 44 },
  box: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center'
  },
  tick: { fontSize: 13, fontWeight: '700', lineHeight: 15 },
  checkText: { flex: 1 },
  struck: { textDecorationLine: 'line-through' },
  lineButton: {
    width: 40,
    height: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    alignItems: 'center',
    justifyContent: 'center'
  },
  lineGlyph: { fontSize: 16, fontWeight: '600' },
  comment: {
    gap: SPACE.small,
    padding: SPACE.medium,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS
  },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.small },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarText: { fontSize: 12, fontWeight: '700' },
  author: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  when: { fontSize: 12 }
})
