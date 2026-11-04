import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type RefreshControlProps
} from 'react-native'
import { t } from '@shared/i18n/index'
import { formatRelativeTime } from '@shared/format'
import type { ItemLinkRef } from '@shared/ostler-api'
import type { EditDb } from '../data/edits'
import {
  approveReview,
  needsYou,
  needsYouGroup,
  NEEDS_YOU_GROUPS,
  replyOnTask,
  resolveTaskBlocker,
  sendBackTask,
  unblockTask,
  undoTaskAnswer,
  type NeedsYouBlocker,
  type NeedsYouGroup,
  type NeedsYouItem,
  type TaskAnswer
} from '../data/needs-you'
import { answerSignOff, linkedItemTitle } from '../data/plan'
import { projectColor, projectName } from '../data/project-display'
import { today, type QueryDb } from '../data/queries'
import { RADIUS, SPACE, useTheme, type Theme } from '../theme'
import { Chip, editErrorText, TextSender } from './EditBits'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import type { ProjectView } from './Project'

interface Props {
  db: QueryDb & EditDb
  /** Bumped by the app whenever a pull or an edit changed the database. */
  version: number
  onOpenTask: (taskId: string) => void
  onOpenProject: (projectId: string, view?: ProjectView) => void
  onOpenItem: (ref: ItemLinkRef) => void
  /** After an answer, so the app pushes it and re-reads. */
  onEdited: () => void
  /** Pull-to-refresh for the list (the home screen syncs on a pull). */
  refreshControl?: ReactElement<RefreshControlProps>
}

/** How long an Undo stays offered after an answer. */
const UNDO_MS = 5000

const GROUP_TITLE: Record<NeedsYouGroup, string> = {
  decide: 'mobile:needsYou.groupDecide',
  review: 'mobile:needsYou.groupReview',
  blocked: 'mobile:needsYou.groupBlocked',
  pc: 'mobile:needsYou.groupPc',
  waiting: 'mobile:needsYou.groupWaiting'
}

/** The text box a card has open: a blocker's note, a send-back note, or a reply. */
type Open = { key: string; box: 'note' | 'sendBack' | 'reply' | 'unblock' } | null

/**
 * Needs you: what waits on this phone's person across projects (`needs-you.ts`), grouped as
 * Decide, Review, Blocked on you, On your PC and Waiting on other tasks (folded), each card with
 * the latest comment and one-tap answers. An answer that only moved a task and added a comment
 * offers Undo for a few seconds.
 */
