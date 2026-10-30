import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import {
  MAX_SCORE,
  MIN_SCORE,
  SCORE_STEPS,
  isScored,
  sortBestFirst
} from '@shared/planning/idea-scores'
import { t } from '@shared/i18n'
import { Button, Popover, useAnnounce } from '../../../ui'
import { IdeaActions, type IdeaColumnContext } from './idea-columns'
import { useScoreIdea, type IdeaScores } from './useScoreIdea'
import './IdeaGrid.css'

/** More ideas than this in one cell collapse to a count that opens a list. */
export const CELL_CARD_LIMIT = 3

/** Impact from the top, high to low; effort from the left, low to high. */
const IMPACT_ROWS = [...SCORE_STEPS].reverse()
const EFFORT_COLUMNS = SCORE_STEPS

const DRAG_TYPE = 'text/plain'

/** What the grid needs from the workspace; the tests pass a fake. */
export type IdeaGridWorkspace = IdeaColumnContext['ws'] & {
  openWorkItem(item: PlanningWorkItem): void
}

const cellKey = (impact: number, effort: number) => `${impact}:${effort}`

/** Whether a cell is in the quick-wins corner (impact 4 or 5, effort 1 or 2). */
const isQuickWinCell = (impact: number, effort: number) => impact >= 4 && effort <= 2
/** Whether a cell is in the "Probably not" corner (impact 1 or 2, effort 4 or 5). */
const isProbablyNotCell = (impact: number, effort: number) => impact <= 2 && effort >= 4

const clamp = (value: number) => Math.min(MAX_SCORE, Math.max(MIN_SCORE, value))

/**
 * The Someday view's grid (N1.1b, N10): impact up, effort across, five steps
 * each, drawn with plain elements and tokens (D19: no chart library). The
 * quick-wins corner is shaded and labelled, the opposite one reads "Probably
 * not". Dragging a card to a cell sets both scores, with undo; unscored ideas
 * wait in the tray beside it. On a focused card the arrow keys move it one
 * step (an unscored one lands in the middle) and Enter opens the drawer.
 */
