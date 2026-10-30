import { useEffect, useState } from 'react'
import type {
  BlockMovePlan,
  BlockTime,
  FillDayPiece,
  FillDayPlan,
  TimeBlock
} from '@shared/ostler-api'
import { formatIsoDate } from '@shared/dates'
import { clockTime } from '@shared/planning/time-blocks'
import { t } from '@shared/i18n'
import { blockTimeRange } from '../../hooks/useTimeBlocks'
import { Button, Dialog, useToast } from '../../ui'
import { CalendarClock } from '../../ui/icons'
import './time-blocks.css'

/*
 * Blocks that move (N3.4b, decision N28): Move to the next free time, Move
 * them and Fill my day. Every move starts with the person's click; the two
 * dialogs show what will happen before anything changes, and each change
 * has one undo. The rules live in main (`BlockMoveService`).
 */

/** "Monday 19 October, 13:30". */
function whenText(time: Pick<BlockTime, 'date' | 'startMinute'>): string {
  return t('views:blockMoves.when', {
    day: formatIsoDate(time.date, { weekday: 'long', day: 'numeric', month: 'long' }),
    time: clockTime(time.startMinute)
  })
}

/** Moving and placing blocks, each one call with a toast whose undo puts everything back. */
export function useBlockMoveActions(onChanged?: () => void) {
  const { toast, toastUndo } = useToast()
  const fail = (title: string, error: string) => toast({ title, body: error, tone: 'danger' })

  const undoMoves = (previous: (BlockTime & { blockId: string })[]) => async () => {
    for (const before of previous) {
      await window.ostlerAPI.updateTimeBlock(before.blockId, {
        date: before.date,
        startMinute: before.startMinute,
        lengthMinutes: before.lengthMinutes
      })
    }
    onChanged?.()
  }

  /** Applies a plan of moves; returns the new plan when time moved on. */
  const applyMoves = async (plan: BlockMovePlan): Promise<BlockMovePlan | 'done' | null> => {
    const result = await window.ostlerAPI.applyBlockMoves(plan)
    if (!result.ok) {
      fail(t('views:blockMoves.couldntMove'), result.error)
      return null
    }
    if (!result.value.applied) return result.value.plan
    onChanged?.()
    const moved = result.value.blocks
    toastUndo(
      moved.length === 1
        ? t('views:blockMoves.moved', { title: moved[0].title, when: whenText(moved[0]) })
        : t('views:blockMoves.movedMany', { count: moved.length }),
      undoMoves(result.value.previous)
    )
    return 'done'
  }

  /** Move to the next free time: one click, worked out and moved at once. */
  const moveOne = async (block: TimeBlock): Promise<void> => {
    const preview = await window.ostlerAPI.previewBlockMoves([block.id])
    if (!preview.ok) {
      fail(t('views:blockMoves.couldntMove'), preview.error)
      return
    }
    if (!preview.value.moves[0]?.to) {
      toast({ title: t('views:blockMoves.noFreeTime', { title: block.title }) })
      return
    }
    const outcome = await applyMoves(preview.value)
    // Time moved on in between: the fresh plan is the one the click meant.
    if (outcome && outcome !== 'done') await applyMoves(outcome)
  }

  /** Places them; returns the new plan when time moved on. */
  const applyFill = async (plan: FillDayPlan): Promise<FillDayPlan | 'done' | null> => {
    const result = await window.ostlerAPI.applyFillDay(plan)
    if (!result.ok) {
      fail(t('views:blockMoves.couldntFill'), result.error)
      return null
    }
    if (!result.value.applied) return result.value.plan
    onChanged?.()
    const ids = result.value.blocks.map((block) => block.id)
    toastUndo(t('views:blockMoves.placed', { count: ids.length }), async () => {
      await window.ostlerAPI.removeTimeBlocks(ids)
      onChanged?.()
    })
    return 'done'
  }

  return { moveOne, applyMoves, applyFill }
}

/** Home's line about passed blocks, and Move them with its preview. */
export function PassedBlocks({
  blocks,
  onChanged
}: {
  blocks: readonly TimeBlock[]
  onChanged?: () => void
}) {
  const [open, setOpen] = useState(false)
  if (blocks.length === 0) return null
  return (
    <>
      <span>{t('views:blockMoves.passedCount', { count: blocks.length })}</span>
      <Button size="sm" icon={CalendarClock} onClick={() => setOpen(true)}>
        {t('views:blockMoves.moveThem')}
      </Button>
      {open && (
        <MoveBlocksDialog
          blockIds={blocks.map((block) => block.id)}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
        />
      )}
    </>
  )
}

