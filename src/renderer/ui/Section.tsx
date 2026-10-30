import { useId, type ReactNode, type Ref } from 'react'
import { cx } from './cx'
import './Section.css'

export interface SectionProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  headingLevel?: 2 | 3 | 4
  children?: ReactNode
  className?: string
  ref?: Ref<HTMLElement>
}

/** A titled region of a page, with optional actions beside the heading. */
export function Section({
  title,
  description,
  actions,
  headingLevel = 2,
  children,
  className,
  ref
}: SectionProps) {
  const headingId = useId()
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  return (
    <section ref={ref} aria-labelledby={headingId} className={cx('ui-section', className)}>
      <div className="ui-section__header">
        <div className="ui-section__titles">
          <Heading id={headingId} className="ui-section__title">
            {title}
          </Heading>
          {description && <p className="ui-section__description">{description}</p>}
        </div>
        {actions && <div className="ui-section__actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
