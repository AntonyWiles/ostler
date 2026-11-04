import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Share, Text, TextInput, View } from 'react-native'
import { t } from '@shared/i18n/index'
import {
  R2SetupCodeError,
  R2_CHECK_MINUTES,
  type R2Setup
} from '../../../electron/services/sync/r2-setup-code'
import {
  exportR2Setup,
  forgetR2Setup,
  importR2Setup,
  setR2CheckMinutes
} from '../sync/r2-phone-settings'
import type { Theme } from '../theme'
import { Chip, editStyles } from './EditBits'
import { formStyles } from './formStyles'

export interface AdvancedSyncProps {
  setup: R2Setup | null
  lastSyncedAt: number | null
  /** A setup code that arrived as a link, filled in for the person. */
  incomingCode: string | null
  onCodeUsed: () => void
  onSyncNow: () => Promise<void>
}

/**
 * Advanced sync in Settings: sync through the person's own Cloudflare R2 bucket instead of Google
 * Drive. A setup code made on the PC (Settings › Devices › Advanced sync) fills it in; the bucket's
 * keys stay in the phone's secure store. The person chooses how often the phone looks for changes,
 * and Sync now looks at once.
 */
export function AdvancedSync({ theme, ...props }: AdvancedSyncProps & { theme: Theme }) {
  const s = formStyles(theme)
  const [code, setCode] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ good: boolean; text: string } | null>(null)
  const [shared, setShared] = useState<string | null>(null)
  const { incomingCode, onCodeUsed } = props

  useEffect(() => {
    if (incomingCode === null) return
    setCode(incomingCode)
    onCodeUsed()
  }, [incomingCode, onCodeUsed])

  const onImport = async () => {
    setBusy(true)
    setNotice(null)
    // Let the spinner draw before the passphrase is stretched (it takes a moment).
    await new Promise((resolve) => setTimeout(resolve, 50))
    try {
      await importR2Setup(code, passphrase)
      setCode('')
      setPassphrase('')
      setNotice({ good: true, text: t('mobile:advancedSync.imported') })
    } catch (error) {
      setNotice({
        good: false,
        text: t(
          error instanceof R2SetupCodeError && error.reason === 'wrong-passphrase'
            ? 'mobile:advancedSync.wrongPassphrase'
            : 'mobile:advancedSync.notACode'
        )
      })
    } finally {
      setBusy(false)
    }
  }

  const onSyncNow = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await props.onSyncNow()
      setNotice({ good: true, text: t('mobile:advancedSync.synced') })
    } catch {
      setNotice({ good: false, text: t('mobile:advancedSync.syncFailed') })
    } finally {
      setBusy(false)
    }
  }

  const onShare = async () => {
    const made = await exportR2Setup()
    if (!made) return
    setShared(made.passphrase)
    // Only the code goes to the share sheet; the passphrase stays on screen to type or send apart.
    await Share.share({ message: made.code })
  }

  if (props.setup === null) {
    return (
      <View style={s.block}>
        <Text style={s.muted}>{t('mobile:advancedSync.intro')}</Text>
        <TextInput
          accessibilityLabel={t('mobile:advancedSync.code')}
          placeholder={t('mobile:advancedSync.code')}
          placeholderTextColor={theme.textMuted}
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={[s.input, { minHeight: 72 }]}
        />
        <TextInput
          accessibilityLabel={t('mobile:advancedSync.passphrase')}
          placeholder={t('mobile:advancedSync.passphrase')}
          placeholderTextColor={theme.textMuted}
          value={passphrase}
          onChangeText={setPassphrase}
          autoCapitalize="characters"
          autoCorrect={false}
          secureTextEntry
          style={s.input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy || !code.trim() || !passphrase.trim()}
          onPress={() => void onImport()}
          style={[s.button, (busy || !code.trim() || !passphrase.trim()) && s.disabled]}
        >
          {busy ? (
            <ActivityIndicator color={theme.accentContrast} />
          ) : (
            <Text style={s.buttonText}>{t('mobile:advancedSync.import')}</Text>
          )}
        </Pressable>
        {notice !== null && <Text style={notice.good ? s.good : s.bad}>{notice.text}</Text>}
      </View>
    )
  }

  const { setup } = props
  return (
    <View style={s.block}>
      <Text style={s.line}>
        {t('mobile:advancedSync.bucket', {
          bucket: setup.config.prefix
            ? `${setup.config.bucket}/${setup.config.prefix}`
            : setup.config.bucket
        })}
      </Text>
      <Text style={s.muted}>
        {props.lastSyncedAt
          ? t('mobile:advancedSync.lastSynced', {
              time: new Date(props.lastSyncedAt).toLocaleString()
            })
          : t('mobile:advancedSync.notSyncedYet')}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void onSyncNow()}
        style={[s.button, busy && s.disabled]}
      >
        {busy ? (
          <ActivityIndicator color={theme.accentContrast} />
        ) : (
          <Text style={s.buttonText}>{t('mobile:advancedSync.syncNow')}</Text>
        )}
      </Pressable>
      {notice !== null && <Text style={notice.good ? s.good : s.bad}>{notice.text}</Text>}
      <Text style={s.line}>{t('mobile:advancedSync.checkEvery')}</Text>
      <View accessibilityRole="radiogroup" style={editStyles.row}>
        {R2_CHECK_MINUTES.map((minutes) => (
          <Chip
            key={minutes}
            label={
              minutes === 0
                ? t('mobile:advancedSync.onlySyncNow')
                : t('mobile:advancedSync.minutes', { count: minutes })
            }
            theme={theme}
            selected={setup.checkMinutes === minutes}
            onPress={() => void setR2CheckMinutes(minutes)}
          />
        ))}
      </View>
      <Text style={s.muted}>{t('mobile:advancedSync.costNote')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void onShare()}
        style={s.secondaryButton}
      >
        <Text style={s.secondaryButtonText}>{t('mobile:advancedSync.shareCode')}</Text>
      </Pressable>
      {shared !== null && (
        <View style={s.card}>
          <Text style={s.line}>{t('mobile:advancedSync.passphraseIs')}</Text>
          <Text selectable style={[s.cardTitle, { letterSpacing: 2 }]}>
            {shared}
          </Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => void forgetR2Setup()}
        style={s.secondaryButton}
      >
        <Text style={s.secondaryButtonText}>{t('mobile:advancedSync.remove')}</Text>
      </Pressable>
    </View>
  )
}
