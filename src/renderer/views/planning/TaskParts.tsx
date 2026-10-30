import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Button, Menu, type MenuEntry } from '../../ui'
import { Icon, Plus } from '../../ui/icons'
import {
  TASK_PARTS,
  TASK_PART_GROUPS,
  partShown,
  quickParts,
  taskPart,
  type TaskPartId
} from './task-parts'
import './TaskParts.css'

/**
 * The task drawer's optional parts at work (`task-parts.ts` holds the rule).
 * Each part asks `useTaskPart` whether to show and says whether it holds
 * anything; the parts that stay out are offered in "Add to this task", and
 * adding one shows it and takes you to it.
 */

interface TaskPartsValue {
  projectUses: ReadonlySet<TaskPartId>
  added: ReadonlySet<TaskPartId>
  domId: (part: TaskPartId) => string
  report: (part: TaskPartId, shown: boolean, start: (() => void) | undefined) => void
  forget: (part: TaskPartId) => void
}

const TaskPartsContext = createContext<TaskPartsValue | null>(null)

/** Where "Add to this task" reads what is hidden, and how to add it. */
const TaskPartsBarContext = createContext<{
  hidden: TaskPartId[]
  items: readonly PlanningWorkItem[]
  add: (part: TaskPartId) => void
} | null>(null)

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * The parts of one task. Key it by the task, so the next task starts with
 * only what it holds.
 */
export function TaskPartsProvider({
  projectUses,
  items,
  children
}: {
  projectUses: ReadonlySet<TaskPartId>
  /** The project's tasks, which order what "Add to this task" offers first. */
  items: readonly PlanningWorkItem[]
  children: ReactNode
}) {
  const base = useId()
  const [added, setAdded] = useState<ReadonlySet<TaskPartId>>(() => new Set())
  // Each part present in the drawer, and whether it shows.
  const [present, setPresent] = useState<ReadonlyMap<TaskPartId, boolean>>(() => new Map())
  const starts = useRef(new Map<TaskPartId, () => void>())
  const [justAdded, setJustAdded] = useState<TaskPartId | null>(null)

  const domId = useCallback((part: TaskPartId) => `${base}-${part}`, [base])
  const report = useCallback(
    (part: TaskPartId, shown: boolean, start: (() => void) | undefined) => {
      if (start) starts.current.set(part, start)
      else starts.current.delete(part)
      setPresent((current) =>
        current.get(part) === shown ? current : new Map(current).set(part, shown)
      )
    },
    []
  )
  const forget = useCallback((part: TaskPartId) => {
    starts.current.delete(part)
    setPresent((current) => {
      if (!current.has(part)) return current
      const next = new Map(current)
      next.delete(part)
      return next
    })
  }, [])
  const add = useCallback((part: TaskPartId) => {
    setAdded((current) => new Set(current).add(part))
    setJustAdded(part)
  }, [])

  // Once an added part is on screen: its own first step if it has one (a
  // cost's dialog), otherwise its first control, which brings it into view.
  useEffect(() => {
    if (!justAdded || present.get(justAdded) !== true) return
    setJustAdded(null)
    const start = starts.current.get(justAdded)
    if (start) {
      document.getElementById(domId(justAdded))?.scrollIntoView?.({ block: 'nearest' })
      start()
      return
    }
    const anchor = document.getElementById(domId(justAdded))
    const target = anchor?.matches(FOCUSABLE)
      ? anchor
      : anchor?.querySelector<HTMLElement>(FOCUSABLE)
    if (target) target.focus()
    else anchor?.scrollIntoView?.({ block: 'nearest' })
  }, [justAdded, present, domId])

  const value = useMemo(
    () => ({ projectUses, added, domId, report, forget }),
    [projectUses, added, domId, report, forget]
  )
  const hidden = useMemo(
    () => TASK_PARTS.filter((part) => present.get(part.id) === false).map((part) => part.id),
    [present]
  )
  const bar = useMemo(() => ({ hidden, items, add }), [hidden, items, add])
  return (
    <TaskPartsContext.Provider value={value}>
      <TaskPartsBarContext.Provider value={bar}>{children}</TaskPartsBarContext.Provider>
    </TaskPartsContext.Provider>
  )
}

