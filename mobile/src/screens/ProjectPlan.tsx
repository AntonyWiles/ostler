import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDateShort } from '@shared/dates'
import { today, type TaskSummary } from '../data/queries'
import type {
  DecisionSummary,
  GoalSummary,
  MilestoneSummary,
  SignOffSummary
} from '../data/plan'
import { RADIUS, SPACE, type Theme } from '../theme'
import { Chip, TextSender } from './EditBits'
import { TaskRow } from './TaskRow'

/** A bordered card that opens and closes on a tap. */
function Card({
  theme,
  label,
  open,
  onToggle,
  children
}: {
  theme: Theme
  label: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      {children}
    </Pressable>
  )
}

function Muted({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <Text style={[styles.muted, { color: theme.textMuted }]}>{children}</Text>
}

function Empty({ theme, text }: { theme: Theme; text: string }) {
  return <Text style={[styles.empty, { color: theme.textMuted }]}>{text}</Text>
}

const MILESTONE_STATUS: Record<MilestoneSummary['status'], string> = {
  planned: 'mobile:plan.milestonePlanned',
  active: 'mobile:plan.milestoneActive',
  complete: 'mobile:plan.milestoneComplete',
  archived: 'mobile:plan.milestoneComplete'
}

/** The project's milestones; one opens to show its outcome and tasks. */
export function MilestoneList({
  theme,
  items,
  tasksOf,
  onOpenTask
}: {
  theme: Theme
  items: MilestoneSummary[]
  tasksOf: (milestoneId: string) => TaskSummary[]
  onOpenTask: (taskId: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  if (items.length === 0) return <Empty theme={theme} text={t('mobile:plan.noMilestones')} />
  return (
    <View style={styles.list}>
      {items.map((milestone) => {
        const shown = open === milestone.id
        const share = milestone.total === 0 ? 0 : milestone.done / milestone.total
        const late =
          milestone.status !== 'complete' &&
          milestone.targetDate !== null &&
          milestone.targetDate < today()
        return (
          <Card
            key={milestone.id}
            theme={theme}
            label={milestone.name}
            open={shown}
            onToggle={() => setOpen(shown ? null : milestone.id)}
          >
            <View style={styles.headRow}>
              <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
                {milestone.name}
              </Text>
              <Text style={[styles.badge, { color: theme.textSecondary }]}>
                {t(MILESTONE_STATUS[milestone.status])}
              </Text>
            </View>
            <Muted theme={theme}>
              {[
                milestone.targetDate
                  ? t('mobile:project.due', { date: formatIsoDateShort(milestone.targetDate) })
                  : t('mobile:plan.noDate'),
                t('mobile:plan.progress', { done: milestone.done, total: milestone.total })
              ].join(' · ')}
            </Muted>
            <View style={[styles.bar, { backgroundColor: theme.border }]}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${Math.round(share * 100)}%`,
                    backgroundColor: late ? theme.danger : theme.success
                  }
                ]}
              />
            </View>
            {shown && (
              <View style={styles.more}>
                {milestone.outcome.trim() !== '' && (
                  <Text style={[styles.body, { color: theme.textSecondary }]}>
                    {milestone.outcome}
                  </Text>
                )}
                {tasksOf(milestone.id).map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    theme={theme}
                    onPress={() => onOpenTask(task.id)}
                  />
                ))}
              </View>
            )}
          </Card>
        )
      })}
    </View>
  )
}

/** The project's decisions; one opens to show its context, alternatives and consequences. */
export function DecisionList({ theme, items }: { theme: Theme; items: DecisionSummary[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (items.length === 0) return <Empty theme={theme} text={t('mobile:plan.noDecisions')} />
  const part = (heading: string, text: string) =>
    text.trim() === '' ? null : (
      <View key={heading}>
        <Text style={[styles.subhead, { color: theme.textSecondary }]}>{heading}</Text>
        <Text style={[styles.body, { color: theme.text }]}>{text}</Text>
      </View>
    )
  return (
    <View style={styles.list}>
      {items.map((decision) => {
        const shown = open === decision.id
        return (
          <Card
            key={decision.id}
            theme={theme}
            label={decision.title}
            open={shown}
            onToggle={() => setOpen(shown ? null : decision.id)}
          >
            <Text style={[styles.title, { color: theme.text }]}>{decision.title}</Text>
            <Muted theme={theme}>{formatIsoDateShort(decision.date)}</Muted>
            <Text
              style={[styles.body, { color: theme.textSecondary }]}
              numberOfLines={shown ? undefined : 3}
            >
              {decision.decision}
            </Text>
            {shown && (
              <View style={styles.more}>
                {part(t('mobile:plan.context'), decision.context)}
                {part(t('mobile:plan.alternatives'), decision.alternatives)}
                {part(t('mobile:plan.consequences'), decision.consequences)}
              </View>
            )}
          </Card>
        )
      })}
    </View>
  )
}

const SIGN_OFF_STATE: Record<SignOffSummary['state'], string> = {
  waiting: 'mobile:plan.signOffWaiting',
  approved: 'mobile:plan.signOffApproved',
  changes: 'mobile:plan.signOffChanges'
}

const SIGN_OFF_KIND: Record<SignOffSummary['itemKind'], string> = {
  task: 'mobile:plan.kindTask',
  milestone: 'mobile:plan.kindMilestone',
  decision: 'mobile:plan.kindDecision'
}

/** The project's sign-offs; the ones asked of this phone's person can be answered here. */
export function SignOffList({
  theme,
  items,
  onAnswer,
  onOpenTask
}: {
  theme: Theme
  items: SignOffSummary[]
  onAnswer: (id: string, answer: 'approved' | 'changes', note: string) => void
  onOpenTask: (taskId: string) => void
}) {
  const [sendingBack, setSendingBack] = useState<string | null>(null)
  if (items.length === 0) return <Empty theme={theme} text={t('mobile:plan.noSignOffs')} />
  return (
    <View style={styles.list}>
      {items.map((signOff) => {
        const stateColor =
          signOff.state === 'approved'
            ? theme.success
            : signOff.state === 'changes'
              ? theme.danger
              : theme.warning
        return (
          <Card
            key={signOff.id}
            theme={theme}
            label={signOff.itemTitle}
            open={false}
            onToggle={() => {
              if (signOff.itemKind === 'task' && signOff.itemTitle !== '')
                onOpenTask(signOff.itemId)
            }}
          >
            <View style={styles.headRow}>
              <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
                {signOff.itemTitle || t('mobile:plan.itemGone')}
              </Text>
              <Text style={[styles.badge, { color: stateColor }]}>
                {t(SIGN_OFF_STATE[signOff.state])}
              </Text>
            </View>
            <Muted theme={theme}>
              {t('mobile:plan.signOffLine', {
                kind: t(SIGN_OFF_KIND[signOff.itemKind]),
                name: signOff.approverName
              })}
            </Muted>
            {signOff.note.trim() !== '' && (
              <Text style={[styles.body, { color: theme.textSecondary }]}>{signOff.note}</Text>
            )}
            {signOff.canAnswer && (
              <View style={styles.actions}>
                <Chip
                  label={t('mobile:plan.approve')}
                  theme={theme}
                  onPress={() => onAnswer(signOff.id, 'approved', '')}
                />
                <Chip
                  label={t('mobile:plan.sendBack')}
                  theme={theme}
                  selected={sendingBack === signOff.id}
                  onPress={() => setSendingBack(sendingBack === signOff.id ? null : signOff.id)}
                />
              </View>
            )}
            {signOff.canAnswer && sendingBack === signOff.id && (
              <TextSender
                theme={theme}
                placeholder={t('mobile:plan.sendBackNote')}
                button={t('mobile:plan.sendBack')}
                multiline
                autoFocus
                onSend={(note) => {
                  onAnswer(signOff.id, 'changes', note)
                  setSendingBack(null)
                }}
              />
            )}
          </Card>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: SPACE.small, paddingHorizontal: SPACE.large, paddingTop: SPACE.medium },
  card: {
    borderWidth: 1,
    borderRadius: RADIUS,
    padding: SPACE.medium,
    gap: SPACE.small
  },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.small },
  title: { fontSize: 16, fontWeight: '600', flex: 1 },
  badge: { fontSize: 12, fontWeight: '600' },
  muted: { fontSize: 13 },
  body: { fontSize: 14, lineHeight: 20 },
  subhead: { fontSize: 12, fontWeight: '600', marginTop: SPACE.small },
  more: { gap: SPACE.small },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small },
  empty: { fontSize: 15, marginHorizontal: SPACE.large, marginTop: SPACE.medium }
})

const GOAL_STATUS: Record<string, string> = {
  active: 'mobile:plan.goalActive',
  achieved: 'mobile:plan.goalAchieved',
  archived: 'mobile:plan.goalArchived'
}

/** The project's goals, with how far each measure has come; a measured goal takes a check-in. */
export function GoalList({
  theme,
  items,
  onCheckIn
}: {
  theme: Theme
  items: GoalSummary[]
  onCheckIn: (goalId: string, value: number) => void
}) {
  const [checking, setChecking] = useState<string | null>(null)
  if (items.length === 0) return <Empty theme={theme} text={t('mobile:plan.noGoals')} />
  return (
    <View style={styles.list}>
      {items.map((goal) => {
        const measured = goal.target !== null && goal.start !== null
        const current = goal.latest?.value ?? goal.start
        const span = measured ? (goal.target as number) - (goal.start as number) : 0
        const share =
          measured && span !== 0 && current !== null
            ? Math.max(0, Math.min(1, (current - (goal.start as number)) / span))
            : 0
        const unit = goal.unit ? ` ${goal.unit}` : ''
        return (
          <Card
            key={goal.id}
            theme={theme}
            label={goal.title}
            open={checking === goal.id}
            onToggle={() => {}}
          >
            <View style={styles.headRow}>
              <Text style={[styles.title, { color: theme.text }]}>{goal.title}</Text>
              <Text style={[styles.badge, { color: theme.textSecondary }]}>
                {t(GOAL_STATUS[goal.status] ?? 'mobile:plan.goalActive')}
              </Text>
            </View>
            {goal.outcome.trim() !== '' && (
              <Text style={[styles.body, { color: theme.textSecondary }]}>{goal.outcome}</Text>
            )}
            {measured && (
              <>
                <Muted theme={theme}>
                  {t('mobile:plan.goalMeasure', {
                    current: `${current ?? '–'}${unit}`,
                    target: `${goal.target}${unit}`
                  })}
                  {goal.targetDate
                    ? ` · ${t('mobile:project.due', { date: formatIsoDateShort(goal.targetDate) })}`
                    : ''}
                  {goal.latest
                    ? ` · ${t('mobile:plan.lastCheckIn', { date: formatIsoDateShort(goal.latest.date) })}`
                    : ''}
                </Muted>
                <View style={[styles.bar, { backgroundColor: theme.border }]}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${Math.round(share * 100)}%`, backgroundColor: theme.accent }
                    ]}
                  />
                </View>
                {goal.status === 'active' && (
                  <View style={styles.actions}>
                    <Chip
                      label={t('mobile:plan.checkIn')}
                      theme={theme}
                      selected={checking === goal.id}
                      onPress={() => setChecking(checking === goal.id ? null : goal.id)}
                    />
                  </View>
                )}
                {checking === goal.id && (
                  <TextSender
                    theme={theme}
                    placeholder={t('mobile:plan.checkInValue', { unit: goal.unit ?? '' })}
                    button={t('mobile:plan.record')}
                    keyboardType="decimal-pad"
                    autoFocus
                    onSend={(text) => {
                      const value = Number(text.replace(',', '.'))
                      if (!Number.isFinite(value)) throw new Error('not a number')
                      onCheckIn(goal.id, value)
                      setChecking(null)
                    }}
                  />
                )}
              </>
            )}
            {goal.milestoneCount > 0 && (
              <Muted theme={theme}>
                {t('mobile:plan.goalMilestones', { count: goal.milestoneCount })}
              </Muted>
            )}
          </Card>
        )
      })}
    </View>
  )
}
