import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { HarnessWalkthroughStop } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Button, InlineAlert } from '../../ui'
import { ChevronLeft, ChevronRight } from '../../ui/icons'
import './ReportPictures.css'

/**
 * The bar Walk through shows under the diff (N9.1): one stop's file, lines
 * and note, "Stop 2 of 6", and Previous, Next and Close. The arrow keys step
 * while focus is in the bar (Escape stays the dialog's, as everywhere). The note
 * is the agent's text, shown as plain text.
 */
export function WalkthroughBar({
  stops,
  index,
  inDiff,
  patchTruncated,
  onIndex,
  onClose
}: {
  stops: HarnessWalkthroughStop[]
  index: number
  /** Whether the shown diff holds this stop's lines. */
  inDiff: boolean
  patchTruncated: boolean
  onIndex: (index: number) => void
  onClose: () => void
}) {
  const stop = stops[index]
  const bar = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    bar.current?.focus()
  }, [])
  if (!stop) return null
  const last = stops.length - 1

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight' && index < last) {
      event.preventDefault()
      onIndex(index + 1)
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      onIndex(index - 1)
    }
  }

  const lines =
    stop.startLine === stop.endLine
      ? t('agents:walkthrough.line', { line: stop.startLine })
      : t('agents:walkthrough.lines', { first: stop.startLine, last: stop.endLine })

  return (
    <div
      ref={bar}
      className="walkthrough-bar"
      role="region"
      aria-label={t('agents:walkthrough.title')}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="walkthrough-bar__head">
        <strong aria-live="polite">
          {t('agents:walkthrough.stopOf', { number: index + 1, count: stops.length })}
        </strong>
        <span className="walkthrough-bar__where">
          <code>{stop.path}</code> {lines}
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon={ChevronLeft}
          disabled={index === 0}
          onClick={() => onIndex(index - 1)}
        >
          {t('agents:walkthrough.previous')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={ChevronRight}
          disabled={index === last}
          onClick={() => onIndex(index + 1)}
        >
          {t('agents:walkthrough.next')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('agents:walkthrough.close')}
        </Button>
      </div>
      {!inDiff && (
        <InlineAlert tone="info">
          {patchTruncated
            ? t('agents:walkthrough.notShownTruncated')
            : t('agents:walkthrough.notShown')}
        </InlineAlert>
      )}
      <p className="walkthrough-bar__note">{stop.note}</p>
    </div>
  )
}
