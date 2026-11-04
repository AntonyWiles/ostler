import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View, type RefreshControlProps } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatRelativeTime } from '@shared/format'
import type { InboxEntry } from '@shared/ostler-api'
import { phoneInbox, type InboxDb } from '../data/inbox'
import { projectName } from '../data/project-display'
import { RADIUS, SPACE, useTheme, type Theme } from '../theme'
import { Icon, type IconName } from './Icon'

/** Where an Inbox item leads: one of its task, or else its project. */
export type InboxTarget = { kind: 'task'; taskId: string } | { kind: 'project'; projectId: string }

interface Props {
  db: InboxDb
  /** Bumped by the app whenever a pull or an edit changed the database. */
  version: number
  onOpen: (target: InboxTarget) => void
  /** After a change to the Inbox's state, so the app pushes it and re-reads. */
  onEdited: () => void
  /** Pull-to-refresh for the list (the home screen syncs on a pull). */
  refreshControl?: ReactElement<RefreshControlProps>
}

/** How long an Undo stays offered after archiving. */
const UNDO_MS = 6000

/** The kinds the phone shows, in the desktop Inbox's words. */
function kindLabel(item: InboxEntry): string {
  switch (item.kind) {
    case 'mention':
      return t('views:inboxView.mention')
    case 'signOff':
      return t('views:inboxView.signOff')
    case 'triage':
      return t('views:inboxView.triage')
    case 'blocker':
      return t('views:inboxView.blockerReported')
    case 'reminder':
      return t('views:inboxView.reminder')
    default:
      return item.kind
  }
}

function targetOf(item: InboxEntry): InboxTarget | null {
  if (item.kind !== 'triage' && item.taskId) return { kind: 'task', taskId: item.taskId }
  if (item.projectId) return { kind: 'project', projectId: item.projectId }
  return null
}

/**
 * The Inbox (the desktop's, P5.6): what wants attention, newest first, across the projects on this
 * phone. An item opens its task or project and is marked read; each can be marked read or unread
 * and archived, with an Undo. Read and archived state syncs with the PC.
 */
