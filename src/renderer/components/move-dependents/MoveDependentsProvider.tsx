import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { formatIsoDateShort } from '@shared/dates'
import {
  moveDays,
  startMoveDays,
  type DependentMovePlan,
  type TaskDateMove
} from '@shared/planning/move-dependents'
import { undoChanges } from '@shared/planning/reschedule'
import { t } from '@shared/i18n'
import { Button, Dialog, useToast } from '../../ui'
import './MoveDependents.css'

export interface MoveDependentsApi {
  /**
   * After date changes already saved: when tasks that wait on them now start
   * too early, a toast offers to move them (Preview, Leave them). `onChanged`
   * runs after the move and after its undo, so the view reads again.
   */
  offer: (moves: readonly TaskDateMove[], onChanged?: () => void) => Promise<void>
}

const MoveDependentsContext = createContext<MoveDependentsApi | null>(null)

const NO_OFFER: MoveDependentsApi = { offer: async () => {} }

/** The offer, or nothing outside the provider (some component tests): the change itself is saved. */
export function useMoveDependents(): MoveDependentsApi {
  return useContext(MoveDependentsContext) ?? NO_OFFER
}

/** A move from a task's dates as they were to the ones just saved. */
export function taskDateMove(
  before: { id: string; targetDate: string | null; startDate: string | null },
  after: { targetDate?: string | null; startDate?: string | null }
): TaskDateMove {
  return {
    id: before.id,
    fromDue: before.targetDate ?? null,
    fromStart: before.startDate ?? null,
    toDue: after.targetDate === undefined ? (before.targetDate ?? null) : after.targetDate,
    toStart: after.startDate === undefined ? (before.startDate ?? null) : after.startDate
  }
}

interface Pending {
  plan: DependentMovePlan
  onChanged?: () => void
}

/**
 * Move what waits on it (N7.1, decision N49). Mounted once in App.tsx: every
 * surface that moves dates (the Timeline, the Calendar, the drawer, bulk edit,
 * Reschedule) calls `offer`, main works out the one plan
 * (`previewMoveDependents`), and Move applies it in one call with one undo.
 */
export function MoveDependentsProvider({ children }: { children: ReactNode }) {
  const { toast, toastUndo } = useToast()
  const [pending, setPending] = useState<Pending | null>(null)

  const offer = useCallback(
    async (moves: readonly TaskDateMove[], onChanged?: () => void) => {
      // A first day moving later can push a start-to-start link (N7.2a).
      const later = moves.filter((move) => moveDays(move) > 0 || startMoveDays(move) > 0)
      if (later.length === 0) return
      const result = await window.ostlerAPI.previewMoveDependents(later)
      if (!result.ok || result.value.entries.length === 0) return
      const plan = result.value
      toast({
        title: t('tasks:moveDependents.offer', { count: plan.entries.length }),
        tone: 'warning',
        action: {
          label: t('tasks:moveDependents.preview'),
          onClick: () => setPending({ plan, onChanged })
        },
        secondaryAction: { label: t('tasks:moveDependents.leave'), onClick: () => {} }
      })
    },
    [toast]
  )

  const api = useMemo<MoveDependentsApi>(() => ({ offer }), [offer])

  const apply = async ({ plan, onChanged }: Pending) => {
    const result = await window.ostlerAPI.applyReschedule(
      plan.entries.map(({ id, fromDue, toDue, fromStart, toStart }) => ({
        id,
        fromDue,
        toDue,
        fromStart,
        toStart
      }))
    )
    setPending(null)
    if (!result.ok) {
      toast({ title: t('tasks:moveDependents.couldntMove'), body: result.error, tone: 'danger' })
      return
    }
    onChanged?.()
    const { changed, skipped } = result.value
    toastUndo(
      t('tasks:moveDependents.moved', { count: changed.length }),
      async () => {
        const undone = await window.ostlerAPI.applyReschedule(undoChanges(changed))
        if (!undone.ok)
          toast({
            title: t('tasks:moveDependents.couldntUndo'),
            body: undone.error,
            tone: 'danger'
          })
        onChanged?.()
      },
      skipped.length > 0
        ? t('tasks:moveDependents.changedMeanwhile', { count: skipped.length })
        : undefined
    )
  }

  return (
    <MoveDependentsContext.Provider value={api}>
      {children}
      {pending && (
        <MoveDependentsDialog
          plan={pending.plan}
          onLeave={() => setPending(null)}
          onMove={() => apply(pending)}
        />
      )}
    </MoveDependentsContext.Provider>
  )
}

function datesText(due: string, start: string | null): string {
  return start && start !== due
    ? t('tasks:moveDependents.range', {
        start: formatIsoDateShort(start),
        due: formatIsoDateShort(due)
      })
    : formatIsoDateShort(due)
}

/** The preview: each task's old and new dates, the ones left as they are, and Move. */
export function MoveDependentsDialog({
  plan,
  onLeave,
  onMove
}: {
  plan: DependentMovePlan
  onLeave: () => void
  onMove: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const move = async () => {
    setBusy(true)
    try {
      await onMove()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onLeave}
      size="lg"
      canDismiss={!busy}
      title={t('tasks:moveDependents.title')}
      description={t('tasks:moveDependents.description')}
      footer={
        <>
          <Button onClick={onLeave} disabled={busy}>
            {t('tasks:moveDependents.leave')}
          </Button>
          <Button variant="primary" onClick={() => void move()} disabled={busy}>
            {t('tasks:moveDependents.move', { count: plan.entries.length })}
          </Button>
        </>
      }
    >
      <div className="move-dependents">
        <div className="move-dependents__scroll">
          <table
            className="move-dependents__table"
            aria-label={t('tasks:moveDependents.previewLabel')}
          >
            <thead>
              <tr>
                <th scope="col">{t('tasks:moveDependents.task')}</th>
                <th scope="col">{t('tasks:moveDependents.now')}</th>
                <th scope="col">{t('tasks:moveDependents.movesTo')}</th>
              </tr>
            </thead>
            <tbody>
              {plan.entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="move-dependents__title">{entry.title}</td>
                  <td className="tabular-nums">{datesText(entry.fromDue, entry.fromStart)}</td>
                  <td className="tabular-nums">
                    {datesText(entry.toDue, entry.toStart)}
                    <span className="move-dependents__note">
                      {t('tasks:moveDependents.later', { count: entry.days })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {plan.skipped.length > 0 && (
          <div>
            <p className="move-dependents__heading">{t('tasks:moveDependents.leftHeading')}</p>
            <ul className="move-dependents__skipped">
              {plan.skipped.map((skip) => (
                <li key={skip.id}>
                  {t(
                    skip.reason === 'done'
                      ? 'tasks:moveDependents.leftDone'
                      : 'tasks:moveDependents.leftUndated',
                    { title: skip.title }
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  )
}
