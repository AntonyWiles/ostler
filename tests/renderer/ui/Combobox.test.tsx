// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Combobox, SuggestField, type ComboboxOption } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'

afterEach(() => __resetDismissableStackForTests())

const OPTIONS: ComboboxOption[] = [
  { value: 'design', label: 'Design' },
  { value: 'bug', label: 'Bug' },
  { value: 'docs', label: 'Documentation' },
  { value: 'legacy', label: 'Legacy', disabled: true },
  { value: 'perf', label: 'Performance' }
]

function Harness({
  onCreate,
  disabled
}: {
  onCreate?: (text: string) => void
  disabled?: boolean
}) {
  const [value, setValue] = useState<string | null>(null)
  return (
    <>
      <Combobox
        label="Label"
        options={OPTIONS}
        value={value}
        onChange={setValue}
        onCreate={onCreate}
        disabled={disabled}
      />
      <output>{value ?? 'none'}</output>
    </>
  )
}

const input = () => screen.getByRole('combobox', { name: 'Label' })
const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent)

describe('Combobox', () => {
  it('is a labelled combobox that opens a listbox', () => {
    render(<Harness />)
    expect(input()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(input()).toHaveAttribute('aria-expanded', 'true')
    const listbox = screen.getByRole('listbox', { name: 'Label' })
    expect(input()).toHaveAttribute('aria-controls', listbox.id)
  })

  it('filters as you type', () => {
    render(<Harness />)
    fireEvent.change(input(), { target: { value: 'do' } })
    expect(optionNames()).toEqual(['Documentation'])
    fireEvent.change(input(), { target: { value: 'G' } })
    expect(optionNames()).toEqual(['Design', 'Bug', 'Legacy'])
  })

  it('moves with the arrow keys (skipping disabled), and Enter selects', () => {
    render(<Harness />)
    fireEvent.change(input(), { target: { value: 'e' } })
    const active = () =>
      document.getElementById(input().getAttribute('aria-activedescendant') ?? '')?.textContent
    // Design, Documentation, Legacy (disabled), Performance
    expect(active()).toBe('Design')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(active()).toBe('Documentation')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(active()).toBe('Performance')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(active()).toBe('Design')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByRole('status')).toHaveTextContent('perf')
    expect(input()).toHaveValue('Performance')
    expect(input()).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape without changing the value', () => {
    render(<Harness />)
    fireEvent.change(input(), { target: { value: 'bu' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('none')
    expect(input()).toHaveValue('')
  })

  it('offers to create what was typed when nothing matches exactly', () => {
    const onCreate = vi.fn()
    render(<Harness onCreate={onCreate} />)
    fireEvent.change(input(), { target: { value: 'Urgent' } })
    expect(optionNames()).toEqual(['Create “Urgent”'])
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onCreate).toHaveBeenCalledWith('Urgent')
  })

  it('cannot be used while disabled', () => {
    render(<Harness disabled />)
    expect(input()).toBeDisabled()
  })
})

describe('SuggestField', () => {
  function Suggest() {
    const [value, setValue] = useState('')
    return (
      <>
        <SuggestField
          label="Category"
          value={value}
          onChange={setValue}
          suggestions={['Travel', 'Tools']}
        />
        <output>{value || 'none'}</output>
      </>
    )
  }

  it('keeps typed text as the value and offers suggestions in Ostler’s own list', () => {
    render(<Suggest />)
    const box = screen.getByRole('combobox', { name: 'Category' })
    fireEvent.change(box, { target: { value: 'Snacks' } })
    expect(screen.getByRole('status')).toHaveTextContent('Snacks')
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(box, { key: 'Tab' })
    expect(box).toHaveValue('Snacks')
    fireEvent.change(box, { target: { value: 'tr' } })
    fireEvent.click(screen.getByRole('option', { name: 'Travel' }))
    expect(screen.getByRole('status')).toHaveTextContent('Travel')
    expect(box).toHaveValue('Travel')
  })
})

describe('Combobox openOnMount', () => {
  it('focuses the input and lists every option without typing', () => {
    render(
      <Combobox label="Label" options={OPTIONS} value={null} onChange={() => {}} openOnMount />
    )
    expect(document.activeElement).toBe(screen.getByRole('combobox'))
    expect(screen.getAllByRole('option')).toHaveLength(OPTIONS.length)
  })
})
