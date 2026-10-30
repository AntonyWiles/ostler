import { useCallback, useEffect, useRef, useState } from 'react'
import { currentLanguage } from '@shared/i18n'

/**
 * The voice for a language: Windows' default when it speaks the language,
 * else the first that does, else null (the browser's default). The list may
 * be empty until `voiceschanged` fires; null then, so nothing waits for it.
 */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  language: string
): SpeechSynthesisVoice | null {
  const base = language.toLowerCase().split('-')[0]
  const speaks = (voice: SpeechSynthesisVoice) => voice.lang.toLowerCase().split(/[-_]/)[0] === base
  return voices.find((voice) => voice.default && speaks(voice)) ?? voices.find(speaks) ?? null
}

function synthesis(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null
}

/**
 * Reads text aloud with `speechSynthesis` and an installed Windows voice for
 * the interface language. Nothing is recorded or saved; leaving the screen
 * stops it.
 */
export function useSpeech(): {
  available: boolean
  speaking: boolean
  speak(parts: string[]): void
  stop(): void
} {
  const [speaking, setSpeaking] = useState(false)
  // Each Listen is a new round; a cancelled round's late `end` is ignored.
  const round = useRef(0)

  const stop = useCallback(() => {
    round.current += 1
    synthesis()?.cancel()
    setSpeaking(false)
  }, [])

  const speak = useCallback((parts: string[]) => {
    const synth = synthesis()
    if (!synth || parts.length === 0) return
    synth.cancel()
    const mine = ++round.current
    const language = currentLanguage()
    const voice = pickVoice(synth.getVoices(), language)
    const done = () => {
      if (round.current === mine) setSpeaking(false)
    }
    parts.forEach((text, index) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = voice?.lang ?? language
      if (voice) utterance.voice = voice
      if (index === parts.length - 1) utterance.onend = done
      utterance.onerror = done
      synth.speak(utterance)
    })
    setSpeaking(true)
  }, [])

  useEffect(
    () => () => {
      round.current += 1
      synthesis()?.cancel()
    },
    []
  )

  return { available: synthesis() !== null, speaking, speak, stop }
}
