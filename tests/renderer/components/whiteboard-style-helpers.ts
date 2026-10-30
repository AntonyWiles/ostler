import { fireEvent, screen, within } from '@testing-library/react'

/**
 * Driving the whiteboard's property bar (PropertyBar.tsx) in tests: its
 * controls are fixed in the top bar, each a button named for what it sets
 * ("Text size: Medium") that opens a menu of options, or for Colour a panel
 * of swatches.
 */

export const styleBar = () => screen.getByRole('toolbar', { name: 'Style' })

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The control named `label` ("Text size", "Colour", "Dashed"), whatever it shows now. */
export const styleControl = (label: string) =>
  within(styleBar()).getByRole('button', { name: new RegExp(`^${escape(label)}(: |$)`) })

/** True when the control applies to what is selected (or to the chosen tool). */
export const isOffered = (label: string) =>
  styleControl(label).getAttribute('aria-disabled') !== 'true'

/** The option the control shows as chosen, or null when nothing is shared. */
export const chosenOption = (label: string) => {
  const name = styleControl(label).getAttribute('aria-label') ?? ''
  return name.startsWith(`${label}: `) ? name.slice(label.length + 2) : null
}

/** Opens the control's menu and picks `option`. */
export function pickStyle(label: string, option: string) {
  fireEvent.click(styleControl(label))
  fireEvent.click(screen.getByRole('menuitemradio', { name: option }))
}

/** Opens the colour's swatches and picks the colour named `name`. */
export function pickColour(name: string) {
  fireEvent.click(styleControl('Colour'))
  const panel = screen.getByRole('dialog', { name: 'Colour' })
  fireEvent.click(within(panel).getByRole('button', { name }))
}
