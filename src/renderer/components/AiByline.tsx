import { formatDateTime, formatRelativeTime } from '@shared/format'
import { InlineAlert } from '../ui'
import { Icon, Sparkles } from '../ui/icons'
import './AiByline.css'
import { t } from '@shared/i18n'

/**
 * "Suggested by Ostler AI · model · 3 minutes ago": the one line every AI
 * dialog shows, so a human always knows what wrote the draft and when.
 */
export function AiByline({
  model,
  at,
  verb = 'suggested'
}: {
  model?: string
  /** When it was generated: a timestamp or an ISO string. */
  at?: number | string
  /** What Ostler AI did: "Suggested by Ostler AI" or "Reviewed by Ostler AI". */
  verb?: 'suggested' | 'reviewed'
}) {
  const date = at === undefined ? null : new Date(at)
  return (
    <p className="ai-byline">
      <Icon icon={Sparkles} />
      <span>
        {verb === 'reviewed' ? t('ai:aiByline.reviewedBy') : t('ai:aiByline.suggestedBy')}
        {model ? ` · ${model}` : ''}
        {date && !Number.isNaN(date.getTime()) && (
          <>
            {' · '}
            <time dateTime={date.toISOString()} title={formatDateTime(date)}>
              {formatRelativeTime(date.getTime())}
            </time>
          </>
        )}
      </span>
    </p>
  )
}

/**
 * An AI draft's warnings (including "Images were sent as descriptions") and,
 * optionally, its assumptions, in one warning alert. Nothing when empty.
 */
export function AiWarnings({
  warnings,
  assumptions = []
}: {
  warnings: string[]
  assumptions?: string[]
}) {
  if (warnings.length === 0 && assumptions.length === 0) return null
  return (
    <InlineAlert
      tone={warnings.length > 0 ? 'warning' : 'info'}
      title={warnings.length > 0 ? t('ai:aiByline.beforeRely') : t('ai:aiByline.assumptions')}
    >
      <ul className="ai-warnings">
        {warnings.map((warning) => (
          <li key={`warning-${warning}`}>{warning}</li>
        ))}
        {assumptions.map((assumption) => (
          <li key={`assumption-${assumption}`}>{t('ai:aiByline.assumed', { assumption })}</li>
        ))}
      </ul>
    </InlineAlert>
  )
}
