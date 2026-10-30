import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'
import type { ProjectViewId } from '../navigation/registry'
import { shortcut } from '../navigation/shortcuts'
import type { TipSide } from './placement'
import { findTarget, findTargets } from './targets'
import { hasResizedDrawer } from '../ui/Drawer'

/**
 * Every tip and the walkthrough, in one place. A tip points at an element
 * found by `target`, a CSS selector; the elements carry `data-tour` names so
 * a restyle does not lose them. Text is read when shown, in the interface
 * language. They start in the sample project for now (`isSampleProject`).
 */
export interface TipContent {
  /** The element the tip points at: a CSS selector, or a finder for one a selector can't name. */
  target: TipTarget
  side: TipSide
  title: () => string
  body: () => string
  /** Lines from the tip to exactly what to click or drag, each with a word or two. */
  pointers?: readonly TipPointer[]
  /** False: nothing is outlined, the card's arrow alone points (pointers keep their labels). */
  outline?: false
}

export type TipTarget = string | (() => Element | null)

/** The element a tip's `target` names, if it is on screen. */
export function resolveTarget(target: TipTarget): Element | null {
  return typeof target === 'string' ? findTarget(target) : target()
}

/**
 * A line from the tip to one control, labelled with what to do there
 * ("Click to sort"). With `to`, it is a drag instead: a dashed arrow from the
 * control to where it goes ("Drag to another day").
 */
export interface TipPointer {
  find: () => Element | null
  label: () => string
  to?: (from: Element) => Element | null
}

export interface TourStep extends TipContent {
  /** The project view to open first; left out, the step shows wherever the person is. */
  view?: ProjectViewId
  /** One-off tips that say what this step says: seen here, they are not offered again. */
  covers?: readonly string[]
}

export interface OneTimeTip extends TipContent {
  /** Saved in `ui.tips.dismissed` once the person says "Got it". */
  id: string
  /** Only on this project view. */
  view?: ProjectViewId
  /** Shows anywhere, not only in the sample project: for things every panel or view has. */
  anywhere?: boolean
}

/** The `n`th (from 0) element matching `selector` that is on screen. */
function nth(selector: string, n = 0): () => Element | null {
  return () => findTargets(selector)[n] ?? null
}

const CALENDAR_DAY = '.ostler-workspace-view--calendar .ui-calendar [role="gridcell"]'
const CALENDAR_TASK = '.ostler-workspace-view--calendar .ui-calendar__item[draggable="true"]'
const TIMELINE_BAR = '.ostler-workspace-view--timeline .ui-timeline__bar--bar.is-editable'
const LIBRARY_ITEM =
  '.ostler-workspace-view--library .ostler-library-banner, .ostler-workspace-view--library .ostler-library-row'
const SORTABLE_HEADING = '.ostler-workspace-view--list [role="columnheader"].is-sortable'
const LIBRARY_ADD =
  '.ostler-workspace-view--library .ostler-library-toolbar button[aria-haspopup="menu"]'

/** A day two along from the one a calendar task sits on, in the same week: where to drag it. */
function calendarDayBeside(task: Element): Element | null {
  const box = task.getBoundingClientRect()
  const week = findTargets(CALENDAR_DAY).filter((day) => {
    const cell = day.getBoundingClientRect()
    return box.top >= cell.top && box.top < cell.bottom
  })
  const index = week.findIndex((day) => {
    const cell = day.getBoundingClientRect()
    return box.left >= cell.left - 1 && box.left < cell.right
  })
  if (index < 0) return null
  return week[index >= 2 ? index - 2 : index + 2] ?? null
}

/** The widest bar that can be dragged: the easiest to point at and to grab. */
function widestTimelineBar(): Element | null {
  let widest: Element | null = null
  let width = 0
  for (const bar of findTargets(TIMELINE_BAR)) {
    const box = bar.getBoundingClientRect()
    if (box.width > width) {
      widest = bar
      width = box.width
    }
  }
  return widest
}

/** The board column after the one a card is in: where to drag it to move it on. */
function nextColumn(card: Element): Element | null {
  const columns = findTargets('.board .board-column')
  const own = columns.findIndex((column) => column.contains(card))
  return own < 0 ? null : (columns[own + 1] ?? null)
}

/** The walkthrough of the sample project, and the id saved once it is finished or turned down. */
export const SAMPLE_TOUR_ID = 'tour:sample'

