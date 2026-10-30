import type { GettingStartedProgress } from './ostler-api/config-types'
import { t } from './i18n'

/**
 * Home's getting-started checklist (P8.1). Every step ticks itself from real
 * state or from something the person did, never from a click on the card:
 * tasks and dates are read from the database, Ostler AI from the config, and
 * the rest from the activity Ostler records as it happens
 * (`GettingStartedProgress`). Main works the list out (`GettingStartedService`)
 * and the card only shows it.
 */
export const GETTING_STARTED_STEPS = [
  {
    id: 'createTask',
    get label() {
      return t('onboarding:gettingStarted.createTask')
    },
    optional: false
  },
  {
    id: 'dueDate',
    get label() {
      return t('onboarding:gettingStarted.giveTaskDueDate')
    },
    optional: false
  },
  {
    id: 'tryView',
    get label() {
      return t('onboarding:gettingStarted.tryAnotherViewList')
    },
    optional: false
  },
  {
    id: 'search',
    get label() {
      return t('onboarding:gettingStarted.findSomethingCommandPalette')
    },
    optional: false
  },
  {
    id: 'backups',
    get label() {
      return t('onboarding:gettingStarted.seeWhereBackups')
    },
    optional: false
  },
  {
    id: 'ai',
    get label() {
      return t('onboarding:gettingStarted.setUpAi')
    },
    optional: true
  }
] as const

export type GettingStartedStepId = (typeof GETTING_STARTED_STEPS)[number]['id']

/** The things the person did that the checklist records, as `recordGettingStarted` takes them. */
export const GETTING_STARTED_ACTIVITIES = ['triedView', 'usedSearch', 'sawBackups'] as const
export type GettingStartedActivity = (typeof GETTING_STARTED_ACTIVITIES)[number]

export interface GettingStartedState {
  /** A task exists that the person made: not from a template, the sample project or an import. */
  createdTask: boolean
  /** One of those tasks has a due date. */
  datedTask: boolean
  /** Ostler AI is set up (`isAiConfigured`). */
  aiConfigured: boolean
  progress: GettingStartedProgress
}

export interface GettingStartedStep {
  id: GettingStartedStepId
  label: string
  optional: boolean
  done: boolean
}

export interface GettingStarted {
  steps: GettingStartedStep[]
  /** Every step that is not optional is done. */
  complete: boolean
  dismissed: boolean
  /** Show the card: neither complete nor dismissed. */
  visible: boolean
}

/** The checklist for `state`: one rule, used by main for every surface. */
export function gettingStarted(state: GettingStartedState): GettingStarted {
  const done: Record<GettingStartedStepId, boolean> = {
    createTask: state.createdTask,
    dueDate: state.datedTask,
    tryView: state.progress.triedView,
    search: state.progress.usedSearch,
    backups: state.progress.sawBackups,
    ai: state.aiConfigured
  }
  const steps = GETTING_STARTED_STEPS.map((step) => ({ ...step, done: done[step.id] }))
  const complete = steps.every((step) => step.optional || step.done)
  const dismissed = state.progress.dismissed
  return { steps, complete, dismissed, visible: !complete && !dismissed }
}
