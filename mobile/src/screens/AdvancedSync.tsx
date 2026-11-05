import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Share, Text, TextInput, View } from 'react-native'
import { t } from '@shared/i18n/index'
import {
  R2SetupCodeError,
  R2_CHECK_MINUTES,
  type R2Setup
} from '../../../electron/services/sync/r2-setup-code'
import { PersonalSpaceError } from '../../../electron/services/sync/pairing'
import { R2Error } from '../../../electron/services/sync/r2-transport'
import { nearFreeTier } from '../../../electron/services/sync/r2-usage'
import type { PendingRequest } from '../../../electron/services/sync/pairing'
import type { PhonePairing } from '../sync/phone-pairing'
import {
  exportR2Setup,
  forgetR2Setup,
  importR2Setup,
  phoneR2Usage,
  saveR2Details,
  setR2CheckMinutes,
  testR2Details,
  type R2Details
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
  /** Joins the personal space, or starts it in the bucket when there is none; null before sync runs. */
  pairing: PhonePairing | null
}

const NO_DETAILS: R2Details = { accountId: '', bucket: '', accessKeyId: '', secretAccessKey: '' }

/** The `mobile:advancedSync.*` text for a failed test or save of typed-in bucket details. */
export function detailsErrorKey(error: unknown): string {
  if (error instanceof R2Error && error.reason === 'bad-config')
    return 'mobile:advancedSync.badDetails'
  if (error instanceof R2Error && error.reason !== 'missing') return r2ErrorKey(error.reason)
  return 'mobile:advancedSync.testFailed'
}

/** The text for why a call to the bucket failed (`R2Error.reason`): wrong keys, no bucket, no network… */
export function r2ErrorKey(reason: string): string {
  return reason === 'signIn' ? 'mobile:advancedSync.wrongKeys' : `errors:r2Sync.call.${reason}`
}

/** The `mobile:advancedSync.*` text for a personal space that couldn't be started. */
export function startSpaceErrorKey(error: unknown): string {
  return error instanceof PersonalSpaceError && error.reason === 'wrong-folder'
    ? 'mobile:advancedSync.spaceExists'
    : 'mobile:advancedSync.startFailed'
}

/**
 * Advanced sync in Settings: sync through the person's own Cloudflare R2 bucket instead of Google
 * Drive. A setup code made on the PC (Settings › Devices › Advanced sync) fills it in, or the person
 * types the bucket's details; the bucket's keys stay in the phone's secure store. With no personal
 * space in the bucket yet, the phone can start one there, where a PC given the bucket finds it.
 * The person chooses how often the phone looks for changes, and Sync now looks at once.
 */
