import { afterEach, describe, expect, it } from 'vitest'
import { localizeDemoMoney } from '../../src/shared/demo-money'
import { applyLocale, SOURCE_LANGUAGE } from '../../src/shared/i18n'
import { defaultCurrency } from '../../src/shared/money'
import { MAX_MEASURE_UNIT_LENGTH } from '../../src/shared/goal-measures'
import { BUILT_IN_TEMPLATES, DEMO_SOURCES } from '../../src/shared/templates'
import { TEMPLATE_TEXT, translateTemplate } from '../../src/shared/templates/template-text'
import { ADVANCED_DEMO_TEMPLATE_ID, SAMPLE_TEMPLATE_ID } from '../../src/shared/ostler-api'

const demo = {
  budget: { amount: 12000 },
  billingSettings: { hourlyRate: 45, newTimeBillable: true },
  billings: [{ ref: 'b1', hourlyRate: 45, amount: 832.5 }],
  costs: [{ amount: 64 }, { amount: 832.5 }],
  shopping: [
    { name: 'Lemonade', quantity: 3, estimate: 4.5 },
    { name: 'Plates', quantity: 1 }
  ],
  decisions: [{ consequences: 'Saves {{money:400}} for the lights.' }],
  goals: [{ measure: { unit: '{{currency}} in the pot' } }]
}

describe('localizeDemoMoney', () => {
  afterEach(() => applyLocale({ language: SOURCE_LANGUAGE, formatLocale: SOURCE_LANGUAGE }))

  it('turns major units into minor units of the currency, and fills it in', () => {
    const pkg = localizeDemoMoney(demo, 'GBP')
    expect(pkg.budget).toEqual({ amount: 1_200_000, currency: 'GBP' })
    expect(pkg.billingSettings).toEqual({ hourlyRate: 4500, newTimeBillable: true })
    expect(pkg.billings).toEqual([{ ref: 'b1', hourlyRate: 4500, amount: 83_250, currency: 'GBP' }])
    expect(pkg.costs).toEqual([{ amount: 6400 }, { amount: 83_250 }])
    expect(pkg.shopping).toEqual([
      { name: 'Lemonade', quantity: 3, estimate: 450 },
      { name: 'Plates', quantity: 1 }
    ])
  })

  it('scales by the currency’s decimal places', () => {
    expect(localizeDemoMoney(demo, 'JPY').costs).toEqual([{ amount: 64 }, { amount: 833 }])
    expect(localizeDemoMoney(demo, 'KWD').budget).toEqual({ amount: 12_000_000, currency: 'KWD' })
  })

  it('writes amounts in prose in the currency', () => {
    const text = (currency: string) =>
      (localizeDemoMoney(demo, currency).decisions as { consequences: string }[])[0].consequences
    expect(text('GBP')).toBe('Saves £400 for the lights.')
    expect(text('JPY')).toMatch(/^Saves (JP)?¥400 for the lights.$/)
  })

  it('reads both demos in the user’s currency, with no placeholder left', () => {
    for (const id of [SAMPLE_TEMPLATE_ID, ADVANCED_DEMO_TEMPLATE_ID]) {
      const json = BUILT_IN_TEMPLATES.find((entry) => entry.id === id)!.json as {
        budget: { currency: string }
      }
      expect(json.budget.currency, id).toBe(defaultCurrency())
      expect(JSON.stringify(json), id).not.toContain('{{money:')
    }
  })

  it('names the currency by its symbol', () => {
    const unit = (currency: string) =>
      (localizeDemoMoney(demo, currency).goals as { measure: { unit: string } }[])[0].measure.unit
    expect(unit('GBP')).toBe('£ in the pot')
    expect(unit('EUR')).toBe('€ in the pot')
    expect(unit('USD')).toBe('$ in the pot')
    expect(unit('CHF')).toBe('CHF in the pot')
  })

  // A narrow symbol can be four characters ("FCFA"), and differs by locale.
  it('keeps the weekend demo’s goal unit within its limit in every language and currency', () => {
    for (const language of [SOURCE_LANGUAGE, ...Object.keys(TEMPLATE_TEXT)]) {
      applyLocale({ language, formatLocale: language })
      const json = translateTemplate(DEMO_SOURCES.simple, language)
      for (const currency of Intl.supportedValuesOf('currency')) {
        const goals = localizeDemoMoney(json, currency).goals as { measure: { unit: string } }[]
        const unit = goals[0].measure.unit
        expect(unit.length, `${language} ${currency}: ${unit}`).toBeLessThanOrEqual(
          MAX_MEASURE_UNIT_LENGTH
        )
      }
    }
  })
})
