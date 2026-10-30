import { useEffect, useMemo, useState } from 'react'
import { useConfig } from '../../../hooks/useConfig'
import type {
  AgentLimitUsage,
  AgentModelPrice,
  AgentRunFilter,
  AgentRunHistory,
  AgentRunRecord,
  AgentRunRecordOutcome,
  AgentRunTotals,
  AgentUsageStatus
} from '@shared/ostler-api'
import {
  AGENT_RUN_OUTCOMES,
  agentRunOutcomeLabel,
  normalizeModelPrices,
  runCost
} from '@shared/agent-run-history'
import { formatDate, formatDuration, formatNumber, formatPercent, formatTime } from '@shared/format'
import { t } from '@shared/i18n'
import {
  Badge,
  Button,
  DateField,
  InlineAlert,
  ProgressBar,
  Select,
  useToast,
  type BadgeTone
} from '../../../ui'

const OUTCOME_TONE: Record<AgentRunRecordOutcome, BadgeTone> = {
  in_review: 'accent',
  accepted: 'success',
  discarded: 'neutral',
  rejected: 'warning',
  abandoned: 'warning',
  unreported: 'warning',
  stopped: 'neutral',
  failed: 'danger'
}

/** A cost in the person's own currency: they entered the prices, so there is no symbol. */
function costText(value: number | null): string {
  return value === null
    ? '—'
    : formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function tokensText(totals: Pick<AgentRunTotals, 'inputTokens' | 'outputTokens'>): string {
  return t('agents:runHistory.tokensInOut', {
    input: formatNumber(totals.inputTokens),
    output: formatNumber(totals.outputTokens)
  })
}

function successText(totals: AgentRunTotals): string {
  return totals.successRate === null ? '—' : formatPercent(totals.successRate)
}

function durationText(ms: number | null): string {
  return ms === null ? '—' : formatDuration(ms, { long: true })
}

/**
 * The Agents view's History (R5.3, D43): how much of each token limit the
 * built-in agent has used, every run with filters, the totals, a breakdown by
 * model, and Export CSV. `refreshKey` changes with the harness state, so a run
 * shows here as soon as it ends.
 */
export function AgentHistorySection({
  projectId,
  refreshKey
}: {
  projectId: string
  refreshKey: unknown
}) {
  const { toast } = useToast()
  const [filter, setFilter] = useState<AgentRunFilter>({})
  const [history, setHistory] = useState<AgentRunHistory | null>(null)
  const [usage, setUsage] = useState<AgentUsageStatus | null>(null)
  const modelPrices = useConfig().config?.harness.modelPrices
  const prices = useMemo(() => normalizeModelPrices(modelPrices), [modelPrices])
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.ostlerAPI.getAgentRunHistory(projectId, filter),
      window.ostlerAPI.getAgentUsage(projectId)
    ]).then(([historyResult, usageResult]) => {
      if (cancelled) return
      if (historyResult.ok) setHistory(historyResult.value)
      setError(historyResult.ok ? null : historyResult.error)
      if (usageResult.ok) setUsage(usageResult.value)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey, filter])

  const exportCsv = async () => {
    setExporting(true)
    try {
      const result = await window.ostlerAPI.exportAgentRunHistory(projectId, filter)
      if (!result.ok) {
        toast({ title: t('agents:runHistory.exportFailed'), body: result.error, tone: 'danger' })
      } else if (result.value) {
        toast({ title: t('agents:runHistory.exported'), body: result.value, tone: 'success' })
      }
    } finally {
      setExporting(false)
    }
  }

  const change = (next: Partial<AgentRunFilter>) => {
    const merged: AgentRunFilter = { ...filter, ...next }
    for (const key of Object.keys(merged) as (keyof AgentRunFilter)[]) {
      if (!merged[key]) delete merged[key]
    }
    setFilter(merged)
  }

  const totals = history?.totals

  return (
    <section className="agents-section" aria-labelledby="agents-history">
      <header className="agents-section__header">
        <h3 id="agents-history">{t('agents:runHistory.history')}</h3>
        <Button
          size="sm"
          variant="secondary"
          disabled={exporting || !history || history.runs.length === 0}
          onClick={() => void exportCsv()}
        >
          {t('agents:runHistory.exportCsv')}
        </Button>
      </header>

      {usage && <LimitUsage usage={usage} />}

      <div className="agents-history__filters">
        <Select
          size="sm"
          label={t('agents:runHistory.outcomeFilter')}
          value={filter.outcome ?? ''}
          onChange={(event) =>
            change({ outcome: (event.target.value || undefined) as AgentRunRecordOutcome })
          }
          options={[
            { value: '', label: t('agents:runHistory.allOutcomes') },
            ...AGENT_RUN_OUTCOMES.map((outcome) => ({
              value: outcome,
              label: agentRunOutcomeLabel(outcome)
            }))
          ]}
        />
        <Select
          size="sm"
          label={t('agents:runHistory.modelFilter')}
          value={filter.model ?? ''}
          onChange={(event) => change({ model: event.target.value || undefined })}
          options={[
            { value: '', label: t('agents:runHistory.allModels') },
            ...(history?.models ?? []).map((model) => ({ value: model, label: model }))
          ]}
        />
        <DateField
          label={t('agents:runHistory.from')}
          value={filter.from ?? ''}
          due={false}
          max={filter.to}
          onChange={(value) => change({ from: value || undefined })}
        />
        <DateField
          label={t('agents:runHistory.to')}
          value={filter.to ?? ''}
          due={false}
          min={filter.from}
          onChange={(value) => change({ to: value || undefined })}
        />
      </div>

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      {totals && (
        <dl className="agents-tiles" aria-label={t('agents:runHistory.totals')}>
          <div className="agents-tile">
            <dt>{t('agents:runHistory.runs')}</dt>
            <dd>{formatNumber(totals.runs)}</dd>
          </div>
          <div className="agents-tile">
            <dt>
              {t('agents:runHistory.successRateOf', {
                accepted: totals.accepted,
                finished: totals.finished
              })}
            </dt>
            <dd>{successText(totals)}</dd>
          </div>
          <div className="agents-tile">
            <dt>{t('agents:runHistory.medianDuration')}</dt>
            <dd>{durationText(totals.medianDurationMs)}</dd>
          </div>
          <div className="agents-tile">
            <dt>{t('agents:runHistory.tokens')}</dt>
            <dd>{formatNumber(totals.inputTokens + totals.outputTokens)}</dd>
          </div>
          {totals.cost !== null && (
            <div className="agents-tile">
              <dt>{t('agents:runHistory.cost')}</dt>
              <dd>{costText(totals.cost)}</dd>
            </div>
          )}
        </dl>
      )}
      {totals && (
        <p className="agents-muted">
          {[
            tokensText(totals),
            totals.includesReportedUsage ? t('agents:runHistory.includesReported') : null,
            totals.cost === null
              ? t('agents:runHistory.noPrices')
              : totals.costIncomplete
                ? t('agents:runHistory.costIncomplete')
                : null
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      {history && history.byModel.length > 0 && (
        <div className="agents-history__scroll">
          <table className="agents-history__table">
            <caption>{t('agents:runHistory.byModel')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('agents:runHistory.model')}</th>
                <th scope="col">{t('agents:runHistory.runs')}</th>
                <th scope="col">{t('agents:runHistory.successRate')}</th>
                <th scope="col">{t('agents:runHistory.medianDuration')}</th>
                <th scope="col">{t('agents:runHistory.tokens')}</th>
                <th scope="col">{t('agents:runHistory.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {history.byModel.map((row) => (
                <tr key={row.model ?? ''}>
                  <th scope="row">{row.model ?? t('agents:runHistory.unknownModel')}</th>
                  <td>{formatNumber(row.runs)}</td>
                  <td>{successText(row)}</td>
                  <td>{durationText(row.medianDurationMs)}</td>
                  <td>{tokensText(row)}</td>
                  <td>{costText(row.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history && history.runs.length === 0 && (
        <p className="agents-muted">
          {Object.keys(filter).length > 0
            ? t('agents:runHistory.noRunsMatch')
            : t('agents:runHistory.noRunsYet')}
        </p>
      )}
      {history && history.runs.length > 0 && (
        <div className="agents-history__scroll">
          <table className="agents-history__table">
            <caption>{t('agents:runHistory.runsCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('agents:runHistory.started')}</th>
                <th scope="col">{t('agents:runHistory.task')}</th>
                <th scope="col">{t('agents:runHistory.outcomeColumn')}</th>
                <th scope="col">{t('agents:runHistory.model')}</th>
                <th scope="col">{t('agents:runHistory.duration')}</th>
                <th scope="col">{t('agents:runHistory.work')}</th>
                <th scope="col">{t('agents:runHistory.tokens')}</th>
                <th scope="col">{t('agents:runHistory.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {history.runs.map((run) => (
                <RunRow key={run.sessionId} run={run} prices={prices} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function RunRow({ run, prices }: { run: AgentRunRecord; prices: AgentModelPrice[] }) {
  const hasUsage = run.inputTokens !== null || run.outputTokens !== null
  const steering = [
    run.stalls > 0 ? t('agents:runHistory.stalls', { count: run.stalls }) : null,
    run.nudges > 0 ? t('agents:runHistory.nudges', { count: run.nudges }) : null,
    run.guidance > 0 ? t('agents:runHistory.guidance', { count: run.guidance }) : null
  ].filter(Boolean)
  return (
    <tr>
      <td>{formatDate(run.startedAt, { dateStyle: 'medium', timeStyle: 'short' })}</td>
      <th scope="row">
        <span className="agents-history__task">{run.title}</span>
        <small className="agents-muted">
          {run.provenance === 'embedded'
            ? t('agents:runHistory.builtIn')
            : t('agents:runHistory.connected')}
        </small>
      </th>
      <td>
        <Badge tone={OUTCOME_TONE[run.outcome]}>{agentRunOutcomeLabel(run.outcome)}</Badge>
      </td>
      <td>
        {run.model ?? '—'}
        {run.effort && <small className="agents-muted"> {run.effort}</small>}
      </td>
      <td>{formatDuration(run.durationMs, { long: true })}</td>
      <td>
        {[
          run.commits === null ? null : t('agents:runHistory.commits', { count: run.commits }),
          run.filesChanged === null
            ? null
            : t('agents:runHistory.files', { count: run.filesChanged }),
          ...steering
        ]
          .filter(Boolean)
          .join(' · ') || '—'}
      </td>
      <td>
        {hasUsage ? (
          <>
            {tokensText({
              inputTokens: run.inputTokens ?? 0,
              outputTokens: run.outputTokens ?? 0
            })}
            {run.usageReported && (
              <small className="agents-muted"> {t('agents:runHistory.reportedByAgent')}</small>
            )}
          </>
        ) : (
          '—'
        )}
      </td>
      <td>{costText(runCost(run, prices))}</td>
    </tr>
  )
}

/** How much of each token limit the built-in agent has used, and when each resets. */
function LimitUsage({ usage }: { usage: AgentUsageStatus }) {
  const limits = [usage.day, usage.month].filter((entry) => entry.limit !== null)
  if (limits.length === 0) {
    return <p className="agents-muted">{t('agents:runHistory.noLimits')}</p>
  }
  return (
    <div className="agents-history__limits">
      {limits.map((entry) => (
        <LimitBar key={entry.period} entry={entry} />
      ))}
    </div>
  )
}

function LimitBar({ entry }: { entry: AgentLimitUsage }) {
  const limit = entry.limit ?? 0
  const label =
    entry.period === 'day' ? t('agents:runHistory.todayLimit') : t('agents:runHistory.monthLimit')
  const resets =
    entry.period === 'day'
      ? t('agents:runHistory.resetsAt', { time: formatTime(entry.resetsAt) })
      : t('agents:runHistory.resetsOn', { date: formatDate(entry.resetsAt) })
  return (
    <div className="agents-history__limit">
      <ProgressBar
        label={label}
        showLabel
        value={Math.min(entry.used, limit)}
        max={limit}
        tone={entry.reached ? 'danger' : entry.used >= limit * 0.8 ? 'warning' : 'accent'}
        valueText={t('agents:runHistory.usedOf', {
          used: formatNumber(entry.used),
          limit: formatNumber(limit)
        })}
      />
      <small className={entry.reached ? 'agents-danger-text' : 'agents-muted'}>
        {entry.reached ? `${t('agents:runHistory.limitReached')} ${resets}` : resets}
      </small>
    </div>
  )
}
