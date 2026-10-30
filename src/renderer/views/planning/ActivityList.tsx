import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Markdown } from '../../ui/Markdown'
import { useItemLinkPicker } from '../../hooks/useItemLinkPicker'
import { useMentionPicker } from '../../hooks/useMentionPicker'
import type { ActivityEntry, PlanningComment, ShareRole } from '@shared/ostler-api'
import { usePeople } from '../../context/PeopleContext'
import { useConfig } from '../../hooks/useConfig'
import { isChatSendShortcut } from '../../utils/chatSendKey'
import { Collapse, Avatar, Button, IconButton, TextArea, useToast } from '../../ui'
import { absoluteTimeText, relativeTimeText } from '../../ui/date-text'
import {
  Bot,
  chevronClass,
  ChevronRight,
  Icon,
  Paperclip,
  Pencil,
  Pin,
  Plug,
  Quote,
  Settings,
  Sparkles,
  Trash2,
  User,
  Zap,
  type LucideIcon
} from '../../ui/icons'
import { PersonAvatar } from './AssigneeField'
import { attachmentMarkdown, useAttachFiles } from './useAttachFiles'
import { commentPermissions } from '@shared/comment-permissions'
import { useMyShareRole } from '../../hooks/useMyShareRole'
import './Activity.css'
import { t } from '@shared/i18n'
import { groupActivity, type ActivityFeedItem } from '@shared/activity-groups'
import { markdownExcerpt } from '@shared/markdown-excerpt'

const ACTOR_ICONS: Partial<Record<ActivityEntry['actor']['kind'], LucideIcon>> = {
  agent: Bot,
  'ostler-ai': Sparkles,
  automation: Plug,
  system: Settings,
  rule: Zap
}

/** A comment on its way into the comment box as a quote. */
export interface CommentQuote {
  text: string
  author: string
  nonce: number
}

/** `text` as a Markdown quote, headed "**Author** wrote:" so the reply says whose words they are. */
export function quoteMarkdown(text: string, author: string): string {
  const lines = text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
  const heading = `> ${t('tasks:activityList.quoteWrote', { name: `**${author}**` })}`
  return [heading, '>', ...lines].join('\n')
}

/** Who did it: the person's avatar, or an icon for an agent, Ostler AI, automation or Ostler itself. */
export function ActivityActorMark({ actor }: { actor: ActivityEntry['actor'] }) {
  const people = usePeople()
  const person = actor.personId ? people.byId.get(actor.personId) : undefined
  if (person) return <PersonAvatar person={person} />
  const icon = ACTOR_ICONS[actor.kind]
  if (icon) {
    return (
      <span className="activity-actor activity-actor--icon" role="img" aria-label={actor.name}>
        <Icon icon={icon} />
      </span>
    )
  }
  if (actor.kind === 'human' && actor.name !== 'Someone')
    return <Avatar name={actor.name} size="sm" />
  return (
    <span className="activity-actor activity-actor--icon" role="img" aria-label={actor.name}>
      <Icon icon={User} />
    </span>
  )
}

/** "5 minutes ago", with the exact time on hover. */
export function ActivityTime({ at }: { at: number }) {
  const exact = absoluteTimeText(at)
  return (
    <time className="activity-time" dateTime={new Date(at).toISOString()} title={exact}>
      {relativeTimeText(at)}
    </time>
  )
}

/**
 * The comment box (P5.2). It sends on Ctrl+Enter, or on Enter when Settings
 * says so: the same rule as the notes chat.
 */