export function IdeaGrid({ ws, ideas }: { ws: IdeaGridWorkspace; ideas: PlanningWorkItem[] }) {
  const scoreIdea = useScoreIdea(ws)
  const announce = useAnnounce()
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [openCell, setOpenCell] = useState<string | null>(null)
  /** The card to focus once the grid has drawn it in its new place. */
  const [refocusId, setRefocusId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const countRefs = useRef(new Map<string, HTMLButtonElement | null>())

  const byCell = new Map<string, PlanningWorkItem[]>()
  const tray: PlanningWorkItem[] = []
  for (const idea of sortBestFirst(ideas)) {
    if (!isScored(idea)) {
      tray.push(idea)
      continue
    }
    const key = cellKey(idea.impact!, idea.effort!)
    byCell.set(key, [...(byCell.get(key) ?? []), idea])
  }

  useEffect(() => {
    if (!refocusId) return
    const card = rootRef.current?.querySelector<HTMLElement>(
      `[data-idea-id="${CSS.escape(refocusId)}"] .idea-card__title`
    )
    // A card that went into a crowded cell is behind its count: focus that instead.
    const target =
      card ??
      [...countRefs.current.entries()].find(([key]) => {
        const cell = byCell.get(key)
        return cell?.some((idea) => idea.id === refocusId)
      })?.[1]
    target?.focus()
    setRefocusId(null)
  })

  const move = async (item: PlanningWorkItem, next: IdeaScores) => {
    setRefocusId(item.id)
    await scoreIdea(item, next)
  }

  const ideaById = (id: string) => ideas.find((idea) => idea.id === id)

  const dropProps = (key: string, scores: IdeaScores) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dropTarget !== key) setDropTarget(key)
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      if (dropTarget === key) setDropTarget(null)
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      setDropTarget(null)
      const item = ideaById(event.dataTransfer.getData(DRAG_TYPE))
      if (item) void move(item, scores)
    }
  })

  const onCardKeyDown = (event: KeyboardEvent<HTMLButtonElement>, item: PlanningWorkItem) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    const steps: Record<string, [number, number]> = {
      ArrowUp: [1, 0],
      ArrowDown: [-1, 0],
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1]
    }
    const step = steps[event.key]
    if (!step) return
    event.preventDefault()
    if (!isScored(item)) {
      // Out of the tray: into the middle, keeping a score it already has.
      void move(item, { impact: item.impact ?? 3, effort: item.effort ?? 3 })
      return
    }
    const impact = clamp(item.impact! + step[0])
    const effort = clamp(item.effort! + step[1])
    if (impact === item.impact && effort === item.effort) {
      announce(t('tasks:ideas.cannotMoveFurther'))
      return
    }
    void move(item, { impact, effort })
  }

  const card = (item: PlanningWorkItem) => (
    <li
      key={item.id}
      className="idea-card"
      data-idea-id={item.id}
      draggable={!ws.busy}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, item.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
    >
      <button
        type="button"
        className="idea-card__title"
        aria-label={
          isScored(item)
            ? t('tasks:ideas.cardScored', {
                title: item.title,
                impact: item.impact,
                effort: item.effort
              })
            : t('tasks:ideas.cardUnscored', { title: item.title })
        }
        onClick={() => ws.openWorkItem(item)}
        onKeyDown={(event) => onCardKeyDown(event, item)}
      >
        {item.title}
      </button>
      <IdeaActions ws={ws} item={item} compact />
    </li>
  )

  const cell = (impact: number, effort: number, row: number, column: number) => {
    const key = cellKey(impact, effort)
    const items = byCell.get(key) ?? []
    const crowded = items.length > CELL_CARD_LIMIT
    const label = t('tasks:ideas.cellLabel', { impact, effort, count: items.length })
    const corner = isQuickWinCell(impact, effort)
      ? 'quick-win'
      : isProbablyNotCell(impact, effort)
        ? 'probably-not'
        : null
    return (
      <div
        key={key}
        role="group"
        aria-label={label}
        className={[
          'idea-grid__cell',
          corner ? `idea-grid__cell--${corner}` : '',
          dropTarget === key ? 'is-drop-target' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ gridRow: row, gridColumn: column }}
        data-cell={key}
        {...dropProps(key, { impact, effort })}
      >
        {impact === MAX_SCORE && effort === MIN_SCORE && (
          <span className="idea-grid__corner">{t('tasks:ideas.quickWins')}</span>
        )}
        {crowded ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              ref={(element: HTMLButtonElement | null) => {
                countRefs.current.set(key, element)
              }}
              aria-label={t('tasks:ideas.moreFor', { count: items.length, impact, effort })}
              aria-expanded={openCell === key}
              onClick={() => setOpenCell(openCell === key ? null : key)}
            >
              {t('tasks:ideas.more', { count: items.length })}
            </Button>
            {openCell === key && (
              <Popover
                open
                onClose={() => setOpenCell(null)}
                anchorRef={{ current: countRefs.current.get(key) ?? null }}
                label={t('tasks:ideas.cellList', { impact, effort })}
                className="idea-grid__popover"
              >
                <ul className="idea-grid__list">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setOpenCell(null)
                          ws.openWorkItem(item)
                        }}
                      >
                        {item.title}
                      </Button>
                    </li>
                  ))}
                </ul>
              </Popover>
            )}
          </>
        ) : (
          items.length > 0 && <ul className="idea-grid__cards">{items.map(card)}</ul>
        )}
        {impact === MIN_SCORE && effort === MAX_SCORE && (
          <span className="idea-grid__corner idea-grid__corner--end">
            {t('tasks:ideas.probablyNot')}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="idea-board" ref={rootRef}>
      <p className="idea-board__hint">{t('tasks:ideas.hint')}</p>
      <div className="idea-board__body">
        <div className="idea-grid" role="group" aria-label={t('tasks:ideas.gridLabel')}>
          <span className="idea-grid__axis idea-grid__axis--impact" aria-hidden="true">
            {t('tasks:ideas.impactAxis')}
          </span>
          {IMPACT_ROWS.map((impact, rowIndex) => (
            <span
              key={`impact-${impact}`}
              className="idea-grid__step"
              style={{ gridRow: rowIndex + 1, gridColumn: 2 }}
              aria-hidden="true"
            >
              {impact}
            </span>
          ))}
          {IMPACT_ROWS.flatMap((impact, rowIndex) =>
            EFFORT_COLUMNS.map((effort, columnIndex) =>
              cell(impact, effort, rowIndex + 1, columnIndex + 3)
            )
          )}
          {EFFORT_COLUMNS.map((effort, columnIndex) => (
            <span
              key={`effort-${effort}`}
              className="idea-grid__step"
              style={{ gridRow: IMPACT_ROWS.length + 1, gridColumn: columnIndex + 3 }}
              aria-hidden="true"
            >
              {effort}
            </span>
          ))}
          <span
            className="idea-grid__axis idea-grid__axis--effort"
            style={{
              gridRow: IMPACT_ROWS.length + 2,
              gridColumn: `3 / span ${EFFORT_COLUMNS.length}`
            }}
            aria-hidden="true"
          >
            {t('tasks:ideas.effortAxis')}
          </span>
        </div>
        <section
          className={`idea-tray${dropTarget === 'tray' ? ' is-drop-target' : ''}`}
          aria-label={t('tasks:ideas.trayLabel', { count: tray.length })}
          data-cell="tray"
          {...dropProps('tray', { impact: null, effort: null })}
        >
          <h3 className="idea-tray__title">{t('tasks:ideas.tray')}</h3>
          {tray.length === 0 ? (
            <p className="idea-tray__empty">{t('tasks:ideas.trayEmpty')}</p>
          ) : (
            <ul className="idea-grid__cards">{tray.map(card)}</ul>
          )}
        </section>
      </div>
    </div>
  )
}
