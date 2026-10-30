import { i18n, t } from '@shared/i18n'
import { cx } from './cx'
import { VisuallyHidden } from './VisuallyHidden'
import './Kbd.css'

export interface KbdProps {
  /**
   * The shortcut as the registry writes it: keys joined by "+", for example
   * "Ctrl+K" or "Ctrl+Shift+P". (The registry itself arrives with P3.2.)
   */
  shortcut: string
  className?: string
}

/** Splits "Ctrl+Shift+K" into its keys. A lone "+" is the plus key. */
export function shortcutKeys(shortcut: string): string[] {
  if (shortcut === '+') return ['+']
  return shortcut
    .split(/\+(?!$)/)
    .map((key) => key.trim())
    .filter(Boolean)
}

/**
 * A key's name as the keyboard in this language prints it: "Ctrl" is "Strg"
 * on a German keyboard (P11.1). Letters, digits and symbols stay as they are.
 */
export function keyName(key: string): string {
  const id = key.replace(/\s+/g, '')
  return /^[A-Za-z]{2,}$/.test(id) && i18n.exists(`common:keys.${id}`)
    ? t(`common:keys.${id}`)
    : key
}

/** A whole shortcut as text, key names translated: "Ctrl+K", "Strg+K". */
export function shortcutText(shortcut: string): string {
  return shortcut
    .split(/ (then|or) /)
    .map((part, index) =>
      index % 2 === 1 ? t(`common:keys.${part}`) : shortcutKeys(part).map(keyName).join('+')
    )
    .join(' ')
}

/**
 * A keyboard shortcut, one keycap per key. Assistive tech reads it as words
 * ("Ctrl plus K") from hidden text: `kbd` may not carry an aria-label (P9.2).
 */
export function Kbd({ shortcut, className }: KbdProps) {
  const keys = shortcutKeys(shortcut).map(keyName)
  return (
    <kbd className={cx('ui-kbd', className)}>
      <VisuallyHidden>{keys.join(` ${t('common:keys.plus')} `)}</VisuallyHidden>
      {keys.map((key, index) => (
        <kbd key={`${key}-${index}`} className="ui-kbd__key" aria-hidden="true">
          {key}
        </kbd>
      ))}
    </kbd>
  )
}
