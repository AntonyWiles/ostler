import { formatLocale, t } from './i18n'
import { MAX_MINOR_UNITS, parseMoney, type CurrencyCode } from './money'

/**
 * The shopping list (N6.3b, N46): what a project needs bought, from whom and
 * for which task. The one set of rules for main, the automation API and
 * every screen. A bought item points at the paid cost it made: the cost is
 * the record of the purchase, so its date and amount are the item's "bought
 * on" and "price paid", never a second copy.
 */

export const MAX_SHOPPING_NAME = 200
export const MAX_SHOPPING_UNIT = 20
export const MAX_SHOPPING_QUANTITY = 1_000_000

export interface ShoppingItem {
  id: string
  projectId: string
  /** At most 200 characters. */
  name: string
  /** More than 0; may have decimals (2.5 m). */
  quantity: number
  /** Free text such as "m" or "packs"; empty for none. */
  unit: string
  /** The estimated price of the whole line, in minor units, or none. */
  estimate: number | null
  /** The supplier, a contact (N6.5), or none. */
  contactId: string | null
  /** The supplier's name, read in the same query as the list. */
  supplierName: string | null
  workItemId: string | null
  orderKey: string
  /** The paid cost buying it made; null while it is still to buy. */
  costId: string | null
  /** The cost's date (`YYYY-MM-DD`), when bought. */
  boughtOn: string | null
  /** The cost's amount in minor units, when bought. */
  pricePaid: number | null
  createdAt: number
  updatedAt: number
}

export interface ShoppingInput {
  name?: string
  quantity?: number
  unit?: string
  estimate?: number | null
  contactId?: string | null
  workItemId?: string | null
  /** Moves the item to just after this one; null puts it first. */
  afterId?: string | null
  /** Moves the item to just before this one. */
  beforeId?: string
}

/** Ticking an item as bought: the price paid (minor units) and the day. */
export interface ShoppingBuyInput {
  pricePaid: number
  date: string
}

/** The fields of a shopping item, checked: an English message for anything wrong (the API's 400). */
export function parseShoppingFields(input: unknown, partial: boolean): ShoppingInput {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('A shopping item must be an object')
  const value = input as Record<string, unknown>
  const known = [
    'name',
    'quantity',
    'unit',
    'estimate',
    'contactId',
    'workItemId',
    'afterId',
    'beforeId'
  ]
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) throw new Error(`A shopping item has no field ${key}`)
  }
  const out: ShoppingInput = {}
  if (value.name !== undefined || !partial) {
    if (typeof value.name !== 'string' || !value.name.trim())
      throw new Error('name must be some text')
    const name = value.name.trim()
    if (name.length > MAX_SHOPPING_NAME)
      throw new Error(`name must be at most ${MAX_SHOPPING_NAME} characters`)
    out.name = name
  }
  if (value.quantity !== undefined) {
    const quantity = value.quantity
    if (
      typeof quantity !== 'number' ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > MAX_SHOPPING_QUANTITY
    )
      throw new Error(`quantity must be a number more than 0, at most ${MAX_SHOPPING_QUANTITY}`)
    out.quantity = quantity
  }
  if (value.unit !== undefined && value.unit !== null) {
    if (typeof value.unit !== 'string') throw new Error('unit must be text')
    const unit = value.unit.trim()
    if (unit.length > MAX_SHOPPING_UNIT)
      throw new Error(`unit must be at most ${MAX_SHOPPING_UNIT} characters`)
    out.unit = unit
  } else if (value.unit === null) out.unit = ''
  if (value.estimate !== undefined) {
    const estimate = value.estimate
    if (
      estimate !== null &&
      (typeof estimate !== 'number' ||
        !Number.isSafeInteger(estimate) ||
        estimate < 0 ||
        estimate > MAX_MINOR_UNITS)
    )
      throw new Error('estimate must be a whole number of minor units (pence, cents), or null')
    out.estimate = estimate as number | null
  }
  for (const key of ['contactId', 'workItemId', 'afterId'] as const) {
    const id = value[key]
    if (id === undefined) continue
    if (id !== null && (typeof id !== 'string' || !id))
      throw new Error(`${key} must be an id or null`)
    out[key] = id as string | null
  }
  if (value.beforeId !== undefined) {
    if (typeof value.beforeId !== 'string' || !value.beforeId)
      throw new Error('beforeId must be an id')
    out.beforeId = value.beforeId
  }
  if (out.afterId !== undefined && out.beforeId !== undefined)
    throw new Error('Give afterId or beforeId, not both')
  return out
}

/** What is still to buy, estimated: the unbought items' estimates. Never a bought item's price. */
export function stillToBuy(
  items: ReadonlyArray<Pick<ShoppingItem, 'estimate' | 'costId'>>
): number {
  return items.reduce((sum, item) => sum + (item.costId === null ? (item.estimate ?? 0) : 0), 0)
}

export interface ShoppingGroup {
  /** The supplier's contact id; null is "No supplier". */
  contactId: string | null
  name: string | null
  items: ShoppingItem[]
}

