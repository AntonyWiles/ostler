import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatRelativeTime } from '@shared/format'
import {
  STATUS_UPDATE_HEALTHS,
  statusUpdateHealthLabel,
  type StatusUpdate,
  type StatusUpdateHealth
} from '@shared/status-updates'
import { MAX_STATUS_UPDATE_NOTE } from '../data/status-updates'
import { RADIUS, SPACE, type Theme } from '../theme'
import { Chip } from './EditBits'
import { Markdown } from './Markdown'

/** The colour a health shows in: green, amber or red. */
export function healthColors(theme: Theme, health: StatusUpdateHealth): { fg: string; bg: string } {
  switch (health) {
    case 'on-track':
      return { fg: theme.success, bg: theme.successSubtle }
    case 'at-risk':
      return { fg: theme.warning, bg: theme.warningSubtle }
    case 'off-track':
      return { fg: theme.danger, bg: theme.dangerSubtle }
  }
}

/** A health as a small coloured tag. */
export function HealthTag({ theme, health }: { theme: Theme; health: StatusUpdateHealth }) {
  const colors = healthColors(theme, health)
  return (
    <View style={[styles.tag, { backgroundColor: colors.bg }]}>
      <Text style={[styles.tagText, { color: colors.fg }]}>{statusUpdateHealthLabel(health)}</Text>
    </View>
  )
}

/**
 * A project's status updates: post one (how it is going and a note), the latest on top, then the
 * history. The person's own updates can be deleted, with Undo on the screen that owns this list.
 */
export function StatusList({
  theme,
  items,
  meId,
  onPost,
  onDelete
}: {
  theme: Theme
  items: StatusUpdate[]
  /** This phone's person, whose own updates can be deleted. */
  meId: string | null
  /** Posts an update; returns false when it was refused (the reason shows above). */
  onPost: (health: StatusUpdateHealth, note: string) => boolean
  onDelete: (update: StatusUpdate) => void
}) {
  const [posting, setPosting] = useState(false)
  const [health, setHealth] = useState<StatusUpdateHealth>(items[0]?.health ?? 'on-track')
  const [note, setNote] = useState('')
  const tooLong = note.trim().length > MAX_STATUS_UPDATE_NOTE
  return (
    <View style={styles.list}>
      {posting ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>
            {t('projects:statusUpdates.howIsItGoing')}
          </Text>
          <View style={styles.row}>
            {STATUS_UPDATE_HEALTHS.map((value) => (
              <Chip
                key={value}
                label={statusUpdateHealthLabel(value)}
                theme={theme}
                selected={health === value}
                onPress={() => setHealth(value)}
              />
            ))}
          </View>
          <TextInput
            accessibilityLabel={t('projects:statusUpdates.note')}
            placeholder={t('projects:statusUpdates.note')}
            placeholderTextColor={theme.textMuted}
            value={note}
            onChangeText={setNote}
            multiline
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.borderStrong, backgroundColor: theme.surface }
            ]}
          />
          {tooLong && (
            <Text style={[styles.meta, { color: theme.danger }]}>
              {t('projects:statusUpdates.noteTooLong', { max: MAX_STATUS_UPDATE_NOTE })}
            </Text>
          )}
          <View style={styles.row}>
            <Chip
              label={t('projects:statusUpdates.post')}
              theme={theme}
              selected
              onPress={() => {
                if (tooLong) return
                if (onPost(health, note)) {
                  setNote('')
                  setPosting(false)
                }
              }}
            />
            <Chip
              label={t('projects:statusUpdates.cancel')}
              theme={theme}
              onPress={() => setPosting(false)}
            />
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          <Chip
            label={t('mobile:status.postUpdate')}
            theme={theme}
            onPress={() => setPosting(true)}
          />
        </View>
      )}
      {items.length === 0 && (
        <Text style={[styles.empty, { color: theme.textMuted }]}>
          {t('projects:statusUpdates.noUpdateYet')}
        </Text>
      )}
      {items.map((update, index) => (
        <View
          key={update.id}
          style={[
            styles.card,
            {
              backgroundColor: theme.surface,
              borderColor: index === 0 ? healthColors(theme, update.health).fg : theme.border
            }
          ]}
        >
          <View style={styles.head}>
            <HealthTag theme={theme} health={update.health} />
            <Text style={[styles.meta, styles.grow, { color: theme.textMuted }]} numberOfLines={1}>
              {update.authorName} · {formatRelativeTime(update.postedAt)}
              {update.editedAt !== null ? ` ${t('projects:statusUpdates.editedMark')}` : ''}
            </Text>
            {meId !== null && update.authorPersonId === meId && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('projects:statusUpdates.delete')}
                onPress={() => onDelete(update)}
                hitSlop={SPACE.small}
              >
                <Text style={[styles.action, { color: theme.danger }]}>
                  {t('mobile:status.delete')}
                </Text>
              </Pressable>
            )}
          </View>
          {update.note.trim() !== '' && <Markdown theme={theme}>{update.note}</Markdown>}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: SPACE.small, paddingHorizontal: SPACE.large, paddingTop: SPACE.medium },
  card: { borderWidth: 1, borderRadius: RADIUS, padding: SPACE.medium, gap: SPACE.small },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small },
  head: { flexDirection: 'row', alignItems: 'center', gap: SPACE.small },
  grow: { flex: 1 },
  label: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 12 },
  action: { fontSize: 14, fontWeight: '600' },
  empty: { fontSize: 15, paddingVertical: SPACE.small },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.medium,
    paddingVertical: SPACE.small,
    fontSize: 15,
    textAlignVertical: 'top'
  },
  tag: { borderRadius: RADIUS, paddingHorizontal: SPACE.small, paddingVertical: 2 },
  tagText: { fontSize: 13, fontWeight: '700' }
})
