import { useCallback, useEffect, useState } from 'react'
import { AppState, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { SPACE, useTheme, type Theme } from '../theme'
import { Chip, editStyles } from './EditBits'
import { formStyles } from './formStyles'
import { rows } from './Settings'
import { TopBar } from './TopBar'
import { TODAY_TIMES, type NotificationSettings } from '../data/notifications'
import {
  askForNotifications,
  notificationPermission,
  openPhoneSettings,
  setNotificationSettings,
  useNotificationSettings,
  type NotificationPermission
} from '../notifications'

type Flag = Exclude<keyof NotificationSettings, 'todayTime'>

const FLAGS: [Flag, string, string][] = [
  ['due', 'mobile:notifications.due', 'mobile:notifications.dueHint'],
  ['timer', 'mobile:notifications.timer', 'mobile:notifications.timerHint'],
  ['inbox', 'mobile:notifications.inbox', 'mobile:notifications.inboxHint'],
  ['today', 'mobile:notifications.today', 'mobile:notifications.todayHint'],
  ['sync', 'mobile:notifications.sync', 'mobile:notifications.syncHint']
]

/**
 * Settings › Notifications: each kind on or off, the Today summary's time, and a way to allow
 * notifications when the phone does not.
 */
export function NotificationSettingsScreen({ onBack }: { onBack: () => void }) {
  const theme = useTheme()
  const s = formStyles(theme)
  const settings = useNotificationSettings()
  const [permission, setPermission] = useState<NotificationPermission | null>(null)

  const refresh = useCallback(() => {
    void notificationPermission()
      .then(setPermission)
      .catch(() => setPermission(null))
  }, [])
  // Asked again on return from the phone's settings.
  useEffect(() => {
    refresh()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh()
    })
    return () => subscription.remove()
  }, [refresh])

  const allow = async () => {
    if (permission === 'denied' || !(await askForNotifications().catch(() => false))) {
      openPhoneSettings()
    }
    refresh()
  }

  return (
    <>
      <TopBar theme={theme} title={t('mobile:notifications.title')} onBack={onBack} />
      <ScrollView contentContainerStyle={s.container}>
        <Text style={s.muted}>{t('mobile:notifications.intro')}</Text>
        {permission !== null && permission !== 'granted' && (
          <View style={styles.blocked}>
            {permission === 'denied' && (
              <Text style={s.bad}>{t('mobile:notifications.blocked')}</Text>
            )}
            <Pressable accessibilityRole="button" style={s.button} onPress={() => void allow()}>
              <Text style={s.buttonText}>
                {permission === 'denied'
                  ? t('mobile:notifications.openPhoneSettings')
                  : t('mobile:notifications.allow')}
              </Text>
            </Pressable>
          </View>
        )}
        <View style={[rows.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {FLAGS.map(([key, label, hint]) => (
            <SwitchRow
              key={key}
              theme={theme}
              label={t(label)}
              hint={t(hint)}
              value={settings[key]}
              onChange={(value) => setNotificationSettings({ ...settings, [key]: value })}
            />
          ))}
        </View>
        {settings.today && (
          <>
            <Text accessibilityRole="header" style={s.heading}>
              {t('mobile:notifications.todayTime')}
            </Text>
            <View accessibilityRole="radiogroup" style={editStyles.row}>
              {TODAY_TIMES.map((time) => (
                <Chip
                  key={time}
                  label={time}
                  theme={theme}
                  selected={settings.todayTime === time}
                  onPress={() => setNotificationSettings({ ...settings, todayTime: time })}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </>
  )
}

function SwitchRow({
  theme,
  label,
  hint,
  value,
  onChange
}: {
  theme: Theme
  label: string
  hint: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <View style={[rows.row, { borderColor: theme.border }]}>
      <View style={rows.text}>
        <Text style={[rows.label, { color: theme.text }]}>{label}</Text>
        <Text style={[rows.hint, { color: theme.textMuted }]}>{hint}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.borderStrong, true: theme.accent }}
        thumbColor={theme.surface}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  blocked: { gap: SPACE.small }
})
