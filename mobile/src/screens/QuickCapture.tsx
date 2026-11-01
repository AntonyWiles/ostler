import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { addTask, type EditDb } from '../data/edits'
import { projectName } from '../data/project-display'
import { projects, type QueryDb } from '../data/queries'
import { RADIUS, SPACE, type Theme } from '../theme'
import { Chip, editErrorText, TextSender } from './EditBits'

/** The project the last capture went to, offered first next time while the app runs. */
let lastProject: string | null = null

/**
 * Quick capture: one line into a project's To triage, to sort out later on either device. The
 * project chosen last time is chosen again.
 */
export function QuickCapture({
  db,
  theme,
  onCaptured,
  onClose
}: {
  db: EditDb & QueryDb
  theme: Theme
  /** After a capture, with its project's name, so the app pushes it and says where it went. */
  onCaptured: (projectId: string, title: string) => void
  onClose: () => void
}) {
  const list = useMemo(
    () =>
      projects(db)
        .map((project) => ({ id: project.id, name: projectName(project) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [db]
  )
  const [projectId, setProjectId] = useState<string | null>(
    lastProject !== null && list.some((p) => p.id === lastProject)
      ? lastProject
      : (list[0]?.id ?? null)
  )
  const [error, setError] = useState<string | null>(null)
  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.title, { color: theme.text }]}>{t('mobile:capture.title')}</Text>
      {list.length === 0 ? (
        <Text style={[styles.meta, { color: theme.textMuted }]}>{t('mobile:projects.empty')}</Text>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {list.map((project) => (
              <Chip
                key={project.id}
                label={project.name}
                theme={theme}
                selected={projectId === project.id}
                onPress={() => setProjectId(project.id)}
              />
            ))}
          </ScrollView>
          <TextSender
            theme={theme}
            placeholder={t('mobile:capture.placeholder')}
            button={t('mobile:capture.add')}
            autoFocus
            onSend={(text) => {
              if (projectId === null || !text.trim()) throw new Error('empty')
              try {
                addTask(db, projectId, text, { triage: true })
              } catch (failure) {
                setError(editErrorText(failure))
                throw failure
              }
              setError(null)
              lastProject = projectId
              onCaptured(projectId, text.trim())
            }}
          />
          <Text style={[styles.meta, { color: theme.textMuted }]}>{t('mobile:capture.hint')}</Text>
        </>
      )}
      {error !== null && <Text style={[styles.meta, { color: theme.danger }]}>{error}</Text>}
      <View style={styles.row}>
        <Chip label={t('mobile:capture.close')} theme={theme} onPress={onClose} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    margin: SPACE.medium,
    padding: SPACE.medium,
    gap: SPACE.small,
    borderWidth: 1,
    borderRadius: RADIUS
  },
  title: { fontSize: 16, fontWeight: '700' },
  chips: { gap: SPACE.small },
  meta: { fontSize: 13 },
  row: { flexDirection: 'row', justifyContent: 'flex-end' }
})
