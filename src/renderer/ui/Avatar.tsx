import { initialsFromName } from '@shared/people'
import { cx } from './cx'
import { relativeLuminance } from './theme/accent'
import './Avatar.css'

export interface AvatarProps {
  /** The person's (or agent's) name: the initials and the accessible name. */
  name: string
  /** Any CSS colour. Defaults to one of the chart tokens, picked from the name. */
  color?: string
  /** Initials to show instead of the ones from the name (a person's own). */
  initials?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const PALETTE_SIZE = 6

/** Up to two initials: "Ada Lovelace" → "AL", "ostler" → "N". */
export const initials = initialsFromName

/** A stable palette slot for a name, so a person keeps their colour. */
export function paletteIndex(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return (hash % PALETTE_SIZE) + 1
}

/**
 * Above this luminance black initials contrast more than white ones; below it,
 * white. With pure black and white, the better of the two reaches 4.58:1 on
 * any colour, so a person's colour never makes their initials unreadable.
 */
const DARK_INK_ABOVE = 0.179

/** Which ink a `#rrggbb` colour needs; null for a token, which brings its own. */
export function avatarInk(color: string | undefined): 'light' | 'dark' | null {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return null
  return relativeLuminance(color) > DARK_INK_ABOVE ? 'dark' : 'light'
}

/** Initials on a colour. */
export function Avatar({ name, color, initials: shown, size = 'md', className }: AvatarProps) {
  const ink = avatarInk(color)
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cx('ui-avatar', `ui-avatar--${size}`, ink && `ui-avatar--ink-${ink}`, className)}
      style={{ background: color ?? `var(--chart-${paletteIndex(name)})` }}
    >
      <span aria-hidden="true">{shown || initials(name)}</span>
    </span>
  )
}