export const SAMPLE_TOUR: readonly TourStep[] = [
  {
    target: '[data-tour="project-header"]',
    side: 'bottom',
    // The whole header row: an outline round it would only run through its buttons.
    outline: false,
    title: () => t('onboarding:tips.tour.welcome.title'),
    body: () => t('onboarding:tips.tour.welcome.body')
  },
  {
    target: '.ostler-workspace-tabs [role="tablist"]',
    view: 'overview',
    side: 'bottom',
    title: () => t('onboarding:tips.tour.views.title'),
    body: () => t('onboarding:tips.tour.views.body')
  },
  {
    target: '.ostler-workspace-view--overview .overview-stats',
    view: 'overview',
    side: 'bottom',
    title: () => t('onboarding:tips.tour.overview.title'),
    body: () => t('onboarding:tips.tour.overview.body'),
    pointers: [
      {
        // The Status section comes first, and its one action is Post an update.
        find: nth('.ostler-workspace-view--overview .ui-section__actions .ui-button'),
        label: () => t('onboarding:tips.pointers.postUpdate')
      }
    ]
  },
  {
    target: '.board__columns, .board__lanes',
    view: 'board',
    side: 'bottom',
    title: () => t('onboarding:tips.tour.board.title'),
    body: () => t('onboarding:tips.tour.board.body')
  },
  {
    target: '.board .task-card',
    view: 'board',
    side: 'right',
    title: () => t('onboarding:tips.tour.card.title'),
    body: () => t('onboarding:tips.tour.card.body'),
    pointers: [
      { find: nth('.board .task-card'), label: () => t('onboarding:tips.pointers.clickToOpen') }
    ],
    covers: ['tip:board-drag']
  },
  {
    // The tip points at one heading itself: its ring and arrow say "this", with no label of its own.
    target: nth(SORTABLE_HEADING, 1),
    view: 'list',
    side: 'bottom',
    title: () => t('onboarding:tips.tour.list.title'),
    body: () => t('onboarding:tips.tour.list.body'),
    pointers: [
      {
        find: nth('.ostler-workspace-view--list .list-view__columns'),
        label: () => t('onboarding:tips.pointers.chooseColumns')
      }
    ],
    covers: ['tip:list']
  },
  {
    target: CALENDAR_TASK,
    view: 'calendar',
    side: 'top',
    title: () => t('onboarding:tips.tour.calendar.title'),
    body: () => t('onboarding:tips.tour.calendar.body'),
    pointers: [
      {
        find: nth('.ostler-workspace-view--calendar .ui-segmented'),
        label: () => t('onboarding:tips.pointers.changeRange')
      },
      {
        find: nth(CALENDAR_TASK),
        label: () => t('onboarding:tips.pointers.dragToDay'),
        to: calendarDayBeside
      }
    ],
    covers: ['tip:calendar']
  },
  {
    target: widestTimelineBar,
    view: 'timeline',
    side: 'bottom',
    // Bars are small and close together: the labels say which, an outline only crowds them.
    outline: false,
    title: () => t('onboarding:tips.tour.timeline.title'),
    body: () => t('onboarding:tips.tour.timeline.body'),
    pointers: [
      { find: widestTimelineBar, label: () => t('onboarding:tips.pointers.dragToMove') },
      {
        find: nth('.ostler-workspace-view--timeline .timeline-view__critical-path'),
        label: () => t('onboarding:tips.pointers.criticalPath')
      }
    ],
    covers: ['tip:timeline']
  },
  {
    target: '.ostler-workspace-view--milestones .milestone-card .ui-progress',
    view: 'milestones',
    side: 'right',
    // The text says what the bar does: the arrow is enough.
    outline: false,
    title: () => t('onboarding:tips.tour.milestones.title'),
    body: () => t('onboarding:tips.tour.milestones.body')
  },
  {
    target: LIBRARY_ITEM,
    view: 'library',
    side: 'bottom',
    title: () => t('onboarding:tips.tour.library.title'),
    body: () => t('onboarding:tips.tour.library.body'),
    pointers: [
      { find: nth(LIBRARY_ITEM), label: () => t('onboarding:tips.pointers.clickToOpen') },
      { find: nth(LIBRARY_ADD), label: () => t('onboarding:tips.pointers.addDocument') }
    ],
    covers: ['tip:library']
  },
  {
    target: '.ostler-workspace-view--decisions .decisions__row',
    view: 'decisions',
    side: 'bottom',
    title: () => t('onboarding:tips.tour.decisions.title'),
    body: () => t('onboarding:tips.tour.decisions.body'),
    pointers: [
      {
        find: nth('.ostler-workspace-view--decisions .decisions__row'),
        label: () => t('onboarding:tips.pointers.clickToRead')
      },
      {
        find: nth('.ostler-workspace-view--decisions .decisions__header .ui-button--primary'),
        label: () => t('onboarding:tips.pointers.recordDecision')
      }
    ]
  },
  {
    target: '[data-tour="new-task"]',
    side: 'bottom',
    title: () => t('onboarding:tips.tour.newTask.title'),
    body: () => t('onboarding:tips.tour.newTask.body', { keys: shortcut('new-task').keys }),
    pointers: [
      { find: nth('[data-tour="new-task"]'), label: () => t('onboarding:tips.pointers.clickToAdd') }
    ]
  },
  {
    target: '[data-tour="search"]',
    side: 'right',
    title: () => t('onboarding:tips.tour.search.title'),
    body: () => t('onboarding:tips.tour.search.body', { keys: shortcut('palette').keys }),
    pointers: [
      {
        find: nth('[data-tour="search"]'),
        label: () => t('onboarding:tips.pointers.clickOrPress', { keys: shortcut('palette').keys })
      }
    ]
  },
  {
    target: '[data-tour="help"]',
    side: 'right',
    title: () => t('onboarding:tips.tour.help.title'),
    body: () => t('onboarding:tips.tour.help.body', { brand: BRAND.name }),
    pointers: [
      { find: nth('[data-tour="help"]'), label: () => t('onboarding:tips.pointers.clickForHelp') }
    ]
  }
]

