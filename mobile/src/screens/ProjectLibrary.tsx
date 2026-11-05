import { useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatRelativeTime } from '@shared/format'
import type { ItemLinkRef, LibraryItem, LibraryItemKind } from '@shared/ostler-api'
import { capabilitiesOf } from '@shared/share-roles'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { BRAND } from '@shared/brand'
import {
  addLibraryFile,
  addLibraryLink,
  addLibraryNote,
  libraryItem,
  libraryItems,
  libraryTags,
  setLibraryItemTags
} from '../data/library'
import { isAudioMime } from '@shared/audio-files'
import { addLibraryVoiceMemo, newVoiceMemoId } from '../data/voice-memos'
import { forgetRecording, keepPickedFile, storedRecording } from '../data/voice-memo-files'
import { linkedItemTitle } from '../data/plan'
import { projectLabels, shareRole, type QueryDb } from '../data/queries'
import { RADIUS, SPACE, useTheme, type Theme } from '../theme'
import { Chip, editErrorText, TextSender } from './EditBits'
import { Markdown } from './Markdown'
import { TopBar } from './TopBar'
import { RecordingPlayer, VoiceMemoRecorder } from './VoiceMemoRecorder'

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

/**
 * What is being added: a note, a link, a voice memo, or a file already picked (a document or a
 * photo).
 */
type Adding =
  | { kind: 'note' }
  | { kind: 'link' }
  | { kind: 'voice' }
  | { kind: 'file'; uri: string; name: string; mimeType: string | null }

/** Shows the file picker, the gallery or the camera; null when the person backed out. */
async function pickFile(
  source: 'file' | 'photo' | 'camera'
): Promise<Extract<Adding, { kind: 'file' }> | null> {
  if (source === 'file') {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
    const asset = result.canceled ? null : result.assets[0]
    return asset
      ? { kind: 'file', uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? null }
      : null
  }
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) throw new Error(t('mobile:library.noCamera', { brand: BRAND.name }))
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options)
  const asset = result.canceled ? null : result.assets[0]
  if (!asset) return null
  const name = asset.fileName || asset.uri.split('/').pop() || 'photo.jpg'
  return { kind: 'file', uri: asset.uri, name, mimeType: asset.mimeType ?? null }
}

/**
 * A project's Library as a list to read: filter by words, open an item. Someone who may edit the
 * Library adds a note, a link, a file, a photo or a voice memo, with tags, from here.
 */
