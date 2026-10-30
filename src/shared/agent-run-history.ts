import type {
  AgentLimitUsage,
  AgentModelPrice,
  AgentRunFilter,
  AgentRunHistory,
  AgentRunRecord,
  AgentRunRecordOutcome,
  AgentRunTotals,
  AgentUsageLimits
} from './ostler-api'
import { csvRecord } from './export/task-csv'
import { parseIsoDate, toIsoDate } from './dates'
import { t } from './i18n'
import { formatDate, formatNumber, formatTime } from './format'

/**
 * Run history, usage and limits (R5.3, D43): the one set of rules the Agents
 * view, the CSV export, the automation API and the limit checks share.
 */

export const AGENT_RUN_OUTCOMES: readonly AgentRunRecordOutcome[] = [
  'in_review',
  'accepted',
  'discarded',
  'rejected',
  'abandoned',
  'unreported',
  'stopped',
  'failed'
]

export function isAgentRunOutcome(value: unknown): value is AgentRunRecordOutcome {
  return AGENT_RUN_OUTCOMES.includes(value as AgentRunRecordOutcome)
}

/** The longest model name a price may name. */
const MAX_MODEL_LENGTH = 200
/** A price above this per million tokens is a typing mistake. */
const MAX_PRICE = 1_000_000
/** At most this many prices. */
const MAX_PRICES = 200

/**
 * Prices as Settings saves them: a model name and two prices of 0 or more.
 * Anything else is dropped; a later price for the same model wins.
 */
export function normalizeModelPrices(value: unknown): AgentModelPrice[] {
  if (!Array.isArray(value)) return []
  const byModel = new Map<string, AgentModelPrice>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const entry = candidate as Record<string, unknown>
    const model = typeof entry.model === 'string' ? entry.model.trim() : ''
    const input = Number(entry.inputPerMillion)
    const output = Number(entry.outputPerMillion)
    if (!model || model.length > MAX_MODEL_LENGTH) continue
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue
    if (input < 0 || output < 0 || input > MAX_PRICE || output > MAX_PRICE) continue
    byModel.set(model, { model, inputPerMillion: input, outputPerMillion: output })
  }
  return [...byModel.values()].slice(0, MAX_PRICES)
}

/** The largest limit a project may set, in tokens. */
export const MAX_AGENT_TOKEN_LIMIT = 1_000_000_000_000

/** Limits as Project settings saves them: a whole number of tokens above 0, or none. */
export function normalizeAgentLimits(value: unknown): AgentUsageLimits {
  const entry = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const limit = (raw: unknown): number | null => {
    if (raw === null || raw === undefined || raw === '') return null
    const number = Math.floor(Number(raw))
    if (!Number.isFinite(number) || number <= 0) return null
    return Math.min(number, MAX_AGENT_TOKEN_LIMIT)
  }
  return { tokensPerDay: limit(entry.tokensPerDay), tokensPerMonth: limit(entry.tokensPerMonth) }
}

/**
 * A run's cost from the person's prices, or null without a price for its
 * model or without tokens. Never guessed.
 */
export function runCost(
  run: Pick<AgentRunRecord, 'model' | 'inputTokens' | 'outputTokens'>,
  prices: readonly AgentModelPrice[]
): number | null {
  if (run.inputTokens === null && run.outputTokens === null) return null
  const price = run.model ? prices.find((candidate) => candidate.model === run.model) : undefined
  if (!price) return null
  return (
    ((run.inputTokens ?? 0) * price.inputPerMillion +
      (run.outputTokens ?? 0) * price.outputPerMillion) /
    1_000_000
  )
}

/** A run no longer waiting for a person's review. */
export function isFinishedRun(run: Pick<AgentRunRecord, 'outcome'>): boolean {
  return run.outcome !== 'in_review'
}

