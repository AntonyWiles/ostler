import { useEffect, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { MyDayAddResult } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { useAnnounce, useToast } from '../ui'
import { useToday } from './useToday'

/** What a "brought back" note says, or nothing. */
function broughtBackText(result: MyDayAddResult): string | undefined {
  if (result.broughtBack === 'someday') return t('views:myDay.broughtBackSomeday')
  if (result.broughtBack === 'later') return t('views:myDay.broughtBackLater')
  return undefined
}

/**
 * Add to My day (N1.4), from a task's menu, Home's lists and quick add: one
 * call for today's local date, then one toast whose undo takes the task out
 * of My day again. A hidden task comes back first, and the toast says so.
 */
export function useAddToMyDay(onChanged?: () => void) {
  const { toast, toastUndo } = useToast()
  const today = useToday()
  return async (task: { id: string; title: string }): Promise<boolean> => {
    const result = await window.ostlerAPI.addToMyDay(task.id, { date: today })
    if (!result.ok) {
      toast({
        title: t('views:myDay.couldntAdd', { title: task.title }),
        body: result.error,
        tone: 'danger'
      })
      return false
    }
    onChanged?.()
    if (result.value.already) {
      toast({ title: t('views:myDay.alreadyIn', { title: task.title }) })
      return true
    }
    toastUndo(
      t('views:myDay.added', { title: task.title }),
      async () => {
        await window.ostlerAPI.removeFromMyDay(task.id, today)
        onChanged?.()
      },
      broughtBackText(result.value)
    )
    return true
  }
}

/** Where a reordered item goes: before or after another. */
export type ListPlacement = { beforeId: string } | { afterId: string }

/**
 * Drag and Alt+Up/Down for a short ordered list (My day and Plan my day's
 * order): the same moves the subtask list makes. `onMove` gets the item, its
 * placement and the new order; the caller saves it.
 */
export function useReorderableList<T extends { id: string; title: string }>(
  items: readonly T[],
  onMove: (item: T, placement: ListPlacement, order: T[]) => void,
  focusSelector: (id: string) => string
) {
  const announce = useAnnounce()
  const [dragged, setDragged] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; side: 'before' | 'after' } | null>(null)
  const [refocusId, setRefocusId] = useState<string | null>(null)
  useEffect(() => {
    if (!refocusId) return
    document.querySelector<HTMLElement>(focusSelector(refocusId))?.focus()
    setRefocusId(null)
  })

  const move = (item: T, placement: ListPlacement) => {
    const rest = items.filter((candidate) => candidate.id !== item.id)
    const anchor = 'beforeId' in placement ? placement.beforeId : placement.afterId
    const index = rest.findIndex((candidate) => candidate.id === anchor)
    if (index === -1) return
    rest.splice('beforeId' in placement ? index : index + 1, 0, item)
    onMove(item, placement, rest)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, item: T) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const index = items.findIndex((candidate) => candidate.id === item.id)
    const step = event.key === 'ArrowUp' ? -1 : 1
    const neighbour = items[index + step]
    if (!neighbour) {
      announce(t('tasks:boardView.cannotMoveFurther'))
      return
    }
    move(item, step < 0 ? { beforeId: neighbour.id } : { afterId: neighbour.id })
    setRefocusId(item.id)
    announce(
      t(step < 0 ? 'tasks:boardView.movedAbove' : 'tasks:boardView.movedBelow', {
        title: neighbour.title,
        position: index + step + 1,
        count: items.length
      })
    )
  }

  const rowProps = (item: T) => ({
    draggable: true,
    className: [
      dragged === item.id && 'is-dragging',
      dropAt?.id === item.id && dragged !== item.id && `is-drop-${dropAt.side}`
    ]
      .filter(Boolean)
      .join(' '),
    onDragStart: (event: DragEvent<HTMLElement>) => {
      setDragged(item.id)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', item.id)
    },
    onDragEnd: () => {
      setDragged(null)
      setDropAt(null)
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragged) return
      event.preventDefault()
      const box = event.currentTarget.getBoundingClientRect()
      const side = event.clientY < box.top + box.height / 2 ? 'before' : 'after'
      if (dropAt?.id !== item.id || dropAt.side !== side) setDropAt({ id: item.id, side })
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      const moved = items.find((candidate) => candidate.id === dragged)
      const side = dropAt?.id === item.id ? dropAt.side : 'before'
      setDragged(null)
      setDropAt(null)
      if (!moved || moved.id === item.id) return
      move(moved, side === 'before' ? { beforeId: item.id } : { afterId: item.id })
    }
  })

  return { rowProps, onKeyDown }
}
