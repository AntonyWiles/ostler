import { useState } from 'react'
import type {
  EstimateUnit,
  PlanningIteration,
  PlanningIterationCarryOver,
  PlanningWorkItem
} from '@shared/ostler-api'
import { nextIteration } from '@shared/planning/iterations'
import { Button, Dialog, InlineAlert, Radio, RadioGroup } from '../ui'
import { estimateAmount, iterationDates } from './iteration-words'
import { t } from '@shared/i18n'

const totalEstimate = (tasks: readonly PlanningWorkItem[]) =>
  Math.round(tasks.reduce((sum, task) => sum + (task.estimate ?? 0), 0) * 100) / 100

/**
 * Finish iteration: what was done and what was not, and where the unfinished
 * tasks go: the next planned iteration, or out of any. Main does the move
 * and keeps the summary on the iteration.
 */
export function FinishIterationDialog({
  iteration,
  iterations,
  tasks,
  unit,
  busy,
  error,
  onClose,
  onFinish
}: {
  iteration: PlanningIteration
  iterations: readonly PlanningIteration[]
  /** The project's live tasks; those in this iteration are picked out here. */
  tasks: readonly PlanningWorkItem[]
  unit: EstimateUnit
  busy: boolean
  /** The workspace's error line: a refusal from main shows here, in the dialog. */
  error?: string | null
  onClose: () => void
  onFinish: (carryOver: PlanningIterationCarryOver) => Promise<boolean>
}) {
  const next = nextIteration(iterations, iteration)
  const [carryOver, setCarryOver] = useState<PlanningIterationCarryOver>(next ? 'next' : 'none')
  const inIt = tasks.filter((task) => task.iterationId === iteration.id)
  const done = inIt.filter((task) => task.status === 'done')
  const open = inIt.filter((task) => task.status !== 'done')

  const list = (items: PlanningWorkItem[], empty: string) =>
    items.length === 0 ? (
      <p className="iterations__quiet">{empty}</p>
    ) : (
      <ul className="iteration-finish__tasks">
        {items.map((task) => (
          <li key={task.id}>
            <span>{task.title}</span>
            {task.estimate !== null && (
              <span className="iteration-finish__estimate">
                {estimateAmount(task.estimate, unit)}
              </span>
            )}
          </li>
        ))}
      </ul>
    )

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      size="md"
      title={t('tasks:iterations.finishTitle', { name: iteration.name })}
      description={iterationDates(iteration)}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('tasks:iterations.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() =>
              void onFinish(carryOver).then((finished) => {
                if (finished) onClose()
              })
            }
          >
            {t('tasks:iterations.finish')}
          </Button>
        </>
      }
    >
      <div className="iteration-finish">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <section aria-labelledby="iteration-finish-done">
          <h3 id="iteration-finish-done" className="iteration-finish__heading">
            {t('tasks:iterations.doneHeading', {
              count: done.length,
              estimate: estimateAmount(totalEstimate(done), unit)
            })}
          </h3>
          {list(done, t('tasks:iterations.nothingDone'))}
        </section>
        <section aria-labelledby="iteration-finish-open">
          <h3 id="iteration-finish-open" className="iteration-finish__heading">
            {t('tasks:iterations.openHeading', {
              count: open.length,
              estimate: estimateAmount(totalEstimate(open), unit)
            })}
          </h3>
          {list(open, t('tasks:iterations.nothingOpen'))}
        </section>
        {open.length > 0 && (
          <RadioGroup legend={t('tasks:iterations.carryOverLegend')}>
            <Radio
              name="carry-over"
              value="next"
              label={
                next
                  ? t('tasks:iterations.carryNext', { name: next.name })
                  : t('tasks:iterations.carryNextNone')
              }
              hint={next ? iterationDates(next) : t('tasks:iterations.carryNextNoneHint')}
              disabled={!next}
              checked={carryOver === 'next'}
              onChange={() => setCarryOver('next')}
            />
            <Radio
              name="carry-over"
              value="none"
              label={t('tasks:iterations.carryNone')}
              checked={carryOver === 'none'}
              onChange={() => setCarryOver('none')}
            />
          </RadioGroup>
        )}
      </div>
    </Dialog>
  )
}
