import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDate, formatIsoDateShort, shiftIsoDate } from '@shared/dates'
import { formatRelativeTime } from '@shared/format'
import {
  WEEKLY_REVIEW_STEPS,
  type HomeTask,
  type WeeklyReview as Review,
  type WeeklyReviewMilestone,
  type WeeklyReviewStepId,
  type WeeklyReviewTask
} from '@shared/ostler-api'
import {
  allDismissed,
  EMPTY_PROGRESS,
  reviewCounts,
  stepIds,
  type ReviewProgress
} from '@shared/planning/weekly-review-progress'
import {
  closeTaskAsWontDo,
  setTaskDueDate,
  setTaskSomeday,
  unarchiveTask,
  type EditDb
} from '../data/edits'
import type { InboxDb } from '../data/inbox'
import { projectColor, projectName } from '../data/project-display'
import { today as todayOf, type QueryDb } from '../data/queries'
import { finishWeeklyReview, weeklyReview } from '../data/weekly-review'
import { RADIUS, SPACE, useTheme, type Theme } from '../theme'
import { Chip, editErrorText } from './EditBits'
import { TopBar } from './TopBar'

interface Props {
  db: EditDb & QueryDb & InboxDb
  version: number
  onBack: () => void
  onOpenTask: (taskId: string) => void
  onOpenMilestones: (projectId: string) => void
  onOpenInbox: () => void
  onEdited: () => void
}

const STEP_TITLE: Record<WeeklyReviewStepId, string> = {
  inbox: 'views:weeklyReview.step.inbox',
  overdue: 'views:weeklyReview.step.overdue',
  blocked: 'views:weeklyReview.step.blocked',
  stale: 'views:weeklyReview.step.stale',
  someday: 'views:weeklyReview.step.someday',
  upcoming: 'views:weeklyReview.step.upcoming',
  milestones: 'views:weeklyReview.step.milestones'
}

const STEP_DESCRIPTION: Record<WeeklyReviewStepId, string> = {
  inbox: 'views:weeklyReview.describe.inbox',
  overdue: 'views:weeklyReview.describe.overdue',
  blocked: 'views:weeklyReview.describe.blocked',
  stale: 'views:weeklyReview.describe.stale',
  someday: 'views:weeklyReview.describe.someday',
  upcoming: 'views:weeklyReview.describe.upcoming',
  milestones: 'views:weeklyReview.describe.milestones'
}

const UNDO_MS = 5000
const DAY_MS = 86_400_000

/** Where the person is in the review; kept while the app runs, so leaving and coming back resumes. */
let kept: ReviewProgress = EMPTY_PROGRESS

const info = {
  name: (id: string) => projectName({ id, name: null }),
  color: (id: string) => projectColor({ id, color: null })
}

/**
 * The weekly review (the PC's, N1.5): one step at a time across every project on the phone, with
 * Back, Skip and Next. Each task's action is one tap with Undo; Finish records the counts, which
 * sync, so the PC's Home knows the review was done.
 */