export function LibraryList({
  db,
  projectId,
  version,
  theme,
  onOpen,
  onAdded
}: {
  db: QueryDb
  projectId: string
  version: number
  theme: Theme
  onOpen: (itemId: string) => void
  /** Called with a new item's id. Left out when the person may not write here. */
  onAdded?: (itemId: string) => void
}) {
  const [words, setWords] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [adding, setAdding] = useState<Adding | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [newTags, setNewTags] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const stopAdding = () => {
    setAdding(null)
    setTitle('')
    setBody('')
    setUrl('')
    setNewTags([])
    setError(null)
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
  const labels = useMemo(
    () => (adding !== null && version >= 0 ? projectLabels(db, projectId) : []),
    [db, projectId, adding, version]
  )
  const pick = (source: 'file' | 'photo' | 'camera') => {
    setError(null)
    pickFile(source).then(
      (file) => {
        if (!file) return
        setAdding(file)
        setTitle(file.name.replace(/\.[a-z0-9]{1,10}$/i, ''))
      },
      (failure: unknown) => setError(editErrorText(failure))
    )
  }
  const save = () => {
    if (adding === null || adding.kind === 'voice') return
    let itemId: string
    try {
      if (adding.kind === 'note') {
        if (!title.trim()) return
        itemId = addLibraryNote(db, projectId, { title, body, tags: newTags }).id
      } else if (adding.kind === 'link') {
        itemId = addLibraryLink(db, projectId, { title, url, tags: newTags }).id
      } else {
        const id = newVoiceMemoId()
        try {
          const kept = keepPickedFile(adding.uri, adding.name, adding.mimeType, projectId, id)
          if (!kept) throw new Error(t('mobile:library.unreadable'))
          itemId = addLibraryFile(db, projectId, { ...kept, title, tags: newTags }).id
        } catch (failure) {
          forgetRecording(projectId, id)
          throw failure
        }
      }
    } catch (failure) {
      setError(editErrorText(failure))
      return
    }
    stopAdding()
    onAdded?.(itemId)
  }
  const field = [styles.input, { color: theme.text, borderColor: theme.borderStrong }]
  const tagPicker = (
    <>
      <Text style={[styles.kind, { color: theme.textMuted }]}>
        {t('library:libraryDetail.tags')}
      </Text>
      <TagChoices
        theme={theme}
        choices={labels}
        selected={newTags}
        onChange={(next) => {
          setNewTags(next)
          return true
        }}
      />
    </>
  )
  return (
    <View style={styles.list}>
      {onAdded !== undefined && adding === null && (
        <View style={styles.actions}>
          <Chip
            label={t('mobile:library.newNote')}
            theme={theme}
            onPress={() => setAdding({ kind: 'note' })}
          />
          <Chip
            label={t('mobile:library.newLink')}
            theme={theme}
            onPress={() => setAdding({ kind: 'link' })}
          />
          <Chip label={t('mobile:library.addFile')} theme={theme} onPress={() => pick('file')} />
          <Chip label={t('mobile:library.addPhoto')} theme={theme} onPress={() => pick('photo')} />
          <Chip
            label={t('mobile:library.takePhoto')}
            theme={theme}
            onPress={() => pick('camera')}
          />
          <Chip
            label={t('mobile:voiceMemo.record')}
            theme={theme}
            onPress={() => {
              setError(null)
              setAdding({ kind: 'voice' })
            }}
          />
        </View>
      )}
      {onAdded !== undefined && adding?.kind === 'voice' && (
        <View
          style={[
            styles.card,
            styles.form,
            { backgroundColor: theme.surface, borderColor: theme.accent }
          ]}
        >
          <VoiceMemoRecorder
            projectId={projectId}
            theme={theme}
            saveLabel={t('mobile:voiceMemo.saveToLibrary')}
            saveWithTranscriptLabel={t('mobile:voiceMemo.saveWithTranscript')}
            onSave={(memo) => {
              const item = addLibraryVoiceMemo(db, projectId, {
                ...memo,
                title: title.trim() || memo.title,
                tags: newTags
              })
              onAdded(item.id)
            }}
            onClose={stopAdding}
          >
            <TextInput
              accessibilityLabel={t('mobile:library.noteTitle')}
              placeholder={t('mobile:library.linkTitle')}
              placeholderTextColor={theme.textMuted}
              value={title}
              onChangeText={setTitle}
              style={field}
            />
            {tagPicker}
          </VoiceMemoRecorder>
        </View>
      )}
      {onAdded !== undefined && adding !== null && adding.kind !== 'voice' && (
        <View
          style={[
            styles.card,
            styles.form,
            { backgroundColor: theme.surface, borderColor: theme.accent }
          ]}
        >
          {adding.kind === 'file' && (
            <Text style={[styles.kind, { color: theme.textMuted }]}>{adding.name}</Text>
          )}
          {adding.kind === 'link' && (
            <TextInput
              accessibilityLabel={t('mobile:library.linkUrl')}
              placeholder={t('mobile:library.linkUrl')}
              placeholderTextColor={theme.textMuted}
              value={url}
              onChangeText={setUrl}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={field}
            />
          )}
          <TextInput
            accessibilityLabel={t('mobile:library.noteTitle')}
            placeholder={
              adding.kind === 'link' ? t('mobile:library.linkTitle') : t('mobile:library.noteTitle')
            }
            placeholderTextColor={theme.textMuted}
            value={title}
            onChangeText={setTitle}
            autoFocus={adding.kind === 'note'}
            style={field}
          />
          {adding.kind === 'note' && (
            <TextInput
              accessibilityLabel={t('mobile:library.noteBody')}
              placeholder={t('mobile:library.noteBody')}
              placeholderTextColor={theme.textMuted}
              value={body}
              onChangeText={setBody}
              multiline
              style={[...field, styles.noteBody]}
            />
          )}
          {tagPicker}
          {error !== null && <Text style={{ color: theme.danger }}>{error}</Text>}
          <View style={styles.actions}>
            <Chip label={t('mobile:edit.save')} theme={theme} selected onPress={save} />
            <Chip label={t('mobile:taskMenu.cancel')} theme={theme} onPress={stopAdding} />
          </View>
        </View>
      )}
      {adding === null && error !== null && <Text style={{ color: theme.danger }}>{error}</Text>}
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
 * a link's address to open, or what a document or picture is. A recording this phone has plays here.
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
  return (
    <View style={styles.form}>
      <Text style={[styles.kind, { color: theme.textMuted }]}>
        {t('library:libraryDetail.tags')}
      </Text>
      {editing && (
        <TagChoices theme={theme} choices={choices} selected={item.tags} onChange={save} />
      )}
      <View style={styles.actions} accessibilityLabel={t('library:libraryDetail.tagsItem')}>
        {(editing ? [] : item.tags).map((name) => (
          <Chip
            key={name}
            label={`#${name}`}
            theme={theme}
            selected={item.tags.includes(name)}
            onPress={() => {
              if (canEdit) setEditing(true)
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
      {error !== null && <Text style={{ color: theme.danger }}>{error}</Text>}
    </View>
  )
}

/**
 * The project's labels as chips to turn on or off for an item, and a box for a new one. `onChange`
 * says whether the new tags were kept, so a refused new label stays typed.
 */
function TagChoices({
  theme,
  choices,
  selected,
  onChange
}: {
  theme: Theme
  choices: string[]
  selected: string[]
  onChange: (tags: string[]) => boolean
}) {
  const names = [...new Set([...choices, ...selected])].sort((a, b) => a.localeCompare(b))
  return (
    <View style={styles.form}>
      <View style={styles.actions} accessibilityLabel={t('library:libraryDetail.tagsItem')}>
        {names.map((name) => (
          <Chip
            key={name}
            label={`#${name}`}
            theme={theme}
            selected={selected.includes(name)}
            onPress={() =>
              onChange(
                selected.includes(name)
                  ? selected.filter((tag) => tag !== name)
                  : [...selected, name]
              )
            }
          />
        ))}
      </View>
      <TextSender
        theme={theme}
        placeholder={t('mobile:edit.newLabel')}
        button={t('mobile:edit.add')}
        onSend={(text) => {
          if (!onChange([...selected, text.trim()])) throw new Error('refused')
        }}
      />
    </View>
  )
}

/** A file's name and size, and where it is: on this phone (a recording plays) or on the PC. */
function FileNote({ item, theme }: { item: LibraryItem; theme: Theme }) {
  const file = item.file!
  const stored = useMemo(() => storedRecording(item.projectId, item.id), [item.projectId, item.id])
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
        {size} · {stored ? t('mobile:library.fileOnPhone') : t('mobile:library.fileOnPc')}
      </Text>
      {stored && isAudioMime(file.mimeType) && <RecordingPlayer uri={stored.uri} theme={theme} />}
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