/** Items grouped by supplier, by name, with "No supplier" last; each group keeps the list's order. */
export function groupBySupplier(items: readonly ShoppingItem[]): ShoppingGroup[] {
  const groups = new Map<string | null, ShoppingGroup>()
  for (const item of items) {
    const group = groups.get(item.contactId) ?? {
      contactId: item.contactId,
      name: item.supplierName,
      items: []
    }
    group.items.push(item)
    groups.set(item.contactId, group)
  }
  return [...groups.values()].sort((a, b) => {
    if (a.contactId === null) return 1
    if (b.contactId === null) return -1
    return (a.name ?? '').localeCompare(b.name ?? '')
  })
}

/** A line as typed: "3 packs wall plugs £4.50". */
export interface ShoppingLine {
  name: string
  quantity: number
  unit: string
  estimate: number | null
}

/** The units the single-line entry recognises, from the locale ("m, cm, packs, …"). */
export function lineUnits(): Set<string> {
  return new Set(
    t('projects:shopping.lineUnits')
      .split(',')
      .map((unit) => unit.trim().toLowerCase())
      .filter(Boolean)
  )
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The ways a currency is written in this locale: "£", "US$", "$", "GBP". */
function currencyMarks(currency: CurrencyCode, locale: string): string[] {
  const marks = new Set<string>([currency])
  for (const tag of [locale, 'en']) {
    for (const display of ['symbol', 'narrowSymbol'] as const) {
      try {
        const part = new Intl.NumberFormat(tag, {
          style: 'currency',
          currency,
          currencyDisplay: display
        })
          .formatToParts(1)
          .find((entry) => entry.type === 'currency')?.value
        if (part) marks.add(part)
      } catch {
        // An old engine without narrowSymbol: the other marks still work.
      }
    }
  }
  return [...marks].sort((a, b) => b.length - a.length)
}

const NUMBER = String.raw`\d(?:[\d.,'’]*\d)?`

/**
 * A price at the end of the line, written with the project's currency.
 * 'unsure' when the end looks like a price but is not one we can read
 * (another currency, too many decimals).
 */
function trailingPrice(
  line: string,
  currency: CurrencyCode,
  locale: string
): { minor: number; rest: string } | 'unsure' | null {
  const marks = currencyMarks(currency, locale).map(escapeRegExp).join('|')
  const before = new RegExp(String.raw`(?:^|\s)(?:${marks})\s?(${NUMBER})$`, 'u').exec(line)
  const after = new RegExp(String.raw`(?:^|\s)(${NUMBER})\s?(?:${marks})$`, 'u').exec(line)
  const match = before ?? after
  if (!match) {
    if (/(?:\p{Sc}\s?\d[\d.,]*|\d[\d.,]*\s?\p{Sc})$/u.test(line)) return 'unsure'
    return null
  }
  const minor = parseMoney(match[1], currency, locale)
  if (minor === null) return 'unsure'
  return { minor, rest: line.slice(0, match.index).trim() }
}

/** A quantity in the person's number format; null when it uses another one. */
function readQuantity(text: string, locale: string): number | null {
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === 'decimal')
      ?.value ?? '.'
  const other = decimal === ',' ? '.' : ','
  if (text.includes(other)) return null
  const value = Number(text.replace(decimal, '.'))
  return Number.isFinite(value) && value > 0 && value <= MAX_SHOPPING_QUANTITY ? value : null
}

/**
 * Reads a line typed into Add item: a quantity first ("3", "2.5" or "2,5"
 * in the person's own format, "3 x"), then a unit it knows ("packs", "m",
 * "2.5m"), the name, and a price at the end written with the project's
 * currency ("£4.50", "4,50 €"). When any part is unsure, the whole line is
 * the name and the person fills in the rest: it never guesses wildly.
 */
export function readShoppingLine(
  text: string,
  currency: CurrencyCode,
  locale: string = formatLocale(),
  units: Set<string> = lineUnits()
): ShoppingLine {
  const whole = text.replace(/\s+/g, ' ').trim()
  const fallback: ShoppingLine = {
    name: whole.slice(0, MAX_SHOPPING_NAME),
    quantity: 1,
    unit: '',
    estimate: null
  }
  let rest = whole
  let estimate: number | null = null
  const price = trailingPrice(rest, currency, locale)
  if (price === 'unsure') return fallback
  if (price) {
    estimate = price.minor
    rest = price.rest
  }
  let quantity = 1
  let unit = ''
  const lead = /^(\d+(?:[.,]\d+)?)(?:\s?[x×](?=\s))?(\s*)(.*)$/u.exec(rest)
  if (lead && lead[3]) {
    const value = readQuantity(lead[1], locale)
    if (value === null) return fallback
    const glued = lead[2] === ''
    rest = lead[3]
    const word = /^(\S+)\s+(.+)$/u.exec(rest)
    // "3 Packs" is a unit; "3M tape" is a name, so a unit glued on must match exactly.
    if (word && units.has(glued ? word[1] : word[1].toLowerCase())) {
      unit = word[1]
      rest = word[2]
    } else if (glued) return fallback
    quantity = value
  } else if (lead) return fallback
  rest = rest.trim()
  if (!rest || rest.length > MAX_SHOPPING_NAME) return fallback
  return { name: rest, quantity, unit, estimate }
}

/** A quantity for the screen: "3", "2.5" or "2,5", with its unit: "3 packs". */
export function quantityText(item: Pick<ShoppingItem, 'quantity' | 'unit'>): string {
  const number = new Intl.NumberFormat(formatLocale(), { maximumFractionDigits: 3 }).format(
    item.quantity
  )
  return item.unit ? `${number} ${item.unit}` : number
}