export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Runs, success rate (accepted out of finished), median duration, tokens and cost. */
export function summarizeRuns(
  runs: readonly AgentRunRecord[],
  prices: readonly AgentModelPrice[]
): AgentRunTotals {
  const finished = runs.filter(isFinishedRun)
  const accepted = finished.filter((run) => run.outcome === 'accepted').length
  let cost: number | null = null
  let costIncomplete = false
  for (const run of runs) {
    if (run.inputTokens === null && run.outputTokens === null) continue
    const value = runCost(run, prices)
    if (value === null) costIncomplete = true
    else cost = (cost ?? 0) + value
  }
  return {
    runs: runs.length,
    finished: finished.length,
    accepted,
    successRate: finished.length > 0 ? accepted / finished.length : null,
    medianDurationMs: medianOf(runs.map((run) => run.durationMs)),
    inputTokens: runs.reduce((sum, run) => sum + (run.inputTokens ?? 0), 0),
    outputTokens: runs.reduce((sum, run) => sum + (run.outputTokens ?? 0), 0),
    cost,
    costIncomplete: cost !== null && costIncomplete,
    includesReportedUsage: runs.some(
      (run) => run.usageReported && (run.inputTokens !== null || run.outputTokens !== null)
    )
  }
}

/** Whether a run passes the history's filters. */
export function matchesRunFilter(run: AgentRunRecord, filter: AgentRunFilter): boolean {
  if (filter.outcome && run.outcome !== filter.outcome) return false
  if (filter.model && run.model !== filter.model) return false
  const day = toIsoDate(new Date(run.startedAt))
  if (filter.from && day < filter.from) return false
  if (filter.to && day > filter.to) return false
  return true
}

/** Reads a filter from untrusted input (IPC or a query string), dropping what is not valid. */
export function parseRunFilter(value: unknown): AgentRunFilter {
  const entry = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const filter: AgentRunFilter = {}
  if (isAgentRunOutcome(entry.outcome)) filter.outcome = entry.outcome
  if (typeof entry.model === 'string' && entry.model.trim()) {
    filter.model = entry.model.trim().slice(0, MAX_MODEL_LENGTH)
  }
  for (const key of ['from', 'to'] as const) {
    const day = entry[key]
    if (typeof day === 'string' && parseIsoDate(day)) filter[key] = day
  }
  return filter
}

/** The history: runs newest first, filtered, with totals and a breakdown by model. */
export function buildRunHistory(
  allRuns: readonly AgentRunRecord[],
  filter: AgentRunFilter,
  prices: readonly AgentModelPrice[]
): AgentRunHistory {
  const runs = allRuns
    .filter((run) => matchesRunFilter(run, filter))
    .sort((a, b) => b.startedAt - a.startedAt)
  const groups = new Map<string | null, AgentRunRecord[]>()
  for (const run of runs) groups.set(run.model, [...(groups.get(run.model) ?? []), run])
  const byModel = [...groups.entries()]
    .map(([model, group]) => ({ model, ...summarizeRuns(group, prices) }))
    .sort((a, b) => b.runs - a.runs || String(a.model).localeCompare(String(b.model)))
  const models = [
    ...new Set(allRuns.map((run) => run.model).filter((m): m is string => Boolean(m)))
  ].sort()
  return { runs, totals: summarizeRuns(runs, prices), byModel, models }
}

/** A run's tokens, in and out, as the limits count them. */
export function runTokens(run: Pick<AgentRunRecord, 'inputTokens' | 'outputTokens'>): number {
  return (run.inputTokens ?? 0) + (run.outputTokens ?? 0)
}

/**
 * The periods limits count in: today from local midnight, and this month
 * from the first. Built from local date parts, so a daylight-saving change
 * moves neither start nor reset.
 */
export function limitPeriods(now: number): {
  dayStart: number
  dayResetsAt: number
  monthStart: number
  monthResetsAt: number
} {
  const date = new Date(now)
  const year = date.getFullYear()
  const month = date.getMonth()
  const day = date.getDate()
  return {
    dayStart: new Date(year, month, day).getTime(),
    dayResetsAt: new Date(year, month, day + 1).getTime(),
    monthStart: new Date(year, month, 1).getTime(),
    monthResetsAt: new Date(year, month + 1, 1).getTime()
  }
}

/**
 * How much of each limit the built-in agent has used. A run counts in the
 * period it started in; `runs` are the project's built-in runs, finished and
 * running.
 */
