/** `FIELD_SPECS`: every field, its operators and the values they take. */

import type { PlanningFieldDefinition, PlanningFieldType } from '../ostler-api'
import { t } from '../i18n'
import type {
  FilterFieldSpec,
  FilterOpSpec,
  RelativeDate,
  TaskFilterField,
  TaskFilterOp
} from './types'

const DUE_RELATIVE: readonly RelativeDate[] = [
  'today',
  'overdue',
  'thisWeek',
  'next7Days',
  'none',
  'any'
]
const RECORDED_RELATIVE: readonly RelativeDate[] = ['today', 'thisWeek', 'last7Days']
const SHOW_FROM_RELATIVE: readonly RelativeDate[] = ['hidden', 'shown', 'today', 'none', 'any']

const dateOps = (relative: readonly RelativeDate[]): FilterOpSpec[] => [
  { op: 'is', label: 'is', kind: 'relativeDate', relative },
  { op: 'before', label: t('tasks:taskFilter.before'), kind: 'date' },
  { op: 'after', label: t('tasks:taskFilter.after'), kind: 'date' }
]

export const FIELD_SPECS: readonly FilterFieldSpec[] = [
  {
    field: 'text',
    get label() {
      return t('tasks:taskFilter.text')
    },
    ops: [
      { op: 'contains', label: 'contains', kind: 'text' },
      {
        op: 'notContains',
        get label() {
          return t('tasks:taskFilter.doesNotContain')
        },
        kind: 'text'
      }
    ]
  },
  {
    field: 'status',
    get label() {
      return t('tasks:taskFilter.status')
    },
    ops: [
      { op: 'is', label: 'is', kind: 'statuses' },
      {
        op: 'isNot',
        get label() {
          return t('tasks:taskFilter.not')
        },
        kind: 'statuses'
      }
    ]
  },
  {
    field: 'priority',
    get label() {
      return t('tasks:taskFilter.priority')
    },
    ops: [
      { op: 'is', label: 'is', kind: 'priorities' },
      {
        op: 'isNot',
        get label() {
          return t('tasks:taskFilter.not')
        },
        kind: 'priorities'
      }
    ]
  },
  {
    field: 'assignee',
    get label() {
      return t('tasks:taskFilter.assignee')
    },
    ops: [
      { op: 'is', label: 'is', kind: 'people' },
      {
        op: 'isNot',
        get label() {
          return t('tasks:taskFilter.not')
        },
        kind: 'people'
      }
    ]
  },
  {
    field: 'labels',
    get label() {
      return t('tasks:taskFilter.labels')
    },
    ops: [
      {
        op: 'hasAny',
        get label() {
          return t('tasks:taskFilter.includeAny')
        },
        kind: 'labels'
      },
      {
        op: 'hasAll',
        get label() {
          return t('tasks:taskFilter.includeAll')
        },
        kind: 'labels'
      },
      {
        op: 'hasNone',
        get label() {
          return t('tasks:taskFilter.includeNone')
        },
        kind: 'labels'
      }
    ]
  },
  {
    field: 'milestone',
    get label() {
      return t('tasks:taskFilter.milestone')
    },
    ops: [
      { op: 'is', label: 'is', kind: 'milestones' },
      {
        op: 'isNot',
        get label() {
          return t('tasks:taskFilter.not')
        },
        kind: 'milestones'
      }
    ]
  },
  {
    field: 'goal',
    get label() {
      return t('tasks:taskFilter.goal')
    },
    ops: [
      { op: 'is', label: 'is', kind: 'goals' },
      {
        op: 'isNot',
        get label() {
          return t('tasks:taskFilter.not')
        },
        kind: 'goals'
      }
    ]
  },
  {
    field: 'iteration',
    get label() {
      return t('tasks:taskFilter.iteration')
    },
    ops: [
      { op: 'is', label: 'is', kind: 'iterations' },
      {
        op: 'isNot',
        get label() {
          return t('tasks:taskFilter.not')
        },
        kind: 'iterations'
      }
    ]
  },
  {
    field: 'type',
    get label() {
      return t('tasks:taskFilter.type')
    },
    ops: [
      { op: 'is', label: 'is', kind: 'types' },
      {
        op: 'isNot',
        get label() {
          return t('tasks:taskFilter.not')
        },
        kind: 'types'
      }
    ]
  },
  {
    field: 'subproject',
    get label() {
      return t('tasks:taskFilter.subproject')
    },
    ops: [
      { op: 'is', label: 'is', kind: 'subprojects' },
      {
        op: 'isNot',
        get label() {
          return t('tasks:taskFilter.not')
        },
        kind: 'subprojects'
      }
    ]
  },
  {
    field: 'contact',
    get label() {
      return t('tasks:taskFilter.contact')
    },
    ops: [
      {
        op: 'hasAny',
        get label() {
          return t('tasks:taskFilter.contactIncludes')
        },
        kind: 'contacts'
      },
      {
        op: 'hasNone',
        get label() {
          return t('tasks:taskFilter.contactExcludes')
        },
        kind: 'contacts'
      }
    ]
  },
  {
    field: 'due',
    get label() {
      return t('tasks:taskFilter.due')
    },
    ops: dateOps(DUE_RELATIVE)
  },
  {
    field: 'start',
    get label() {
      return t('tasks:taskFilter.start')
    },
    ops: dateOps(DUE_RELATIVE)
  },
  {
    field: 'estimate',
    get label() {
      return t('tasks:taskFilter.estimate')
    },
    ops: [
      { op: 'is', label: 'is', kind: 'estimatePresence' },
      { op: 'equals', label: 'equals', kind: 'number' },
      {
        op: 'lessThan',
        get label() {
          return t('tasks:taskFilter.lessThan')
        },
        kind: 'number'
      },
      {
        op: 'greaterThan',
        get label() {
          return t('tasks:taskFilter.moreThan')
        },
        kind: 'number'
      }
    ]
  },
  {
    field: 'checklist',
    get label() {
      return t('tasks:taskFilter.checklist')
    },
    ops: [{ op: 'is', label: 'is', kind: 'checklist' }]
  },
  {
    field: 'hasComments',
    get label() {
      return t('tasks:taskFilter.hasComments')
    },
    ops: [{ op: 'is', label: 'is', kind: 'boolean' }]
  },
  {
    field: 'recurring',
    get label() {
      return t('tasks:taskFilter.repeats')
    },
    ops: [{ op: 'is', label: 'is', kind: 'boolean' }]
  },
  {
    field: 'resolution',
    get label() {
      return t('tasks:taskFilter.resolution')
    },
    ops: [
      { op: 'is', label: 'is', kind: 'resolution' },
      {
        op: 'isNot',
        get label() {
          return t('tasks:taskFilter.not')
        },
        kind: 'resolution'
      }
    ]
  },
  {
    field: 'showFrom',
    get label() {
      return t('tasks:taskFilter.showFrom')
    },
    ops: dateOps(SHOW_FROM_RELATIVE)
  },
  {
    field: 'someday',
    get label() {
      return t('tasks:taskFilter.someday')
    },
    ops: [{ op: 'is', label: 'is', kind: 'boolean' }]
  },
  {
    field: 'inTriage',
    get label() {
      return t('tasks:taskFilter.inTriage')
    },
    ops: [{ op: 'is', label: 'is', kind: 'boolean' }]
  },
  {
    field: 'impact',
    get label() {
      return t('tasks:taskFilter.impact')
    },
    ops: scoreOps()
  },
  {
    field: 'effort',
    get label() {
      return t('tasks:taskFilter.effort')
    },
    ops: scoreOps()
  },
  {
    field: 'created',
    get label() {
      return t('tasks:taskFilter.created')
    },
    ops: dateOps(RECORDED_RELATIVE)
  },
  {
    field: 'updated',
    get label() {
      return t('tasks:taskFilter.updated')
    },
    ops: dateOps(RECORDED_RELATIVE)
  }
]

