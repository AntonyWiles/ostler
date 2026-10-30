import { formatLocale } from './i18n'
import { numberFormat } from './format'
import { isIsoDate } from './dates'

/**
 * Budgets and costs (N6.3a, N46): the one set of money rules for main, the
 * automation API and every screen. Amounts are whole minor units (pence,
 * cents, yen, fils), so every sum is exact; a currency's decimal places come
 * from `Intl.NumberFormat`. Every amount is in the project's one currency:
 * Ostler never converts.
 */

/** Common ISO 4217 codes, offered in the currency picker. */
export const CURRENCIES = [
  'AED',
  'AUD',
  'BHD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'KWD',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SAR',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'TWD',
  'USD',
  'ZAR'
] as const

export type CurrencyCode = string

export const COST_STATES = ['planned', 'paid'] as const
export type CostState = (typeof COST_STATES)[number]

export const MAX_COST_DESCRIPTION = 200
export const MAX_COST_CATEGORY = 60
/** The largest amount, in minor units: far beyond any project, well inside exact integers. */
export const MAX_MINOR_UNITS = 1_000_000_000_000

/** A project's budget: an amount in minor units, or none, and its currency. */
export interface ProjectBudget {
  projectId: string
  amount: number | null
  currency: CurrencyCode
}

export interface Cost {
  id: string
  projectId: string
  /** `YYYY-MM-DD`: when it was or will be paid. */
  date: string
  /** Whole minor units, never negative. */
  amount: number
  description: string
  /** Free text; empty is "No category". */
  category: string
  workItemId: string | null
  milestoneId: string | null
  state: CostState
  createdAt: number
  updatedAt: number
  /**
   * The shopping item this paid cost records (N6.3b), only on what `delete`
   * returns, so Undo can tick the item again.
   */
  shoppingItemId?: string | null
}

export interface CostInput {
  date?: string
  amount?: number
  description?: string
  category?: string
  workItemId?: string | null
  milestoneId?: string | null
  state?: CostState
}

/** The Costs view's and `GET /costs`' filters. */
export interface CostQuery {
  category?: string
  state?: CostState
  workItemId?: string
  milestoneId?: string
}

export interface MoneyTotals {
  paid: number
  planned: number
  /** Paid plus planned. */
  total: number
}

export interface MoneySummary extends MoneyTotals {
  currency: CurrencyCode
  budget: number | null
  /** Budget minus total; null without a budget. Negative is over budget. */
  left: number | null
  /** How far over budget, or 0. */
  over: number
  /** By category, largest total first; '' is no category. */
  byCategory: Array<MoneyTotals & { category: string }>
  /** By milestone id. */
  byMilestone: Record<string, MoneyTotals>
  count: number
  /**
   * The shopping list's unbought estimates (N6.3b), apart from planned costs
   * so nothing is counted twice: not in total, left or over.
   */
  stillToBuy: number
}

/** The amount's currency is a three-letter code `Intl` knows. */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) return false
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: value })
    return true
  } catch {
    return false
  }
}

/** A currency's decimal places: 2 for GBP, 0 for JPY, 3 for KWD. */
export function currencyDigits(currency: CurrencyCode): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  )
}

const REGION_CURRENCY: Record<string, CurrencyCode> = {
  AE: 'AED',
  AU: 'AUD',
  BH: 'BHD',
  BR: 'BRL',
  CA: 'CAD',
  CH: 'CHF',
  LI: 'CHF',
  CN: 'CNY',
  CZ: 'CZK',
  DK: 'DKK',
  GB: 'GBP',
  HK: 'HKD',
  HU: 'HUF',
  ID: 'IDR',
  IL: 'ILS',
  IN: 'INR',
  IS: 'ISK',
  JP: 'JPY',
  KR: 'KRW',
  KW: 'KWD',
  MX: 'MXN',
  MY: 'MYR',
  NO: 'NOK',
  NZ: 'NZD',
  PH: 'PHP',
  PL: 'PLN',
  RO: 'RON',
  SA: 'SAR',
  SE: 'SEK',
  SG: 'SGD',
  TH: 'THB',
  TR: 'TRY',
  TW: 'TWD',
  US: 'USD',
  ZA: 'ZAR'
}

const EURO_REGIONS = new Set(
  'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' ')
)

/** The currency of a locale's region ("en-GB" is GBP, "de-DE" is EUR); USD when unknown. */
export function defaultCurrency(locale: string = formatLocale()): CurrencyCode {
  let region: string | undefined
  try {
    region = new Intl.Locale(locale).maximize().region
  } catch {
    region = undefined
  }
  if (!region) return 'USD'
  if (EURO_REGIONS.has(region)) return 'EUR'
  return REGION_CURRENCY[region] ?? 'USD'
}

/** Minor units as a decimal string with a dot: 12345 GBP is "123.45", 500 JPY is "500". */
export function moneyPlainText(minor: number, currency: CurrencyCode): string {
  const digits = currencyDigits(currency)
  const sign = minor < 0 ? '-' : ''
  const text = String(Math.abs(minor)).padStart(digits + 1, '0')
  if (digits === 0) return `${sign}${text}`
  return `${sign}${text.slice(0, -digits)}.${text.slice(-digits)}`
}

/** "£1,234.50", "1.234,50 €", "¥500", in the active locale. */
export function formatMoney(minor: number, currency: CurrencyCode): string {
  const digits = currencyDigits(currency)
  // Through the exact decimal text, so a large amount never picks up float noise.
  return numberFormat({
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number(moneyPlainText(minor, currency)))
}

/** The locale's decimal and grouping separators. */
function separators(locale: string): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5)
  return {
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    group: parts.find((part) => part.type === 'group')?.value ?? ','
  }
}

