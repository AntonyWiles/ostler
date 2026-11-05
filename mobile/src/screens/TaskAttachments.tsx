import { useMemo, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import type { ItemLinkRef } from '@shared/ostler-api'
import type { EditDb } from '../data/edits'
import type { QueryDb } from '../data/queries'
import {
  attachFileToTask,
  detachTaskAttachment,
  taskAttachments,
  type TaskAttachment
} from '../data/task-attachments'
import { forgetRecording, keepPickedFile, storedRecording } from '../data/voice-memo-files'
import { newVoiceMemoId } from '../data/voice-memos'
import { RADIUS, SPACE, type Theme } from '../theme'
import { Chip, editErrorText } from './EditBits'
import { libraryKindLabel, pickFile } from './ProjectLibrary'

/**
 * A task's attachments on the task screen: photos, documents and other Library items linked to
 * it. A photo (gallery or camera) or a document added here goes into the project's Library and is
 * attached; tapping one opens it in the Library reader; Remove takes it off the task and leaves it
 * in the Library.
 */
export function TaskAttachments({
  db,
  taskId,
  projectId,
  version,
  theme,
  open,
  onEdited,
  onOpenItem
}: {
  db: EditDb & QueryDb
  taskId: string
  projectId: string
  version: number
  theme: Theme
  /** False for an archived or binned task: its attachments can be opened, not changed. */
  open: boolean
  onEdited: () => void
  onOpenItem: (ref: ItemLinkRef) => void
}) {
  const list = useMemo(
    () => (version >= 0 ? taskAttachments(db, taskId) : []),
    [db, taskId, version]
  )
  const [error, setError] = useState<string | null>(null)

  if (list.length === 0 && !open) return null

  const add = (source: 'file' | 'photo' | 'camera') => {
    setError(null)
    pickFile(source).then(
      (picked) => {
        if (!picked) return
        const id = newVoiceMemoId()
        try {
          const kept = keepPickedFile(picked.uri, picked.name, picked.mimeType, projectId, id)
          if (!kept) throw new Error(t('mobile:library.unreadable'))
          attachFileToTask(db, taskId, kept)
        } catch (failure) {
          forgetRecording(projectId, id)
          setError(editErrorText(failure))
          return
        }
        onEdited()
      },
      (failure: unknown) => setError(editErrorText(failure))
    )
  }

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.textSecondary }]}>
        {t('mobile:attachments.title')}
      </Text>
      {list.map((item) => (
        <AttachmentRow
          key={item.itemId}
          item={item}
          theme={theme}
          onOpen={() => onOpenItem({ kind: 'library', projectId: item.projectId, id: item.itemId })}
          onRemove={
            open
              ? () => {
                  try {
                    detachTaskAttachment(db, taskId, item.itemId)
                  } catch (failure) {
                    setError(editErrorText(failure))
                    return
                  }
                  onEdited()
                }
              : undefined
          }
        />
      ))}
      {open && (
        <View style={styles.actions}>
          <Chip label={t('mobile:library.addPhoto')} theme={theme} onPress={() => add('photo')} />
          <Chip label={t('mobile:library.takePhoto')} theme={theme} onPress={() => add('camera')} />
          <Chip label={t('mobile:library.addFile')} theme={theme} onPress={() => add('file')} />
        </View>
      )}
      {error !== null && <Text style={[styles.hint, { color: theme.danger }]}>{error}</Text>}
    </View>
  )
}

/** One attachment: a picture's thumbnail when this phone has it, its title and kind. */
function AttachmentRow({
  item,
  theme,
  onOpen,
  onRemove
}: {
  item: TaskAttachment
  theme: Theme
  onOpen: () => void
  onRemove?: () => void
}) {
  const stored = useMemo(
    () => (item.fileName !== null ? storedRecording(item.projectId, item.itemId) : null),
    [item]
  )
  const where =
    item.fileName === null
      ? (item.url ?? '')
      : stored
        ? t('mobile:library.fileOnPhone')
        : t('mobile:library.fileOnPc')
  return (
    <View style={[styles.row, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.title}
        onPress={onOpen}
        style={styles.open}
      >
        {stored !== null && item.kind === 'image' && (
          <Image source={{ uri: stored.uri }} style={styles.thumb} resizeMode="cover" />
        )}
        <View style={styles.text}>
          <Text style={[styles.body, { color: theme.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.hint, { color: theme.textMuted }]} numberOfLines={1}>
            {libraryKindLabel(item.kind)}
            {where ? ` · ${where}` : ''}
          </Text>
        </View>
      </Pressable>
      {onRemove !== undefined && (
        <Chip label={t('mobile:attachments.remove')} theme={theme} onPress={onRemove} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: SPACE.small, marginTop: SPACE.medium },
  heading: { fontSize: 13, fontWeight: '600' },
  hint: { fontSize: 13 },
  body: { fontSize: 15 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.small,
    borderWidth: 1,
    borderRadius: RADIUS,
    padding: SPACE.small
  },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.small, minHeight: 44 },
  thumb: { width: 44, height: 44, borderRadius: RADIUS },
  text: { flex: 1 }
})
