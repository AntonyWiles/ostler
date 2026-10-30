import { useMemo } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { projectColor, projectName } from '../data/project-display'
import { projects, type QueryDb } from '../data/queries'
import { SPACE, useTheme } from '../theme'
import { Icon } from './Icon'

interface Props {
  db: QueryDb
  /** Bumped by the app whenever a pull changed the database. */
  version: number
  onOpenProject: (projectId: string) => void
}

/** The projects on this phone: each one's colour and name, and how many tasks are open and done. */
export function Projects({ db, version, onOpenProject }: Props) {
  const theme = useTheme()
  // `version` changes when a pull changed the database; reading it re-runs the query.
  const list = useMemo(
    () =>
      (version >= 0 ? projects(db) : [])
        .map((project) => ({ ...project, name: projectName(project) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [db, version]
  )
  if (list.length === 0) {
    return (
      <Text style={[styles.empty, { color: theme.textMuted }]}>{t('mobile:projects.empty')}</Text>
    )
  }
  return (
    <FlatList
      accessibilityLabel={t('mobile:projects.list')}
      data={list}
      keyExtractor={(project) => project.id}
      renderItem={({ item }) => {
        const name = item.name
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile:projects.rowLabel', {
              name,
              open: item.openCount,
              done: item.doneCount
            })}
            onPress={() => onOpenProject(item.id)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? theme.surfaceSunken : theme.surface,
                borderColor: theme.border
              }
            ]}
          >
            <View style={[styles.swatch, { backgroundColor: projectColor(item) }]} />
            <View style={styles.text}>
              <Text style={[styles.name, { color: theme.text }]}>{name}</Text>
              <Text style={[styles.meta, { color: theme.textMuted }]}>
                {t('mobile:projects.counts', { open: item.openCount, done: item.doneCount })}
              </Text>
            </View>
            <Icon name="chevron-right" color={theme.textMuted} />
          </Pressable>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  empty: { padding: SPACE.large, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.medium,
    paddingHorizontal: SPACE.large,
    paddingVertical: SPACE.medium,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 60
  },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13 }
})
