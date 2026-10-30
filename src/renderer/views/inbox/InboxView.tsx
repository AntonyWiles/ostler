import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { InboxEntry, InboxItemKind, InboxList, Result } from '@shared/ostler-api'
import { useOstler } from '../../context/OstlerContext'
import { useHomeFeed } from '../../hooks/useHomeFeed'
import { useUndoImport } from '../../hooks/useUndoImport'
import {
  inboxPath,
  projectPath,
  settingsPath,
  taskPath,
  itemPath,
  weeklyReviewPath,
  statusUpdatePath
} from '../../navigation/paths'
import {
  Button,
  EmptyState,
  IconButton,
  InlineAlert,
  Menu,
  PageHeader,
  SegmentedControl,
  Skeleton,
  useToast
} from '../../ui'
import { absoluteTimeText, relativeTimeText } from '../../ui/date-text'
import {
  Archive,
  Ban,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  CircleAlert,
  ClipboardCheck,
  Clock,
  Download,
  Eye,
  FileInput,
  GitCommitHorizontal,
  X,
  ClipboardList,
  Gauge,
  HardDrive,
  Icon,
  Inbox,
  Mail,
  MailOpen,
  Megaphone,
  MessageSquare,
  Play,
  Repeat,
  Undo2,
  Zap,
  type LucideIcon
} from '../../ui/icons'
import './InboxView.css'
import { joinSentences, t } from '@shared/i18n'
import { agentRunStateLabel } from '@shared/agent-run-state'
import { ProjectMark } from '../../components/ProjectMark'
import { PlanDialog } from '../planning/PlanDialog'

const KINDS: Record<InboxItemKind, { label: string; icon: LucideIcon }> = {
  mention: {
    get label() {
      return t('views:inboxView.mention')
    },
    icon: MessageSquare
  },
  signOff: {
    get label() {
      return t('views:inboxView.signOff')
    },
    icon: ClipboardCheck
  },
  triage: {
    get label() {
      return t('views:inboxView.triage')
    },
    icon: Inbox
  },
  plan: {
    get label() {
      return t('views:inboxView.plan')
    },
    icon: ClipboardList
  },
  round: {
    get label() {
      return t('views:inboxView.round')
    },
    icon: Repeat
  },
  scheduled: {
    get label() {
      return t('views:inboxView.scheduled')
    },
    icon: Repeat
  },
  commit: {
    get label() {
      return t('views:inboxView.commit')
    },
    icon: GitCommitHorizontal
  },
  statusUpdate: {
    get label() {
      return t('views:inboxView.statusUpdate')
    },
    icon: Megaphone
  },
  weeklyReview: {
    get label() {
      return t('views:inboxView.weeklyReview')
    },
    icon: ClipboardCheck
  },
  backupCopy: {
    get label() {
      return t('views:inboxView.backupCopy')
    },
    icon: HardDrive
  },
  rule: {
    get label() {
      return t('views:inboxView.rule')
    },
    icon: Zap
  },
  agentLimit: {
    get label() {
      return t('views:inboxView.agentLimit')
    },
    icon: Gauge
  },
  reminder: {
    get label() {
      return t('views:inboxView.reminder')
    },
    icon: Bell
  },
  question: {
    get label() {
      return t('views:inboxView.agentQuestion')
    },
    icon: CircleAlert
  },
  review: {
    get label() {
      return agentRunStateLabel('inReview')
    },
    icon: Eye
  },
  blocker: {
    get label() {
      return t('views:inboxView.blockerReported')
    },
    icon: Ban
  },
  import: {
    get label() {
      return t('views:inboxView.import')
    },
    icon: FileInput
  },
  update: {
    get label() {
      return t('views:inboxView.update')
    },
    icon: Download
  }
}

/**
 * The Inbox (P5.6): what
 * happened that wants attention, newest first, across every project.
 * Reminders that fired, agent questions, reviews waiting and blockers
 * reported, imports (P6.1) and a downloaded update (P10.1). Items can be opened,
 * marked read or unread,
 * archived (with undo); reminders can be snoozed and imports undone.
 */