export function CommentComposer({
  label = t('tasks:activityList.comment'),
  initial = '',
  submitLabel = t('tasks:activityList.comment'),
  onSubmit,
  onCancel,
  autoFocus,
  projectId = null,
  quote
}: {
  /** Text to quote: each new `nonce` adds it to the box as a Markdown quote, headed by who wrote
   * it, and focuses the box. */
  quote?: CommentQuote | null
  /** The task's project: typing `[[` links to its items (N4.4a). */
  projectId?: string | null
  label?: string
  initial?: string
  submitLabel?: string
  onSubmit: (body: string) => Promise<boolean>
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const { config } = useConfig()
  const sendOn = config?.ui.sendMessageOn ?? 'ctrlEnter'
  const [body, setBody] = useState(initial)
  const [busy, setBusy] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const links = useItemLinkPicker({ projectId, value: body, onChange: setBody, textRef })
  const mentions = useMentionPicker({ projectId, value: body, onChange: setBody, textRef })
  const lastQuote = useRef(0)
  useEffect(() => {
    if (!quote || quote.nonce === lastQuote.current) return
    lastQuote.current = quote.nonce
    const quoted = `${quoteMarkdown(quote.text, quote.author)}\n\n`
    setBody((current) => (current.trim() ? `${current.trimEnd()}\n\n${quoted}` : quoted))
    textRef.current?.focus()
  }, [quote])
  const submit = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    const done = await onSubmit(body)
    setBusy(false)
    if (done && !onCancel) setBody('')
  }
  return (
    <div className="comment-composer">
      <TextArea
        label={label}
        hideLabel
        rows={2}
        maxRows={12}
        value={body}
        autoFocus={autoFocus}
        placeholder={
          sendOn === 'enter'
            ? t('tasks:activityList.writeCommentMarkdownWorks')
            : t('tasks:activityList.writeCommentMarkdownWorks2')
        }
        onChange={(event) => setBody(event.target.value)}
        {...links.inputProps}
        {...(mentions.open ? mentions.inputProps : {})}
        onSelect={(event) => {
          links.inputProps.onSelect(event)
          mentions.inputProps.onSelect(event)
        }}
        ref={textRef}
        onKeyDown={(event) => {
          mentions.inputProps.onKeyDown(event)
          if (event.defaultPrevented) return
          links.inputProps.onKeyDown(event)
          if (event.defaultPrevented) return
          if (event.key === 'Escape' && onCancel) {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
            return
          }
          if (isChatSendShortcut(event, sendOn)) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      {links.picker}
      {mentions.picker}
      <div className="comment-composer__actions">
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('tasks:activityList.cancel')}
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          disabled={!body.trim()}
          disabledReason={body.trim() ? undefined : t('tasks:activityList.writeSomethingFirst')}
          onClick={() => void submit()}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

/** A comment's text, rendered as sanitized markdown: scripts and `javascript:` links stay inert. */
export function CommentBody({ body, projectId }: { body: string; projectId?: string }) {
  return (
    <div className="activity-comment__body">
      <Markdown projectId={projectId}>{body}</Markdown>
    </div>
  )
}

/** A comment in the feed, with Edit and Delete (Delete offers undo). */
function CommentEntry({
  entry,
  comment,
  role,
  myPersonId,
  onQuote,
  onChanged,
  onError
}: {
  entry: ActivityEntry
  comment: PlanningComment
  role: ShareRole | null
  myPersonId: string | null
  onQuote?: (text: string, author: string) => void
  onChanged: () => void
  onError: (message: string) => void
}) {
  const { toastUndo } = useToast()
  const can = commentPermissions(role, comment, myPersonId)
  const pinned = Boolean(comment.pinnedAt)
  const togglePin = async () => {
    const result = await window.ostlerAPI.pinPlanningComment(comment.id, !pinned)
    if (!result.ok) return onError(result.error)
    onChanged()
  }
  const [editing, setEditing] = useState(false)
  const edited = comment.updatedAt > comment.createdAt
  const { pickFiles } = useAttachFiles(comment.projectId, comment.workItemId)
  // Attach files (MOP-13): kept in the Library and attached to the task like
  // any attachment, and linked at the end of this comment.
  const attach = async () => {
    const items = await pickFiles()
    if (items.length === 0) return
    const body = `${comment.body.trimEnd()}\n\n${attachmentMarkdown(comment.projectId, items)}`
    const result = await window.ostlerAPI.updatePlanningComment(comment.id, body)
    if (!result.ok) return onError(result.error)
    onChanged()
  }

  const remove = async () => {
    const result = await window.ostlerAPI.deletePlanningComment(comment.id)
    if (!result.ok) return onError(result.error)
    onChanged()
    toastUndo(t('tasks:activityList.commentDeleted'), async () => {
      const restored = await window.ostlerAPI.restorePlanningComment(comment.id)
      if (!restored.ok) onError(restored.error)
      onChanged()
    })
  }

  return (
    <ActivityRow
      entry={entry}
      headline={
        <>
          <strong className="activity-row__actor">{entry.actor.name}</strong>
          {edited && <span className="activity-row__muted"> {t('tasks:activityList.edited')}</span>}
          {pinned && (
            <span className="activity-row__muted activity-row__pinned">
              {' '}
              <Icon icon={Pin} /> {t('tasks:activityList.pinned')}
            </span>
          )}
        </>
      }
      actions={
        editing ? null : (
          <>
            {can.quote && onQuote && (
              <IconButton
                size="sm"
                icon={Quote}
                label={t('tasks:activityList.quoteComment')}
                onClick={() => onQuote(comment.body, entry.actor.name)}
              />
            )}
            {can.pin && (
              <IconButton
                size="sm"
                icon={Pin}
                label={
                  pinned ? t('tasks:activityList.unpinComment') : t('tasks:activityList.pinComment')
                }
                aria-pressed={pinned}
                onClick={() => void togglePin()}
              />
            )}
            {can.edit && (
              <IconButton
                size="sm"
                icon={Paperclip}
                label={t('tasks:activityList.attachToComment')}
                onClick={() => void attach()}
              />
            )}
            {can.edit && (
              <IconButton
                size="sm"
                icon={Pencil}
                label={t('tasks:activityList.editComment')}
                onClick={() => setEditing(true)}
              />
            )}
            {can.delete && (
              <IconButton
                size="sm"
                icon={Trash2}
                label={t('tasks:activityList.deleteComment')}
                onClick={() => void remove()}
              />
            )}
          </>
        )
      }
    >
      {editing ? (
        <CommentComposer
          label={t('tasks:activityList.editComment')}
          projectId={comment.projectId}
          initial={comment.body}
          submitLabel={t('tasks:activityList.saveComment')}
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const result = await window.ostlerAPI.updatePlanningComment(comment.id, body)
            if (!result.ok) {
              onError(result.error)
              return false
            }
            setEditing(false)
            onChanged()
            return true
          }}
        />
      ) : (
        <CommentBody body={comment.body} projectId={comment.projectId} />
      )}
    </ActivityRow>
  )
}

/** One line of history: who, what, when; a comment adds its body beneath. */
function ActivityRow({
  entry,
  headline,
  actions,
  context,
  children,
  compact = false
}: {
  entry: ActivityEntry
  headline: ReactNode
  actions?: ReactNode
  context?: ReactNode
  children?: ReactNode
  /** One quiet line: the context sits after the sentence instead of beneath it. */
  compact?: boolean
}) {
  return (
    <li
      className={`activity-row activity-row--${entry.kind}${compact ? ' activity-row--compact' : ''}`}
    >
      <ActivityActorMark actor={entry.actor} />
      <div className="activity-row__main">
        <div className="activity-row__head">
          <span className="activity-row__summary">{headline}</span>
          {compact && context}
          <ActivityTime at={entry.at} />
          {actions && <span className="activity-row__actions">{actions}</span>}
        </div>
        {!compact && context}
        {children}
      </div>
    </li>
  )
}

/** A task's name in the project feed: a link that opens it, or plain text when it cannot. */
function TaskName({
  entry,
  onOpenTask,
  canOpenTask
}: {
  entry: ActivityEntry
  onOpenTask: (workItemId: string) => void
  canOpenTask: (workItemId: string) => boolean
}) {
  return !canOpenTask(entry.workItemId) ? (
    <span className="activity-row__task" title={entry.workItemTitle}>
      {entry.workItemTitle}
    </span>
  ) : (
    <button
      type="button"
      className="activity-row__task"
      title={t('tasks:activityList.open', { workItemTitle: entry.workItemTitle })}
      onClick={() => onOpenTask(entry.workItemId)}
    >
      {entry.workItemTitle}
    </button>
  )
}

/** One action that made or changed many tasks (R1.4): one row that expands to the tasks. */
function ActivityGroupRow({
  group,
  onOpenTask,
  canOpenTask
}: {
  group: Extract<ActivityFeedItem, { kind: 'group' }>
  onOpenTask?: (workItemId: string) => void
  canOpenTask: (workItemId: string) => boolean
}) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const first = group.entries[0]
  const count = group.entries.length
  return (
    <ActivityRow
      entry={first}
      headline={group.summary}
      context={
        <button
          type="button"
          className="activity-group__toggle"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon icon={ChevronRight} className={chevronClass(open)} />
          {open
            ? t('tasks:activityGroups.hideTasks')
            : t('tasks:activityGroups.showTasks', { count })}
        </button>
      }
    >
      <Collapse open={open}>
        <ul id={listId} className="activity-group__tasks">
          {group.entries.map((entry) => (
            <li key={entry.id}>
              {onOpenTask ? (
                <TaskName entry={entry} onOpenTask={onOpenTask} canOpenTask={canOpenTask} />
              ) : (
                <span className="activity-row__task">{entry.workItemTitle}</span>
              )}
            </li>
          ))}
        </ul>
      </Collapse>
    </ActivityRow>
  )
}

