import React from 'react'
import { Badge } from '../ui'
import type { HarnessEmbeddedRuntime, HarnessSessionProvenance } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { formatNumber, formatTime } from '@shared/format'

export interface ProvenanceBadgeProps {
  provenance: HarnessSessionProvenance
  embeddedRuntime?: HarnessEmbeddedRuntime
  className?: string
}

export const ProvenanceBadge: React.FC<ProvenanceBadgeProps> = ({
  provenance,
  embeddedRuntime,
  className = ''
}) => {
  const isEmbedded = provenance === 'embedded'

  let tooltip = t('ai:provenanceBadge.connectedAgentLinkedThrough')
  if (isEmbedded) {
    if (embeddedRuntime) {
      const parts = [
        t('ai:provenanceBadge.builtAgentVersionPort', {
          version: embeddedRuntime.version,
          processPort: embeddedRuntime.processPort
        })
      ]
      if (typeof embeddedRuntime.toolCallCount === 'number') {
        parts.push(
          t('ai:provenanceBadge.toolCalls', { toolCallCount: embeddedRuntime.toolCallCount })
        )
      }
      if (embeddedRuntime.maxToolCallsPerMinute) {
        const rateInfo =
          typeof embeddedRuntime.toolCallsInLastMinute === 'number'
            ? t('ai:provenanceBadge.perMinute', {
                toolCallsInLastMinute: embeddedRuntime.toolCallsInLastMinute,
                maxToolCallsPerMinute: embeddedRuntime.maxToolCallsPerMinute
              })
            : t('ai:provenanceBadge.limitMinute', {
                maxToolCallsPerMinute: embeddedRuntime.maxToolCallsPerMinute
              })
        parts.push(t('ai:provenanceBadge.rate', { rateInfo }))
      }
      if (typeof embeddedRuntime.turnCount === 'number') {
        parts.push(t('ai:provenanceBadge.turns', { turnCount: embeddedRuntime.turnCount }))
      }
      if (embeddedRuntime.usage?.totalTokens) {
        parts.push(
          t('ai:provenanceBadge.tokens', {
            localeString: formatNumber(embeddedRuntime.usage.totalTokens)
          })
        )
      }
      if (embeddedRuntime.stoppedForReview) {
        parts.push(t('ai:provenanceBadge.stoppedReview'))
      }
      if (embeddedRuntime.stall) {
        const since = formatTime(new Date(embeddedRuntime.stall.since), { timeStyle: 'medium' })
        parts.push(
          t('ai:provenanceBadge.stalledSince', { since, reason: embeddedRuntime.stall.reason })
        )
      }
      if (embeddedRuntime.stallAborts) {
        parts.push(
          t('ai:provenanceBadge.stuckCallsAborted', { stallAborts: embeddedRuntime.stallAborts })
        )
      }
      tooltip = parts.join(' · ')
    } else {
      tooltip = t('ai:provenanceBadge.builtAgent')
    }
  }

  // Whether the AI behind this session ever answered is the first thing worth
  // knowing about an embedded session, and it is not visible anywhere else:
  // Ostler starting opencode successfully says nothing about the model.
  const noResponse =
    isEmbedded &&
    embeddedRuntime !== undefined &&
    embeddedRuntime.modelResponded === false &&
    (embeddedRuntime.stopReason === 'no-response' || embeddedRuntime.stopReason === 'error')

  if (noResponse) {
    return (
      <Badge
        tone="danger"
        className={className || undefined}
        title={t('ai:provenanceBadge.aiNeverRespondedNo', { tooltip })}
        data-provenance={provenance}
        aria-label={t('ai:provenanceBadge.builtAgentAiNever')}
      >
        {t('ai:provenanceBadge.aiNeverResponded')}
      </Badge>
    )
  }

  const stalled = isEmbedded && Boolean(embeddedRuntime?.stall)
  return (
    <Badge
      tone={stalled ? 'warning' : isEmbedded ? 'info' : 'neutral'}
      className={className || undefined}
      title={tooltip}
      data-provenance={provenance}
      aria-label={
        isEmbedded ? t('ai:provenanceBadge.builtAgent') : t('ai:provenanceBadge.connectedAgent')
      }
    >
      {isEmbedded
        ? stalled
          ? t('ai:provenanceBadge.builtStalled')
          : t('ai:provenanceBadge.built')
        : t('ai:provenanceBadge.connected')}
    </Badge>
  )
}
