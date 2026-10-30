import { useEffect, useState } from 'react'
import { todayIsoDate } from '@shared/dates'

/** How long after local midnight the new day is read: past any timer drift. */
const AFTER_MIDNIGHT_MS = 1000

/**
 * Today's local date, `YYYY-MM-DD`, that turns over at local midnight: a view
 * left open overnight shows the new day without being reopened.
 */
export function useToday(): string {
  const [today, setToday] = useState(todayIsoDate)
  useEffect(() => {
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const timer = setTimeout(
      () => setToday(todayIsoDate()),
      midnight.getTime() - now.getTime() + AFTER_MIDNIGHT_MS
    )
    return () => clearTimeout(timer)
  }, [today])
  return today
}
