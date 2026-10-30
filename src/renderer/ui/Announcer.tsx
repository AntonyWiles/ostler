import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Portal } from './Portal'
import { VisuallyHidden } from './VisuallyHidden'

/**
 * The app's one polite live region (P9.2). Page changes, agent runs starting
 * and stopping, saves and errors (through toasts) are said here, once each,
 * without moving focus. Mounted once, in App.tsx; anything below it calls
 * `useAnnounce()`.
 */

export type Announce = (message: string) => void

const AnnouncerContext = createContext<Announce | null>(null)

/** Added to every other message, so the same words twice are a change to say. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0)

/** How long a message stays in the region before it is cleared. */
const CLEAR_AFTER_MS = 5000

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Alternates so the same words said twice in a row are still a change.
  const toggle = useRef(false)

  const announce = useCallback<Announce>((text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    toggle.current = !toggle.current
    setMessage(toggle.current ? trimmed : `${trimmed}${NO_BREAK_SPACE}`)
    if (clearTimer.current) clearTimeout(clearTimer.current)
    clearTimer.current = setTimeout(() => setMessage(''), CLEAR_AFTER_MS)
  }, [])

  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <Portal>
        <VisuallyHidden role="status" aria-live="polite" aria-atomic="true" data-announcer="">
          {message}
        </VisuallyHidden>
      </Portal>
    </AnnouncerContext.Provider>
  )
}

/** Says `message` politely. Outside an AnnouncerProvider it does nothing. */
export function useAnnounce(): Announce {
  return useContext(AnnouncerContext) ?? NO_ANNOUNCER
}

const NO_ANNOUNCER: Announce = () => {}