/**
 * The merged history (P5.2): comments with their text, everything else as
 * one sentence. `onOpenTask` makes each entry name its task (the project feed).
 * `grouped` folds one action on many tasks into one row (R1.4, the project feed).
 */
export function ActivityList({
  entries,
  onChanged,
  onError,
  onOpenTask,
  canOpenTask = () => true,
  grouped = false,
  projectId,
  onQuote
}: {
  /** The task's project, for what its role allows with a comment. */
  projectId?: string
  /** Quotes a comment into the comment box; without it there is no Quote button. */
  onQuote?: (text: string, author: string) => void
  entries: ActivityEntry[]
  onChanged: () => void
  onError: (message: string) => void
  onOpenTask?: (workItemId: string) => void
  /** Whether a task can be opened; an archived or deleted one is named without a link. */
  canOpenTask?: (workItemId: string) => boolean
  grouped?: boolean
}) {
  const role = useMyShareRole(projectId ?? null)
  const myPersonId = usePeople().me?.id ?? null
  const items: ActivityFeedItem[] = useMemo(() => {
    const feed: ActivityFeedItem[] = grouped
      ? groupActivity(entries)
      : entries.map((entry) => ({ kind: 'entry', entry }))
    // Pinned comments stay at the top of a task's feed, newest pin first.
    const pinnedAt = (item: ActivityFeedItem) =>
      item.kind === 'entry' && item.entry.kind === 'comment'
        ? (item.entry.comment?.pinnedAt ?? 0)
        : 0
    return projectId && !grouped ? [...feed].sort((a, b) => pinnedAt(b) - pinnedAt(a)) : feed
  }, [entries, grouped, projectId])
  return (
    <ul className="activity-list">
      {items.map((item) => {
        if (item.kind === 'group') {
          return (
            <ActivityGroupRow
              key={item.id}
              group={item}
              onOpenTask={onOpenTask}
              canOpenTask={canOpenTask}
            />
          )
        }
        const entry = item.entry
        // A status update (N5.5) is the project's, not a task's: no task name.
        const context =
          onOpenTask && entry.workItemId ? (
            <TaskName entry={entry} onOpenTask={onOpenTask} canOpenTask={canOpenTask} />
          ) : null
        if (entry.kind === 'comment' && entry.comment && !onOpenTask) {
          return (
            <CommentEntry
              key={entry.id}
              entry={entry}
              comment={entry.comment}
              role={role}
              myPersonId={myPersonId}
              onQuote={onQuote}
              onChanged={onChanged}
              onError={onError}
            />
          )
        }
        // In the project feed a change is one quiet line, so comments stand out.
        return (
          <ActivityRow
            key={entry.id}
            entry={entry}
            headline={entry.summary}
            context={context}
            compact={Boolean(onOpenTask) && entry.kind !== 'comment'}
          >
            {entry.kind === 'comment' && entry.comment && onOpenTask && (
              <p className="activity-row__excerpt">{markdownExcerpt(entry.comment.body)}</p>
            )}
          </ActivityRow>
        )
      })}
    </ul>
  )
}
