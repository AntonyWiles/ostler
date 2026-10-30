import type { ReactNode } from 'react'
import { Button } from '../ui'
import './HiddenFieldsNote.css'

/**
 * The one quiet line under a form that leaves something out: the task drawer
 * for its type ("2 more fields with values are hidden for Bug"). A
 * sentence saying what is hidden and where, then the button that shows it.
 * With no sentence it is the button alone, a quiet link ("Show all fields").
 */
export function HiddenFieldsNote({
  icon,
  message,
  action,
  onAction
}: {
  icon?: ReactNode
  message?: string
  action: string
  onAction: () => void
}) {
  return (
    <p className="hidden-fields-note">
      {icon}
      {message && <span>{message}</span>}
      <Button size="sm" variant="ghost" onClick={onAction}>
        {action}
      </Button>
    </p>
  )
}
