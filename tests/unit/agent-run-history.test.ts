import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentRunRecord } from '../../src/shared/ostler-api'
import {
  agentLimitUsage,
  buildRunHistory,
  limitPeriods,
  normalizeAgentLimits,
  normalizeModelPrices,
  parseRunFilter,
  runCost,
  runHistoryCsv,
  summarizeRuns
} from '../../src/shared/agent-run-history'

function run(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  const startedAt = overrides.startedAt ?? new Date(2026, 9, 14, 9).getTime()
  const durationMs = overrides.durationMs ?? 60_000
  return {
    sessionId: 's1',
    projectId: 'p1',
    taskId: 't1',
    title: 'Fix the parser',
    provenance: 'embedded',
    model: 'claude-sonnet-5-5',
    effort: null,
    startedAt,
    endedAt: startedAt + durationMs,
    durationMs,
    outcome: 'accepted',
    endedAs: 'in_review',
    detail: '',
    stalls: 0,
    nudges: 0,
    guidance: 0,
    commits: 1,
    filesChanged: 1,
    inputTokens: 1_000_000,
    outputTokens: 200_000,
    usageReported: false,
    ...overrides
  }
}

const PRICES = [{ model: 'claude-sonnet-5-5', inputPerMillion: 3, outputPerMillion: 15 }]

describe('cost (D43)', () => {
  it('works out a run’s cost from the prices the person entered', () => {
    expect(runCost(run(), PRICES)).toBeCloseTo(3 + 3)
  })

  it('shows no cost without a price for the model, or without tokens: never guessed', () => {
    expect(runCost(run(), [])).toBeNull()
    expect(runCost(run({ model: 'gpt-5' }), PRICES)).toBeNull()
    expect(runCost(run({ inputTokens: null, outputTokens: null }), PRICES)).toBeNull()
    const totals = summarizeRuns([run()], [])
    expect(totals.cost).toBeNull()
    expect(totals.costIncomplete).toBe(false)
  })

  it('totals only the priced runs and says when some are left out', () => {
    const totals = summarizeRuns(
      [run({ sessionId: 'a' }), run({ sessionId: 'b', model: 'gpt-5' })],
      PRICES
    )
    expect(totals.cost).toBeCloseTo(6)
    expect(totals.costIncomplete).toBe(true)
  })

  it('keeps only valid prices', () => {
    expect(
      normalizeModelPrices([
        { model: ' gpt-5 ', inputPerMillion: '1.25', outputPerMillion: 10 },
        { model: 'bad', inputPerMillion: -1, outputPerMillion: 1 },
        { model: '', inputPerMillion: 1, outputPerMillion: 1 },
        'nonsense'
      ])
    ).toEqual([{ model: 'gpt-5', inputPerMillion: 1.25, outputPerMillion: 10 }])
    expect(normalizeModelPrices(undefined)).toEqual([])
  })
})

describe('totals', () => {
  it('counts success as accepted out of finished, leaving runs in review out', () => {
    const totals = summarizeRuns(
      [
        run({ sessionId: 'a', outcome: 'accepted' }),
        run({ sessionId: 'b', outcome: 'rejected' }),
        run({ sessionId: 'c', outcome: 'failed' }),
        run({ sessionId: 'd', outcome: 'accepted' }),
        run({ sessionId: 'e', outcome: 'in_review' })
      ],
      PRICES
    )
    expect(totals).toMatchObject({ runs: 5, finished: 4, accepted: 2, successRate: 0.5 })
    expect(summarizeRuns([run({ outcome: 'in_review' })], PRICES).successRate).toBeNull()
  })

  it('takes the median duration, odd and even', () => {
    const durations = (values: number[]) =>
      summarizeRuns(
        values.map((durationMs, index) => run({ sessionId: String(index), durationMs })),
        []
      ).medianDurationMs
    expect(durations([3, 1, 2])).toBe(2)
    expect(durations([4, 1, 3, 2])).toBe(2.5)
    expect(durations([])).toBeNull()
  })

  it('marks usage the agents reported themselves', () => {
    expect(summarizeRuns([run()], []).includesReportedUsage).toBe(false)
    expect(
      summarizeRuns([run({ provenance: 'external', usageReported: true })], [])
        .includesReportedUsage
    ).toBe(true)
  })

  it('filters by outcome, model and local day, with a breakdown by model', () => {
    const day = (date: number) => new Date(2026, 9, date, 12).getTime()
    const runs = [
      run({ sessionId: 'a', startedAt: day(12) }),
      run({ sessionId: 'b', startedAt: day(13), model: 'gpt-5', outcome: 'failed' }),
      run({ sessionId: 'c', startedAt: day(14) })
    ]
    const history = buildRunHistory(runs, parseRunFilter({ from: '2026-10-13' }), PRICES)
    expect(history.runs.map((entry) => entry.sessionId)).toEqual(['c', 'b'])
    expect(history.byModel.map((entry) => [entry.model, entry.runs])).toEqual([
      ['claude-sonnet-5-5', 1],
      ['gpt-5', 1]
    ])
    expect(history.models).toEqual(['claude-sonnet-5-5', 'gpt-5'])
    expect(buildRunHistory(runs, parseRunFilter({ outcome: 'failed' }), PRICES).runs).toHaveLength(
      1
    )
    expect(parseRunFilter({ outcome: 'won', from: '13/10/2026', model: 7 })).toEqual({})
  })

  it('writes CSV with the usage source and cost', () => {
    const text = runHistoryCsv(
      [run(), run({ sessionId: 'x', provenance: 'external', usageReported: true, model: null })],
      PRICES
    )
    const lines = text
      .replace(/^\ufeff/, '')
      .trim()
      .split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('Usage source')
    expect(lines[1]).toContain('6.0000')
    expect(lines[2]).toContain('reported by the agent')
  })
})

