import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PortalProps {
  children: ReactNode
  /** Where to render. Defaults to `document.body`. */
  container?: Element
}

/**
 * Renders children into `document.body`. Every overlay goes through this:
 * `.ostler-content` isolates its stacking context, so anything rendered inside
 * it cannot rise above the status bar whatever its z-index.
 */
export function Portal({ children, container }: PortalProps) {
  if (typeof document === 'undefined') return null
  return createPortal(children, container ?? document.body)
}
