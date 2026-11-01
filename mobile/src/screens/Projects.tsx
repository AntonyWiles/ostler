import { useMemo } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { projectColor, projectName } from '../data/project-display'
import { projects, today, type QueryDb } from '../data/queries'
import { projectAttention, type ProjectAttention } from '../data/plan'
import { needsYou, needsYouCounts } from '../data/needs-you'
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
  const attention = useMemo(
    () => (version >= 0 ? projectAttention(db, today()) : new Map<string, ProjectAttention>()),
    [db, version]
  )
  // Blocked on the person and in review, per project, as the Needs you tab counts them.
  const asks = useMemo(
    () =>
      version >= 0
        ? needsYouCounts(needsYou(db, today()))
        : new Map<string, { blocked: number; review: number }>(),
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
              {(() => {
                const wants = attention.get(item.id)
                if (!wants) return null
                const parts: { text: string; color: string }[] = []
                if (wants.active > 0)
                  parts.push({
                    text: t('mobile:projects.active', { count: wants.active }),
                    color: theme.textSecondary
                  })
                if (wants.overdue > 0)
                  parts.push({
                    text: t('mobile:projects.overdue', { count: wants.overdue }),
                    color: theme.danger
                  })
                if (wants.triage > 0)
                  parts.push({
                    text: t('mobile:projects.triage', { count: wants.triage }),
                    color: theme.warning
                  })
                if (wants.signOffs > 0)
                  parts.push({
                    text: t('mobile:projects.signOffs', { count: wants.signOffs }),
                    color: theme.accent
                  })
                if (parts.length === 0) return null
                return (
                  <Text style={styles.meta}>
                    {parts.map((part, index) => (
                      <Text key={part.text} style={{ color: part.color }}>
                        {index > 0 ? ' · ' : ''}
                        {part.text}
                      </Text>
                    ))}
                  </Text>
                )
              })()}
              {(() => {
                const waiting = asks.get(item.id)
                if (!waiting) return null
                const parts = [
                  waiting.blocked > 0
                    ? t('mobile:projects.blockedOnYou', { count: waiting.blocked })
                    : null,
                  waiting.review > 0
                    ? t('mobile:projects.toReview', { count: waiting.review })
                    : null
                ].filter((part): part is string => part !== null)
                if (parts.length === 0) return null
                return (
                  <Text style={[styles.meta, { color: theme.warning }]}>
                    {t('mobile:projects.needsYou', { what: parts.join(' · ') })}
                  </Text>
                )
              })()}
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