/** The invitation to the walkthrough, shown on first opening the sample project. */
export const TOUR_INVITE: TipContent = {
  target: '[data-tour="project-header"]',
  side: 'bottom',
  outline: false,
  title: () => t('onboarding:tips.invite.title'),
  body: () => t('onboarding:tips.invite.body', { count: SAMPLE_TOUR.length })
}

/**
 * One-off tips: each shows once, the first time its view is open, after the
 * walkthrough has been answered. The first whose target is on the page wins.
 */
export const ONE_TIME_TIPS: readonly OneTimeTip[] = [
  {
    id: 'tip:drawer-saves',
    target: '.task-drawer .ui-drawer__header, .task-drawer header',
    side: 'left',
    title: () => t('onboarding:tips.drawer.title'),
    body: () => t('onboarding:tips.drawer.body'),
    pointers: [
      {
        find: nth('.task-drawer .task-drawer__status'),
        label: () => t('onboarding:tips.pointers.changeStatus')
      }
    ]
  },
  {
    id: 'tip:drawer-resize',
    anywhere: true,
    // Any side panel, until one has been resized: then the person already knows.
    target: () => (hasResizedDrawer() ? null : findTarget('[data-tour="drawer-resize"]')),
    side: 'left',
    title: () => t('onboarding:tips.drawerResize.title'),
    body: () => t('onboarding:tips.drawerResize.body'),
    pointers: [
      {
        find: nth('[data-tour="drawer-resize"]'),
        label: () => t('onboarding:tips.pointers.dragToResize')
      }
    ]
  },
  {
    id: 'tip:board-drag',
    view: 'board',
    target: '.board .task-card',
    side: 'bottom',
    title: () => t('onboarding:tips.boardDrag.title'),
    body: () => t('onboarding:tips.boardDrag.body'),
    pointers: [
      {
        find: nth('.board .task-card'),
        label: () => t('onboarding:tips.pointers.dragToColumn'),
        to: nextColumn
      }
    ]
  },
  {
    id: 'tip:list',
    view: 'list',
    // One heading, Title unless the columns were moved: the ring and arrow are enough, and the text says the rest.
    target: nth(SORTABLE_HEADING, 1),
    side: 'bottom',
    title: () => t('onboarding:tips.list.title'),
    body: () => t('onboarding:tips.list.body')
  },
  {
    id: 'tip:calendar',
    view: 'calendar',
    target: CALENDAR_TASK,
    side: 'top',
    title: () => t('onboarding:tips.calendar.title'),
    body: () => t('onboarding:tips.calendar.body'),
    pointers: [
      {
        find: nth(CALENDAR_TASK),
        label: () => t('onboarding:tips.pointers.dragToDay'),
        to: calendarDayBeside
      }
    ]
  },
  {
    id: 'tip:timeline',
    view: 'timeline',
    target: widestTimelineBar,
    side: 'bottom',
    title: () => t('onboarding:tips.timeline.title'),
    body: () => t('onboarding:tips.timeline.body'),
    // One line: bars are small, and the text says the ends resize.
    pointers: [{ find: widestTimelineBar, label: () => t('onboarding:tips.pointers.dragToMove') }]
  },
  {
    id: 'tip:library',
    view: 'library',
    target: LIBRARY_ITEM,
    side: 'bottom',
    title: () => t('onboarding:tips.library.title'),
    body: () => t('onboarding:tips.library.body'),
    pointers: [
      { find: nth(LIBRARY_ITEM), label: () => t('onboarding:tips.pointers.clickToOpen') },
      {
        find: nth(LIBRARY_ADD),
        label: () => t('onboarding:tips.pointers.addDocument')
      }
    ]
  }
]
