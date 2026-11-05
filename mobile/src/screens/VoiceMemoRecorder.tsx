import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder
} from 'expo-audio'
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition'
import { t } from '@shared/i18n/index'
import { BRAND } from '@shared/brand'
import { AUDIO_MIME, formatAudioDuration } from '@shared/audio-files'
import { formatDateTime } from '@shared/format'
import { newVoiceMemoId, type VoiceMemoInput } from '../data/voice-memos'
import {
  discardRecording,
  forgetRecording,
  keepRecording,
  readRecording
} from '../data/voice-memo-files'
import { RADIUS, SPACE, type Theme } from '../theme'
import { Chip, editErrorText } from './EditBits'
import { elapsedText, useTick } from './TaskTime'

/** The speech service that can transcribe without sending the sound anywhere, when its language is installed. */
const ON_DEVICE_SERVICE = 'com.google.android.as'

type Transcription = 'unavailable' | 'on-device' | 'online'

/** The phone's language as a speech locale, e.g. `en-GB`. */
function speechLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US'
  } catch {
    return 'en-US'
  }
}

/** Whether this phone can record and transcribe at once, and whether that stays on the phone. */
async function transcriptionHere(locale: string): Promise<Transcription> {
  if (Platform.OS !== 'android') return 'unavailable'
  try {
    if (
      !ExpoSpeechRecognitionModule.isRecognitionAvailable() ||
      !ExpoSpeechRecognitionModule.supportsRecording()
    ) {
      return 'unavailable'
    }
    if (ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({
        androidRecognitionServicePackage: ON_DEVICE_SERVICE
      })
      const language = locale.split('-')[0].toLowerCase()
      if (installedLocales.some((installed) => installed.toLowerCase().startsWith(language))) {
        return 'on-device'
      }
    }
    return 'online'
  } catch {
    return 'unavailable'
  }
}

/** `voice-memo-2026-11-05-1402.m4a` */
function memoFileName(at: Date, extension: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `voice-memo-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-` +
    `${pad(at.getHours())}${pad(at.getMinutes())}.${extension}`
  )
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number; transcribing: boolean }
  | { kind: 'stopping'; startedAt: number; transcribing: boolean }
  | { kind: 'review'; uri: string; durationMs: number; transcribing: boolean }
  | { kind: 'saving' }

/**
 * Records a voice memo (with its words written out as they are said, when the phone can), lets
 * the person check the transcript, then stores the recording in a new Library item's folder and
 * hands it to `onSave`, which writes the rows. A failed save removes the stored recording.
 * `children` shows under the transcript while reviewing (a title and tags, say).
 */
