import { useCallback, useEffect, useState } from 'react'
import type { CreateTimeBlockInput, TimeBlock, UpdateTimeBlockInput } from '@shared/ostler-api'
import { clockTime } from '@shared/planning/time-blocks'
import { isBlockPassed, wallMoment } from '@shared/planning/free-time'
import { t } from '@shared/i18n'
import { useToast } from '../ui'

const NONE: TimeBlock[] = []

/**
 * Time blocks (N3.4a) from one date to another: one call for the range on
 * screen, asked again when the range moves or anything that plans changes
 * (the 'home' push follows every planning write, the automation API's too).
 * `projectId` keeps one project's; leave out for every enabled project.
 */
export function useTimeBlocks(
  from: string,
  to: string,
  options: { projectId?: string; workItemId?: string; enabled?: boolean } = {}
): { blocks: TimeBlock[]; reload: () => void; setBlocks: (blocks: TimeBlock[]) => void } {
  const { projectId, workItemId, enabled = true } = options
  const [blocks, setBlocks] = useState<TimeBlock[]>(NONE)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((value) => value + 1), [])

  useEffect(() => {
    if (!enabled) {
      setBlocks(NONE)
      return
    }
    let live = true
    void window.ostlerAPI.getTimeBlocks({ from, to, projectId, workItemId }).then((result) => {
      if (live) setBlocks(result.ok ? result.value : NONE)
    })
    return () => {
      live = false
    }
  }, [from, to, projectId, workItemId, enabled, version])

  useEffect(() => {
    if (!enabled) return
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home' || update.field === 'planning') reload()
    })
  }, [enabled, reload])

  return { blocks: enabled ? blocks : NONE, reload, setBlocks }
}

/** "09:00 to 10:30". */
export function blockTimeRange(block: Pick<TimeBlock, 'startMinute' | 'lengthMinutes'>): string {
  return t('views:timeBlocks.range', {
    start: clockTime(block.startMinute),
    end: clockTime(block.startMinute + block.lengthMinutes)
  })
}

/** "45 min", "1 h", "1 h 30 min". */
export function lengthText(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return t('views:timeBlocks.minutes', { count: rest })
  if (rest === 0) return t('views:timeBlocks.hours', { count: hours })
  return t('views:timeBlocks.hoursMinutes', { hours, minutes: rest })
}

/** What a screen reader hears for a block: "Write the proposal, 09:00 to 10:30". */
export function blockLabel(block: Pick<TimeBlock, 'title' | 'startMinute' | 'lengthMinutes'>) {
  return t('views:timeBlocks.label', { title: block.title, range: blockTimeRange(block) })
}

/**
 * Whether a block passed with its task unfinished (N3.4b), and what a screen
 * reader hears for it then: "Write the proposal, 09:00 to 10:30, passed".
 */
export function blockPassedState(
  block: Pick<TimeBlock, 'title' | 'date' | 'startMinute' | 'lengthMinutes' | 'status'>,
  now: Date = new Date()
): { passed: boolean; label: string } {
  const label = blockLabel(block)
  const passed = isBlockPassed(block, wallMoment(now))
  return { passed, label: passed ? t('views:blockMoves.passedLabel', { label }) : label }
}

/**
 * Making, moving and removing blocks, each one call with a toast; Remove's
 * toast undoes it. `onChanged` runs after every change, so the caller's
 * list is asked again at once.
 */
export function useTimeBlockActions(onChanged?: () => void) {
  const { toast, toastUndo } = useToast()

  const fail = (title: string, error: string) => toast({ title, body: error, tone: 'danger' })

  /** `note` is a day off's note (N3.2), shown in the toast; it never blocks. */
  const create = async (input: CreateTimeBlockInput, note?: string): Promise<TimeBlock | null> => {
    const result = await window.ostlerAPI.createTimeBlock(input)
    if (!result.ok) {
      fail(t('views:timeBlocks.couldntBlock'), result.error)
      return null
    }
    onChanged?.()
    const block = result.value
    toastUndo(
      t('views:timeBlocks.blocked', { title: block.title, range: blockTimeRange(block) }),
      async () => {
        await window.ostlerAPI.removeTimeBlock(block.id)
        onChanged?.()
      },
      note
    )
    return block
  }

  const update = async (
    block: TimeBlock,
    updates: UpdateTimeBlockInput
  ): Promise<TimeBlock | null> => {
    const result = await window.ostlerAPI.updateTimeBlock(block.id, updates)
    if (!result.ok) {
      fail(t('views:timeBlocks.couldntMove'), result.error)
      return null
    }
    onChanged?.()
    return result.value
  }

  const remove = async (block: TimeBlock): Promise<boolean> => {
    const result = await window.ostlerAPI.removeTimeBlock(block.id)
    if (!result.ok) {
      fail(t('views:timeBlocks.couldntRemove'), result.error)
      return false
    }
    onChanged?.()
    toastUndo(t('views:timeBlocks.removed', { title: block.title }), async () => {
      await window.ostlerAPI.restoreTimeBlock(result.value)
      onChanged?.()
    })
    return true
  }

  return { create, update, remove }
}
