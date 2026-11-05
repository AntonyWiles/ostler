import { useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatRelativeTime } from '@shared/format'
import type { ItemLinkRef, LibraryItem, LibraryItemKind } from '@shared/ostler-api'
import { capabilitiesOf } from '@shared/share-roles'
import { libraryItem, libraryItems, libraryTags, setLibraryItemTags } from '../data/library'
import { linkedItemTitle } from '../data/plan'
import { projectLabels, shareRole, type QueryDb } from '../data/queries'
import { RADIUS, SPACE, useTheme, type Theme } from '../theme'
import { Chip, editErrorText, TextSender } from './EditBits'
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
  const [tag, setTag] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const stopWriting = () => {
    setWriting(false)
    setTitle('')
    setBody('')
  }
  const tags = useMemo(
    () => (version >= 0 ? libraryTags(db, projectId) : []),
    [db, projectId, version]
  )
  // A tag no item carries any more (renamed or removed) stops filtering.
  const shownTag = tag !== null && tags.includes(tag) ? tag : null
  const items = useMemo(
    () => (version >= 0 ? libraryItems(db, projectId, words, shownTag) : []),
    [db, projectId, words, shownTag, version]
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
      {tags.length > 0 && (
        <View style={styles.actions} accessibilityLabel={t('library:libraryRail.tags')}>
          <Chip
            label={t('library:libraryRail.allTags')}
            theme={theme}
            selected={shownTag === null}
            onPress={() => setTag(null)}
          />
          {tags.map((name) => (
            <Chip
              key={name}
              label={`#${name}`}
              theme={theme}
              selected={shownTag === name}
              onPress={() => setTag(shownTag === name ? null : name)}
            />
          ))}
        </View>
      )}
      {items.length === 0 && (
        <Text style={[styles.empty, { color: theme.textMuted }]}>
          {words.trim() || shownTag !== null
            ? t('mobile:project.noMatches')
            : t('mobile:library.empty')}
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
          {item.tags.length > 0 && (
            <Text style={[styles.kind, { color: theme.textMuted }]} numberOfLines={1}>
              {item.tags.map((name) => `#${name}`).join(' ')}
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
  onOpenItem,
  onEdited
}: {
  db: QueryDb
  itemId: string
  version: number
  onBack: () => void
  onOpenItem: (ref: ItemLinkRef) => void
  /** Called after an edit is saved, so every screen reads it again. */
  onEdited: () => void
}) {
  const theme = useTheme()
  const item = useMemo(() => (version >= 0 ? libraryItem(db, itemId) : null), [db, itemId, version])
  const canEdit = useMemo(
    () => item !== null && capabilitiesOf(shareRole(db, item.projectId)).editLibrary,
    [db, item]
  )
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
            {libraryKindLabel(item.kind)}
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
          <TagsPanel
            db={db}
            item={item}
            theme={theme}
            canEdit={canEdit}
            version={version}
            onEdited={onEdited}
          />
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

/**
 * An item's tags, which are the project's labels, as chips. Someone who may edit the Library taps
 * Add a tag to see each of the project's labels to turn on or off, and a box for a new one.
 */
function TagsPanel({
  db,
  item,
  theme,
  canEdit,
  version,
  onEdited
}: {
  db: QueryDb
  item: LibraryItem
  theme: Theme
  canEdit: boolean
  version: number
  onEdited: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const choices = useMemo(() => {
    if (!editing || version < 0) return []
    const names = new Set([...projectLabels(db, item.projectId), ...item.tags])
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [db, item, editing, version])
  /** Saves the tags; false when refused (a Viewer, too many), with the reason shown. */
  const save = (tags: string[]): boolean => {
    try {
      setLibraryItemTags(db, item.id, tags)
    } catch (failure) {
      setError(editErrorText(failure))
      return false
    }
    setError(null)
    onEdited()
    return true
  }
  if (!canEdit && item.tags.length === 0) return null
  const toggle = (name: string) =>
    save(item.tags.includes(name) ? item.tags.filter((tag) => tag !== name) : [...item.tags, name])
  return (
    <View style={styles.form}>
      <Text style={[styles.kind, { color: theme.textMuted }]}>
        {t('library:libraryDetail.tags')}
      </Text>
      <View style={styles.actions} accessibilityLabel={t('library:libraryDetail.tagsItem')}>
        {(editing ? choices : item.tags).map((name) => (
          <Chip
            key={name}
            label={`#${name}`}
            theme={theme}
            selected={item.tags.includes(name)}
            onPress={() => {
              if (editing) toggle(name)
              else if (canEdit) setEditing(true)
            }}
          />
        ))}
        {canEdit && (
          <Chip
            label={editing ? t('mobile:edit.done') : t('library:libraryDetail.addTag')}
            theme={theme}
            onPress={() => setEditing(!editing)}
          />
        )}
      </View>
      {editing && (
        <TextSender
          theme={theme}
          placeholder={t('mobile:edit.newLabel')}
          button={t('mobile:edit.add')}
          onSend={(text) => {
            if (!save([...item.tags, text])) throw new Error('refused')
          }}
        />
      )}
      {error !== null && <Text style={{ color: theme.danger }}>{error}</Text>}
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
