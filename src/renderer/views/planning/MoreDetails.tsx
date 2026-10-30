import { useId, useState, type ReactNode } from 'react'
import { Button, Collapse } from '../../ui'
import { chevronClass, ChevronDown } from '../../ui/icons'
import { readMoreDetailsOpen, writeMoreDetailsOpen } from './more-details-memory'
import { t } from '@shared/i18n'
import './more-details.css'

/**
 * A disclosure for the fields a short form leaves out: "More details". Its
 * state is remembered for this viewer, so a person who always sets the dates
 * finds them open next time.
 */
export function MoreDetails({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(readMoreDetailsOpen)
  const panelId = useId()
  const toggle = () => {
    setOpen(!open)
    writeMoreDetailsOpen(!open)
  }
  return (
    <div className="more-details">
      <Button
        size="sm"
        variant="ghost"
        className="more-details__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        icon={ChevronDown}
        iconClassName={chevronClass(open, 'down')}
        onClick={toggle}
      >
        {t('tasks:moreDetails.moreDetails')}
      </Button>
      <Collapse open={open} id={panelId} className="more-details__panel">
        {children}
      </Collapse>
    </div>
  )
}