export function InboxView() {
  const navigate = useNavigate()
  const { projects } = useOstler()
  const { toast, toastUndo } = useToast()
  const feed = useHomeFeed(() => window.ostlerAPI.getInbox(), [], 'inbox')
  const undoImport = useUndoImport()
  const [show, setShow] = useState<'all' | 'unread'>('all')
  // A plan waiting for approval opens in its dialog, here (N9.3b).
  const [openPlan, setOpenPlan] = useState<{ projectId: string; sessionId: string } | null>(null)
  const list = feed.value

  /** Runs an Inbox change and shows its result at once. */
  const change = async (call: Promise<Result<InboxList>>, failure: string) => {
    const result = await call
    if (result.ok) feed.setValue(result.value)
    else toast({ title: failure, body: result.error, tone: 'danger' })
    return result.ok
  }

  const open = (item: InboxEntry) => {
    if (item.readAt === null)
      void change(
        window.ostlerAPI.setInboxRead([item.key], true),
        t('views:inboxView.couldntMarkRead')
      )
    if (item.kind === 'plan' && item.projectId && item.sessionId)
      setOpenPlan({ projectId: item.projectId, sessionId: item.sessionId })
    else if (item.kind === 'update') navigate(settingsPath('about'))
    else if (item.kind === 'backupCopy') navigate(settingsPath('data'))
    else if (item.kind === 'weeklyReview') navigate(weeklyReviewPath())
    else if (item.kind === 'statusUpdate' && item.projectId)
      navigate(statusUpdatePath(item.projectId))
    else if (item.kind === 'triage' && item.projectId)
      navigate(projectPath(item.projectId, 'triage'))
    else if (item.projectId && item.taskId) navigate(taskPath(item.projectId, item.taskId))
    else if (item.projectId && item.decisionId)
      navigate(itemPath('decision', item.projectId, item.decisionId))
    else if (item.projectId && item.milestoneId)
      navigate(itemPath('milestone', item.projectId, item.milestoneId))
    else if (
      item.projectId &&
      (item.kind === 'question' || item.kind === 'review' || item.kind === 'agentLimit')
    )
      navigate(projectPath(item.projectId, 'agents'))
    else if (item.projectId) navigate(projectPath(item.projectId))
    else navigate(inboxPath())
  }

  const archive = async (item: InboxEntry, done = t('views:inboxView.archived')) => {
    const ok = await change(
      window.ostlerAPI.archiveInboxItems([item.key]),
      t('views:inboxView.couldntArchive')
    )
    if (ok)
      toastUndo(done, () =>
        change(
          window.ostlerAPI.unarchiveInboxItems([item.key]),
          t('views:inboxView.couldntBringBack')
        )
      )
  }

  const snooze = async (item: InboxEntry, until: 'hour' | 'tomorrow') => {
    const ok = await change(
      window.ostlerAPI.snoozeInboxReminder(item.key, until),
      t('views:inboxView.couldntSnoozeReminder')
    )
    if (ok)
      toast({
        title:
          until === 'hour'
            ? t('views:inboxView.snoozedHour')
            : item.nudging
              ? t('views:inboxView.snoozedTomorrowSameTime')
              : t('views:inboxView.snoozedUntilTomorrow09'),
        tone: 'success'
      })
  }

  /** A reminder that keeps reminding (N1.7): its task done, or it stops. */
  const finishTask = async (item: InboxEntry) => {
    if (!item.taskId) return
    const result = await window.ostlerAPI.updatePlanningWorkItem(item.taskId, { status: 'done' })
    if (!result.ok)
      toast({ title: t('views:inboxView.couldntMarkDone'), body: result.error, tone: 'danger' })
    void feed.reload()
  }

  /**
   * A commit says it fixes the task (N9.8b): the person's Mark as done goes
   * through the normal status change, and Undo puts the status back.
   */
  const markCommitTaskDone = async (item: InboxEntry) => {
    if (!item.taskId) return
    const taskId = item.taskId
    const result = await window.ostlerAPI.updatePlanningWorkItem(taskId, { status: 'done' })
    if (!result.ok) {
      toast({ title: t('views:inboxView.couldntMarkDone'), body: result.error, tone: 'danger' })
      return
    }
    const before = item.fromStatus
    toastUndo(t('views:inboxView.markedDone', { title: result.value.title }), async () => {
      if (before) await window.ostlerAPI.updatePlanningWorkItem(taskId, { status: before })
      void feed.reload()
    })
    void feed.reload()
  }

  /**
   * Queue it now (N9.7): an occurrence its schedule could not queue goes to
   * agents at the person's click, on the normal queue path. Still refused,
   * the plain reason shows and the note says it.
   */
  const queueNow = async (item: InboxEntry) => {
    if (!item.taskId) return
    const result = await window.ostlerAPI.queueScheduledTaskNow(item.taskId)
    if (result.ok) {
      feed.setValue(result.value)
      // The note now says it was queued, in the words the Inbox uses.
      const now = result.value.items.find((entry) => entry.key === item.key)
      toast({ title: now?.title ?? t('views:inboxView.queuedNow'), tone: 'success' })
    } else {
      toast({ title: t('views:inboxView.couldntQueueNow'), body: result.error, tone: 'danger' })
      void feed.reload()
    }
  }

  const stopReminding = async (item: InboxEntry) => {
    if (!item.taskId) return
    const result = await window.ostlerAPI.stopPlanningReminder(
      item.taskId,
      item.key.slice('reminder:'.length)
    )
    if (result.ok) toast({ title: t('views:inboxView.stoppedReminding'), tone: 'success' })
    else
      toast({
        title: t('views:inboxView.couldntStopReminding'),
        body: result.error,
        tone: 'danger'
      })
    void feed.reload()
  }

  const items = (list?.items ?? []).filter((item) => show === 'all' || item.readAt === null)
  const projectOf = (id: string | null) => projects.find((project) => project.id === id)

  return (
    <div className="ostler-inbox">
      <PageHeader
        title={t('views:inboxView.inbox')}
        subtitle={
          list
            ? list.unreadCount === 0
              ? t('views:inboxView.everythingRead')
              : t('views:inboxView.unread', { unreadCount: list.unreadCount })
            : undefined
        }
        actions={
          <>
            <SegmentedControl
              label={t('views:inboxView.show')}
              size="sm"
              value={show}
              onChange={setShow}
              options={[
                { value: 'all', label: t('views:inboxView.all') },
                { value: 'unread', label: t('views:inboxView.unread2') }
              ]}
            />
            <Button
              size="sm"
              variant="secondary"
              icon={CheckCheck}
              disabled={!list || list.unreadCount === 0}
              onClick={() =>
                void change(
                  window.ostlerAPI.markAllInboxRead(),
                  t('views:inboxView.couldntMarkEverythingRead')
                )
              }
            >
              {t('views:inboxView.markAllRead')}
            </Button>
          </>
        }
      />
      <div className="ostler-inbox__content">
        {feed.error && (
          <InlineAlert tone="danger">
            {t('views:inboxView.couldntLoadInbox', { error: feed.error })}
          </InlineAlert>
        )}
        {list === null ? (
          <Skeleton lines={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={
              show === 'unread' && list.items.length > 0
                ? t('views:inboxView.nothingUnread')
                : t('views:inboxView.youreAllCaughtUp')
            }
            description={t('views:inboxView.remindersFireBlockersReported')}
          />
        ) : (
          <ul className="ostler-inbox__list" aria-label={t('views:inboxView.inboxItems')}>
            {items.map((item) => {
              const kind = KINDS[item.kind]
              const project = projectOf(item.projectId)
              const unread = item.readAt === null
              return (
                <li key={item.key} className={`ostler-inbox__item${unread ? ' is-unread' : ''}`}>
                  <button
                    type="button"
                    className="ostler-inbox__open"
                    onClick={() => open(item)}
                    aria-label={joinSentences([
                      unread && t('views:inboxView.unreadSentence'),
                      t('views:inboxView.itemName', { kind: kind.label, title: item.title }),
                      item.body
                    ])}
                  >
                    <span className={`ostler-inbox__icon ostler-inbox__icon--${item.kind}`}>
                      <Icon icon={kind.icon} />
                    </span>
                    <span className="ostler-inbox__text">
                      <span className="ostler-inbox__title">{item.title}</span>
                      <span className="ostler-inbox__body">{item.body}</span>
                    </span>
                    <span className="ostler-inbox__meta">
                      {project && (
                        <span className="ostler-inbox__project">
                          <ProjectMark project={project} className="ostler-inbox__dot" />
                          {project.name}
                        </span>
                      )}
                      <time
                        dateTime={new Date(item.createdAt).toISOString()}
                        title={absoluteTimeText(item.createdAt)}
                      >
                        {relativeTimeText(item.createdAt)}
                      </time>
                    </span>
                  </button>
                  <span className="ostler-inbox__actions">
                    {item.kind === 'reminder' && (
                      <Menu
                        label={t('views:inboxView.snooze')}
                        placement="bottom-end"
                        renderTrigger={(trigger) => (
                          <IconButton
                            {...trigger}
                            label={t('views:inboxView.snooze')}
                            icon={Clock}
                            size="sm"
                          />
                        )}
                        items={[
                          {
                            label: t('views:inboxView.hour'),
                            onSelect: () => void snooze(item, 'hour')
                          },
                          {
                            label: item.nudging
                              ? t('views:inboxView.tomorrowSameTime')
                              : t('views:inboxView.untilTomorrow0900'),
                            onSelect: () => void snooze(item, 'tomorrow')
                          }
                        ]}
                      />
                    )}
                    {item.kind === 'reminder' && item.nudging && (
                      <>
                        <IconButton
                          label={t('views:inboxView.markDone')}
                          icon={Check}
                          size="sm"
                          onClick={() => void finishTask(item)}
                        />
                        <IconButton
                          label={t('views:inboxView.stopReminding')}
                          icon={BellOff}
                          size="sm"
                          onClick={() => void stopReminding(item)}
                        />
                      </>
                    )}
                    {item.kind === 'commit' && (
                      <>
                        <IconButton
                          label={t('views:inboxView.markAsDone')}
                          icon={Check}
                          size="sm"
                          onClick={() => void markCommitTaskDone(item)}
                        />
                        <IconButton
                          label={t('views:inboxView.dismiss')}
                          icon={X}
                          size="sm"
                          onClick={() => void archive(item, t('views:inboxView.dismissed'))}
                        />
                      </>
                    )}
                    {item.kind === 'scheduled' && item.queueNow && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Play}
                        onClick={() => void queueNow(item)}
                      >
                        {t('views:inboxView.queueNow')}
                      </Button>
                    )}
                    {item.kind === 'import' && (
                      <IconButton
                        label={t('views:inboxView.undoImport')}
                        icon={Undo2}
                        size="sm"
                        onClick={() =>
                          void undoImport(
                            item.key.slice('import:'.length),
                            () => void feed.reload()
                          )
                        }
                      />
                    )}
                    <IconButton
                      label={
                        unread ? t('views:inboxView.markRead') : t('views:inboxView.markUnread')
                      }
                      icon={unread ? MailOpen : Mail}
                      size="sm"
                      onClick={() =>
                        void change(
                          window.ostlerAPI.setInboxRead([item.key], unread),
                          t('views:inboxView.couldntChange')
                        )
                      }
                    />
                    <IconButton
                      label={t('views:inboxView.archive')}
                      icon={Archive}
                      size="sm"
                      onClick={() => void archive(item)}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {openPlan && (
        <PlanDialog
          projectId={openPlan.projectId}
          sessionId={openPlan.sessionId}
          onClose={() => setOpenPlan(null)}
          onDecided={() => void feed.reload()}
        />
      )}
    </div>
  )
}
