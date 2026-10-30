import { numberFormat } from './format'
import { currencyDigits, defaultCurrency, type CurrencyCode } from './money'

/**
 * The demo projects' money is in the user's own currency (`defaultCurrency`),
 * not one fixed when they were written. Their files carry no currency, and
 * every amount is in major units (12000 is twelve thousand, 832.5 is 832.50),
 * so it turns into minor units by the currency's decimal places: 1200000 for
 * GBP, 12000 for JPY, 12000000 for KWD. Nothing is converted: the figures are
 * made up, so £500 becomes €500 or $500. Prose names an amount as
 * `{{money:400}}`, written out in the currency and the locale, and the
 * currency itself as `{{currency}}`, its symbol ("£", "€", "CHF").
 */

const MONEY_IN_TEXT = /\{\{money:(\d+(?:\.\d+)?)\}\}/g
const CURRENCY_IN_TEXT = /\{\{currency\}\}/g

type Json = Record<string, unknown>

/** `entry` with `keys` in minor units; a key it lacks stays out. */
function inMinor(entry: Json, keys: string[], digits: number): Json {
  const out = { ...entry }
  for (const key of keys)
    if (typeof out[key] === 'number') out[key] = Math.round((out[key] as number) * 10 ** digits)
  return out
}

/** "£400", "400 €", "¥400"; a fraction only when the amount has one. */
function moneyText(major: number, currency: CurrencyCode): string {
  const digits = Number.isInteger(major) ? 0 : currencyDigits(currency)
  return numberFormat({
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(major)
}

/** "£", "€", "CHF": the currency's narrow symbol in the locale. */
function currencySymbol(currency: CurrencyCode): string {
  const parts = numberFormat({
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol'
  }).formatToParts(0)
  return parts.find((part) => part.type === 'currency')?.value ?? currency
}

function withMoneyText(value: unknown, currency: CurrencyCode): unknown {
  if (typeof value === 'string')
    return value
      .replace(MONEY_IN_TEXT, (_match, amount: string) => moneyText(Number(amount), currency))
      .replace(CURRENCY_IN_TEXT, () => currencySymbol(currency))
  if (Array.isArray(value)) return value.map((entry) => withMoneyText(entry, currency))
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Json).map(([key, entry]) => [key, withMoneyText(entry, currency)])
    )
  return value
}

/** A demo template's file as a package: its amounts in minor units of `currency`. */
export function localizeDemoMoney(json: Json, currency: CurrencyCode = defaultCurrency()): Json {
  const digits = currencyDigits(currency)
  const pkg = withMoneyText(json, currency) as Json
  const list = (key: string) => (Array.isArray(pkg[key]) ? (pkg[key] as Json[]) : null)
  const budget = pkg.budget as Json | undefined
  const settings = pkg.billingSettings as Json | undefined
  const billings = list('billings')
  const costs = list('costs')
  const shopping = list('shopping')
  return {
    ...pkg,
    ...(budget ? { budget: { ...inMinor(budget, ['amount'], digits), currency } } : {}),
    ...(settings ? { billingSettings: inMinor(settings, ['hourlyRate'], digits) } : {}),
    ...(billings
      ? {
          billings: billings.map((billing) => ({
            ...inMinor(billing, ['hourlyRate', 'amount'], digits),
            currency
          }))
        }
      : {}),
    ...(costs ? { costs: costs.map((cost) => inMinor(cost, ['amount'], digits)) } : {}),
    ...(shopping ? { shopping: shopping.map((item) => inMinor(item, ['estimate'], digits)) } : {})
  }
}
