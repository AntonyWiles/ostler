import type { PlanningIteration } from '@shared/ostler-api'
import type { PlanningWorkspace } from '../hooks/usePlanningWorkspace'
import { useProjectEstimateUnit } from '../context/OstlerContext'
import { Badge, Button, IconButton, Menu, type BadgeTone } from '../ui'
import { CircleCheck, Ellipsis, Pencil, Play, ScrollText, Trash2 } from '../ui/icons'
import { estimateAmount, iterationDates, iterationStatusLabel } from './iteration-words'
import './iterations.css'
import { t } from '@shared/i18n'

const STATUS_TONE: Record<PlanningIteration['status'], BadgeTone> = {
  active: 'info',
  planned: 'neutral',
  finished: 'success'
}

/**
 * The Milestones tab's Iterations section (R6.1): every iteration of the
 * project in date order, with Start, Finish, Edit and Delete. Shown only once
 * the project has an iteration, so a project that never makes one looks as
 * it always did.
 */
export function IterationsSection({
  ws,
  onEdit,
  onFinish,
  onDelete,
  onWriteReleaseNotes
}: {
  ws: PlanningWorkspace
  onEdit: (iteration: PlanningIteration) => void
  onFinish: (iteration: PlanningIteration) => void
  onDelete: (iteration: PlanningIteration) => void
  /** Write release notes (N9.9) from the iteration's finished tasks. */
  onWriteReleaseNotes: (iteration: PlanningIteration) => void
}) {
  const unit = useProjectEstimateUnit(ws.projectId)
  if (ws.iterations.length === 0) return null
  const anyActive = ws.iterations.some((iteration) => iteration.status === 'active')

  const progress = (iteration: PlanningIteration): string => {
    if (iteration.summary) {
      const summary = iteration.summary
      return t('tasks:iterations.summary', {
        count: summary.doneCount,
        doneEstimate: estimateAmount(summary.doneEstimate, unit),
        carried: summary.carriedCount,
        carriedEstimate: estimateAmount(summary.carriedEstimate, unit)
      })
    }
    const tasks = ws.workItems.filter((item) => item.iterationId === iteration.id)
    if (tasks.length === 0) return t('tasks:iterations.noTasks')
    return t('tasks:iterations.progress', {
      count: tasks.length,
      done: tasks.filter((item) => item.status === 'done').length
    })
  }

  return (
    <section className="iterations" aria-labelledby="iterations-heading">
      <header className="goal-header">
        <div className="goal-header__titles">
          <h2 id="iterations-heading" className="goal-header__title">
            {t('tasks:iterations.heading')}
          </h2>
          <p className="goal-header__outcome">{t('tasks:iterations.intro')}</p>
        </div>
      </header>
      <ul className="iterations__list">
        {ws.iterations.map((iteration) => {
          const menuLabel = t('tasks:iterations.moreActions', { name: iteration.name })
          return (
            <li key={iteration.id} className="iteration-row" data-status={iteration.status}>
              <div className="iteration-row__main">
                <div className="iteration-row__title">
                  <h3 className="iteration-row__name">{iteration.name}</h3>
                  <Badge tone={STATUS_TONE[iteration.status]}>
                    {iterationStatusLabel(iteration.status)}
                  </Badge>
                </div>
                <p className="iteration-row__meta">
                  <span>{iterationDates(iteration)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{progress(iteration)}</span>
                </p>
                {iteration.goal && <p className="iteration-row__goal">{iteration.goal}</p>}
              </div>
              <div className="iteration-row__actions">
                {iteration.status === 'planned' && !anyActive && (
                  <Button
                    size="sm"
                    icon={Play}
                    loading={ws.isBusyOn(iteration.id)}
                    disabled={ws.busy}
                    onClick={() => void ws.startIteration(iteration)}
                  >
                    {t('tasks:iterations.start2')}
                  </Button>
                )}
                {iteration.status === 'active' && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={CircleCheck}
                    disabled={ws.busy}
                    onClick={() => onFinish(iteration)}
                  >
                    {t('tasks:iterations.finishIteration')}
                  </Button>
                )}
                <Menu
                  label={menuLabel}
                  placement="bottom-end"
                  items={[
                    {
                      label: t('tasks:iterations.edit'),
                      icon: Pencil,
                      onSelect: () => onEdit(iteration)
                    },
                    {
                      label: t('tasks:releaseNotes.write'),
                      icon: ScrollText,
                      onSelect: () => onWriteReleaseNotes(iteration)
                    },
                    {
                      label: t('tasks:iterations.delete'),
                      icon: Trash2,
                      tone: 'danger',
                      onSelect: () => onDelete(iteration)
                    }
                  ]}
                  renderTrigger={(trigger) => (
                    <IconButton {...trigger} label={menuLabel} icon={Ellipsis} size="sm" />
                  )}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
