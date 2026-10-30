import type { MouseEvent } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import type { ListTreeRow } from '@shared/planning/list'
import { SCORE_STEPS, type ScoreField } from '@shared/planning/idea-scores'
import { t } from '@shared/i18n'
import { Button, IconButton, MenuList, type DataTableColumn } from '../../../ui'
import { Ban, Undo2 } from '../../../ui/icons'
import { EditableCell, type ListEditing } from '../list/ListCells'

/** What the Someday view's own columns need: the workspace and the List's editing state. */
export interface IdeaColumnContext {
  ws: {
    busy: boolean
    updateWorkItemInline(item: PlanningWorkItem, patch: Partial<PlanningWorkItem>): Promise<boolean>
    setSomeday(items: PlanningWorkItem[], someday: boolean): Promise<void>
    openWontDo(items: PlanningWorkItem[]): void
    wontDoBlocker(item: PlanningWorkItem): string | null
  }
  editing: ListEditing | null
  setEditing: (editing: ListEditing | null) => void
  refocus: (rowId: string) => void
}

/** A score's column ids in the Someday view: the field's own name. */
export const SCORE_COLUMN_IDS: readonly ScoreField[] = ['impact', 'effort']

/**
 * Impact and Effort (N1.1b), edited in place: Enter, F2 or a click opens a
 * menu of None and 1 to 5. A missing score shows nothing and sorts last.
 */
export function scoreColumn(
  field: ScoreField,
  context: IdeaColumnContext
): DataTableColumn<ListTreeRow> {
  const { ws, editing, setEditing, refocus } = context
  const header = t(`tasks:ideas.${field}`)
  const close = (row: ListTreeRow) => {
    setEditing(null)
    refocus(row.item.id)
  }
  return {
    id: field,
    header,
    width: 90,
    align: 'end',
    compare: (a, b) => (a.item[field] ?? 0) - (b.item[field] ?? 0),
    isEmpty: (row) => row.item[field] == null,
    cell: (row) => (
      <EditableCell
        editing={editing?.rowId === row.item.id && editing.columnId === field}
        display={
          row.item[field] == null ? null : <span className="tabular-nums">{row.item[field]}</span>
        }
        editor={(anchor) => (
          <MenuList
            label={t('tasks:ideas.scoreFor', { score: header, title: row.item.title })}
            open
            anchorRef={anchor}
            onClose={() => close(row)}
            entries={[
              {
                label: t('tasks:ideas.none'),
                // One of the scores' radios: checked while there is no score.
                checked: row.item[field] == null,
                checkKind: 'radio' as const,
                disabled: row.item[field] == null,
                onSelect: () => {
                  close(row)
                  void ws.updateWorkItemInline(row.item, { [field]: null })
                }
              },
              ...SCORE_STEPS.map((step) => ({
                label: String(step),
                checked: row.item[field] === step,
                checkKind: 'radio' as const,
                onSelect: () => {
                  close(row)
                  if (row.item[field] !== step)
                    void ws.updateWorkItemInline(row.item, { [field]: step })
                }
              }))
            ]}
          />
        )}
      />
    )
  }
}

/**
 * The Someday view's last column (N1.1a, N1.1b): Make it a task brings the
 * idea back with its scores; Not now opens Won't do (N1.2), which asks why.
 */
export function ideaActionsColumn(ws: IdeaColumnContext['ws']): DataTableColumn<ListTreeRow> {
  return {
    id: 'somedayActions',
    header: t('tasks:someday.actions'),
    width: 240,
    cell: (row) => <IdeaActions ws={ws} item={row.item} />
  }
}

/** Make it a task and Not now, for one idea: the List's rows and the grid's cards share them. */
export function IdeaActions({
  ws,
  item,
  compact = false
}: {
  ws: IdeaColumnContext['ws']
  item: PlanningWorkItem
  /** Icons only, for the grid's small cards; the names stay as labels and tooltips. */
  compact?: boolean
}) {
  const makeTask = (event: MouseEvent) => {
    event.stopPropagation()
    void ws.setSomeday([item], false)
  }
  const notNow = (event: MouseEvent) => {
    event.stopPropagation()
    ws.openWontDo([item])
  }
  const blocked = ws.busy || ws.wontDoBlocker(item) !== null
  if (compact)
    return (
      <span className="idea-card__actions">
        <IconButton
          size="sm"
          icon={Undo2}
          disabled={ws.busy}
          label={t('tasks:someday.bringBackTask', { title: item.title })}
          onClick={makeTask}
        />
        <IconButton
          size="sm"
          icon={Ban}
          disabled={blocked}
          label={t('tasks:ideas.notNowFor', { title: item.title })}
          onClick={notNow}
        />
      </span>
    )
  return (
    <span className="list-cell__actions">
      <Button
        size="sm"
        variant="ghost"
        icon={Undo2}
        disabled={ws.busy}
        aria-label={t('tasks:someday.bringBackTask', { title: item.title })}
        onClick={makeTask}
      >
        {t('tasks:someday.bringBack')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={Ban}
        disabled={blocked}
        aria-label={t('tasks:ideas.notNowFor', { title: item.title })}
        onClick={notNow}
      >
        {t('tasks:ideas.notNow')}
      </Button>
    </span>
  )
}
