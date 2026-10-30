import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { BRAND } from '../../../src/shared/brand'
import { findInvite } from '../../../src/shared/deep-link'
import { t } from '@shared/i18n/index'
import { useTheme } from '../theme'
import { formStyles } from './formStyles'
import { TopBar } from './TopBar'
import { joinErrorKey, type PhoneSync, type SharedProject } from '../sync/phone-sync'
import { projectNameOf, rememberProjectColor, rememberProjectName } from '../sync/project-names'

const STATUS_KEY = {
  'catching-up': 'mobile:join.status.catchingUp',
  'up-to-date': 'mobile:join.status.upToDate',
  problems: 'mobile:join.status.problems',
  'cannot-reach-drive': 'mobile:join.status.cannotReach'
} as const

interface Props {
  /** Null until the person has signed in (the sync loop is made after sign-in). */
  sync: PhoneSync | null
  /** Bumped by the app whenever a share's state or data changed. */
  version: number
  /** An invite that arrived as a link; joined as soon as the sync loop exists. */
  invite: string | null
  onInviteUsed: () => void
  onBack: () => void
}

/** Join a shared project from a pasted invite or an opened invite link, and list the joined ones. */
export function Join({ sync, version, invite, onInviteUsed, onBack }: Props) {
  const theme = useTheme()
  const s = formStyles(theme)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ good: boolean; message: string } | null>(null)
  const [shares, setShares] = useState<SharedProject[]>([])
  const joining = useRef(false)

  const reload = useCallback(() => setShares(sync ? sync.shares() : []), [sync])
  useEffect(reload, [reload, version])

  const joinWith = useCallback(
    async (raw: string) => {
      if (!sync || joining.current) return
      const found = findInvite(raw, BRAND.urlScheme)
      if (found === null) {
        setNotice({ good: false, message: t('mobile:join.errors.notAnInvite') })
        return
      }
      joining.current = true
      setBusy(true)
      setNotice(null)
      try {
        const result = await sync.join(found)
        const name = result.project?.name ?? t('mobile:join.unnamedProject')
        rememberProjectName(result.projectId, name)
        rememberProjectColor(result.projectId, result.project?.color)
        setText('')
        setNotice({ good: true, message: t('mobile:join.joined', { name }) })
      } catch (error) {
        setNotice({ good: false, message: t(joinErrorKey(error)) })
      } finally {
        joining.current = false
        setBusy(false)
        reload()
      }
    },
    [sync, reload]
  )

  // A link opened on the phone: paste it for the person and join at once.
  useEffect(() => {
    if (invite === null || !sync) return
    setText(invite)
    onInviteUsed()
    void joinWith(invite)
  }, [invite, sync, joinWith, onInviteUsed])

  return (
    <>
      <TopBar theme={theme} title={t('mobile:join.title')} onBack={onBack} />
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        {sync === null ? (
          <Text style={s.bad}>{t('mobile:join.signInFirst')}</Text>
        ) : (
          <View style={s.block}>
            <Text style={s.line}>{t('mobile:join.intro')}</Text>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t('mobile:join.pastePlaceholder')}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={theme.textMuted}
              style={s.input}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy || text.trim() === ''}
              onPress={() => void joinWith(text)}
              style={[s.button, (busy || text.trim() === '') && s.disabled]}
            >
              <Text style={s.buttonText}>
                {busy ? t('mobile:join.joining') : t('mobile:join.button')}
              </Text>
            </Pressable>
            {busy && <ActivityIndicator color={theme.accent} />}
          </View>
        )}
        {notice !== null && <Text style={notice.good ? s.good : s.bad}>{notice.message}</Text>}

        <Text style={s.heading}>{t('mobile:join.projectsHeading')}</Text>
        {shares.length === 0 && <Text style={s.line}>{t('mobile:join.noProjects')}</Text>}
        {shares.map((share) => (
          <View key={share.projectId} style={s.card}>
            <Text style={s.cardTitle}>
              {projectNameOf(share.projectId) ?? t('mobile:join.unnamedProject')}
            </Text>
            <Text style={s.line}>{t('mobile:join.tasks', { count: share.taskCount })}</Text>
            <Text style={s.line}>{t(STATUS_KEY[share.status])}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void sync?.syncNow(share.projectId).then(reload)}
              style={s.link}
            >
              <Text style={s.linkText}>{t('mobile:join.syncNow')}</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </>
  )
}
