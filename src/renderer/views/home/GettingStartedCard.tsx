import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { GettingStartedStep, GettingStartedStepId } from '@shared/getting-started'
import { useHomeFeed } from '../../hooks/useHomeFeed'
import { settingsPath } from '../../navigation/paths'
import { shortcut } from '../../navigation/shortcuts'
import { useQuickAdd } from '../../components/quick-add/QuickAddProvider'
import {
  Button,
  Card,
  Icon,
  IconButton,
  Kbd,
  ProgressBar,
  VisuallyHidden,
  useToast
} from '../../ui'
import { Check, Circle, X } from '../../ui/icons'
import { t } from '@shared/i18n'
import { Trans } from '../../i18n/Trans'

/**
 * Home's getting-started checklist (P8.1). Main works out which steps are
 * done from real state and activity; the card only shows them, and a step's
 * link takes you where to do it. Clicking the card never ticks anything. It
 * hides when every step is done or when it is dismissed.
 */
export function GettingStartedCard() {
  const feed = useHomeFeed(() => window.ostlerAPI.getGettingStarted(), [], 'home:getting-started')
  const { toast } = useToast()

  // Steps also tick from settings and activity, which main reports as `config`.
  useEffect(
    () =>
      window.ostlerAPI.onProjectStateChange((update) => {
        if (update.field === 'config') void feed.reload()
      }),
    [feed.reload]
  )

  const list = feed.value
  if (!list || !list.visible) return null
  const required = list.steps.filter((step) => !step.optional)
  const done = required.filter((step) => step.done).length

  const dismiss = async () => {
    const result = await window.ostlerAPI.dismissGettingStarted()
    if (result.ok) feed.setValue(result.value)
    else
      toast({
        title: t('views:gettingStartedCard.couldntHideChecklist'),
        body: result.error,
        tone: 'danger'
      })
  }

  return (
    <Card
      as="section"
      className="ostler-getting-started"
      aria-labelledby="ostler-getting-started-title"
    >
      <header className="ostler-getting-started__header">
        <div>
          <h2 id="ostler-getting-started-title">{t('views:gettingStartedCard.gettingStarted')}</h2>
          <p>{t('views:gettingStartedCard.eachStepTicksItself')}</p>
        </div>
        <IconButton
          label={t('views:gettingStartedCard.hideGettingStarted')}
          icon={X}
          size="sm"
          onClick={() => void dismiss()}
        />
      </header>
      <ProgressBar
        label={t('views:gettingStartedCard.stepsDone')}
        value={done}
        max={required.length}
        valueText={t('views:gettingStartedCard.of', { done, requiredCount: required.length })}
        showLabel
        tone="success"
      />
      <ol className="ostler-getting-started__steps">
        {list.steps.map((step) => (
          <li key={step.id} className={step.done ? 'is-done' : undefined}>
            <Icon icon={step.done ? Check : Circle} className="ostler-getting-started__mark" />
            <span className="ostler-getting-started__label">
              <StepLabel step={step} />
              {step.optional && (
                <span className="ostler-getting-started__optional">
                  {' '}
                  {t('views:gettingStartedCard.optional')}
                </span>
              )}
              <VisuallyHidden>
                {step.done
                  ? t('views:gettingStartedCard.done')
                  : t('views:gettingStartedCard.notDoneYet')}
              </VisuallyHidden>
            </span>
            {!step.done && <StepAction id={step.id} />}
          </li>
        ))}
      </ol>
    </Card>
  )
}

function StepLabel({ step }: { step: GettingStartedStep }) {
  if (step.id === 'search')
    return (
      <>
        <Trans
          i18nKey="views:gettingStartedCard.findSomethingWith"
          components={{ kbd: <Kbd shortcut={shortcut('palette').keys} /> }}
        />
      </>
    )
  return <>{step.label}</>
}

/** Where to do a step. Doing it there is what ticks it. */
function StepAction({ id }: { id: GettingStartedStepId }) {
  const quickAdd = useQuickAdd()
  switch (id) {
    case 'createTask':
      return (
        <Button size="sm" variant="ghost" onClick={() => quickAdd.open()}>
          {t('views:gettingStartedCard.addTask')}
        </Button>
      )
    case 'dueDate':
      return (
        <span className="ostler-getting-started__how">
          {t('views:gettingStartedCard.openTaskSetDue')}
        </span>
      )
    case 'tryView':
      return (
        <span className="ostler-getting-started__how">
          {t('views:gettingStartedCard.useTabsTopProject')}
        </span>
      )
    case 'search':
      return null
    case 'backups':
      return <Link to={settingsPath('data')}>{t('views:gettingStartedCard.settingsData')}</Link>
    case 'ai':
      return <Link to={settingsPath('ai')}>{t('views:gettingStartedCard.settingsAi')}</Link>
  }
}