export function VoiceMemoRecorder({
  projectId,
  theme,
  saveLabel,
  saveWithTranscriptLabel,
  onSave,
  onClose,
  children
}: {
  projectId: string
  theme: Theme
  /** The save button when there is no transcript to keep, e.g. Attach to task. */
  saveLabel: string
  /** The save button that keeps the transcript, e.g. Attach with transcript. */
  saveWithTranscriptLabel: string
  /** Writes the memo's rows; throws to refuse (the reason is shown, the review stays open). */
  onSave: (memo: VoiceMemoInput) => void
  /** When given, a Cancel button shows beside Record, and this runs after a save or a discard. */
  onClose?: () => void
  children?: ReactNode
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const locale = useMemo(speechLocale, [])
  const [transcription, setTranscription] = useState<Transcription>('unavailable')
  const [transcribe, setTranscribe] = useState(true)
  /** Words the recogniser has settled on, and the ones it is still hearing. */
  const [heard, setHeard] = useState('')
  const [hearing, setHearing] = useState('')
  const [transcript, setTranscript] = useState('')
  const heardRef = useRef('')
  const hearingRef = useRef('')
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const stageRef = useRef(stage)
  stageRef.current = stage
  const recordingUri = useRef<string | null>(null)

  useEffect(() => {
    let current = true
    void transcriptionHere(locale).then((found) => {
      if (current) setTranscription(found)
    })
    return () => {
      current = false
    }
  }, [locale])

  const active = stage.kind === 'recording' || stage.kind === 'stopping'
  const now = useTick(active)

  // ─── Transcribing recorder (the speech service records the sound as it listens) ───
  useSpeechRecognitionEvent('result', (event) => {
    const words = event.results[0]?.transcript ?? ''
    // Kept in refs too: the service can end right after its last result, before a render.
    if (event.isFinal) {
      heardRef.current = [heardRef.current, words.trim()].filter(Boolean).join(' ')
      hearingRef.current = ''
    } else {
      hearingRef.current = words
    }
    setHeard(heardRef.current)
    setHearing(hearingRef.current)
  })
  useSpeechRecognitionEvent('audioend', (event) => {
    if (event.uri) recordingUri.current = event.uri
  })
  useSpeechRecognitionEvent('error', (event) => {
    // Silence or nothing understood is not a failure: the sound is still kept.
    if (event.error === 'no-speech' || event.error === 'aborted') return
    setError(t('mobile:voiceMemo.transcribeFailed', { message: event.message || event.error }))
  })
  useSpeechRecognitionEvent('end', () => {
    const at = stageRef.current
    if (at.kind !== 'recording' && at.kind !== 'stopping') return
    if (!at.transcribing) return
    // The service stops by itself too (a long pause): what was recorded so far is the memo.
    finish(at.startedAt, true, recordingUri.current)
  })

  const finish = (startedAt: number, transcribing: boolean, uri: string | null) => {
    if (!uri) {
      setStage({ kind: 'idle' })
      setError(t('mobile:voiceMemo.nothingRecorded'))
      return
    }
    setTranscript([heardRef.current, hearingRef.current.trim()].filter(Boolean).join(' '))
    hearingRef.current = ''
    setHearing('')
    setStage({ kind: 'review', uri, durationMs: Date.now() - startedAt, transcribing })
  }

  const start = async () => {
    setError(null)
    heardRef.current = ''
    hearingRef.current = ''
    setHeard('')
    setHearing('')
    setTranscript('')
    recordingUri.current = null
    const transcribing = transcribe && transcription !== 'unavailable'
    try {
      if (transcribing) {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
        if (!permission.granted) {
          setError(t('mobile:voiceMemo.noMicrophone', { brand: BRAND.name }))
          return
        }
        ExpoSpeechRecognitionModule.start({
          lang: locale,
          interimResults: true,
          continuous: true,
          addsPunctuation: true,
          requiresOnDeviceRecognition: transcription === 'on-device',
          ...(transcription === 'on-device'
            ? { androidRecognitionServicePackage: ON_DEVICE_SERVICE }
            : {}),
          recordingOptions: { persist: true, outputSampleRate: 16000 }
        })
      } else {
        const permission = await requestRecordingPermissionsAsync()
        if (!permission.granted) {
          setError(t('mobile:voiceMemo.noMicrophone', { brand: BRAND.name }))
          return
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        await recorder.prepareToRecordAsync()
        recorder.record()
      }
      setStage({ kind: 'recording', startedAt: Date.now(), transcribing })
    } catch (failure) {
      setStage({ kind: 'idle' })
      setError(t('mobile:voiceMemo.recordFailed', { message: editErrorText(failure) }))
    }
  }

  const stop = async () => {
    if (stage.kind !== 'recording') return
    setStage({ ...stage, kind: 'stopping' })
    if (stage.transcribing) {
      // The `end` event finishes it, once the service has written the file.
      ExpoSpeechRecognitionModule.stop()
      return
    }
    try {
      await recorder.stop()
    } finally {
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined)
    }
    finish(stage.startedAt, false, recorder.uri)
  }

  const cancel = async () => {
    if (stage.kind === 'recording' || stage.kind === 'stopping') {
      if (stage.transcribing) ExpoSpeechRecognitionModule.abort()
      else await recorder.stop().catch(() => undefined)
      setStage({ kind: 'idle' })
      const uri = stage.transcribing ? recordingUri.current : recorder.uri
      if (uri) discardRecording(uri)
      return
    }
    if (stage.kind === 'review') {
      discardRecording(stage.uri)
      setStage({ kind: 'idle' })
      onClose?.()
    }
  }

  const save = async (withTranscript: boolean) => {
    if (stage.kind !== 'review') return
    const review = stage
    setStage({ kind: 'saving' })
    setError(null)
    const recording = readRecording(review.uri)
    if (!recording || !AUDIO_MIME[recording.extension]) {
      setStage({ kind: 'idle' })
      setError(t('mobile:voiceMemo.nothingRecorded'))
      return
    }
    const itemId = newVoiceMemoId()
    const at = new Date()
    try {
      await keepRecording(recording, projectId, itemId)
      onSave({
        itemId,
        title: t('mobile:voiceMemo.memoTitle', { when: formatDateTime(at.getTime()) }),
        fileName: memoFileName(at, recording.extension),
        mimeType: AUDIO_MIME[recording.extension],
        sizeBytes: recording.sizeBytes,
        sha256: recording.sha256,
        durationMs: review.durationMs,
        transcript: withTranscript ? transcript : ''
      })
    } catch (failure) {
      forgetRecording(projectId, itemId)
      setStage(review)
      setError(editErrorText(failure))
      return
    }
    setStage({ kind: 'idle' })
    onClose?.()
  }

  const confirmCancel = () =>
    Alert.alert(t('mobile:voiceMemo.discardTitle'), t('mobile:voiceMemo.discardBody'), [
      { text: t('mobile:taskMenu.cancel'), style: 'cancel' },
      {
        text: t('mobile:voiceMemo.discard'),
        style: 'destructive',
        onPress: () => void cancel()
      }
    ])

  const elapsed =
    stage.kind === 'recording' || stage.kind === 'stopping' ? (now - stage.startedAt) / 1000 : 0
  const live = [heard, hearing].filter(Boolean).join(' ')

  return (
    <View style={styles.section}>
      {error !== null && (
        <Text style={[styles.error, { color: theme.danger, backgroundColor: theme.dangerSubtle }]}>
          {error}
        </Text>
      )}

      {stage.kind === 'idle' && (
        <View style={styles.row}>
          <Chip
            label={t('mobile:voiceMemo.record')}
            theme={theme}
            selected
            onPress={() => void start()}
          />
          {transcription !== 'unavailable' && (
            <Chip
              label={t('mobile:voiceMemo.transcribe')}
              theme={theme}
              selected={transcribe}
              onPress={() => setTranscribe(!transcribe)}
            />
          )}
          {onClose !== undefined && (
            <Chip label={t('mobile:taskMenu.cancel')} theme={theme} onPress={onClose} />
          )}
        </View>
      )}
      {stage.kind === 'idle' && transcribe && transcription !== 'unavailable' && (
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          {transcription === 'on-device'
            ? t('mobile:voiceMemo.onDevice')
            : t('mobile:voiceMemo.online')}
        </Text>
      )}

      {active && (
        <View
          style={[styles.panel, { borderColor: theme.danger, backgroundColor: theme.dangerSubtle }]}
        >
          <View style={styles.recordingRow}>
            <Text style={[styles.dot, { color: theme.danger }]}>●</Text>
            <Text style={[styles.clock, { color: theme.text }]}>{elapsedText(elapsed)}</Text>
            <View style={styles.spacer} />
            <Chip
              label={t('mobile:voiceMemo.stop')}
              theme={theme}
              selected
              onPress={() => void stop()}
            />
            <Chip label={t('mobile:taskMenu.cancel')} theme={theme} onPress={confirmCancel} />
          </View>
          {stage.transcribing && (
            <Text style={[styles.live, { color: live ? theme.text : theme.textMuted }]}>
              {live || t('mobile:voiceMemo.listening')}
            </Text>
          )}
        </View>
      )}

      {stage.kind === 'review' && (
        <View style={[styles.panel, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <Text style={[styles.body, { color: theme.text }]}>
            {t('mobile:voiceMemo.recorded', { duration: formatAudioDuration(stage.durationMs) })}
          </Text>
          {stage.transcribing && (
            <TextInput
              accessibilityLabel={t('mobile:voiceMemo.transcript')}
              placeholder={t('mobile:voiceMemo.noWords')}
              placeholderTextColor={theme.textMuted}
              multiline
              value={transcript}
              onChangeText={setTranscript}
              style={[styles.input, { color: theme.text, borderColor: theme.borderStrong }]}
            />
          )}
          {children}
          <View style={styles.row}>
            {stage.transcribing && transcript.trim() !== '' ? (
              <>
                <Chip
                  label={saveWithTranscriptLabel}
                  theme={theme}
                  selected
                  onPress={() => void save(true)}
                />
                <Chip
                  label={t('mobile:voiceMemo.attachAudioOnly')}
                  theme={theme}
                  onPress={() => void save(false)}
                />
              </>
            ) : (
              <Chip label={saveLabel} theme={theme} selected onPress={() => void save(false)} />
            )}
            <Chip label={t('mobile:voiceMemo.discard')} theme={theme} onPress={confirmCancel} />
          </View>
        </View>
      )}
      {stage.kind === 'saving' && (
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          {t('mobile:voiceMemo.saving')}
        </Text>
      )}
    </View>
  )
}

/** A play / pause button for a recording this phone has, with where it is up to. */
export function RecordingPlayer({ uri, theme }: { uri: string; theme: Theme }) {
  const player = useAudioPlayer({ uri })
  const status = useAudioPlayerStatus(player)
  const toggle = () => {
    if (status.playing) {
      player.pause()
      return
    }
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
      void player.seekTo(0)
    }
    player.play()
  }
  return (
    <View style={styles.recordingRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          status.playing ? t('mobile:voiceMemo.pause') : t('mobile:voiceMemo.play')
        }
        onPress={toggle}
        hitSlop={SPACE.small}
        style={[styles.play, { backgroundColor: theme.accent }]}
      >
        <Text style={{ color: theme.accentContrast, fontSize: 16 }}>
          {status.playing ? '❚❚' : '▶'}
        </Text>
      </Pressable>
      <Text style={[styles.hint, { color: theme.textMuted }]}>
        {status.duration > 0
          ? `${formatAudioDuration(status.currentTime * 1000)} / ${formatAudioDuration(status.duration * 1000)}`
          : formatAudioDuration(0)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: SPACE.small },
  error: { padding: SPACE.small, borderRadius: RADIUS, fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small, alignItems: 'center' },
  hint: { fontSize: 13 },
  body: { fontSize: 15 },
  panel: { borderWidth: 1, borderRadius: RADIUS, padding: SPACE.medium, gap: SPACE.small },
  recordingRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.small },
  dot: { fontSize: 18 },
  clock: { fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  spacer: { flex: 1 },
  live: { fontSize: 15, minHeight: 40 },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.medium,
    paddingVertical: SPACE.small,
    fontSize: 15,
    textAlignVertical: 'top'
  },
  play: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }
})
