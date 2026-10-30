import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Ban, CircleAlert, ClipboardList, Eye, Icon, type LucideIcon } from '../ui/icons'
import './NeedsYouList.css'
import { t } from '@shared/i18n'
import { agentRunStateLabel } from '@shared/agent-run-state'

/** One thing waiting for the human: a blocked task, an agent question, a plan or a review. */
export interface NeedsYouItem {
  id: string
  kind: 'blocked' | 'question' | 'review' | 'plan'
  title: string
  /** Shown with the kind's word: the project on Home, a hint on Overview. */
  context?: string
  /** A project colour dot before the context (Home). */
  color?: string
  /** Where it goes: a route, or a handler. Neither: a row with nothing to open. */
  to?: string
  onOpen?: () => void
}

export const NEEDS_YOU_KIND: Record<NeedsYouItem['kind'], { label: string; icon: LucideIcon }> = {
  blocked: {
    get label() {
      return t('views:needsYouList.blockedTask')
    },
    icon: Ban
  },
  question: {
    get label() {
      return t('views:needsYouList.agentQuestion')
    },
    icon: CircleAlert
  },
  review: {
    get label() {
      return agentRunStateLabel('inReview')
    },
    icon: Eye
  },
  plan: {
    get label() {
      return t('views:needsYouList.planToApprove')
    },
    icon: ClipboardList
  }
}

/**
 * The "Needs you" list, one component for Home and a project's Overview so
 * the two read the same: the kind's icon, the title, then the kind in words
 * and where it comes from.
 */
export function NeedsYouList({
  items,
  label = t('views:needsYouList.needs')
}: {
  items: NeedsYouItem[]
  label?: string
}) {
  return (
    <ul className="needs-you" aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <NeedsYouRow item={item} />
        </li>
      ))}
    </ul>
  )
}

function NeedsYouRow({ item }: { item: NeedsYouItem }) {
  const kind = NEEDS_YOU_KIND[item.kind]
  const content: ReactNode = (
    <>
      <span className={`needs-you__icon needs-you__icon--${item.kind}`}>
        <Icon icon={kind.icon} />
      </span>
      <span className="needs-you__title" title={item.title}>
        {item.title}
      </span>
      <span className="needs-you__meta">
        {item.color && (
          <span className="needs-you__dot" style={{ background: item.color }} aria-hidden="true" />
        )}
        {item.context ? `${item.context} · ${kind.label}` : kind.label}
      </span>
    </>
  )
  if (item.to)
    return (
      <Link to={item.to} className="needs-you__row is-interactive">
        {content}
      </Link>
    )
  if (item.onOpen)
    return (
      <button type="button" className="needs-you__row is-interactive" onClick={item.onOpen}>
        {content}
      </button>
    )
  return <div className="needs-you__row">{content}</div>
}
