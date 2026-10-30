// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Radio, RadioGroup } from '@renderer/ui'

function Group() {
  return (
    <RadioGroup legend="Theme">
      <Radio name="theme" value="light" label="Light" hint="Bright" />
      <Radio name="theme" value="dark" label="Dark" />
      <Radio name="theme" value="hc" label="High contrast" disabled />
    </RadioGroup>
  )
}

describe('Radio and RadioGroup', () => {
  it('groups radios under a group named by the legend', () => {
    render(<Group />)
    const group = screen.getByRole('group', { name: 'Theme' })
    expect(group.tagName).toBe('FIELDSET')
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAccessibleDescription('Bright')
  })

  it('selects one at a time', () => {
    render(<Group />)
    const light = screen.getByRole('radio', { name: 'Light' })
    const dark = screen.getByRole('radio', { name: 'Dark' })
    fireEvent.click(light)
    expect(light).toBeChecked()
    fireEvent.click(dark)
    expect(dark).toBeChecked()
    expect(light).not.toBeChecked()
  })

  it('can disable one radio', () => {
    render(<Group />)
    const hc = screen.getByRole('radio', { name: 'High contrast' })
    expect(hc).toBeDisabled()
    expect(hc).not.toBeChecked()
  })
})