export function AdvancedSync({ theme, ...props }: AdvancedSyncProps & { theme: Theme }) {
  const s = formStyles(theme)
  const [code, setCode] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ good: boolean; text: string } | null>(null)
  const [shared, setShared] = useState<string | null>(null)
  const [byHand, setByHand] = useState(false)
  const [details, setDetails] = useState<R2Details>(NO_DETAILS)
  const { incomingCode, onCodeUsed, pairing } = props
  const [canStart, setCanStart] = useState(false)
  const [paired, setPaired] = useState(false)
  const [requests, setRequests] = useState<PendingRequest[] | null>(null)
  const usage = phoneR2Usage()
  const [lastError, setLastError] = useState(usage.lastError)
  useEffect(() => usage.subscribe(() => setLastError(usage.lastError)), [usage])
  const month = usage.totals()

  useEffect(() => {
    if (pairing === null) {
      setCanStart(false)
      setPaired(false)
      return
    }
    const read = () => {
      setCanStart(pairing.canStartSpace())
      setPaired(pairing.state().phase === 'paired')
    }
    read()
    return pairing.subscribe(read)
  }, [pairing])

  const onLookForRequests = async () => {
    if (pairing === null) return
    setBusy(true)
    setNotice(null)
    try {
      setRequests(await pairing.requests())
    } catch {
      setNotice({ good: false, text: t('mobile:advancedSync.syncFailed') })
    } finally {
      setBusy(false)
    }
  }

  const onAllow = async (request: PendingRequest) => {
    if (pairing === null) return
    setBusy(true)
    setNotice(null)
    try {
      await pairing.allow(request.deviceId)
      setRequests((old) => old?.filter((one) => one.deviceId !== request.deviceId) ?? null)
      setNotice({
        good: true,
        text: t('mobile:advancedSync.allowed', { name: request.deviceName })
      })
    } catch {
      setNotice({ good: false, text: t('mobile:advancedSync.syncFailed') })
    } finally {
      setBusy(false)
    }
  }

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
      // The sync loop keeps going past a failed call; the bucket's last answer says how it went.
      const failed = usage.lastError
      setNotice(
        failed
          ? { good: false, text: t(r2ErrorKey(failed)) }
          : { good: true, text: t('mobile:advancedSync.synced') }
      )
    } catch (error) {
      setNotice({
        good: false,
        text: t(
          error instanceof R2Error ? r2ErrorKey(error.reason) : 'mobile:advancedSync.syncFailed'
        )
      })
    } finally {
      setBusy(false)
    }
  }

  const detailsReady = Object.values(details).every((value) => value.trim() !== '')

  const onTest = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await testR2Details(details)
      setNotice({ good: true, text: t('mobile:advancedSync.testOk') })
    } catch (error) {
      setNotice({ good: false, text: t(detailsErrorKey(error)) })
    } finally {
      setBusy(false)
    }
  }

  const onSaveDetails = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await testR2Details(details)
      await saveR2Details(details)
      setDetails(NO_DETAILS)
      setByHand(false)
      setNotice({ good: true, text: t('mobile:advancedSync.savedByHand') })
    } catch (error) {
      setNotice({ good: false, text: t(detailsErrorKey(error)) })
    } finally {
      setBusy(false)
    }
  }

  const onStartSpace = async () => {
    if (pairing === null) return
    setBusy(true)
    setNotice(null)
    try {
      await pairing.startSpace()
      setNotice({ good: true, text: t('mobile:advancedSync.spaceStarted') })
    } catch (error) {
      setNotice({ good: false, text: t(startSpaceErrorKey(error)) })
    } finally {
      setBusy(false)
    }
  }

  const detailField = (key: keyof R2Details, label: string, secret = false) => (
    <TextInput
      key={key}
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={theme.textMuted}
      value={details[key]}
      onChangeText={(value) => setDetails((old) => ({ ...old, [key]: value }))}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={secret}
      style={s.input}
    />
  )

  const onShare = async () => {
    const made = await exportR2Setup()
    if (!made) return
    setShared(made.passphrase)
    // Only the code goes to the share sheet; the passphrase stays on screen to type or send apart.
    await Share.share({ message: made.code })
  }

  if (props.setup === null && byHand) {
    return (
      <View style={s.block}>
        <Text style={s.muted}>{t('mobile:advancedSync.byHandIntro')}</Text>
        {detailField('accountId', t('mobile:advancedSync.accountId'))}
        {detailField('bucket', t('mobile:advancedSync.bucketName'))}
        {detailField('accessKeyId', t('mobile:advancedSync.accessKeyId'))}
        {detailField('secretAccessKey', t('mobile:advancedSync.secretAccessKey'), true)}
        <Pressable
          accessibilityRole="button"
          disabled={busy || !detailsReady}
          onPress={() => void onTest()}
          style={[s.secondaryButton, (busy || !detailsReady) && s.disabled]}
        >
          <Text style={s.secondaryButtonText}>{t('mobile:advancedSync.test')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy || !detailsReady}
          onPress={() => void onSaveDetails()}
          style={[s.button, (busy || !detailsReady) && s.disabled]}
        >
          {busy ? (
            <ActivityIndicator color={theme.accentContrast} />
          ) : (
            <Text style={s.buttonText}>{t('mobile:advancedSync.import')}</Text>
          )}
        </Pressable>
        {notice !== null && <Text style={notice.good ? s.good : s.bad}>{notice.text}</Text>}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setByHand(false)
            setNotice(null)
          }}
          style={s.secondaryButton}
        >
          <Text style={s.secondaryButtonText}>{t('mobile:advancedSync.useCode')}</Text>
        </Pressable>
      </View>
    )
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
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setByHand(true)
            setNotice(null)
          }}
          style={s.secondaryButton}
        >
          <Text style={s.secondaryButtonText}>{t('mobile:advancedSync.enterByHand')}</Text>
        </Pressable>
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
      {canStart && (
        <View style={s.card}>
          <Text style={s.line}>{t('mobile:advancedSync.noSpaceYet')}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void onStartSpace()}
            style={[s.button, busy && s.disabled]}
          >
            <Text style={s.buttonText}>{t('mobile:advancedSync.startSpace')}</Text>
          </Pressable>
        </View>
      )}
      <Text style={s.muted}>
        {props.lastSyncedAt
          ? t('mobile:advancedSync.lastSynced', {
              time: new Date(props.lastSyncedAt).toLocaleString()
            })
          : t('mobile:advancedSync.notSyncedYet')}
      </Text>
      {lastError !== null && notice === null && (
        <Text style={s.bad}>{t(r2ErrorKey(lastError))}</Text>
      )}
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
      <Text style={s.muted}>
        {t('mobile:advancedSync.usage', {
          writes: month.writes.toLocaleString(),
          reads: month.reads.toLocaleString()
        })}
      </Text>
      {nearFreeTier(month) && <Text style={s.bad}>{t('mobile:advancedSync.usageNear')}</Text>}
      {paired && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void onLookForRequests()}
          style={[s.secondaryButton, busy && s.disabled]}
        >
          <Text style={s.secondaryButtonText}>{t('mobile:advancedSync.lookForDevices')}</Text>
        </Pressable>
      )}
      {paired && requests !== null && requests.length === 0 && (
        <Text style={s.muted}>{t('mobile:advancedSync.noRequests')}</Text>
      )}
      {paired &&
        requests?.map((request) => (
          <View key={request.deviceId} style={s.card}>
            <Text style={s.line}>
              {t('mobile:advancedSync.asksToJoin', { name: request.deviceName })}
            </Text>
            <Text selectable style={[s.cardTitle, { letterSpacing: 2 }]}>
              {request.code}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void onAllow(request)}
              style={[s.button, busy && s.disabled]}
            >
              <Text style={s.buttonText}>{t('mobile:advancedSync.allow')}</Text>
            </Pressable>
          </View>
        ))}
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