export function NeedsYou({
  db,
  version,
  onOpenTask,
  onOpenProject,
  onOpenItem,
  onEdited,
  refreshControl
}: Props) {
  const theme = useTheme()
  const [open, setOpen] = useState<Open>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [unblockTo, setUnblockTo] = useState<'ready' | 'backlog' | 'active'>('ready')
  const [waitingOpen, setWaitingOpen] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState<{ text: string; answer: TaskAnswer | null } | null>(null)
  // `version` changes when a pull or an edit changed the database; reading it re-runs the list.
  const needs = useMemo(() => (version >= 0 ? needsYou(db, today()) : null), [db, version])

  useEffect(() => {
    if (done === null) return
    const timer = setTimeout(() => setDone(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [done])

  /** Runs one answer; a refusal (a Viewer, an answer made elsewhere first) shows, not throws. */
  const answer = (run: () => TaskAnswer | null | void, text: string): boolean => {
    try {
      const made = run()
      setFailure(null)
      setOpen(null)
      setDone({ text, answer: made ?? null })
      onEdited()
      return true
    } catch (error) {
      setFailure(editErrorText(error))
      return false
    }
  }

  const undo = () => {
    if (done?.answer == null) return
    const made = done.answer
    setDone(null)
    try {
      undoTaskAnswer(db, made)
      onEdited()
    } catch (error) {
      setFailure(editErrorText(error))
    }
  }

  if (needs === null) return null
  const groups = NEEDS_YOU_GROUPS.map((group) => ({
    group,
    items: needs.items.filter((item) => needsYouGroup(item) === group)
  })).filter((entry) => entry.items.length > 0)

  const card = (item: NeedsYouItem) => (
    <Card
      key={item.key}
      item={item}
      theme={theme}
      db={db}
      open={open?.key === item.key ? open.box : null}
      note={notes[item.key] ?? ''}
      unblockTo={unblockTo}
      onNote={(text) => setNotes({ ...notes, [item.key]: text })}
      onOpenBox={(box) =>
        setOpen(open?.key === item.key && open.box === box ? null : { key: item.key, box })
      }
      onUnblockTo={setUnblockTo}
      onOpenTask={onOpenTask}
      onOpenItem={onOpenItem}
      onResolve={(blocker, choice) =>
        answer(
          () => resolveTaskBlocker(db, blocker.id, choice, notes[item.key] ?? ''),
          t('mobile:needsYou.answered')
        )
      }
      onApprove={() =>
        item.signOff
          ? answer(
              () => answerSignOff(db, item.signOff!.id, 'approved'),
              t('mobile:needsYou.approved')
            )
          : answer(() => approveReview(db, item.taskId!), t('mobile:needsYou.approved'))
      }
      onSendBack={(note) =>
        item.signOff
          ? answer(
              () => answerSignOff(db, item.signOff!.id, 'changes', note),
              t('mobile:needsYou.sentBack')
            )
          : answer(() => sendBackTask(db, item.taskId!, note), t('mobile:needsYou.sentBack'))
      }
      onUnblock={(reply) =>
        answer(
          () => unblockTask(db, item.taskId!, reply, unblockTo),
          t('mobile:needsYou.unblocked')
        )
      }
      onReply={(reply) =>
        answer(() => void replyOnTask(db, item.taskId!, reply), t('mobile:needsYou.replied'))
      }
    />
  )

  return (
    <View style={styles.page}>
      {failure !== null && (
        <Text
          style={[styles.failure, { color: theme.danger, backgroundColor: theme.dangerSubtle }]}
        >
          {failure}
        </Text>
      )}
      <ScrollView
        accessibilityLabel={t('mobile:needsYou.title')}
        refreshControl={refreshControl}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      >
        {needs.triage.length > 0 && (
          <View style={styles.triage}>
            {needs.triage.map((entry) => (
              <Pressable
                key={entry.projectId}
                accessibilityRole="button"
                onPress={() => onOpenProject(entry.projectId, 'triage')}
                style={({ pressed }) => [
                  styles.triageRow,
                  {
                    borderColor: theme.border,
                    backgroundColor: pressed ? theme.surfaceSunken : theme.surface
                  }
                ]}
              >
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: projectColor({ id: entry.projectId, color: null }) }
                  ]}
                />
                <Text style={[styles.triageText, { color: theme.text }]} numberOfLines={1}>
                  {t('mobile:needsYou.triage', {
                    count: entry.count,
                    project: projectName({ id: entry.projectId, name: null })
                  })}
                </Text>
                <Icon name="chevron-right" color={theme.textMuted} />
              </Pressable>
            ))}
          </View>
        )}
        {groups.length === 0 && (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {t('mobile:needsYou.emptyTitle')}
            </Text>
            <Text style={[styles.emptyBody, { color: theme.textMuted }]}>
              {t('mobile:needsYou.emptyBody')}
            </Text>
          </View>
        )}
        {groups.map(({ group, items }) => {
          const foldable = group === 'waiting'
          const shown = !foldable || waitingOpen
          return (
            <View key={group} style={styles.group}>
              <Pressable
                accessibilityRole={foldable ? 'button' : 'header'}
                accessibilityState={foldable ? { expanded: shown } : undefined}
                disabled={!foldable}
                onPress={() => setWaitingOpen(!waitingOpen)}
                style={styles.groupHead}
              >
                <Text style={[styles.groupTitle, { color: theme.textSecondary }]}>
                  {t(GROUP_TITLE[group])} · {items.length}
                </Text>
                {foldable && (
                  <Text style={[styles.groupAction, { color: theme.accent }]}>
                    {shown ? t('mobile:needsYou.hide') : t('mobile:needsYou.show')}
                  </Text>
                )}
              </Pressable>
              {group === 'pc' && shown && (
                <Text style={[styles.groupHint, { color: theme.textMuted }]}>
                  {t('mobile:needsYou.pcHint')}
                </Text>
              )}
              {shown && items.map(card)}
            </View>
          )
        })}
      </ScrollView>
      {done !== null && (
        <View style={[styles.snack, { backgroundColor: theme.text }]}>
          <Text style={[styles.snackText, { color: theme.surface }]}>{done.text}</Text>
          {done.answer !== null && (
            <Pressable accessibilityRole="button" onPress={undo} hitSlop={8}>
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

interface CardProps {
  item: NeedsYouItem
  theme: Theme
  db: QueryDb
  open: 'note' | 'sendBack' | 'reply' | 'unblock' | null
  note: string
  unblockTo: 'ready' | 'backlog' | 'active'
  onNote: (text: string) => void
  onOpenBox: (box: 'note' | 'sendBack' | 'reply' | 'unblock') => void
  onUnblockTo: (to: 'ready' | 'backlog' | 'active') => void
  onOpenTask: (taskId: string) => void
  onOpenItem: (ref: ItemLinkRef) => void
  onResolve: (blocker: NeedsYouBlocker, choice: string) => void
  onApprove: () => void
  onSendBack: (note: string) => void
  onUnblock: (reply: string) => void
  onReply: (reply: string) => void
}

/** One ask: where and how old, the task, the ask itself, and its answers. */
function Card(props: CardProps) {
  const { item, theme, db } = props
  const project = projectName({ id: item.projectId, name: null })
  const meta = [
    project,
    t('mobile:needsYou.asked', { when: formatRelativeTime(item.askedAt) }),
    item.waitsOn > 0 ? t('mobile:needsYou.waitsOn', { count: item.waitsOn }) : null
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
  const comment = item.latestComment
  const canAct = item.canAct && item.kind !== 'waiting'
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.metaRow}>
        <View
          style={[
            styles.swatch,
            { backgroundColor: projectColor({ id: item.projectId, color: null }) }
          ]}
        />
        <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={item.taskId === null}
        onPress={() => item.taskId && props.onOpenTask(item.taskId)}
      >
        <Text style={[styles.title, { color: theme.text }]}>
          {item.title || t('mobile:plan.itemGone')}
        </Text>
      </Pressable>
      {item.signOff && (
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          {t('mobile:needsYou.signOffAsked')}
        </Text>
      )}
      {item.blocker && (
        <Text style={[styles.ask, { color: theme.text }]}>{item.blocker.description}</Text>
      )}
      {comment !== null && (
        <View style={styles.comment}>
          <Text style={[styles.meta, { color: theme.textMuted }]}>
            {comment.author} · {formatRelativeTime(comment.createdAt)}
          </Text>
          <Folded theme={theme}>
            <Markdown
              theme={theme}
              onOpenItem={props.onOpenItem}
              itemTitle={(ref) => linkedItemTitle(db, ref.kind, ref.id)}
            >
              {comment.body}
            </Markdown>
          </Folded>
        </View>
      )}
      {item.onPc && (
        <Text style={[styles.pc, { color: theme.warning }]}>{t('mobile:needsYou.onPc')}</Text>
      )}
      {canAct && <Answers {...props} />}
      {item.taskId !== null && (
        <Pressable
          accessibilityRole="button"
          onPress={() => props.onOpenTask(item.taskId!)}
          hitSlop={SPACE.small}
          style={styles.openTask}
        >
          <Text style={[styles.link, { color: theme.accent }]}>
            {t('mobile:needsYou.openTask')}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

/** A card's answers, by kind. */
function Answers(props: CardProps) {
  const { item, theme, open, note } = props
  if (item.blocker) {
    const blocker = item.blocker
    return (
      <BlockerAnswer
        blocker={blocker}
        theme={theme}
        note={note}
        noteOpen={open === 'note'}
        onNote={props.onNote}
        onToggleNote={() => props.onOpenBox('note')}
        onResolve={(choice) => props.onResolve(blocker, choice)}
      />
    )
  }
  if (item.kind === 'review' || item.kind === 'sign-off') {
    return (
      <View style={styles.answers}>
        <View style={styles.chips}>
          <Chip label={t('mobile:plan.approve')} theme={theme} onPress={props.onApprove} />
          <Chip
            label={t('mobile:plan.sendBack')}
            theme={theme}
            selected={open === 'sendBack'}
            onPress={() => props.onOpenBox('sendBack')}
          />
        </View>
        {open === 'sendBack' && (
          <TextSender
            theme={theme}
            placeholder={t('mobile:plan.sendBackNote')}
            button={t('mobile:plan.sendBack')}
            multiline
            autoFocus
            onSend={(text) => {
              if (!text.trim()) throw new Error('empty')
              props.onSendBack(text)
            }}
          />
        )}
      </View>
    )
  }
  return (
    <View style={styles.answers}>
      <View style={styles.chips}>
        <Chip
          label={t('mobile:needsYou.replyUnblock')}
          theme={theme}
          selected={open === 'unblock'}
          onPress={() => props.onOpenBox('unblock')}
        />
        <Chip
          label={t('mobile:needsYou.replyOnly')}
          theme={theme}
          selected={open === 'reply'}
          onPress={() => props.onOpenBox('reply')}
        />
      </View>
      {open === 'unblock' && (
        <>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>
            {t('mobile:needsYou.moveTo')}
          </Text>
          <View style={styles.chips}>
            {(['ready', 'backlog', 'active'] as const).map((to) => (
              <Chip
                key={to}
                label={t(`mobile:needsYou.to.${to}`)}
                theme={theme}
                selected={props.unblockTo === to}
                onPress={() => props.onUnblockTo(to)}
              />
            ))}
          </View>
          <TextSender
            theme={theme}
            placeholder={t('mobile:needsYou.replyPlaceholder')}
            button={t('mobile:needsYou.send')}
            multiline
            autoFocus
            onSend={(text) => {
              if (!text.trim()) throw new Error('empty')
              props.onUnblock(text)
            }}
          />
        </>
      )}
      {open === 'reply' && (
        <TextSender
          theme={theme}
          placeholder={t('mobile:needsYou.replyPlaceholder')}
          button={t('mobile:needsYou.send')}
          multiline
          autoFocus
          onSend={(text) => {
            if (!text.trim()) throw new Error('empty')
            props.onReply(text)
          }}
        />
      )}
    </View>
  )
}

/**
 * A blocker's answers: one chip per option ("Mark resolved" when it has none, as on the PC), and
 * an optional note sent with the choice. Shared with the task screen.
 */
export function BlockerAnswer({
  blocker,
  theme,
  note,
  noteOpen,
  onNote,
  onToggleNote,
  onResolve
}: {
  blocker: NeedsYouBlocker
  theme: Theme
  note: string
  noteOpen: boolean
  onNote: (text: string) => void
  onToggleNote: () => void
  onResolve: (choice: string) => void
}) {
  const options = blocker.options.length > 0 ? blocker.options : null
  return (
    <View style={styles.answers}>
      <View style={styles.chips}>
        {options
          ? options.map((option) => (
              <Chip key={option} label={option} theme={theme} onPress={() => onResolve(option)} />
            ))
          : [
              <Chip
                key="resolved"
                label={t('mobile:needsYou.markResolved')}
                theme={theme}
                onPress={() => onResolve('resolved')}
              />
            ]}
      </View>
      {noteOpen ? (
        <TextInput
          accessibilityLabel={t('mobile:needsYou.notePlaceholder')}
          placeholder={t('mobile:needsYou.notePlaceholder')}
          placeholderTextColor={theme.textMuted}
          value={note}
          onChangeText={onNote}
          multiline
          autoFocus
          style={[
            styles.input,
            { color: theme.text, borderColor: theme.borderStrong, backgroundColor: theme.surface }
          ]}
        />
      ) : (
        <Pressable accessibilityRole="button" onPress={onToggleNote} hitSlop={SPACE.small}>
          <Text style={[styles.link, { color: theme.accent }]}>{t('mobile:needsYou.addNote')}</Text>
        </Pressable>
      )}
    </View>
  )
}

const LINE = 21
const FOLDED_LINES = 4

/** Shows the first few lines of its content, with More to show the rest. */
function Folded({ theme, children }: { theme: Theme; children: ReactNode }) {
  const [height, setHeight] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const limit = LINE * FOLDED_LINES
  const long = height > limit + 4
  return (
    <View>
      <View style={!expanded && { maxHeight: limit, overflow: 'hidden' }}>
        <View onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>{children}</View>
      </View>
      {long && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded(!expanded)}
          hitSlop={SPACE.small}
        >
          <Text style={[styles.link, { color: theme.accent }]}>
            {expanded ? t('mobile:needsYou.less') : t('mobile:needsYou.more')}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  list: { padding: SPACE.large, gap: SPACE.large, paddingBottom: 96 },
  failure: { fontSize: 14, paddingHorizontal: SPACE.large, paddingVertical: SPACE.small },
  triage: { gap: SPACE.small },
  triageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.medium,
    minHeight: 48,
    paddingHorizontal: SPACE.medium,
    borderWidth: 1,
    borderRadius: RADIUS
  },
  triageText: { flex: 1, fontSize: 15 },
  empty: { gap: SPACE.small },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyBody: { fontSize: 14 },
  group: { gap: SPACE.small },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32
  },
  groupTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  groupAction: { fontSize: 14, fontWeight: '600' },
  groupHint: { fontSize: 13 },
  card: { borderWidth: 1, borderRadius: RADIUS, padding: SPACE.medium, gap: SPACE.small },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.small },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  meta: { flex: 1, fontSize: 12 },
  title: { fontSize: 16, fontWeight: '600' },
  ask: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 14 },
  comment: { gap: 2 },
  pc: { fontSize: 13, fontWeight: '600' },
  answers: { gap: SPACE.small },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.medium,
    fontSize: 15
  },
  link: { fontSize: 14, fontWeight: '600' },
  openTask: { alignSelf: 'flex-start' },
  snack: {
    position: 'absolute',
    left: SPACE.large,
    right: SPACE.large,
    bottom: SPACE.large,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.large,
    minHeight: 48,
    elevation: 4
  },
  snackText: { fontSize: 15 },
  snackAction: { fontSize: 15, fontWeight: '700' }
})
