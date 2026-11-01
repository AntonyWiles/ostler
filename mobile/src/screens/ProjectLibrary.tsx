import { useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatRelativeTime } from '@shared/format'
import type { ItemLinkRef, LibraryItem, LibraryItemKind } from '@shared/ostler-api'
import { libraryItem, libraryItems } from '../data/library'
import { linkedItemTitle } from '../data/plan'
import type { QueryDb } from '../data/queries'
import { RADIUS, SPACE, useTheme, type Theme } from '../theme'
import { Chip } from './EditBits'
import { Markdown } from './Markdown'
import { TopBar } from './TopBar'

/** A kind's name, in the PC's words. */
export function libraryKindLabel(kind: LibraryItemKind): string {
  switch (kind) {
    case 'brief':
      return t('library:libraryUi.designBrief')
    case 'note':
      return t('library:libraryUi.note')
    default:
      return t(`library:libraryUi.kind.${kind}`)
  }
}

/** A project's Library as a list to read: filter by words, open an item. */
export function LibraryList({
  db,
  projectId,
  version,
  theme,
  onOpen,
  onAddNote
}: {
  db: QueryDb
  projectId: string
  version: number
  theme: Theme
  onOpen: (itemId: string) => void
  /** Writes a note; false when it was refused. Left out when the person may not write here. */
  onAddNote?: (title: string, body: string) => boolean
}) {
  const [words, setWords] = useState('')
  const [writing, setWriting] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const stopWriting = () => {
    setWriting(false)
    setTitle('')
    setBody('')
  }
  const items = useMemo(
    () => (version >= 0 ? libraryItems(db, projectId, words) : []),
    [db, projectId, words, version]
  )
  return (
    <View style={styles.list}>
      {onAddNote !== undefined && !writing && (
        <View style={styles.actions}>
          <Chip
            label={t('mobile:library.newNote')}
            theme={theme}
            onPress={() => setWriting(true)}
          />
        </View>
      )}
      {onAddNote !== undefined && writing && (
        <View
          style={[
            styles.card,
            styles.form,
            { backgroundColor: theme.surface, borderColor: theme.accent }
          ]}
        >
          <TextInput
            accessibilityLabel={t('mobile:library.noteTitle')}
            placeholder={t('mobile:library.noteTitle')}
            placeholderTextColor={theme.textMuted}
            value={title}
            onChangeText={setTitle}
            autoFocus
            style={[styles.input, { color: theme.text, borderColor: theme.borderStrong }]}
          />
          <TextInput
            accessibilityLabel={t('mobile:library.noteBody')}
            placeholder={t('mobile:library.noteBody')}
            placeholderTextColor={theme.textMuted}
            value={body}
            onChangeText={setBody}
            multiline
            style={[
              styles.input,
              styles.noteBody,
              { color: theme.text, borderColor: theme.borderStrong }
            ]}
          />
          <View style={styles.actions}>
            <Chip
              label={t('mobile:edit.save')}
              theme={theme}
              selected
              onPress={() => {
                if (title.trim() && onAddNote(title, body)) stopWriting()
              }}
            />
            <Chip label={t('mobile:taskMenu.cancel')} theme={theme} onPress={stopWriting} />
          </View>
        </View>
      )}
      <TextInput
        accessibilityLabel={t('mobile:library.filter')}
        placeholder={t('mobile:library.filter')}
        placeholderTextColor={theme.textMuted}
        value={words}
        onChangeText={setWords}
        style={[styles.input, { color: theme.text, borderColor: theme.borderStrong }]}
      />
      {items.length === 0 && (
        <Text style={[styles.empty, { color: theme.textMuted }]}>
          {words.trim() ? t('mobile:project.noMatches') : t('mobile:library.empty')}
        </Text>
      )}
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          onPress={() => onOpen(item.id)}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: pressed ? theme.surfaceSunken : theme.surface,
              borderColor: item.isPrimaryBrief ? theme.accent : theme.border
            }
          ]}
        >
          <Text style={[styles.kind, { color: theme.textMuted }]}>
            {[
              libraryKindLabel(item.kind),
              item.isPrimaryBrief ? t('library:libraryItemList.primary') : null,
              formatRelativeTime(Date.parse(item.updatedAt))
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Text style={[styles.title, { color: theme.text }]}>{item.title}</Text>
          {item.summary !== '' && (
            <Text style={[styles.summary, { color: theme.textSecondary }]} numberOfLines={2}>
              {item.summary}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  )
}

/**
 * One Library item to read: its text as Markdown (a brief, guide, note, a whiteboard's outline),
 * a link's address to open, or what a document or picture is. Files stay on the PC.
 */
export function LibraryReader({
  db,
  itemId,
  version,
  onBack,
  onOpenItem
}: {
  db: QueryDb
  itemId: string
  version: number
  onBack: () => void
  onOpenItem: (ref: ItemLinkRef) => void
}) {
  const theme = useTheme()
  const item = useMemo(() => (version >= 0 ? libraryItem(db, itemId) : null), [db, itemId, version])
  return (
    <View style={styles.page}>
      <TopBar theme={theme} title={item?.title ?? t('mobile:library.missing')} onBack={onBack} />
      {item === null ? (
        <Text style={[styles.empty, styles.pad, { color: theme.textMuted }]}>
          {t('mobile:library.missing')}
        </Text>
      ) : (
        <ScrollView contentContainerStyle={styles.reader}>
          <Text style={[styles.kind, { color: theme.textMuted }]}>
            {[libraryKindLabel(item.kind), ...item.tags].join(' · ')}
          </Text>
          <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
            {item.title}
          </Text>
          {item.summary !== '' && (
            <Text style={[styles.lead, { color: theme.textSecondary }]}>{item.summary}</Text>
          )}
          {item.url && (
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(item.url!).catch(() => {})}
            >
              <Text style={[styles.url, { color: theme.accent }]}>{item.url}</Text>
            </Pressable>
          )}
          {item.file && <FileNote item={item} theme={theme} />}
          {item.body.trim() !== '' && (
            <Markdown
              theme={theme}
              onOpenItem={onOpenItem}
              itemTitle={(ref) => linkedItemTitle(db, ref.kind, ref.id)}
            >
              {item.body}
            </Markdown>
          )}
        </ScrollView>
      )}
    </View>
  )
}

function FileNote({ item, theme }: { item: LibraryItem; theme: Theme }) {
  const file = item.file!
  const size =
    file.sizeBytes >= 1_048_576
      ? `${(file.sizeBytes / 1_048_576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`
  return (
    <View
      style={[styles.file, { borderColor: theme.border, backgroundColor: theme.surfaceSunken }]}
    >
      <Text style={[styles.fileName, { color: theme.text }]}>{file.fileName}</Text>
      <Text style={[styles.kind, { color: theme.textMuted }]}>
        {size} · {t('mobile:library.fileOnPc')}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  list: { gap: SPACE.small, paddingHorizontal: SPACE.large, paddingTop: SPACE.medium },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.medium,
    fontSize: 15
  },
  empty: { fontSize: 15, paddingVertical: SPACE.small },
  pad: { padding: SPACE.large },
  card: { borderWidth: 1, borderRadius: RADIUS, padding: SPACE.medium, gap: 2 },
  kind: { fontSize: 12 },
  title: { fontSize: 16, fontWeight: '600' },
  summary: { fontSize: 14 },
  reader: { padding: SPACE.large, gap: SPACE.medium, paddingBottom: 48 },
  heading: { fontSize: 22, fontWeight: '700' },
  lead: { fontSize: 16, lineHeight: 22 },
  url: { fontSize: 15, textDecorationLine: 'underline' },
  file: { borderWidth: 1, borderRadius: RADIUS, padding: SPACE.medium, gap: 2 },
  fileName: { fontSize: 15, fontWeight: '600' },
  form: { gap: SPACE.small },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small },
  noteBody: { minHeight: 140, paddingVertical: SPACE.small, textAlignVertical: 'top' }
})