export function WeeklyReview({
  db,
  version,
  onBack,
  onOpenTask,
  onOpenMilestones,
  onOpenInbox,
  onEdited
}: Props) {
  const theme = useTheme()
  const [progress, setProgressState] = useState<ReviewProgress>(kept)
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState<{ text: string; undo: (() => void) | null } | null>(null)
  const [finished, setFinished] = useState(false)
  const today = todayOf()
  const review = useMemo(
    () => (version >= 0 ? weeklyReview(db, info, today) : null),
    [db, version, today]
  )
  const step = WEEKLY_REVIEW_STEPS[progress.step]
  const dismissed = allDismissed(progress)

  const setProgress = (change: (current: ReviewProgress) => ReviewProgress) =>
    setProgressState((current) => {
      const next = change(current)
      kept = next
      return next
    })

  // A step's counts start from what it showed when it was first opened.
  useEffect(() => {
    if (!review) return
    if (step === 'inbox') {
      if (progress.inboxShown === null)
        setProgress((current) => ({ ...current, inboxShown: review.inboxCount }))
    } else if (!progress.shown[step]) {
      const ids = stepIds(review, step)
      setProgress((current) => ({ ...current, shown: { ...current.shown, [step]: ids } }))
    }
  }, [review, step])

  useEffect(() => {
    if (done === null) return
    const timer = setTimeout(() => setDone(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [done])

  const go = (index: number, skip = false) =>
    setProgress((current) => ({
      ...current,
      step: index,
      skipped: skip
        ? [...new Set([...current.skipped, step])]
        : current.skipped.filter((id) => id !== step)
    }))

  /** Runs a task change; the snackbar's Undo runs `undo`. */
  const act = (run: () => void, text: string, undo: () => void) => {
    try {
      run()
    } catch (error) {
      setFailure(editErrorText(error))
      return
    }
    setFailure(null)
    onEdited()
    setDone({
      text,
      undo: () => {
        try {
          undo()
          onEdited()
        } catch (error) {
          setFailure(editErrorText(error))
        }
      }
    })
  }

  const someday = (task: HomeTask, value: boolean) =>
    act(
      () => setTaskSomeday(db, task.id, value),
      t(value ? 'tasks:someday.moved' : 'tasks:someday.broughtBack', { title: task.title }),
      () => setTaskSomeday(db, task.id, !value)
    )
  const wontDo = (task: HomeTask) =>
    act(
      () => closeTaskAsWontDo(db, task.id, ''),
      t('tasks:wontDo.closed', { title: task.title }),
      () => unarchiveTask(db, task.id)
    )
  const moveDue = (task: HomeTask, date: string) =>
    act(
      () => setTaskDueDate(db, task.id, date),
      t('mobile:review.moved', { title: task.title, date: formatIsoDateShort(date) }),
      () => setTaskDueDate(db, task.id, task.targetDate)
    )
  /** Still on and Keep: leaves it off this review only. */
  const leaveOff = (task: HomeTask, words: string) => {
    const at = step
    setProgress((current) => ({
      ...current,
      dismissed: { ...current.dismissed, [at]: [...(current.dismissed[at] ?? []), task.id] }
    }))
    setDone({
      text: words,
      undo: () =>
        setProgress((current) => ({
          ...current,
          dismissed: {
            ...current.dismissed,
            [at]: (current.dismissed[at] ?? []).filter((id) => id !== task.id)
          }
        }))
    })
  }

  const finish = () => {
    if (!review) return
    try {
      finishWeeklyReview(db, info, reviewCounts(progress, review))
    } catch {
      setFailure(t('views:weeklyReview.couldntFinish'))
      return
    }
    kept = EMPTY_PROGRESS
    setProgressState(EMPTY_PROGRESS)
    setFinished(true)
    onEdited()
  }

  const last = progress.step === WEEKLY_REVIEW_STEPS.length - 1
  const count = !review
    ? null
    : step === 'inbox'
      ? review.inboxCount
      : stepIds(review, step).filter((id) => !dismissed.has(id)).length

  return (
    <View style={styles.page}>
      <TopBar theme={theme} title={t('views:weeklyReview.start')} onBack={onBack} />
      {finished ? (
        <View style={styles.finished}>
          <Text style={[styles.heading, { color: theme.text }]}>
            {t('views:weeklyReview.finished')}
          </Text>
          <Text style={[styles.describe, { color: theme.textSecondary }]}>
            {t('mobile:review.finishedBody')}
          </Text>
          <View style={styles.row}>
            <Chip label={t('mobile:review.done')} theme={theme} selected onPress={onBack} />
          </View>
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.steps}
            accessibilityLabel={t('views:weeklyReview.steps')}
          >
            {WEEKLY_REVIEW_STEPS.map((id, index) => {
              const current = index === progress.step
              const skipped = progress.skipped.includes(id)
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current }}
                  onPress={() => go(index)}
                  style={[
                    styles.stepDot,
                    {
                      backgroundColor: current
                        ? theme.accent
                        : index < progress.step
                          ? theme.accentSubtle
                          : theme.surfaceSunken
                    }
                  ]}
                >
                  <Text
                    style={[
                      styles.stepNumber,
                      { color: current ? theme.accentContrast : theme.textSecondary },
                      skipped && styles.skipped
                    ]}
                  >
                    {index + 1}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={[styles.meta, { color: theme.textMuted }]}>
              {t('views:weeklyReview.stepOf', {
                step: progress.step + 1,
                total: WEEKLY_REVIEW_STEPS.length
              })}
            </Text>
            <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
              {count === null
                ? t(STEP_TITLE[step])
                : t('views:weeklyReview.titleWithCount', { title: t(STEP_TITLE[step]), count })}
            </Text>
            <Text style={[styles.describe, { color: theme.textSecondary }]}>
              {t(STEP_DESCRIPTION[step])}
            </Text>
            {failure !== null && (
              <Text
                style={[
                  styles.failure,
                  { color: theme.danger, backgroundColor: theme.dangerSubtle }
                ]}
              >
                {failure}
              </Text>
            )}
            {review && (
              <StepBody
                step={step}
                review={review}
                dismissed={dismissed}
                today={today}
                theme={theme}
                actions={{
                  open: (task) => onOpenTask(task.id),
                  openMilestone: (milestone) => onOpenMilestones(milestone.projectId),
                  openInbox: onOpenInbox,
                  someday,
                  wontDo,
                  moveDue,
                  leaveOff
                }}
              />
            )}
          </ScrollView>
          <View
            style={[styles.footer, { borderColor: theme.border, backgroundColor: theme.surface }]}
          >
            <Chip
              label={t('views:weeklyReview.back')}
              theme={theme}
              onPress={() => progress.step > 0 && go(progress.step - 1)}
            />
            <View style={styles.forward}>
              {!last && (
                <Chip
                  label={t('views:weeklyReview.skip')}
                  theme={theme}
                  onPress={() => go(progress.step + 1, true)}
                />
              )}
              {last ? (
                <Chip
                  label={t('views:weeklyReview.finish')}
                  theme={theme}
                  selected
                  onPress={finish}
                />
              ) : (
                <Chip
                  label={t('views:weeklyReview.next')}
                  theme={theme}
                  selected
                  onPress={() => go(progress.step + 1)}
                />
              )}
            </View>
          </View>
        </>
      )}
      {done !== null && (
        <View style={[styles.snack, { backgroundColor: theme.text }]}>
          <Text style={[styles.snackText, { color: theme.surface }]} numberOfLines={2}>
            {done.text}
          </Text>
          {done.undo !== null && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const undo = done.undo
                setDone(null)
                undo?.()
              }}
              hitSlop={8}
            >
              <Text style={[styles.snackAction, { color: theme.accentSubtle }]}>
                {t('mobile:inbox.undo')}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  )
}

interface StepActions {
  open(task: HomeTask): void
  openMilestone(milestone: WeeklyReviewMilestone): void
  openInbox(): void
  someday(task: HomeTask, value: boolean): void
  wontDo(task: HomeTask): void
  moveDue(task: HomeTask, date: string): void
  leaveOff(task: HomeTask, words: string): void
}

function StepBody({
  step,
  review,
  dismissed,
  today,
  theme,
  actions
}: {
  step: WeeklyReviewStepId
  review: Review
  dismissed: Set<string>
  today: string
  theme: Theme
  actions: StepActions
}) {
  const now = Date.now()
  const tasks = (list: WeeklyReviewTask[]) => list.filter((task) => !dismissed.has(task.id))
  const nothing = (
    <Text style={[styles.empty, { color: theme.textMuted }]}>
      {t('views:weeklyReview.nothingHere')}
    </Text>
  )
  const list = (
    items: WeeklyReviewTask[],
    meta: (task: WeeklyReviewTask) => string | null,
    buttons: (task: WeeklyReviewTask) => { label: string; onPress: () => void }[]
  ) =>
    items.length === 0 ? (
      nothing
    ) : (
      <View style={styles.list}>
        {items.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            theme={theme}
            meta={meta(task)}
            buttons={[
              { label: t('views:weeklyReview.open'), onPress: () => actions.open(task) },
              ...buttons(task)
            ]}
          />
        ))}
      </View>
    )
  const somedayButton = (task: HomeTask) => ({
    label: t('views:weeklyReview.someday'),
    onPress: () => actions.someday(task, true)
  })
  const wontDoButton = (task: HomeTask) => ({
    label: t('tasks:wontDo.mark'),
    onPress: () => actions.wontDo(task)
  })
  switch (step) {
    case 'inbox':
      return (
        <View style={styles.list}>
          <Text style={[styles.describe, { color: theme.text }]}>
            {review.inboxCount === 0
              ? t('views:weeklyReview.nothingHere')
              : t('views:weeklyReview.inboxWaiting', { count: review.inboxCount })}
          </Text>
          <View style={styles.row}>
            <Chip
              label={t('views:weeklyReview.openInbox')}
              theme={theme}
              onPress={actions.openInbox}
            />
          </View>
        </View>
      )
    case 'overdue':
      return list(
        tasks(review.overdue),
        (task) => t('views:weeklyReview.due', { date: formatIsoDateShort(task.targetDate!) }),
        (task) => [
          {
            label: t('mobile:edit.tomorrow'),
            onPress: () => actions.moveDue(task, shiftIsoDate(today, 1))
          },
          {
            label: t('mobile:edit.nextWeek'),
            onPress: () => actions.moveDue(task, shiftIsoDate(today, 7))
          },
          somedayButton(task),
          wontDoButton(task)
        ]
      )
    case 'blocked':
      return list(
        tasks(review.blocked),
        (task) =>
          t('views:weeklyReview.waited', {
            count: Math.max(1, Math.floor((now - task.since) / DAY_MS))
          }),
        (task) => [wontDoButton(task)]
      )
    case 'stale':
      return list(
        tasks(review.stale),
        (task) => t('views:weeklyReview.updated', { when: formatRelativeTime(task.since, now) }),
        (task) => [
          somedayButton(task),
          wontDoButton(task),
          {
            label: t('views:weeklyReview.stillOn'),
            onPress: () =>
              actions.leaveOff(task, t('views:weeklyReview.stillOnDone', { title: task.title }))
          }
        ]
      )
    case 'someday':
      return list(
        tasks(review.someday),
        (task) => t('views:weeklyReview.made', { when: formatRelativeTime(task.since, now) }),
        (task) => [
          { label: t('tasks:someday.bringBack'), onPress: () => actions.someday(task, false) },
          {
            label: t('views:weeklyReview.keep'),
            onPress: () =>
              actions.leaveOff(task, t('views:weeklyReview.keptDone', { title: task.title }))
          },
          wontDoButton(task)
        ]
      )
    case 'upcoming':
      if (review.upcoming.length === 0) return nothing
      return (
        <View style={styles.list}>
          {review.upcoming.map((day) => (
            <View key={day.date} style={styles.list}>
              <Text style={[styles.dayName, { color: theme.textSecondary }]}>
                {day.date === today
                  ? t('views:weeklyReview.today')
                  : formatIsoDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}
              </Text>
              {day.milestones.map((milestone) => (
                <MilestoneCard
                  key={milestone.milestoneId}
                  milestone={milestone}
                  theme={theme}
                  onOpen={() => actions.openMilestone(milestone)}
                />
              ))}
              {day.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  theme={theme}
                  meta={null}
                  buttons={[
                    { label: t('views:weeklyReview.open'), onPress: () => actions.open(task) }
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      )
    case 'milestones':
      if (review.milestones.length === 0) return nothing
      return (
        <View style={styles.list}>
          {review.milestones.map((milestone) => (
            <MilestoneCard
              key={milestone.milestoneId}
              milestone={milestone}
              theme={theme}
              onOpen={() => actions.openMilestone(milestone)}
            />
          ))}
        </View>
      )
  }
}

function TaskCard({
  task,
  theme,
  meta,
  buttons
}: {
  task: HomeTask
  theme: Theme
  meta: string | null
  buttons: { label: string; onPress: () => void }[]
}) {
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.cardHead}>
        <View style={[styles.swatch, { backgroundColor: task.projectColor }]} />
        <Text style={[styles.meta, styles.grow, { color: theme.textMuted }]} numberOfLines={1}>
          {[task.projectName, meta].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text style={[styles.title, { color: theme.text }]}>{task.title}</Text>
      <View style={styles.row}>
        {buttons.map((button) => (
          <Chip key={button.label} label={button.label} theme={theme} onPress={button.onPress} />
        ))}
      </View>
    </View>
  )
}

function MilestoneCard({
  milestone,
  theme,
  onOpen
}: {
  milestone: WeeklyReviewMilestone
  theme: Theme
  onOpen: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('views:weeklyReview.openMilestone', { name: milestone.name })}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? theme.surfaceSunken : theme.surface,
          borderColor: theme.warning
        }
      ]}
    >
      <View style={styles.cardHead}>
        <View style={[styles.swatch, { backgroundColor: milestone.projectColor }]} />
        <Text style={[styles.meta, styles.grow, { color: theme.textMuted }]} numberOfLines={1}>
          {[
            milestone.projectName,
            milestone.targetDate ? formatIsoDateShort(milestone.targetDate) : null
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Text style={[styles.title, { color: theme.text }]}>
        {t('views:weeklyReview.milestone', { name: milestone.name })}
      </Text>
      {milestone.reason !== '' && (
        <Text style={[styles.describe, { color: theme.textSecondary }]}>{milestone.reason}</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  steps: { gap: SPACE.small, paddingHorizontal: SPACE.large, paddingVertical: SPACE.small },
  stepDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepNumber: { fontSize: 15, fontWeight: '700' },
  skipped: { textDecorationLine: 'line-through' },
  body: { padding: SPACE.large, gap: SPACE.small, paddingBottom: 120 },
  heading: { fontSize: 20, fontWeight: '700' },
  describe: { fontSize: 15, lineHeight: 21 },
  meta: { fontSize: 12 },
  failure: { padding: SPACE.small, borderRadius: RADIUS, fontSize: 14 },
  empty: { fontSize: 15, paddingVertical: SPACE.medium },
  list: { gap: SPACE.small, marginTop: SPACE.small },
  dayName: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginTop: SPACE.small },
  card: { borderWidth: 1, borderRadius: RADIUS, padding: SPACE.medium, gap: SPACE.small },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.small },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  grow: { flex: 1 },
  title: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACE.medium,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  forward: { flexDirection: 'row', gap: SPACE.small },
  finished: { padding: SPACE.large, gap: SPACE.medium },
  snack: {
    position: 'absolute',
    left: SPACE.large,
    right: SPACE.large,
    bottom: 80,
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