/**
 * An amount as typed, read with the person's own separators ("1.234,50" in
 * Germany, "1,234.50" in Britain), into minor units. A currency symbol or
 * code around it is ignored. Null when it is not an amount, is negative, or
 * has more decimals than the currency.
 */
export function parseMoney(
  text: string,
  currency: CurrencyCode,
  locale: string = formatLocale()
): number | null {
  const digits = currencyDigits(currency)
  const { decimal, group } = separators(locale)
  // `\s` covers the no-break spaces some regions group digits with.
  let value = text.replace(/\s/g, '').replace(/[^\d.,'’-]/g, '')
  if (!value || value.includes('-')) return null
  // A separator that is not the decimal one only groups digits.
  for (const mark of [group, "'", '’', decimal === ',' ? '.' : ',']) {
    if (mark && mark !== decimal) value = value.split(mark).join('')
  }
  const [whole, fraction = '', extra] = value.split(decimal)
  if (extra !== undefined || !/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null
  if (!whole && !fraction) return null
  if (fraction.length > digits) return null
  const minor = Number(`${whole || '0'}${fraction.padEnd(digits, '0')}`)
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR_UNITS) return null
  return minor
}

/** Minor units as the person would type them back: "1234.50" or "1234,50", no grouping. */
export function moneyInputText(minor: number, currency: CurrencyCode, locale = formatLocale()) {
  const text = moneyPlainText(minor, currency)
  return separators(locale).decimal === ',' ? text.replace('.', ',') : text
}

function emptyTotals(): MoneyTotals {
  return { paid: 0, planned: 0, total: 0 }
}

function add(totals: MoneyTotals, state: CostState, amount: number): void {
  totals[state] += amount
  totals.total += amount
}

/**
 * Budget, paid, planned, total and left (or over), overall, by category and
 * by milestone. Integer arithmetic only: minor units in, minor units out.
 */
export function summarizeCosts(
  costs: ReadonlyArray<Pick<Cost, 'amount' | 'state' | 'category' | 'milestoneId'>>,
  budget: number | null,
  currency: CurrencyCode
): MoneySummary {
  const overall = emptyTotals()
  const categories = new Map<string, MoneyTotals>()
  const byMilestone: Record<string, MoneyTotals> = {}
  for (const cost of costs) {
    add(overall, cost.state, cost.amount)
    const category = categories.get(cost.category) ?? emptyTotals()
    add(category, cost.state, cost.amount)
    categories.set(cost.category, category)
    if (cost.milestoneId) {
      byMilestone[cost.milestoneId] ??= emptyTotals()
      add(byMilestone[cost.milestoneId], cost.state, cost.amount)
    }
  }
  const left = budget === null ? null : budget - overall.total
  return {
    ...overall,
    currency,
    budget,
    left,
    over: left !== null && left < 0 ? -left : 0,
    byCategory: [...categories.entries()]
      .map(([category, totals]) => ({ category, ...totals }))
      .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category)),
    byMilestone,
    count: costs.length,
    stillToBuy: 0
  }
}

/** Costs in date order, then the order they were made. */
export function sortCosts<T extends Pick<Cost, 'date' | 'createdAt' | 'id'>>(costs: T[]): T[] {
  return [...costs].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  )
}

/** The fields of a cost, checked: an English message for anything wrong (the API's 400). */
export function parseCostFields(input: unknown, partial: boolean): CostInput {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('A cost must be an object')
  const value = input as Record<string, unknown>
  const known = ['date', 'amount', 'description', 'category', 'workItemId', 'milestoneId', 'state']
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) throw new Error(`A cost has no field ${key}`)
  }
  const out: CostInput = {}
  if (value.date !== undefined || !partial) {
    if (!isIsoDate(value.date)) throw new Error('date must be a date, YYYY-MM-DD')
    out.date = value.date
  }
  if (value.amount !== undefined || !partial) {
    const amount = value.amount
    if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > MAX_MINOR_UNITS
    )
      throw new Error('amount must be a whole number of minor units (pence, cents), 0 or more')
    out.amount = amount
  }
  if (value.description !== undefined || !partial) {
    if (typeof value.description !== 'string' || !value.description.trim())
      throw new Error('description must be some text')
    const description = value.description.trim()
    if (description.length > MAX_COST_DESCRIPTION)
      throw new Error(`description must be at most ${MAX_COST_DESCRIPTION} characters`)
    out.description = description
  }
  if (value.category !== undefined && value.category !== null) {
    if (typeof value.category !== 'string') throw new Error('category must be text')
    const category = value.category.trim()
    if (category.length > MAX_COST_CATEGORY)
      throw new Error(`category must be at most ${MAX_COST_CATEGORY} characters`)
    out.category = category
  } else if (value.category === null) out.category = ''
  for (const key of ['workItemId', 'milestoneId'] as const) {
    const id = value[key]
    if (id === undefined) continue
    if (id !== null && (typeof id !== 'string' || !id))
      throw new Error(`${key} must be an id or null`)
    out[key] = id as string | null
  }
  if (value.state !== undefined || !partial) {
    const state = value.state ?? 'planned'
    if (!COST_STATES.includes(state as CostState)) throw new Error('state must be planned or paid')
    out.state = state as CostState
  }
  return out
}
