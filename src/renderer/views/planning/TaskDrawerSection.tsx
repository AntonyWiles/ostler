import { useEffect, useId, useState, type ReactNode } from 'react'
import { Collapse } from '../../ui'
import { chevronClass, ChevronRight, Icon } from '../../ui/icons'
import { useTaskPart } from './TaskParts'
import type { TaskPartId } from './task-parts'

/**
 * One part of the task drawer's body: a heading, optional actions and its
 * content. A collapsible section's heading is a button that shows or hides
 * the content (the agent run and verification, which most readers skip).
 *
 * An optional `part` shows only when the task holds something in it, the
 * project usually uses it, or the person adds it from "Add to this task"
 * (`task-parts.ts`). Its description, which explains the part, shows while
 * the part is still empty: once it holds something, that speaks for itself.
 */
export function TaskDrawerSection({
  title,
  description,
  actions,
  collapsible = false,
  defaultOpen = true,
  part,
  className,
  children
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  part?: { id: TaskPartId; inUse: boolean; start?: () => void }
  className?: string
  children?: ReactNode
}) {
  const headingId = useId()
  const bodyId = useId()
  const [open, setOpen] = useState(defaultOpen)
  const own = useTaskPart(part?.id ?? null, part?.inUse ?? true, part?.start)
  const optional = part ? own : null
  // Added from "Add to this task": open, ready to use.
  useEffect(() => {
    if (optional?.added) setOpen(true)
  }, [optional?.added])
  if (optional && !optional.shown) return null
  const shown = !collapsible || open
  const showDescription = description && shown && !(part && part.inUse)
  return (
    <section
      className={['task-drawer__section', className].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
      {...optional?.anchor}
    >
      <div className="task-drawer__section-header">
        <h3 id={headingId} className="task-drawer__section-title">
          {collapsible ? (
            <button
              type="button"
              className="task-drawer__section-toggle"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpen((current) => !current)}
            >
              <Icon icon={ChevronRight} className={chevronClass(open)} />
              {title}
            </button>
          ) : (
            title
          )}
        </h3>
        {actions && shown && <div className="task-drawer__section-actions">{actions}</div>}
      </div>
      {showDescription && <p className="task-drawer__section-description">{description}</p>}
      <Collapse open={shown} id={bodyId} className="task-drawer__section-body">
        {children}
      </Collapse>
    </section>
  )
}
