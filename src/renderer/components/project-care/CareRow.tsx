import type { ReactNode } from 'react'
import { Section } from '../../ui'

/** One command in a Project settings care tab: what it does, and its button. */
export function CareRow({
  title,
  description,
  action,
  children
}: {
  title: string
  description?: ReactNode
  action: ReactNode
  /** What the command produced, shown under it. */
  children?: ReactNode
}) {
  return (
    <div className="project-care-row">
      <div className="project-care-row__text">
        <span className="project-care-row__title">{title}</span>
        {description && <div className="project-care-row__description">{description}</div>}
      </div>
      <div className="project-care-row__action">{action}</div>
      {children && <div className="project-care-row__result">{children}</div>}
    </div>
  )
}

/** A titled group of care rows. */
export function CareGroup({
  title,
  description,
  actions,
  children
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Section title={title} description={description} actions={actions} headingLevel={3}>
      <div className="project-care-group">{children}</div>
    </Section>
  )
}
