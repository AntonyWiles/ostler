import { useState, type Dispatch, type SetStateAction } from 'react'

/**
 * A field's draft that follows its saved value: it starts as the saved value
 * and goes back to it whenever the saved value changes (a save here, or a
 * change made somewhere else), and never otherwise.
 *
 * The draft is brought up to date while rendering, not in an effect. The old
 * `useEffect(() => setDraft(saved), [saved])` also ran once on mount, setting
 * the draft to the value it already had; when the field had appeared in a
 * render React had not flushed yet (one started by a load finishing), that
 * mount effect could run after the person's first keystroke and throw it
 * away, so what they typed was never saved.
 */
export function useSavedDraft<T>(saved: T): [T, Dispatch<SetStateAction<T>>] {
  const [draft, setDraft] = useState(saved)
  const [following, setFollowing] = useState(saved)
  if (!Object.is(saved, following)) {
    setFollowing(saved)
    setDraft(saved)
  }
  return [draft, setDraft]
}