const presenceOp: FilterOpSpec = {
  op: 'isEmpty',
  get label() {
    return t('tasks:taskFilter.isEmptyOp')
  },
  kind: 'presence'
}

/**
 * The operators a custom field offers, by its type (R2.2): text contains,
 * number between, date before or after, choice is one of, and "is empty"
 * for every type but a checkbox.
 */
export const CUSTOM_FIELD_OPS: Record<PlanningFieldType, readonly FilterOpSpec[]> = {
  text: [
    { op: 'contains', label: 'contains', kind: 'text' },
    {
      op: 'notContains',
      get label() {
        return t('tasks:taskFilter.doesNotContain')
      },
      kind: 'text'
    },
    presenceOp
  ],
  number: [
    {
      op: 'between',
      get label() {
        return t('tasks:taskFilter.between')
      },
      kind: 'numberRange'
    },
    { op: 'equals', label: 'equals', kind: 'number' },
    {
      op: 'lessThan',
      get label() {
        return t('tasks:taskFilter.lessThan')
      },
      kind: 'number'
    },
    {
      op: 'greaterThan',
      get label() {
        return t('tasks:taskFilter.moreThan')
      },
      kind: 'number'
    },
    presenceOp
  ],
  date: [
    {
      op: 'before',
      get label() {
        return t('tasks:taskFilter.before')
      },
      kind: 'date'
    },
    {
      op: 'after',
      get label() {
        return t('tasks:taskFilter.after')
      },
      kind: 'date'
    },
    presenceOp
  ],
  choice: [
    {
      op: 'is',
      get label() {
        return t('tasks:taskFilter.isOneOf')
      },
      kind: 'options'
    },
    {
      op: 'isNot',
      get label() {
        return t('tasks:taskFilter.not')
      },
      kind: 'options'
    },
    presenceOp
  ],
  choices: [
    {
      op: 'hasAny',
      get label() {
        return t('tasks:taskFilter.includeAny')
      },
      kind: 'options'
    },
    {
      op: 'hasAll',
      get label() {
        return t('tasks:taskFilter.includeAll')
      },
      kind: 'options'
    },
    {
      op: 'hasNone',
      get label() {
        return t('tasks:taskFilter.includeNone')
      },
      kind: 'options'
    },
    presenceOp
  ],
  checkbox: [{ op: 'is', label: 'is', kind: 'boolean' }]
}

