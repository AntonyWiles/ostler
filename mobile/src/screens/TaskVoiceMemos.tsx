import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import type { EditDb } from '../data/edits'
import type { QueryDb } from '../data/queries'
import { addVoiceMemo, taskVoiceMemos, type VoiceMemo } from '../data/voice-memos'
import { storedRecording } from '../data/voice-memo-files'
import { RADIUS, SPACE, type Theme } from '../theme'
import { RecordingPlayer, VoiceMemoRecorder } from './VoiceMemoRecorder'

/**
 * A task's voice memos on the task screen: record one (with its words written out as they are
 * said, when the phone can), check the transcript, and attach it to the task. Each memo is kept
 * in the project's Library and reaches the PC with the next sync. The memos recorded here play
 * on the phone; those recorded elsewhere play on the PC.
 */
export function TaskVoiceMemos({
  db,
  taskId,
  projectId,
  version,
  theme,
  open,
  onEdited
}: {
  db: EditDb & QueryDb
  taskId: string
  projectId: string
  version: number
  theme: Theme
  /** False for an archived or binned task: its memos can be played, not added to. */
  open: boolean
  onEdited: () => void
}) {
  const memos = useMemo(
    () => (version >= 0 ? taskVoiceMemos(db, taskId) : []),
    [db, taskId, version]
  )

  if (memos.length === 0 && !open) return null

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.textSecondary }]}>
        {t('mobile:voiceMemo.title')}
      </Text>

      {memos.map((memo) => (
        <MemoRow key={memo.itemId} memo={memo} theme={theme} />
      ))}

      {open && (
        <VoiceMemoRecorder
          projectId={projectId}
          theme={theme}
          saveLabel={t('mobile:voiceMemo.attach')}
          saveWithTranscriptLabel={t('mobile:voiceMemo.attachWithTranscript')}
          onSave={(memo) => {
            addVoiceMemo(db, taskId, memo)
            onEdited()
          }}
        />
      )}
    </View>
  )
}

/** One memo: play it (when this phone has the recording), and its transcript. */
function MemoRow({ memo, theme }: { memo: VoiceMemo; theme: Theme }) {
  const file = useMemo(() => storedRecording(memo.projectId, memo.itemId), [memo])
  const [expanded, setExpanded] = useState(false)
  return (
    <View style={[styles.memo, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Text style={[styles.body, { color: theme.text }]} numberOfLines={1}>
        {memo.title}
      </Text>
      {file ? (
        <RecordingPlayer uri={file.uri} theme={theme} />
      ) : (
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          {t('mobile:voiceMemo.playOnPc')}
        </Text>
      )}
      {memo.transcript.trim() !== '' && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
        >
          <Text
            style={[styles.body, { color: theme.text }]}
            numberOfLines={expanded ? undefined : 3}
          >
            {memo.transcript}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: SPACE.small, marginTop: SPACE.medium },
  heading: { fontSize: 13, fontWeight: '600' },
  hint: { fontSize: 13 },
  body: { fontSize: 15 },
  memo: { borderWidth: 1, borderRadius: RADIUS, padding: SPACE.medium, gap: SPACE.small }
})