export interface TaskPartState {
  shown: boolean
  /** True when the person added it here, so a collapsed part opens. */
  added: boolean
  /** Spread on the part's outer element: where Add takes the person. */
  anchor: { id?: string; 'data-task-part'?: TaskPartId }
}

/**
 * Whether a part shows, by the one rule; `inUse` is whether this task holds
 * anything in it. Once shown, a part stays for as long as the task is open,
 * so clearing the last value does not pull it from under the pointer. Outside
 * the drawer (a part on its own) it always shows.
 *
 * `start` is the part's first step when it is added: the dialog that adds a
 * cost, say. Without one, Add focuses the part's first control.
 */
export function useTaskPart(
  part: TaskPartId | null,
  inUse: boolean,
  start?: () => void
): TaskPartState {
  const provided = useContext(TaskPartsContext)
  // No part, or no drawer around it: always shown, and nothing to report.
  const ctx = part ? provided : null
  const [stays, setStays] = useState(false)
  const added = (part && ctx?.added.has(part)) ?? false
  const shown =
    !ctx || !part || stays || partShown({ inUse, projectUses: ctx.projectUses.has(part), added })
  const startRef = useRef(start)
  useLayoutEffect(() => {
    startRef.current = start
  })
  const hasStart = start !== undefined
  // The provider's callbacks never change, so a part reports only when it shows or hides.
  const report = ctx?.report
  const forget = ctx?.forget
  useLayoutEffect(() => {
    if (!part) return
    if (shown) setStays(true)
    report?.(part, shown, hasStart ? () => startRef.current?.() : undefined)
  }, [report, part, shown, hasStart])
  useLayoutEffect(() => {
    if (!part) return
    return () => forget?.(part)
  }, [forget, part])
  return {
    shown,
    added,
    anchor: ctx && part ? { id: ctx.domId(part), 'data-task-part': part } : {}
  }
}

/**
 * A part made of fields in the drawer's grid (a date, a picker): its fields
 * take their places in the grid as they would without it.
 */
export function TaskPart({
  part,
  inUse,
  children
}: {
  part: TaskPartId
  inUse: boolean
  children: ReactNode
}) {
  const { shown, anchor } = useTaskPart(part, inUse)
  if (!shown) return null
  return (
    <div className="task-part" {...anchor}>
      {children}
    </div>
  )
}

function partLabel(part: TaskPartId): string {
  return t(`tasks:parts.${part}.label`)
}

function partHint(part: TaskPartId): string {
  return t(`tasks:parts.${part}.hint`)
}

/**
 * "Add to this task": the parts this task doesn't show, the likeliest as
 * buttons and the rest under More, each with what it is for. Nothing to add,
 * no bar.
 */
export function TaskPartsBar() {
  const bar = useContext(TaskPartsBarContext)
  if (!bar || bar.hidden.length === 0) return null
  const { quick, more } = quickParts(bar.hidden, bar.items)
  const groups: MenuEntry[] = TASK_PART_GROUPS.flatMap((group) => {
    const items = more
      .filter((part) => taskPart(part).group === group)
      .map((part) => ({
        label: partLabel(part),
        icon: taskPart(part).icon,
        hint: partHint(part),
        onSelect: () => bar.add(part)
      }))
    return items.length > 0
      ? [{ type: 'group' as const, label: t(`tasks:parts.groups.${group}`), items }]
      : []
  })
  return (
    <div className="task-parts-bar" role="group" aria-label={t('tasks:parts.addToTask')}>
      <span className="task-parts-bar__label" aria-hidden="true">
        <Icon icon={Plus} />
        {t('tasks:parts.add')}
      </span>
      {quick.map((part) => (
        <button
          key={part}
          type="button"
          className="task-parts-bar__chip"
          title={partHint(part)}
          aria-description={partHint(part)}
          onClick={() => bar.add(part)}
        >
          <Icon icon={taskPart(part).icon} />
          {partLabel(part)}
        </button>
      ))}
      {more.length > 0 && (
        <Menu
          label={t('tasks:parts.moreToAdd')}
          placement="bottom-start"
          items={groups}
          renderTrigger={(props) => (
            <Button {...props} size="sm" variant="ghost" className="task-parts-bar__more">
              {t('tasks:parts.more', { count: more.length })}
            </Button>
          )}
        />
      )}
    </div>
  )
}
