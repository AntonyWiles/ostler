import type { PlanningWorkItem } from '@shared/ostler-api'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'

/**
 * When a Board card may skip a render (P9.1). The workspace object `ws` is new
 * on every render of the workspace, which happens on every move of a drag, so
 * comparing it by identity would re-render every card every time. A card
 * re-renders instead when its own props change or when any of the workspace
 * data below changes: everything a card and its menu read, directly or
 * through the workspace's functions. Drag-over state is not on the list; the
 * card that is being dragged learns it from its `dragging` prop.
 *
 * Add a field here when a card starts reading a new piece of workspace state.
 */
export const CARD_WORKSPACE_INPUTS = [
  'projectId',
  'busy',
  'workItems',
  'milestones',
  'goals',
  'harnessState',
  'lastStatusChangeAt',
  'openBlockersByWorkItem',
  'changedSourceWorkItemIds',
  'unseenTasks',
  'attachmentCounts',
  'commentCounts',
  'taskContacts',
  'timeTotals',
  'labelColor',
  'projectedStatus',
  'fields',
  'taskTypeById',
  'boardCardFields',
  'subprojects',
  'subprojectScope'
] as const satisfies ReadonlyArray<keyof PlanningWorkspace>

export interface CardMemoProps {
  item: PlanningWorkItem
  ws: PlanningWorkspace
  selected?: boolean
  selecting?: boolean
  showBoxes?: boolean
  /** Leave the custom fields off, from the column's options (MOP-79). */
  hideFields?: boolean
  focused?: boolean
  dragging?: boolean
  subtaskCount?: number
  /**
   * Not compared: the Board makes a new one each render, and every version
   * does the same thing for the same item (a functional state update).
   */
  onToggle?: (checked: boolean) => void
}

export function cardPropsEqual(previous: CardMemoProps, next: CardMemoProps): boolean {
  return (
    previous.item === next.item &&
    previous.selected === next.selected &&
    previous.selecting === next.selecting &&
    previous.showBoxes === next.showBoxes &&
    previous.hideFields === next.hideFields &&
    previous.focused === next.focused &&
    previous.dragging === next.dragging &&
    previous.subtaskCount === next.subtaskCount &&
    CARD_WORKSPACE_INPUTS.every((key) => previous.ws[key] === next.ws[key])
  )
}
