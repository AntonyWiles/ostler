import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import type { ThemeSetting } from '@shared/ostler-api'
import { RADIUS, SPACE, setThemeSetting, useTheme, useThemeSetting, type Theme } from '../theme'
import { Chip, editStyles } from './EditBits'
import { formStyles } from './formStyles'
import { Icon } from './Icon'
import { TopBar } from './TopBar'
import { currentAccount, signIn, signOut, type SignInResult } from '../google/account'
import { SignInRequiredError } from '../google/drive-request'
import { listOstlerFolder } from '../google/drive'

type Listing =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'failed' }
  | { state: 'ready'; folders: string[] }

interface Props {
  /** The database's schema version and the newest this app knows, once the database is open. */
  check: { fileVersion: number; latestVersion: number } | null
  onBack: () => void
  /** Opens Join a shared project. */
  onJoin: () => void
  /** Opens Set up from my other device. */
  onPairing: () => void
}

/**
 * The app's settings, opened from the cog on the home screen: the Google account (once signed in,
 * Drive access is proved by listing Ostler's folders), getting projects onto the phone, the theme
 * and about.
 */
export function Settings({ check, onBack, onJoin, onPairing }: Props) {
  const theme = useTheme()
  const themeSetting = useThemeSetting()
  const s = formStyles(theme)
  const [email, setEmail] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [listing, setListing] = useState<Listing>({ state: 'idle' })

  const load = useCallback(async () => {
    setListing({ state: 'loading' })
    try {
      const { folders } = await listOstlerFolder()
      setListing(folders === null ? { state: 'missing' } : { state: 'ready', folders })
    } catch (error) {
      if (error instanceof SignInRequiredError) {
        // Google refused the token (testing mode asks again every 7 days): sign in again.
        setEmail(null)
        setListing({ state: 'idle' })
        setNotice(t('mobile:settings.signInAgain'))
      } else {
        setListing({ state: 'failed' })
      }
    }
  }, [])

  useEffect(() => {
    let alive = true
    void currentAccount().then((account) => {
      if (!alive || !account) return
      setEmail(account)
      void load()
    })
    return () => {
      alive = false
    }
  }, [load])

  const noticeFor = (result: SignInResult): string | null => {
    if (result.status === 'no-play-services') return t('mobile:settings.playServicesMissing')
    if (result.status === 'failed') return t('mobile:settings.signInFailed')
    return null
  }

  const onSignIn = async () => {
    setBusy(true)
    setNotice(null)
    const result = await signIn()
    setBusy(false)
    setNotice(noticeFor(result))
    if (result.status === 'signed-in') {
      setEmail(result.email)
      void load()
    }
  }

  const onSignOut = async () => {
    setBusy(true)
    await signOut()
    setBusy(false)
    setEmail(null)
    setNotice(null)
    setListing({ state: 'idle' })
  }

  return (
    <>
      <TopBar theme={theme} title={t('mobile:settings.title')} onBack={onBack} />
      <ScrollView contentContainerStyle={s.container}>
        <Text accessibilityRole="header" style={s.heading}>
          {t('mobile:settings.googleAccount')}
        </Text>

        {email === null ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void onSignIn()}
            style={s.button}
          >
            <Text style={s.buttonText}>
              {busy ? t('mobile:settings.signingIn') : t('mobile:settings.signIn')}
            </Text>
          </Pressable>
        ) : (
          <View style={s.block}>
            <Text style={s.line}>{t('mobile:settings.signedInAs', { email })}</Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void onSignOut()}
              style={s.secondaryButton}
            >
              <Text style={s.secondaryButtonText}>{t('mobile:settings.signOut')}</Text>
            </Pressable>
          </View>
        )}
        {notice !== null && <Text style={s.bad}>{notice}</Text>}

        {email !== null && (
          <View style={s.block}>
            {listing.state === 'loading' && (
              <View style={s.row}>
                <ActivityIndicator color={theme.accent} />
                <Text style={s.line}>{t('mobile:settings.folderLoading')}</Text>
              </View>
            )}
            {listing.state === 'missing' && (
              <Text style={s.bad}>{t('mobile:settings.folderNotFound')}</Text>
            )}
            {listing.state === 'failed' && (
              <Text style={s.bad}>{t('mobile:settings.folderFailed')}</Text>
            )}
            {listing.state === 'ready' && (
              <>
                <Text style={s.heading}>{t('mobile:settings.folderHeading')}</Text>
                {listing.folders.length === 0 ? (
                  <Text style={s.line}>{t('mobile:settings.folderEmpty')}</Text>
                ) : (
                  listing.folders.map((name, index) => (
                    <Text key={`${index}-${name}`} style={s.line}>
                      {name}
                    </Text>
                  ))
                )}
              </>
            )}
          </View>
        )}
        <Text accessibilityRole="header" style={s.heading}>
          {t('mobile:settings.projectsHeading')}
        </Text>
        <View style={[rows.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <NavRow
            theme={theme}
            label={t('mobile:pairing.open')}
            hint={t('mobile:settings.pairingHint')}
            onPress={onPairing}
          />
          <NavRow
            theme={theme}
            label={t('mobile:join.open')}
            hint={t('mobile:settings.joinHint')}
            onPress={onJoin}
          />
        </View>

        <Text accessibilityRole="header" style={s.heading}>
          {t('mobile:settings.theme')}
        </Text>
        <View accessibilityRole="radiogroup" style={editStyles.row}>
          {THEMES.map(([value, label]) => (
            <Chip
              key={value}
              label={t(label)}
              theme={theme}
              selected={themeSetting === value}
              onPress={() => setThemeSetting(value)}
            />
          ))}
        </View>

        <Text accessibilityRole="header" style={s.heading}>
          {t('mobile:settings.about')}
        </Text>
        {check !== null && (
          <Text
            style={[s.muted, check.fileVersion !== check.latestVersion && { color: theme.danger }]}
          >
            {t('mobile:settings.schema', { file: check.fileVersion, latest: check.latestVersion })}
          </Text>
        )}
      </ScrollView>
    </>
  )
}

const THEMES: [ThemeSetting, string][] = [
  ['system', 'mobile:settings.themeSystem'],
  ['light', 'mobile:settings.themeLight'],
  ['dark', 'mobile:settings.themeDark']
]

/** A row that opens another screen. */
function NavRow({
  theme,
  label,
  hint,
  onPress
}: {
  theme: Theme
  label: string
  hint: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [
        rows.row,
        { borderColor: theme.border },
        pressed && { backgroundColor: theme.surfaceSunken }
      ]}
    >
      <View style={rows.text}>
        <Text style={[rows.label, { color: theme.text }]}>{label}</Text>
        <Text style={[rows.hint, { color: theme.textMuted }]}>{hint}</Text>
      </View>
      <Icon name="chevron-right" color={theme.textMuted} />
    </Pressable>
  )
}

const rows = StyleSheet.create({
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    overflow: 'hidden'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.medium,
    minHeight: 56,
    paddingHorizontal: SPACE.large,
    paddingVertical: SPACE.small,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: -StyleSheet.hairlineWidth
  },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 15 },
  hint: { fontSize: 13 }
})
