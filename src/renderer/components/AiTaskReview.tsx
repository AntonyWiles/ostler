import type { ReactNode } from 'react'
import { Button, Checkbox, TextArea, TextField } from '../ui'
import { cx } from '../ui/cx'
import { t } from '@shared/i18n'
import './AiTaskReview.css'

/**
 * The one way to review tasks Ostler AI drafted before they are added (R1.3):
 * a tick box per suggestion, ticked by default, its title and details edited
 * in place, and a primary button that says how many will be added. Unticking
 * is how a suggestion is turned down. Nothing here adds anything: the dialog
 * that owns the list adds the ticked ones when the person presses the button.
 *
 * A dialog that needs more (a milestone choice, a tree of subtasks) puts it
 * around these pieces through the slots, never inside a copy of them.
 */

export interface AiTaskReviewItemProps {
  /** How the suggestion is named to assistive tech: "Suggestion 2", "B4.1". */
  name: string
  included: boolean
  onToggle: (included: boolean) => void
  title: string
  onTitleChange: (title: string) => void
  details: string
  onDetailsChange: (details: string) => void
  disabled?: boolean
  /** The compact row of a tree: labels hidden, details shorter. */
  compact?: boolean
  /** Before the tick box, such as a tree's expand button and code. */
  lead?: ReactNode
  /** Beside the title, such as a priority. */
  fields?: ReactNode
  /** Under the details, such as a checklist or attachments. */
  children?: ReactNode
  /** After the suggestion's own body, such as its subtasks. */
  after?: ReactNode
  className?: string
}

/** One suggestion: tick box, title and details, plus whatever the dialog adds. */
export function AiTaskReviewItem({
  name,
  included,
  onToggle,
  title,
  onTitleChange,
  details,
  onDetailsChange,
  disabled,
  compact,
  lead,
  fields,
  children,
  after,
  className
}: AiTaskReviewItemProps) {
  const locked = disabled || !included
  return (
    <li
      className={cx(
        'ai-review__item',
        compact && 'ai-review__item--compact',
        !included && 'is-excluded',
        className
      )}
      aria-label={name}
    >
      <div className="ai-review__row">
        {lead}
        <Checkbox
          label={null}
          aria-label={t('ai:aiTaskReview.include', { name })}
          checked={included}
          disabled={disabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <TextField
          label={t('ai:aiTaskReview.title', { name })}
          hideLabel={compact}
          className="ai-review__title"
          value={title}
          disabled={locked}
          onChange={(event) => onTitleChange(event.target.value)}
        />
        {fields}
      </div>
      <div className="ai-review__body">
        <TextArea
          label={t('ai:aiTaskReview.details', { name })}
          hideLabel={compact}
          rows={compact ? 2 : 3}
          value={details}
          disabled={locked}
          onChange={(event) => onDetailsChange(event.target.value)}
        />
        {children}
      </div>
      {after}
    </li>
  )
}

/** The flat list of suggestions, with the polite count above it. */
export function AiTaskReviewList({
  included,
  total,
  children
}: {
  included: number
  total: number
  children: ReactNode
}) {
  return (
    <div className="ai-review">
      <AiTaskReviewCount included={included} total={total} />
      <ol className="ai-review__list">{children}</ol>
    </div>
  )
}

/** "4 of 5 will be added", said politely each time a tick changes it. */
export function AiTaskReviewCount({ included, total }: { included: number; total: number }) {
  return (
    <p className="dialog-muted" role="status" aria-live="polite">
      {t('ai:aiTaskReview.willAdd', { included, total })}
    </p>
  )
}

/** The primary button: "Add 4 tasks". Only this click adds anything. */
export function AiTaskReviewAddButton({
  count,
  missingTitle = false,
  loading,
  disabled,
  onClick
}: {
  count: number
  missingTitle?: boolean
  loading?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="primary"
      loading={loading}
      disabled={disabled || count === 0 || missingTitle}
      disabledReason={
        count === 0
          ? t('ai:aiTaskReview.tickLeastOneTask')
          : missingTitle
            ? t('ai:aiTaskReview.everyTickedTaskNeeds')
            : undefined
      }
      onClick={onClick}
    >
      {t('ai:aiTaskReview.addTasks', { count })}
    </Button>
  )
}

/** The name of the n-th suggestion in a flat list, counted from 1. */
export function aiSuggestionName(index: number): string {
  return t('ai:aiTaskReview.suggestion', { number: index + 1 })
}