export function agentLimitUsage(
  runs: readonly Pick<AgentRunRecord, 'startedAt' | 'inputTokens' | 'outputTokens'>[],
  limits: AgentUsageLimits,
  now: number
): { day: AgentLimitUsage; month: AgentLimitUsage } {
  const periods = limitPeriods(now)
  const usedSince = (start: number, end: number) =>
    runs
      .filter((run) => run.startedAt >= start && run.startedAt < end)
      .reduce((sum, run) => sum + runTokens(run), 0)
  const dayUsed = usedSince(periods.dayStart, periods.dayResetsAt)
  const monthUsed = usedSince(periods.monthStart, periods.monthResetsAt)
  return {
    day: {
      period: 'day',
      limit: limits.tokensPerDay,
      used: dayUsed,
      resetsAt: periods.dayResetsAt,
      reached: limits.tokensPerDay !== null && dayUsed >= limits.tokensPerDay
    },
    month: {
      period: 'month',
      limit: limits.tokensPerMonth,
      used: monthUsed,
      resetsAt: periods.monthResetsAt,
      reached: limits.tokensPerMonth !== null && monthUsed >= limits.tokensPerMonth
    }
  }
}

/** The limit a run is held by, the day's first; null when neither is reached. */
export function reachedLimit(usage: {
  day: AgentLimitUsage
  month: AgentLimitUsage
}): AgentLimitUsage | null {
  if (usage.day.reached) return usage.day
  if (usage.month.reached) return usage.month
  return null
}

/**
 * Which limit was reached and when it resets, in plain words: the refusal, the
 * Inbox item and the note on a run stopped at a limit all say it this way.
 */
export function agentLimitMessage(reached: AgentLimitUsage): string {
  const values = {
    used: formatNumber(reached.used),
    limit: formatNumber(reached.limit ?? 0),
    time: formatTime(reached.resetsAt),
    date: formatDate(reached.resetsAt)
  }
  return reached.period === 'day'
    ? t('errors:agentLimits.dayReached', values)
    : t('errors:agentLimits.monthReached', values)
}

/** The outcome as the app words it. */
export function agentRunOutcomeLabel(outcome: AgentRunRecordOutcome): string {
  return t(`agents:runHistory.outcome.${outcome}`)
}

/** Excel reads the file as UTF-8 only with a byte-order mark. */
const UTF8_BOM = '\ufeff'

function tokenCell(value: number | null): string {
  return value === null ? '' : String(value)
}

/**
 * The history as CSV: one record per run, in the order shown. The same
 * writer as the task export (RFC 4180, UTF-8 with a BOM, CRLF).
 */
export function runHistoryCsv(
  runs: readonly AgentRunRecord[],
  prices: readonly AgentModelPrice[]
): string {
  const header = csvRecord([
    t('agents:runHistory.csv.started'),
    t('agents:runHistory.csv.ended'),
    t('agents:runHistory.csv.durationMinutes'),
    t('agents:runHistory.csv.task'),
    t('agents:runHistory.csv.agent'),
    t('agents:runHistory.csv.model'),
    t('agents:runHistory.csv.effort'),
    t('agents:runHistory.csv.outcome'),
    t('agents:runHistory.csv.stalls'),
    t('agents:runHistory.csv.nudges'),
    t('agents:runHistory.csv.guidance'),
    t('agents:runHistory.csv.commits'),
    t('agents:runHistory.csv.filesChanged'),
    t('agents:runHistory.csv.inputTokens'),
    t('agents:runHistory.csv.outputTokens'),
    t('agents:runHistory.csv.usageSource'),
    t('agents:runHistory.csv.cost')
  ])
  const records = runs.map((run) => {
    const cost = runCost(run, prices)
    const hasUsage = run.inputTokens !== null || run.outputTokens !== null
    return csvRecord([
      new Date(run.startedAt).toISOString(),
      new Date(run.endedAt).toISOString(),
      (run.durationMs / 60_000).toFixed(1),
      run.title,
      run.provenance === 'embedded'
        ? t('agents:runHistory.builtIn')
        : t('agents:runHistory.connected'),
      run.model ?? '',
      run.effort ?? '',
      agentRunOutcomeLabel(run.outcome),
      String(run.stalls),
      String(run.nudges),
      String(run.guidance),
      run.commits === null ? '' : String(run.commits),
      run.filesChanged === null ? '' : String(run.filesChanged),
      tokenCell(run.inputTokens),
      tokenCell(run.outputTokens),
      !hasUsage
        ? ''
        : run.usageReported
          ? t('agents:runHistory.reportedByAgent')
          : t('agents:runHistory.measuredByOstler'),
      cost === null ? '' : cost.toFixed(4)
    ])
  })
  return `${UTF8_BOM}${[header, ...records].join('\r\n')}\r\n`
}
