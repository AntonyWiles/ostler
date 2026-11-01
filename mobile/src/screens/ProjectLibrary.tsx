import { useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatRelativeTime } from '@shared/format'
import type { ItemLinkRef, LibraryItem, LibraryItemKind } from '@shared/ostler-api'
import { libraryItem, libraryItems } from '../data/library'
import { linkedItemTitle } from '../data/plan'
import type { QueryDb } from '../data/queries'
import { RADIUS, SPACE, useTheme, type Theme } from '../theme'
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
  onOpen
}: {
  db: QueryDb
  projectId: string
  version: number
  theme: Theme
  onOpen: (itemId: string) => void
}) {
  const [words, setWords] = useState('')
  const items = useMemo(
    () => (version >= 0 ? libraryItems(db, projectId, words) : []),
    [db, projectId, words, version]
  )
  return (
    <View style={styles.list}>
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
  fileName: { fontSize: 15, fontWeight: '600' }
})
