import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MAX_BASELINES } from '@shared/planning/baselines'
import { normalizeProjectStage } from '@shared/project-stages'
import { projectStageName } from '../../../components/project-stage-name'
import { useProjectStageNames } from '../../../hooks/useProjectStageNames'
import { projectPath } from '../../../navigation/paths'
import { Button, Checkbox, Icon, useToast } from '../../../ui'
import { Check, Circle } from '../../../ui/icons'
import { useMoveProjectStage } from '../../home/ProjectStageBoard'
import type { PlanStepProps } from './plan-step-props'
import { t } from '@shared/i18n'

/**
 * The Start step: the other steps' marks, and for a project in Planning,
 * Start the project, which can keep today's dates as a baseline, moves the
 * project to Active (with undo) and opens its Overview. The marks are advice:
 * starting is always offered.
 */
export function PlanStartStep({ project, progress }: PlanStepProps) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { names } = useProjectStageNames()
  const move = useMoveProjectStage(names)
  const stage = normalizeProjectStage(project.stage)
  const planning = stage === 'planning'
  // Null until the project's baselines are read.
  const [baselineCount, setBaselineCount] = useState<number | null>(null)
  const [keepDates, setKeepDates] = useState(true)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!planning) return
    let cancelled = false
    void window.ostlerAPI.listBaselines(project.id).then((result) => {
      if (!cancelled) setBaselineCount(result.ok ? result.value.length : 0)
    })
    return () => {
      cancelled = true
    }
  }, [planning, project.id])

  const baselineFull = baselineCount !== null && baselineCount >= MAX_BASELINES
  const offerBaseline = planning && progress.hasDates && !baselineFull

  const start = async () => {
    setStarting(true)
    try {
      if (offerBaseline && keepDates) {
        const saved = await window.ostlerAPI.createBaseline(project.id, {
          name: t('views:planView.start.baselineName')
        })
        if (!saved.ok) {
          toast({
            tone: 'danger',
            title: t('views:planView.start.baselineFailed', { error: saved.error })
          })
        }
      }
      const moved = await move(project.id, 'active')
      if (moved) navigate(projectPath(project.id, 'overview'))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="plan-step">
      <ul className="plan-start__checklist">
        {progress.steps
          .filter((step) => step !== 'start')
          .map((step) => {
            const done = progress.done[step]
            return (
              <li key={step} className="plan-start__check">
                <span className="plan-step__item-name">
                  {t(`views:planView.step.${step}.name`)}
                </span>
                <span className="plan-page__step-mark" data-done={done}>
                  <Icon icon={done ? Check : Circle} />
                  {done ? t('views:planView.done') : t('views:planView.toDo')}
                </span>
              </li>
            )
          })}
      </ul>

      {planning ? (
        <>
          <p className="plan-step__note">
            {progress.done.start
              ? t('views:planView.start.ready')
              : t('views:planView.start.notYet')}
          </p>
          {offerBaseline && (
            <Checkbox
              label={t('views:planView.start.baseline')}
              hint={t('views:planView.schedule.baselineHint')}
              checked={keepDates}
              onChange={(event) => setKeepDates(event.target.checked)}
            />
          )}
          {progress.hasDates && baselineFull && (
            <p className="plan-step__note">
              {t('views:planView.start.baselineFull', { count: MAX_BASELINES })}
            </p>
          )}
          <div className="plan-tasks__group">
            <div className="plan-step__actions">
              <Button variant="primary" loading={starting} onClick={() => void start()}>
                {t('views:planView.start.button')}
              </Button>
            </div>
            <p className="plan-tasks__hint">
              {t('views:planView.start.whatHappens', { name: projectStageName('active', names) })}
            </p>
          </div>
        </>
      ) : (
        <p className="plan-step__note">
          {t('views:planView.start.inStage', { name: projectStageName(stage, names) })}
        </p>
      )}
    </div>
  )
}