describe('limits (D43)', () => {
  const originalTz = process.env.TZ
  beforeEach(() => {
    process.env.TZ = 'Europe/London'
  })
  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('resets at local midnight and on the first of the month', () => {
    const now = new Date(2026, 9, 14, 15, 30).getTime()
    const periods = limitPeriods(now)
    expect(periods.dayStart).toBe(new Date(2026, 9, 14).getTime())
    expect(periods.dayResetsAt).toBe(new Date(2026, 9, 15).getTime())
    expect(periods.monthStart).toBe(new Date(2026, 9, 1).getTime())
    expect(periods.monthResetsAt).toBe(new Date(2026, 10, 1).getTime())
    // December rolls over into the next year.
    expect(limitPeriods(new Date(2026, 11, 31, 23).getTime()).monthResetsAt).toBe(
      new Date(2027, 0, 1).getTime()
    )
  })

  it('keeps local midnight across a daylight-saving change', () => {
    // The clocks go back at 02:00 on 25 October 2026 in London: that day has
    // 25 hours, and its reset is still the next local midnight.
    const changeDay = new Date(2026, 9, 25, 12).getTime()
    const periods = limitPeriods(changeDay)
    expect(periods.dayResetsAt - periods.dayStart).toBe(25 * 60 * 60 * 1000)
    expect(new Date(periods.dayResetsAt).getHours()).toBe(0)
    expect(new Date(periods.dayResetsAt).getDate()).toBe(26)
    // And in spring the day is 23 hours long.
    const spring = limitPeriods(new Date(2026, 2, 29, 12).getTime())
    expect(spring.dayResetsAt - spring.dayStart).toBe(23 * 60 * 60 * 1000)
  })

  it('counts runs in the day and month they started, and says when a limit is reached', () => {
    const now = new Date(2026, 9, 14, 15).getTime()
    const runs = [
      { startedAt: new Date(2026, 9, 14, 9).getTime(), inputTokens: 600, outputTokens: 100 },
      { startedAt: new Date(2026, 9, 13, 23, 59).getTime(), inputTokens: 1000, outputTokens: 0 },
      { startedAt: new Date(2026, 8, 30, 12).getTime(), inputTokens: 5000, outputTokens: 0 }
    ]
    const usage = agentLimitUsage(runs, { tokensPerDay: 700, tokensPerMonth: 10_000 }, now)
    expect(usage.day).toMatchObject({ used: 700, reached: true })
    expect(usage.month).toMatchObject({ used: 1700, reached: false })
    // Just after midnight the day starts again.
    const tomorrow = agentLimitUsage(
      runs,
      { tokensPerDay: 700, tokensPerMonth: null },
      new Date(2026, 9, 15, 0, 1).getTime()
    )
    expect(tomorrow.day).toMatchObject({ used: 0, reached: false })
    expect(tomorrow.month).toMatchObject({ limit: null, reached: false })
  })

  it('keeps only whole limits above zero', () => {
    expect(normalizeAgentLimits({ tokensPerDay: '2500.9', tokensPerMonth: 0 })).toEqual({
      tokensPerDay: 2500,
      tokensPerMonth: null
    })
    expect(normalizeAgentLimits(undefined)).toEqual({ tokensPerDay: null, tokensPerMonth: null })
  })
})