export function Inbox({ db, version, onOpen, onEdited, refreshControl }: Props) {
  const theme = useTheme()
  const [show, setShow] = useState<'all' | 'unread'>('all')
  const [archived, setArchived] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const inbox = useMemo(
    () => phoneInbox(db, { projectName: (id) => projectName({ id, name: null }) }),
    [db]
  )
  // `version` changes when a pull or an edit changed the database; reading it re-runs the list.
  const list = useMemo(() => (version >= 0 ? inbox.list() : null), [inbox, version])

  useEffect(() => {
    if (archived === null) return
    const timer = setTimeout(() => setArchived(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [archived])

  /** Runs one change to the Inbox's state; a Viewer's database refuses, and that shows. */
  const change = (run: () => void, failed: string): boolean => {
    try {
      run()
      setFailure(null)
      onEdited()
      return true
    } catch {
      setFailure(failed)
      return false
    }
  }

  const open = (item: InboxEntry) => {
    if (item.readAt === null)
      change(() => inbox.setRead([item.key], true), t('views:inboxView.couldntMarkRead'))
    const target = targetOf(item)
    if (target !== null) onOpen(target)
  }

  const archive = (item: InboxEntry) => {
    if (change(() => inbox.archive([item.key]), t('views:inboxView.couldntArchive')))
      setArchived(item.key)
  }

  const undo = () => {
    if (archived === null) return
    const key = archived
    setArchived(null)
    change(() => inbox.unarchive([key]), t('views:inboxView.couldntBringBack'))
  }

  if (list === null) return null
  const items = list.items.filter((item) => show === 'all' || item.readAt === null)

  return (
    <View style={styles.page}>
      <View style={[styles.bar, { borderColor: theme.border }]}>
        <View style={[styles.segments, { borderColor: theme.borderStrong }]}>
          {(['all', 'unread'] as const).map((value) => {
            const selected = show === value
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setShow(value)}
                style={[styles.segment, selected && { backgroundColor: theme.accentSubtle }]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: selected ? theme.accent : theme.textSecondary }
                  ]}
                >
                  {value === 'all' ? t('views:inboxView.all') : t('views:inboxView.unread2')}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <Text style={[styles.count, { color: theme.textMuted }]} numberOfLines={1}>
          {list.unreadCount === 0
            ? t('views:inboxView.everythingRead')
            : t('views:inboxView.unread', { unreadCount: list.unreadCount })}
        </Text>
        <SmallButton
          icon="check-check"
          label={t('views:inboxView.markAllRead')}
          theme={theme}
          disabled={list.unreadCount === 0}
          onPress={() =>
            change(() => inbox.markAllRead(), t('views:inboxView.couldntMarkEverythingRead'))
          }
        />
      </View>
      {failure !== null && (
        <Text
          style={[styles.failure, { color: theme.danger, backgroundColor: theme.dangerSubtle }]}
        >
          {failure}
        </Text>
      )}
      <FlatList
        accessibilityLabel={t('views:inboxView.inboxItems')}
        refreshControl={refreshControl}
        data={items}
        keyExtractor={(item) => item.key}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {show === 'unread' && list.items.length > 0
                ? t('views:inboxView.nothingUnread')
                : t('views:inboxView.youreAllCaughtUp')}
            </Text>
            <Text style={[styles.emptyBody, { color: theme.textMuted }]}>
              {t('mobile:inbox.emptyBody')}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Row
            item={item}
            theme={theme}
            onOpen={() => open(item)}
            onToggleRead={() =>
              change(
                () => inbox.setRead([item.key], item.readAt === null),
                t('views:inboxView.couldntChange')
              )
            }
            onArchive={() => archive(item)}
          />
        )}
      />
      {archived !== null && (
        <View style={[styles.snack, { backgroundColor: theme.text }]}>
          <Text style={[styles.snackText, { color: theme.surface }]}>
            {t('views:inboxView.archived')}
          </Text>
          <Pressable accessibilityRole="button" onPress={undo} hitSlop={8}>
            <Text style={[styles.snackAction, { color: theme.accentSubtle }]}>
              {t('mobile:inbox.undo')}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

interface RowProps {
  item: InboxEntry
  theme: Theme
  onOpen: () => void
  onToggleRead: () => void
  onArchive: () => void
}

/** One item: an unread dot, the title, its line, where and when; then read and archive buttons. */
function Row({ item, theme, onOpen, onToggleRead, onArchive }: RowProps) {
  const unread = item.readAt === null
  const kind = kindLabel(item)
  const where = item.projectId ? projectName({ id: item.projectId, name: null }) : null
  const meta = [kind, where, formatRelativeTime(item.createdAt)]
    .filter((part): part is string => part !== null)
    .join(' · ')
  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          unread ? t('views:inboxView.unreadSentence') : null,
          t('views:inboxView.itemName', { kind, title: item.title }),
          item.body
        ]
          .filter((part): part is string => part !== null && part !== '')
          .join('. ')}
        onPress={onOpen}
        style={({ pressed }) => [styles.open, pressed && { backgroundColor: theme.surfaceSunken }]}
      >
        <View style={[styles.dot, { backgroundColor: unread ? theme.accent : 'transparent' }]} />
        <View style={styles.text}>
          <Text
            numberOfLines={2}
            style={[styles.title, { color: theme.text }, unread && styles.titleUnread]}
          >
            {item.title}
          </Text>
          {item.body !== '' && (
            <Text numberOfLines={2} style={[styles.body, { color: theme.textSecondary }]}>
              {item.body}
            </Text>
          )}
          <Text numberOfLines={1} style={[styles.meta, { color: theme.textMuted }]}>
            {meta}
          </Text>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <SmallButton
          icon={unread ? 'mail-open' : 'mail'}
          label={unread ? t('views:inboxView.markRead') : t('views:inboxView.markUnread')}
          theme={theme}
          onPress={onToggleRead}
        />
        <SmallButton
          icon="archive"
          label={t('views:inboxView.archive')}
          theme={theme}
          onPress={onArchive}
        />
      </View>
    </View>
  )
}

function SmallButton({
  icon,
  label,
  theme,
  disabled = false,
  onPress
}: {
  icon: IconName
  label: string
  theme: Theme
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={2}
      style={({ pressed }) => [
        styles.small,
        pressed && { backgroundColor: theme.surfaceSunken },
        disabled && styles.disabled
      ]}
    >
      <Icon name={icon} color={theme.textSecondary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.medium,
    paddingLeft: SPACE.large,
    paddingRight: SPACE.small,
    paddingVertical: SPACE.small,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  segments: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    overflow: 'hidden'
  },
  segment: { minHeight: 36, paddingHorizontal: SPACE.medium, justifyContent: 'center' },
  segmentText: { fontSize: 14, fontWeight: '600' },
  count: { flex: 1, fontSize: 13 },
  failure: { fontSize: 14, paddingHorizontal: SPACE.large, paddingVertical: SPACE.small },
  empty: { padding: SPACE.large, gap: SPACE.small },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyBody: { fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingRight: SPACE.small
  },
  open: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.medium,
    paddingLeft: SPACE.large,
    paddingRight: SPACE.small,
    paddingVertical: SPACE.medium,
    minHeight: 60
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15 },
  titleUnread: { fontWeight: '600' },
  body: { fontSize: 14 },
  meta: { fontSize: 12 },
  actions: { flexDirection: 'row' },
  small: {
    width: 44,
    height: 44,
    borderRadius: RADIUS,
    alignItems: 'center',
    justifyContent: 'center'
  },
  disabled: { opacity: 0.4 },
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
