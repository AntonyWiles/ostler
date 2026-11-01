import { useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { t } from '@shared/i18n/index'
import type { SearchEntityType, SearchResult } from '@shared/ostler-api'
import { projectName } from '../data/project-display'
import type { QueryDb } from '../data/queries'
import { searchPhone } from '../data/search'
import { RADIUS, SPACE, useTheme, type Theme } from '../theme'
import type { InboxTarget } from './Inbox'
import { Icon } from './Icon'

interface Props {
  db: QueryDb
  /** Bumped by the app whenever a pull or an edit changed the database. */
  version: number
  /** The words typed so far: kept by the app, so Back from a result comes back to them. */
  query: string
  onQueryChange: (query: string) => void
  onBack: () => void
  onOpen: (target: InboxTarget) => void
}

/** How long typing pauses before the search runs. */
const DEBOUNCE_MS = 200

/** A result's kind in one word, in the desktop's words. */
function typeLabel(type: SearchEntityType): string {
  switch (type) {
    case 'task':
      return t('views:searchResults.task')
    case 'comment':
      return t('views:searchResults.comment')
    case 'decision':
      return t('views:searchResults.decision')
    case 'milestone':
      return t('views:searchResults.milestone')
    case 'goal':
      return t('views:searchResults.goal')
    case 'library':
      return t('views:searchResults.libraryItem')
    case 'contact':
      return t('views:searchResults.contact')
  }
}

/** A task or a comment opens its task; anything else opens its project. */
function targetOf(result: SearchResult): InboxTarget {
  const taskId = result.type === 'task' ? result.id : result.workItemId
  return taskId ? { kind: 'task', taskId } : { kind: 'project', projectId: result.projectId }
}

/**
 * Search (the desktop's, P5.7): every task, comment, decision, milestone and goal on the phone
 * whose words match, best first, with the matching words marked.
 */
export function Search({ db, version, query, onQueryChange, onBack, onOpen }: Props) {
  const theme = useTheme()
  const [words, setWords] = useState(query)

  useEffect(() => {
    const timer = setTimeout(() => setWords(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  // `version` changes when a pull or an edit changed the database; reading it searches again.
  const { results, failure } = useMemo((): {
    results: SearchResult[] | null
    failure: string | null
  } => {
    if (version < 0 || words.trim() === '') return { results: null, failure: null }
    try {
      return { results: searchPhone(db, words), failure: null }
    } catch (error) {
      return { results: [], failure: error instanceof Error ? error.message : String(error) }
    }
  }, [db, version, words])

  return (
    <View style={styles.page}>
      <View style={[styles.bar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile:task.back')}
          onPress={onBack}
          hitSlop={4}
          style={({ pressed }) => [
            styles.icon,
            pressed && { backgroundColor: theme.surfaceSunken }
          ]}
        >
          <Icon name="arrow-left" color={theme.textSecondary} size={22} />
        </Pressable>
        <TextInput
          autoFocus
          accessibilityLabel={t('views:searchView.search2')}
          placeholder={t('views:searchView.searchProjects')}
          placeholderTextColor={theme.textMuted}
          value={query}
          onChangeText={onQueryChange}
          returnKeyType="search"
          style={[styles.input, { color: theme.text }]}
        />
        {query !== '' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile:search.clear')}
            onPress={() => onQueryChange('')}
            hitSlop={4}
            style={({ pressed }) => [
              styles.icon,
              pressed && { backgroundColor: theme.surfaceSunken }
            ]}
          >
            <Icon name="x" color={theme.textSecondary} />
          </Pressable>
        )}
      </View>
      {failure !== null && (
        <Text
          style={[styles.failure, { color: theme.danger, backgroundColor: theme.dangerSubtle }]}
        >
          {failure}
        </Text>
      )}
      {results === null ? (
        <Text style={[styles.hint, { color: theme.textMuted }]}>{t('mobile:search.hint')}</Text>
      ) : (
        <FlatList
          accessibilityLabel={t('views:searchView.results')}
          keyboardShouldPersistTaps="handled"
          data={results}
          keyExtractor={(result) => `${result.type}:${result.id}`}
          ListHeaderComponent={
            results.length > 0 ? (
              <Text style={[styles.count, { color: theme.textSecondary }]}>
                {t('views:searchView.resultCount', { count: results.length })}
              </Text>
            ) : undefined
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                {t('views:searchView.noResults')}
              </Text>
              <Text style={[styles.hintText, { color: theme.textMuted }]}>
                {t('mobile:search.noResults')}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ResultRow result={item} theme={theme} onPress={() => onOpen(targetOf(item))} />
          )}
        />
      )}
    </View>
  )
}

function ResultRow({
  result,
  theme,
  onPress
}: {
  result: SearchResult
  theme: Theme
  onPress: () => void
}) {
  const kind = typeLabel(result.type)
  const title =
    result.type === 'comment'
      ? t('views:searchView.comment', { resultTitle: result.title })
      : result.title
  const meta = [kind, projectName({ id: result.projectId, name: null })].join(' · ')
  const snippet = result.snippet.map((part) => part.text).join('')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[t('views:searchView.resultName', { kind, title }), snippet]
        .filter((part) => part !== '')
        .join('. ')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.surfaceSunken : theme.surface,
          borderColor: theme.border
        }
      ]}
    >
      <Text numberOfLines={2} style={[styles.title, { color: theme.text }]}>
        {title}
      </Text>
      {snippet !== '' && (
        <Text numberOfLines={3} style={[styles.snippet, { color: theme.textSecondary }]}>
          {result.snippet.map((part, index) =>
            part.match ? (
              <Text
                key={index}
                style={[styles.match, { color: theme.text, backgroundColor: theme.warningSubtle }]}
              >
                {part.text}
              </Text>
            ) : (
              part.text
            )
          )}
        </Text>
      )}
      <Text numberOfLines={1} style={[styles.meta, { color: theme.textMuted }]}>
        {meta}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: SPACE.small / 2,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: RADIUS,
    alignItems: 'center',
    justifyContent: 'center'
  },
  input: { flex: 1, fontSize: 17, paddingHorizontal: SPACE.small, minHeight: 44 },
  failure: { fontSize: 14, paddingHorizontal: SPACE.large, paddingVertical: SPACE.small },
  hint: { fontSize: 15, padding: SPACE.large },
  hintText: { fontSize: 14 },
  count: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: SPACE.large,
    paddingTop: SPACE.large,
    paddingBottom: SPACE.small
  },
  empty: { padding: SPACE.large, gap: SPACE.small },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  row: {
    paddingHorizontal: SPACE.large,
    paddingVertical: SPACE.medium,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
    minHeight: 60
  },
  title: { fontSize: 15, fontWeight: '600' },
  snippet: { fontSize: 14 },
  match: { fontWeight: '600' },
  meta: { fontSize: 12 }
})
