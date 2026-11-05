import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { t } from '@shared/i18n/index'
import { BRAND } from '@shared/brand'
import type { EditDb } from '../data/edits'
import { projectName } from '../data/project-display'
import { projectLabels, projects, type QueryDb } from '../data/queries'
import {
  defaultShareProject,
  shareAsTask,
  shareTitle,
  shareToLibrary,
  type KeptShareFile,
  type SharePayload
} from '../data/share-intake'
import { forgetRecording, keepPickedFile } from '../data/voice-memo-files'
import { newVoiceMemoId } from '../data/voice-memos'
import { SPACE, type Theme } from '../theme'
import { Chip, editErrorText } from './EditBits'
import { formStyles } from './formStyles'
import { TagChoices } from './ProjectLibrary'
import { TopBar } from './TopBar'

/** Where the project a share went to last is kept, so the next share starts there. */
const LAST_PROJECT_KEY = 'ostler.share.lastProject'

/**
 * What another app shared, on its way into Ostler: pick the project (the one used last comes
 * first), then make a new task (the shared files attached) or add it to the project's Library
 * (a link, a note or the files, with tags).
 */
export function ShareTarget({
  db,
  share,
  theme,
  onDone,
  onCancel
}: {
  db: EditDb & QueryDb
  share: SharePayload
  theme: Theme
  /** After saving, with what to tell the person. */
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const form = formStyles(theme)
  const list = useMemo(
    () =>
      projects(db)
        .map((project) => ({ id: project.id, name: projectName(project) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [db]
  )
  const [projectId, setProjectId] = useState<string | null>(() =>
    defaultShareProject(
      list.map((p) => p.id),
      null
    )
  )
  // A project picked before the stored one is read wins.
  const chosen = useRef(false)
  useEffect(() => {
    void SecureStore.getItemAsync(LAST_PROJECT_KEY)
      .then((last) => {
        if (chosen.current) return
        const next = defaultShareProject(
          list.map((p) => p.id),
          last
        )
        if (next !== null) setProjectId(next)
      })
      .catch(() => {})
  }, [list])
  const [mode, setMode] = useState<'task' | 'library'>('task')
  const [title, setTitle] = useState(() => shareTitle(share))
  const [tags, setTags] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const labels = useMemo(
    () => (projectId !== null && mode === 'library' ? projectLabels(db, projectId) : []),
    [db, projectId, mode]
  )

  const save = () => {
    if (projectId === null) return
    setError(null)
    const kept: KeptShareFile[] = []
    try {
      for (const file of share.files) {
        const id = newVoiceMemoId()
        const stored = keepPickedFile(file.uri, file.name, file.mimeType, projectId, id)
        if (!stored) {
          forgetRecording(projectId, id)
          throw new Error(t('mobile:library.unreadable'))
        }
        kept.push(stored)
      }
      const name = projectName({ id: projectId, name: null })
      if (mode === 'task') {
        shareAsTask(db, projectId, share, title, kept)
        onDone(t('mobile:share.taskDone', { project: name }))
      } else {
        shareToLibrary(db, projectId, share, { title, tags }, kept)
        onDone(t('mobile:share.libraryDone', { project: name }))
      }
      void SecureStore.setItemAsync(LAST_PROJECT_KEY, projectId).catch(() => {})
    } catch (failure) {
      for (const file of kept) forgetRecording(projectId, file.itemId)
      setError(
        failure instanceof Error && failure.message === t('mobile:library.unreadable')
          ? failure.message
          : editErrorText(failure)
      )
    }
  }

  return (
    <View style={styles.page}>
      <TopBar
        theme={theme}
        title={t('mobile:share.title', { brand: BRAND.name })}
        onBack={onCancel}
      />
      <ScrollView contentContainerStyle={form.container} keyboardShouldPersistTaps="handled">
        {list.length === 0 ? (
          <Text style={form.muted}>{t('mobile:projects.empty')}</Text>
        ) : (
          <>
            <Text style={form.heading}>{t('mobile:share.project')}</Text>
            <View style={styles.chips}>
              {list.map((project) => (
                <Chip
                  key={project.id}
                  label={project.name}
                  theme={theme}
                  selected={projectId === project.id}
                  onPress={() => {
                    chosen.current = true
                    setProjectId(project.id)
                    setTags([])
                  }}
                />
              ))}
            </View>
            <View style={styles.chips}>
              <Chip
                label={t('mobile:share.newTask')}
                theme={theme}
                selected={mode === 'task'}
                onPress={() => setMode('task')}
              />
              <Chip
                label={t('mobile:share.toLibrary')}
                theme={theme}
                selected={mode === 'library'}
                onPress={() => setMode('library')}
              />
            </View>
            <TextInput
              accessibilityLabel={t('mobile:library.noteTitle')}
              placeholder={
                mode === 'task' ? t('mobile:library.noteTitle') : t('mobile:library.linkTitle')
              }
              placeholderTextColor={theme.textMuted}
              value={title}
              onChangeText={setTitle}
              style={[form.input, styles.title]}
            />
            {share.url !== null && <Text style={form.muted}>{share.url}</Text>}
            {share.files.length > 0 && (
              <Text style={form.muted}>
                {t('mobile:share.files', { number: share.files.length })}
                {' · '}
                {share.files.map((file) => file.name).join(', ')}
              </Text>
            )}
            {mode === 'library' && projectId !== null && (
              <>
                <Text style={form.heading}>{t('library:libraryDetail.tags')}</Text>
                <TagChoices
                  theme={theme}
                  choices={labels}
                  selected={tags}
                  onChange={(next) => {
                    setTags(next)
                    return true
                  }}
                />
              </>
            )}
            <View style={form.row}>
              <Pressable
                accessibilityRole="button"
                onPress={save}
                disabled={projectId === null || (mode === 'task' && !title.trim())}
                style={form.button}
              >
                <Text style={form.buttonText}>
                  {mode === 'task' ? t('mobile:share.newTask') : t('mobile:share.toLibrary')}
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={onCancel} style={form.secondaryButton}>
                <Text style={form.secondaryButtonText}>{t('mobile:share.cancel')}</Text>
              </Pressable>
            </View>
          </>
        )}
        {error !== null && <Text style={{ color: theme.danger }}>{error}</Text>}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small },
  title: { minHeight: 44 }
})