/** The custom-field spec for a condition, by its field's type; undefined when the field is gone. */
export function customOpSpec(
  field: Pick<PlanningFieldDefinition, 'type'> | undefined,
  op: TaskFilterOp
): FilterOpSpec | undefined {
  return field ? CUSTOM_FIELD_OPS[field.type].find((spec) => spec.op === op) : undefined
}

export const RELATIVE_DATE_LABELS: Record<RelativeDate, string> = {
  today: 'today',
  overdue: 'overdue',
  get thisWeek() {
    return t('tasks:taskFilter.week')
  },
  get next7Days() {
    return t('tasks:taskFilter.next7Days')
  },
  get last7Days() {
    return t('tasks:taskFilter.last7Days')
  },
  get none() {
    return t('tasks:taskFilter.notSet')
  },
  any: 'set',
  get hidden() {
    return t('tasks:taskFilter.hiddenNow')
  },
  get shown() {
    return t('tasks:taskFilter.shownNow')
  }
}

export const CHECKLIST_VALUES = ['complete', 'incomplete'] as const

export function fieldSpec(field: TaskFilterField): FilterFieldSpec | undefined {
  return FIELD_SPECS.find((spec) => spec.field === field)
}

export function opSpec(field: TaskFilterField, op: TaskFilterOp): FilterOpSpec | undefined {
  return fieldSpec(field)?.ops.find((spec) => spec.op === op)
}

/** The operators of a number that may be empty: the estimate, and an idea's scores (N1.1b). */
function scoreOps(): FilterOpSpec[] {
  return [
    { op: 'is', label: 'is', kind: 'estimatePresence' },
    { op: 'equals', label: 'equals', kind: 'number' },
    {
      op: 'lessThan',
      get label() {
        return t('tasks:taskFilter.lessThan')
      },
      kind: 'number'
    },
    {
      op: 'greaterThan',
      get label() {
        return t('tasks:taskFilter.moreThan')
      },
      kind: 'number'
    }
  ]
}

/** Every operator custom fields use, for checking a stored condition without its field. */
export const CUSTOM_OPS: FilterOpSpec[] = Object.values(CUSTOM_FIELD_OPS).flat()
