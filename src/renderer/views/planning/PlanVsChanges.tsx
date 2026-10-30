import type { HarnessPlan } from '@shared/ostler-api'
import { comparePlanFiles } from '@shared/plan-first'
import { InlineAlert } from '../../ui'
import { t } from '@shared/i18n'

/**
 * The approved plan beside the change in Review changes (N9.3b): the plan's
 * steps, then its files against the files the run changed. `changed` is null
 * while the change is still being read. Plain text only: the plan is the
 * agent's own words.
 */
export function PlanVsChanges({ plan, changed }: { plan: HarnessPlan; changed: string[] | null }) {
  const compared = changed ? comparePlanFiles(plan.files, changed) : null
  return (
    <section className="dialog-section" aria-label={t('agents:planFirst.reviewPlan')}>
      <h3 className="dialog-section__title">
        {t('agents:planFirst.reviewPlan')} ·{' '}
        {t('agents:planFirst.version', { version: plan.version })}
      </h3>
      <ol className="dialog-list">
        {plan.steps.map((step, index) => (
          <li key={index} className="dialog-report">
            {step}
          </li>
        ))}
      </ol>
      {plan.changedBeforeApproval && plan.changedBeforeApproval.files.length > 0 && (
        <InlineAlert tone="warning">
          {t('agents:planFirst.changedBeforeApproval', {
            count: plan.changedBeforeApproval.files.length
          })}{' '}
          {plan.changedBeforeApproval.files.join(', ')}
        </InlineAlert>
      )}
      {compared &&
        (compared.changedNotPlanned.length === 0 && compared.plannedNotChanged.length === 0 ? (
          <p className="dialog-muted">{t('agents:planFirst.filesMatch')}</p>
        ) : (
          <>
            <FileList
              title={t('agents:planFirst.changedNotInPlan')}
              files={compared.changedNotPlanned}
            />
            <FileList
              title={t('agents:planFirst.inPlanNotChanged')}
              files={compared.plannedNotChanged}
            />
          </>
        ))}
    </section>
  )
}

function FileList({ title, files }: { title: string; files: string[] }) {
  if (files.length === 0) return null
  return (
    <div aria-label={title}>
      <h4 className="dialog-section__title">{title}</h4>
      <ul className="dialog-list dialog-list--code">
        {files.map((file) => (
          <li key={file}>
            <code>{file}</code>
          </li>
        ))}
      </ul>
    </div>
  )
}
