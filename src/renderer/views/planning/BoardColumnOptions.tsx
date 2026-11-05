import { useRef, useState } from 'react'
import type { BoardColumnOptions } from '@shared/planning/board'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { Button, Checkbox, IconButton, Popover, SegmentedControl, Select } from '../../ui'
import { SlidersHorizontal } from '../../ui/icons'
import { t } from '@shared/i18n'

/** "Cards shown" choices; 0 is all of them. */
export const MAX_CARD_CHOICES = [0, 5, 10, 20, 50] as const
/** Column height choices in pixels; 0 fits the cards. */
export const MAX_HEIGHT_CHOICES = [0, 320, 480, 720] as const

const HEIGHT_LABELS: Record<number, string> = {
  0: 'tasks:boardView.columnOptions.heightAuto',
  320: 'tasks:boardView.columnOptions.heightShort',
  480: 'tasks:boardView.columnOptions.heightMedium',
  720: 'tasks:boardView.columnOptions.heightTall'
}

/**
 * A Board column's own options (MOP-79), from the button beside its Select all
 * and +: its sort, how many cards it shows, its height and whether its cards
 * show custom fields. Kept per column in the Board's view, like the rest of
 * View options.
 */
export function BoardColumnOptionsButton({
  ws,
  columnKey,
  column
}: {
  ws: PlanningWorkspace
  columnKey: string
  /** The column's name as shown, "Ready in Website launch" in a lane. */
  column: string
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const options = ws.boardColumnOptions[columnKey] ?? {}
  const set = (change: Partial<BoardColumnOptions>) => {
    const next: BoardColumnOptions = { ...options, ...change }
    for (const name of Object.keys(next) as (keyof BoardColumnOptions)[]) {
      if (next[name] === undefined || next[name] === false || next[name] === 0) delete next[name]
    }
    ws.setBoardColumnOptions(columnKey, next)
  }
  const customised = Object.keys(options).length > 0
  return (
    <>
      <IconButton
        ref={buttonRef}
        size="sm"
        icon={SlidersHorizontal}
        className={`board-column__options${customised || open ? ' is-visible' : ''}`}
        label={t('tasks:boardView.columnOptions.open', { column })}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        label={t('tasks:boardView.columnOptions.title', { column })}
        placement="bottom-end"
        className="task-view-options"
      >
        <Select
          label={t('tasks:boardToolbar.sort')}
          size="sm"
          value={options.sortBy ?? ''}
          onChange={(event) => {
            const sortBy = (event.target.value || undefined) as BoardColumnOptions['sortBy']
            set({ sortBy, sortDir: sortBy ? (options.sortDir ?? 'asc') : undefined })
          }}
          options={[
            { value: '', label: t('tasks:boardView.columnOptions.sortBoard') },
            { value: 'priority', label: t('tasks:boardToolbar.priority') },
            { value: 'targetDate', label: t('tasks:boardToolbar.dueDate') },
            { value: 'title', label: t('tasks:boardToolbar.title') },
            { value: 'created', label: t('tasks:boardToolbar.created') }
          ]}
        />
        {options.sortBy && (
          <SegmentedControl
            label={t('tasks:boardToolbar.sortDirection')}
            size="sm"
            value={options.sortDir ?? 'asc'}
            onChange={(sortDir) => set({ sortDir })}
            options={[
              { value: 'asc', label: t('tasks:boardToolbar.ascending') },
              { value: 'desc', label: t('tasks:boardToolbar.descending') }
            ]}
          />
        )}
        <Select
          label={t('tasks:boardView.columnOptions.maxCards')}
          size="sm"
          value={String(options.maxCards ?? 0)}
          onChange={(event) => set({ maxCards: Number(event.target.value) || undefined })}
          options={[
            ...MAX_CARD_CHOICES.map((value) => ({
              value: String(value),
              label: value === 0 ? t('tasks:boardView.columnOptions.maxCardsAll') : String(value)
            })),
            // A number set through the automation API keeps showing as itself.
            ...(options.maxCards &&
            !(MAX_CARD_CHOICES as readonly number[]).includes(options.maxCards)
              ? [{ value: String(options.maxCards), label: String(options.maxCards) }]
              : [])
          ]}
        />
        <Select
          label={t('tasks:boardView.columnOptions.maxHeight')}
          size="sm"
          value={String(options.maxHeight ?? 0)}
          onChange={(event) => set({ maxHeight: Number(event.target.value) || undefined })}
          options={[
            ...MAX_HEIGHT_CHOICES.map((value) => ({
              value: String(value),
              label: t(HEIGHT_LABELS[value])
            })),
            // A height set through the automation API keeps showing as itself.
            ...(options.maxHeight &&
            !(MAX_HEIGHT_CHOICES as readonly number[]).includes(options.maxHeight)
              ? [{ value: String(options.maxHeight), label: `${options.maxHeight} px` }]
              : [])
          ]}
        />
        {ws.boardCardFields.length > 0 && (
          <Checkbox
            label={t('tasks:boardView.columnOptions.showFields')}
            checked={!options.hideFields}
            onChange={(event) => set({ hideFields: !event.target.checked })}
          />
        )}
        {customised && (
          <Button
            size="sm"
            variant="ghost"
            className="task-view-options__more"
            onClick={() => ws.setBoardColumnOptions(columnKey, null)}
          >
            {t('tasks:boardView.columnOptions.reset')}
          </Button>
        )}
      </Popover>
    </>
  )
}
