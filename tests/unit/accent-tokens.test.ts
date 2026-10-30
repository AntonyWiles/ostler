import { describe, expect, it } from 'vitest'
import { WINDOW_BACKGROUND, normalizeAccentColor } from '../../src/shared/ostler-api'
import { accentTokens, contrastRatio } from '../../src/renderer/ui/theme/accent'

describe('accentTokens', () => {
  it('keeps an accent that already passes', () => {
    expect(accentTokens('#2563EB', 'light')?.accent).toBe('#2563EB')
  })

  it('darkens a light accent until white text on it reaches 4.5:1', () => {
    const tokens = accentTokens('#60A5FA', 'light')

    expect(tokens).not.toBeNull()
    expect(tokens!.accent).not.toBe('#60A5FA')
    expect(contrastRatio('#FFFFFF', tokens!.accent)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#FFFFFF', tokens!.accentHover)).toBeGreaterThanOrEqual(4.5)
  })

  it('lightens a near-black accent in the dark theme so it stands out from the page', () => {
    const tokens = accentTokens('#141A33', 'dark')

    expect(tokens).not.toBeNull()
    expect(contrastRatio(tokens!.accent, WINDOW_BACKGROUND.dark)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio('#FFFFFF', tokens!.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('falls back to the Ostler accent when the colour cannot be made readable', () => {
    expect(accentTokens('#FFFF99', 'light')).toBeNull()
    expect(accentTokens('#FFFF99', 'dark')).toBeNull()
  })

  it('falls back when there is no usable colour', () => {
    expect(accentTokens(null, 'light')).toBeNull()
    expect(accentTokens('not a colour', 'dark')).toBeNull()
  })

  it('gives the same result for the same input', () => {
    expect(accentTokens('#E3008C', 'dark')).toEqual(accentTokens('#E3008C', 'dark'))
    expect(accentTokens('#60A5FA', 'light')).toEqual(accentTokens('#60A5FA', 'light'))
  })
})

describe('normalizeAccentColor', () => {
  it('drops the alpha from Windows RRGGBBAA', () => {
    expect(normalizeAccentColor('0078d4ff')).toBe('#0078D4')
  })

  it('rejects anything else', () => {
    expect(normalizeAccentColor('blue')).toBeNull()
    expect(normalizeAccentColor(undefined)).toBeNull()
  })
})
