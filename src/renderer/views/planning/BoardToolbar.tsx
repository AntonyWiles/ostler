import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { useOptionalSearchParams } from '../../hooks/useOptionalSearchParams'
import { Button, Checkbox, IconButton, Popover, Toolbar } from '../../ui'
import { Columns3Cog, Eye, EyeOff, ListChecks, SlidersHorizontal } from '../../ui/icons'
import { TaskFilterFields } from './TaskFilterFields'
import { HiddenTasksNote } from './HiddenTasksNote'
import { MarkAllSeenButton } from './UnseenMark'
import { BoardViewOptionsFields } from './board-layout/BoardViewOptionsFields'
import { BoardLayoutEditor } from './board-layout/BoardLayoutEditor'
import { CUSTOMISE_BOARD_PARAM } from '../../navigation/paths'
import './TaskToolbar.css'
import { t } from '@shared/i18n'
import { countInScope } from './subproject-ui'

/**
 * The Board's one toolbar row: its views, search and filters, and one "View
 * options" button (MOP-35) holding the columns this view shows, grouping and
 * sorting, and Customise board…, which opens everything about the Board in one
 * panel beside it (`BoardLayoutEditor`), also from a link (`boardLayoutPath`:
 * Settings and Project settings › Board).
 * `end` holds the view's own action (Suggest tasks, when AI is set up).
 */
export function BoardFilterBar({ ws, end }: { ws: PlanningWorkspace; end?: ReactNode }) {
  const viewButtonRef = useRef<HTMLButtonElement | null>(null)
  const [viewOpen, setViewOpen] = useState(false)
  const [customising, setCustomising] = useState(false)
  const [params, setParams] = useOptionalSearchParams()
  const requested = params.get(CUSTOMISE_BOARD_PARAM) !== null
  const hiddenColumns = ws.columns.filter((column) =>
    ws.boardHiddenColumns.includes(column.key)
  ).length

  // Opened from a link: open the panel and take the hand-off out of the address.
  useEffect(() => {
    if (!requested) return
    setCustomising(true)
    const next = new URLSearchParams(params)
    next.delete(CUSTOMISE_BOARD_PARAM)
    setParams(next, { replace: true })
  }, [requested, params, setParams])

  return (
    <>
      <Toolbar
        label={t('tasks:boardToolbar.boardFilters')}
        className="task-toolbar ostler-planning-board-toolbar"
        end={
          <>
            <BoardTaskCount ws={ws} />
            <HiddenTasksNote hidden={ws.boardHidden} />
            <MarkAllSeenButton ws={ws} />
            {hiddenColumns > 0 && (
              <IconButton
                size="sm"
                icon={ws.peekHiddenColumns ? EyeOff : Eye}
                label={
                  ws.peekHiddenColumns
                    ? t('tasks:boardToolbar.hideHiddenColumns')
                    : t('tasks:boardToolbar.showHiddenColumns', { count: hiddenColumns })
                }
                pressed={ws.peekHiddenColumns}
                onClick={() => ws.setPeekHiddenColumns(!ws.peekHiddenColumns)}
              />
            )}
            <IconButton
              size="sm"
              icon={ListChecks}
              label={t('tasks:boardToolbar.showBoxes')}
              pressed={ws.boardShowBoxes}
              onClick={() => ws.setBoardShowBoxes(!ws.boardShowBoxes)}
            />
            <Button
              ref={viewButtonRef}
              size="sm"
              variant="ghost"
              icon={SlidersHorizontal}
              aria-haspopup="dialog"
              aria-expanded={viewOpen}
              onClick={() => setViewOpen((open) => !open)}
            >
              {hiddenColumns > 0
                ? t('tasks:boardToolbar.viewOptionsHidden', { count: hiddenColumns })
                : t('tasks:boardToolbar.viewOptions')}
            </Button>
            {end}
          </>
        }
      >
        <TaskFilterFields ws={ws} workItems={ws.workItems} filters={ws.boardView} />
      </Toolbar>

      <Popover
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        anchorRef={viewButtonRef}
        label={t('tasks:boardToolbar.viewOptions')}
        placement="bottom-end"
        className="task-view-options"
      >
        <BoardColumnsFields ws={ws} />
        <BoardViewOptionsFields ws={ws} />
        <Button
          size="sm"
          variant="ghost"
          icon={Columns3Cog}
          className="task-view-options__more"
          onClick={() => {
            setViewOpen(false)
            setCustomising(true)
          }}
        >
          {t('tasks:boardLayout.openMore')}
        </Button>
      </Popover>

      <BoardLayoutEditor ws={ws} open={customising} onClose={() => setCustomising(false)} />
    </>
  )
}

/**
 * Columns, at the top of View options: which of the project's columns this view
 * shows, one tick each, changed in a click and put back with Show all. The
 * project's own columns (Project settings › Board) stay as they are; this is
 * the view's, kept with it like its grouping. The last column shown cannot be
 * hidden.
 */
function BoardColumnsFields({ ws }: { ws: PlanningWorkspace }) {
  const hidden = ws.columns.filter((column) => ws.boardHiddenColumns.includes(column.key))
  const shownCount = ws.columns.length - hidden.length
  const toggle = (key: string, show: boolean) =>
    ws.setBoardHiddenColumns(
      show
        ? ws.boardHiddenColumns.filter((candidate) => candidate !== key)
        : [...ws.boardHiddenColumns, key]
    )
  return (
    <>
      <fieldset className="task-view-options__fields">
        <legend className="task-view-options__legend">
          {t('tasks:boardToolbar.columnsShown')}
        </legend>
        {ws.columns.map((column) => {
          const shown = !ws.boardHiddenColumns.includes(column.key)
          return (
            <Checkbox
              key={column.key}
              label={column.label}
              checked={shown}
              disabled={shown && shownCount <= 1}
              onChange={(event) => toggle(column.key, event.target.checked)}
            />
          )
        })}
      </fieldset>
      {hidden.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="task-view-options__more"
          onClick={() => ws.setBoardHiddenColumns([])}
        >
          {t('tasks:boardToolbar.showAllColumns')}
        </Button>
      )}
      <p className="task-view-options__hint">{t('tasks:boardToolbar.columnsHint')}</p>
    </>
  )
}

/** "12 of 30 tasks": the toolbar's count, and the same line in Customise board. */
export function BoardTaskCount({ ws, live = true }: { ws: PlanningWorkspace; live?: boolean }) {
  return (
    <span className="task-toolbar__count" aria-live={live ? 'polite' : undefined}>
      {t('tasks:boardToolbar.tasks', {
        filteredWorkItemCount: ws.filteredWorkItems.length,
        workItemCount: countInScope(ws.workItems, ws.subprojectScope)
      })}
    </span>
  )
}