/** Move them: where each passed block would go, then one click moves them all. */
export function MoveBlocksDialog({
  blockIds,
  onClose,
  onChanged
}: {
  blockIds: string[]
  onClose: () => void
  onChanged?: () => void
}) {
  const actions = useBlockMoveActions(onChanged)
  const [plan, setPlan] = useState<BlockMovePlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recomputed, setRecomputed] = useState(false)
  const [busy, setBusy] = useState(false)
  const key = blockIds.join(',')

  useEffect(() => {
    let live = true
    void window.ostlerAPI.previewBlockMoves(key.split(',')).then((result) => {
      if (!live) return
      if (result.ok) setPlan(result.value)
      else setError(result.error)
    })
    return () => {
      live = false
    }
  }, [key])

  const movable = plan?.moves.filter((move) => move.to) ?? []
  const apply = async () => {
    if (!plan) return
    setBusy(true)
    const outcome = await actions.applyMoves(plan)
    setBusy(false)
    if (outcome === 'done') onClose()
    else if (outcome) {
      setPlan(outcome)
      setRecomputed(true)
    }
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('views:blockMoves.moveTitle')}
      description={t('views:blockMoves.moveDescription')}
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common:confirm.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={movable.length === 0}
            onClick={() => void apply()}
          >
            {t('views:blockMoves.moveThem')}
          </Button>
        </>
      }
    >
      {error && <p role="alert">{error}</p>}
      {recomputed && <p role="status">{t('views:blockMoves.recomputed')}</p>}
      {plan && (
        <ul className="block-moves-list" aria-label={t('views:blockMoves.previewList')}>
          {plan.moves.map((move) => (
            <li key={move.blockId}>
              {move.to
                ? t('views:blockMoves.moveRow', {
                    title: move.title,
                    from: whenText(move.from),
                    to: `${whenText(move.to)} (${blockTimeRange(move.to)})`
                  })
                : t('views:blockMoves.nowhere', { title: move.title })}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

/** "split in two", "split in 3". */
function splitText(parts: number): string {
  return parts === 2
    ? t('views:blockMoves.splitInTwo')
    : t('views:blockMoves.splitIn', { count: parts })
}

/**
 * Fill my day's preview: where each task would go today (also drawn on the
 * Week's grid through `onPreview`), what was split and what did not fit;
 * Place them makes every block in one call, and one undo removes them all.
 */
export function FillDayDialog({
  date,
  onClose,
  onChanged,
  onPreview
}: {
  date: string
  onClose: () => void
  onChanged?: () => void
  onPreview?: (pieces: readonly FillDayPiece[]) => void
}) {
  const actions = useBlockMoveActions(onChanged)
  const [plan, setPlan] = useState<FillDayPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recomputed, setRecomputed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void window.ostlerAPI.previewFillDay(date).then((result) => {
      if (!live) return
      if (result.ok) setPlan(result.value)
      else setError(result.error)
    })
    return () => {
      live = false
    }
  }, [date])

  useEffect(() => {
    onPreview?.(plan?.pieces ?? [])
  }, [plan, onPreview])
  useEffect(() => () => onPreview?.([]), [onPreview])

  const apply = async () => {
    if (!plan) return
    setBusy(true)
    const outcome = await actions.applyFill(plan)
    setBusy(false)
    if (outcome === 'done') onClose()
    else if (outcome) {
      setPlan(outcome)
      setRecomputed(true)
    }
  }

  const empty = plan && !plan.closed && plan.pieces.length === 0 && plan.notPlaced.length === 0

  return (
    <Dialog
      open
      size="sm"
      title={t('views:blockMoves.fillTitle')}
      description={t('views:blockMoves.fillDescription')}
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common:confirm.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!plan || plan.pieces.length === 0}
            onClick={() => void apply()}
          >
            {t('views:blockMoves.place')}
          </Button>
        </>
      }
    >
      {error && <p role="alert">{error}</p>}
      {recomputed && <p role="status">{t('views:blockMoves.recomputed')}</p>}
      {plan?.closed?.kind === 'dayOff' && (
        <p role="status">{t('views:blockMoves.dayOff', { name: plan.closed.name })}</p>
      )}
      {plan?.closed?.kind === 'notWorking' && (
        <p role="status">{t('views:blockMoves.notWorkingDay')}</p>
      )}
      {empty && <p role="status">{t('views:blockMoves.nothingToPlace')}</p>}
      {plan && !plan.closed && (plan.pieces.length > 0 || plan.notPlaced.length > 0) && (
        <ul className="block-moves-list" aria-label={t('views:blockMoves.previewList')}>
          {plan.pieces.map((piece) => (
            <li key={`${piece.workItemId}:${piece.part}`}>
              {piece.parts > 1
                ? t('views:blockMoves.pieceRowSplit', {
                    title: piece.title,
                    range: blockTimeRange(piece),
                    split: splitText(piece.parts)
                  })
                : t('views:blockMoves.pieceRow', {
                    title: piece.title,
                    range: blockTimeRange(piece)
                  })}
            </li>
          ))}
          {plan.notPlaced.map((entry) => (
            <li key={`not:${entry.workItemId}`} className="block-moves-list__missed">
              {t('views:blockMoves.didNotFit', { title: entry.title })}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

/** Fill my day's button and its dialog. */
export function FillDayButton({
  date,
  onChanged,
  onPreview,
  variant = 'secondary'
}: {
  date: string
  onChanged?: () => void
  onPreview?: (pieces: readonly FillDayPiece[]) => void
  variant?: 'secondary' | 'ghost'
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size="sm"
        variant={variant}
        icon={CalendarClock}
        title={t('views:blockMoves.fillHint')}
        onClick={() => setOpen(true)}
      >
        {t('views:blockMoves.fill')}
      </Button>
      {open && (
        <FillDayDialog
          date={date}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
          onPreview={onPreview}
        />
      )}
    </>
  )
}
