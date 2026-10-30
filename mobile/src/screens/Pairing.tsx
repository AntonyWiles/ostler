import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { useTheme } from '../theme'
import { formStyles } from './formStyles'
import { TopBar } from './TopBar'
import { pairingErrorKey, type PairingState, type PhonePairing } from '../sync/phone-pairing'

interface Props {
  /** Null until the person has signed in (pairing is made after sign-in). */
  pairing: PhonePairing | null
  onBack: () => void
}

/** "Set up from my other device": shows the code and waits for a PC to allow this phone. */
export function Pairing({ pairing, onBack }: Props) {
  const theme = useTheme()
  const s = formStyles(theme)
  const [state, setState] = useState<PairingState | null>(pairing ? pairing.state() : null)

  useEffect(() => {
    if (!pairing) {
      setState(null)
      return
    }
    setState(pairing.state())
    const stop = pairing.subscribe(setState)
    return stop
  }, [pairing])

  return (
    <>
      <TopBar theme={theme} title={t('mobile:pairing.title')} onBack={onBack} />
      <ScrollView contentContainerStyle={s.container}>
        {pairing === null || state === null ? (
          <Text style={s.bad}>{t('mobile:pairing.signInFirst')}</Text>
        ) : state.phase === 'paired' ? (
          <Text style={s.good}>{t('mobile:pairing.paired')}</Text>
        ) : (
          <View style={s.block}>
            <Text style={s.line}>{t('mobile:pairing.intro')}</Text>
            <Text style={s.line}>{t('mobile:pairing.step1')}</Text>
            <Text style={s.line}>{t('mobile:pairing.step2')}</Text>
            <Text style={s.line}>{t('mobile:pairing.step3')}</Text>

            {state.phase === 'idle' && (
              <Pressable
                accessibilityRole="button"
                onPress={() => void pairing.start()}
                style={s.button}
              >
                <Text style={s.buttonText}>{t('mobile:pairing.start')}</Text>
              </Pressable>
            )}

            {state.phase === 'looking' && (
              <View style={s.block}>
                <ActivityIndicator color={theme.accent} />
                <Text style={s.line}>{t('mobile:pairing.looking')}</Text>
              </View>
            )}

            {state.phase === 'waiting' && (
              <View style={s.block}>
                {state.code === null ? (
                  <Text style={s.line}>{t('mobile:pairing.noCodeYet')}</Text>
                ) : (
                  <>
                    <Text style={s.line}>{t('mobile:pairing.codeLabel')}</Text>
                    <Text accessibilityLabel={state.code.split('').join(' ')} style={s.code}>
                      {state.code}
                    </Text>
                  </>
                )}
                <ActivityIndicator color={theme.accent} />
                <Text style={s.line}>{t('mobile:pairing.waiting')}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => pairing.cancel()}
                  style={s.secondaryButton}
                >
                  <Text style={s.secondaryButtonText}>{t('mobile:pairing.cancel')}</Text>
                </Pressable>
              </View>
            )}

            {state.phase === 'failed' && (
              <View style={s.block}>
                <Text style={s.bad}>{t(pairingErrorKey(state.failure ?? 'failed'))}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void pairing.start()}
                  style={s.button}
                >
                  <Text style={s.buttonText}>{t('mobile:pairing.tryAgain')}</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </>
  )
}
