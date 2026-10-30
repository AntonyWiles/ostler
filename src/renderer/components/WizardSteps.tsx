import { Icon, Check } from '../ui/icons'
import { VisuallyHidden } from '../ui'
import './WizardSteps.css'
import { t } from '@shared/i18n'

/**
 * The step indicator of a stepped Dialog: one
 * numbered step per stage, the current one marked `aria-current="step"`, done
 * ones ticked. The plan wizard, the new-project wizard and project removal
 * share it.
 */
export function WizardSteps({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="wizard-steps" aria-label={t('projects:wizardSteps.steps')}>
      {steps.map((name, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'next'
        return (
          <li
            key={name}
            className={`wizard-steps__step is-${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="wizard-steps__number" aria-hidden="true">
              {state === 'done' ? <Icon icon={Check} /> : index + 1}
            </span>
            <span>{name}</span>
            {state === 'done' && <VisuallyHidden>{t('projects:wizardSteps.done')}</VisuallyHidden>}
          </li>
        )
      })}
    </ol>
  )
}
