import { WINDOW_BACKGROUND, type ResolvedTheme } from '@shared/ostler-api'

/**
 * Windows' accent colour, made safe to use as the Ostler accent (P2.1).
 *
 * The accent is a fill with white text on it, so white must reach 4.5:1
 * (WCAG AA). In the dark theme the fill must also stand out from the page
 * (3:1 against --color-bg). The colour is darkened or lightened in small
 * steps until both hold. A colour that would need to move further than
 * MAX_LIGHTNESS_SHIFT is no longer recognisably the user's colour, so it falls
 * back to the Ostler accent (null).
 */

export interface AccentTokens {
  accent: string
  accentHover: string
}

const STEP = 0.01
const MAX_LIGHTNESS_SHIFT = 0.4
const HOVER_DARKEN = 0.06
const WHITE_TEXT_CONTRAST = 4.5
const FILL_CONTRAST = 3

interface Rgb {
  r: number
  g: number
  b: number
}

function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = parseInt(match[1], 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function channelLuminance(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) throw new Error(`Not a #RRGGBB colour: ${hex}`)
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  )
}

/** WCAG contrast ratio between two `#RRGGBB` colours. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

interface Hsl {
  h: number
  s: number
  l: number
}

function toHsl({ r, g, b }: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4
  return { h: h / 6, s, l }
}

function hueToChannel(p: number, q: number, t: number): number {
  const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t
  if (tt < 1 / 6) return p + (q - p) * 6 * tt
  if (tt < 1 / 2) return q
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
  return p
}

function fromHsl({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToChannel(p, q, h) * 255),
    b: Math.round(hueToChannel(p, q, h - 1 / 3) * 255)
  }
}

function withLightness(hsl: Hsl, l: number): string {
  return toHex(fromHsl({ ...hsl, l: Math.min(1, Math.max(0, l)) }))
}

function usable(color: string, theme: ResolvedTheme): boolean {
  if (contrastRatio('#FFFFFF', color) < WHITE_TEXT_CONTRAST) return false
  return theme === 'light' || contrastRatio(color, WINDOW_BACKGROUND.dark) >= FILL_CONTRAST
}

/**
 * The accent tokens for `hex` in `theme`, or null to keep the Ostler accent.
 * Pure: the same input always gives the same result.
 */
export function accentTokens(hex: string | null, theme: ResolvedTheme): AccentTokens | null {
  const rgb = hex ? parseHex(hex) : null
  if (!rgb) return null
  const hsl = toHsl(rgb)
  const steps = Math.round(MAX_LIGHTNESS_SHIFT / STEP)
  for (let step = 0; step <= steps; step++) {
    const shift = step * STEP
    for (const l of step === 0 ? [hsl.l] : [hsl.l - shift, hsl.l + shift]) {
      if (l < 0 || l > 1) continue
      const accent = withLightness(hsl, l)
      if (usable(accent, theme)) {
        return { accent, accentHover: withLightness(hsl, l - HOVER_DARKEN) }
      }
    }
  }
  return null
}
