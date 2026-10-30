import { describe, expect, it } from 'vitest'
import {
  currencyDigits,
  defaultCurrency,
  formatMoney,
  isCurrencyCode,
  moneyInputText,
  moneyPlainText,
  parseCostFields,
  parseMoney,
  sortCosts,
  summarizeCosts,
  type Cost
} from '../../src/shared/money'
import { costsToCsv } from '../../src/shared/export/costs-csv'

function cost(partial: Partial<Cost>): Cost {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    projectId: 'p1',
    date: '2026-11-01',
    amount: 0,
    description: 'Thing',
    category: '',
    workItemId: null,
    milestoneId: null,
    state: 'planned',
    createdAt: 1,
    updatedAt: 1,
    ...partial
  }
}

describe('money in minor units (N6.3a)', () => {
  it('adds up exactly, with no floating-point drift', () => {
    // 0.1 + 0.2 in pounds is 10 + 20 pence: exactly 30.
    const costs = Array.from({ length: 1000 }, () => cost({ amount: 10, state: 'paid' }))
    costs.push(cost({ amount: 20 }))
    const summary = summarizeCosts(costs, 10_000, 'GBP')
    expect(summary.paid).toBe(10_000)
    expect(summary.planned).toBe(20)
    expect(summary.total).toBe(10_020)
    expect(summary.left).toBe(-20)
    expect(summary.over).toBe(20)
    expect(moneyPlainText(summary.total, 'GBP')).toBe('100.20')
  })

  it('sums overall, by category and by milestone', () => {
    const summary = summarizeCosts(
      [
        cost({ amount: 5000, category: 'Venue', state: 'paid', milestoneId: 'm1' }),
        cost({ amount: 2500, category: 'Venue', milestoneId: 'm1' }),
        cost({ amount: 1200, category: 'Food', milestoneId: 'm2' }),
        cost({ amount: 300, category: '' })
      ],
      20_000,
      'GBP'
    )
    expect(summary).toMatchObject({
      budget: 20_000,
      paid: 5000,
      planned: 4000,
      total: 9000,
      left: 11_000,
      over: 0,
      count: 4
    })
    expect(summary.byCategory).toEqual([
      { category: 'Venue', paid: 5000, planned: 2500, total: 7500 },
      { category: 'Food', paid: 0, planned: 1200, total: 1200 },
      { category: '', paid: 0, planned: 300, total: 300 }
    ])
    expect(summary.byMilestone).toEqual({
      m1: { paid: 5000, planned: 2500, total: 7500 },
      m2: { paid: 0, planned: 1200, total: 1200 }
    })
  })

  it('has no left or over without a budget', () => {
    const summary = summarizeCosts([cost({ amount: 100 })], null, 'EUR')
    expect(summary.left).toBeNull()
    expect(summary.over).toBe(0)
  })

  it('knows a currency with no decimals (JPY) and one with three (KWD)', () => {
    expect(currencyDigits('GBP')).toBe(2)
    expect(currencyDigits('JPY')).toBe(0)
    expect(currencyDigits('KWD')).toBe(3)
    expect(moneyPlainText(1500, 'JPY')).toBe('1500')
    expect(moneyPlainText(1500, 'KWD')).toBe('1.500')
    expect(moneyPlainText(5, 'KWD')).toBe('0.005')
    expect(parseMoney('1500', 'JPY', 'ja-JP')).toBe(1500)
    expect(parseMoney('1500.5', 'JPY', 'en-US')).toBeNull()
    expect(parseMoney('1.250', 'KWD', 'en-US')).toBe(1250)
    expect(parseMoney('1.2505', 'KWD', 'en-US')).toBeNull()
    expect(formatMoney(1500, 'JPY')).toMatch(/1,?500/)
    expect(formatMoney(1250, 'KWD')).toMatch(/1\.250/)
  })

  it("reads amounts with the person's own separators", () => {
    expect(parseMoney('1.234,50', 'EUR', 'de-DE')).toBe(123_450)
    expect(parseMoney('1 234,50 €', 'EUR', 'fr-FR')).toBe(123_450)
    expect(parseMoney('1,234.50', 'GBP', 'en-GB')).toBe(123_450)
    expect(parseMoney('£12.5', 'GBP', 'en-GB')).toBe(1250)
    expect(parseMoney('12', 'GBP', 'en-GB')).toBe(1200)
    expect(parseMoney(',5', 'EUR', 'de-DE')).toBe(50)
    expect(parseMoney('', 'GBP', 'en-GB')).toBeNull()
    expect(parseMoney('abc', 'GBP', 'en-GB')).toBeNull()
    expect(parseMoney('-5', 'GBP', 'en-GB')).toBeNull()
    expect(parseMoney('1,2,3.4.5', 'GBP', 'en-GB')).toBeNull()
    expect(moneyInputText(123_450, 'EUR', 'de-DE')).toBe('1234,50')
    expect(moneyInputText(123_450, 'GBP', 'en-GB')).toBe('1234.50')
  })

  it("defaults to the region's currency", () => {
    expect(defaultCurrency('en-GB')).toBe('GBP')
    expect(defaultCurrency('de-DE')).toBe('EUR')
    expect(defaultCurrency('ja-JP')).toBe('JPY')
    expect(defaultCurrency('en-US')).toBe('USD')
    expect(isCurrencyCode('KWD')).toBe(true)
    expect(isCurrencyCode('gbp')).toBe(false)
    expect(isCurrencyCode('XX')).toBe(false)
  })

  it('checks a cost’s fields', () => {
    expect(
      parseCostFields({ date: '2026-11-01', amount: 100, description: ' Hire ' }, false)
    ).toEqual({ date: '2026-11-01', amount: 100, description: 'Hire', state: 'planned' })
    expect(() =>
      parseCostFields({ date: '2026-11-01', amount: 1.5, description: 'x' }, false)
    ).toThrow(/whole number/)
    expect(() => parseCostFields({ amount: -1 }, true)).toThrow(/whole number/)
    expect(() => parseCostFields({ description: 'x'.repeat(201) }, true)).toThrow(/200/)
    expect(() => parseCostFields({ state: 'owed' }, true)).toThrow(/planned or paid/)
    expect(() => parseCostFields({ colour: 'red' }, true)).toThrow(/no field/)
  })

  it('sorts by date, then the order they were made', () => {
    const sorted = sortCosts([
      cost({ id: 'b', date: '2026-11-02', createdAt: 1 }),
      cost({ id: 'c', date: '2026-11-01', createdAt: 2 }),
      cost({ id: 'a', date: '2026-11-01', createdAt: 1 })
    ])
    expect(sorted.map((entry) => entry.id)).toEqual(['a', 'c', 'b'])
  })
})

describe('costs as CSV (N6.3a)', () => {
  it('writes a BOM, CRLF, quoted fields and a plain amount with the currency', () => {
    const text = costsToCsv(
      [
        cost({
          date: '2026-11-01',
          description: 'Venue, deposit',
          category: 'Venue',
          workItemId: 't1',
          milestoneId: 'm1',
          state: 'paid',
          amount: 123_450
        }),
        cost({ date: '2026-11-02', description: 'Say "cheese"', amount: 5 })
      ],
      {
        currency: 'GBP',
        taskTitle: (id) => (id === 't1' ? 'Book the hall' : null),
        milestoneName: (id) => (id === 'm1' ? 'Wedding' : null)
      }
    )
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text.slice(1).split('\r\n')).toEqual([
      'Date,Description,Category,Task,Milestone,State,Amount,Currency',
      '2026-11-01,"Venue, deposit",Venue,Book the hall,Wedding,Paid,1234.50,GBP',
      '2026-11-02,"Say ""cheese""",,,,Planned,0.05,GBP',
      ''
    ])
  })
})
