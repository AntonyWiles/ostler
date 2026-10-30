// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DateField, addDays, toIsoDate } from '@renderer/ui'

const today = () => toIsoDate(new Date())
const inDays = (n: number) => toIsoDate(addDays(new Date(), n))

function Harness({ initial, onChange }: { initial: string; onChange: (value: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <DateField
      label="Due"
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

describe('DateField', () => {
  it('is a date input named by its label, described by the date in words', () => {
    render(<DateField label="Due" value={inDays(1)} onChange={() => {}} />)
    const input = screen.getByLabelText('Due')
    expect(input).toHaveAttribute('type', 'date')
    expect(input).toHaveValue(inDays(1))
    expect(screen.getByText('Tomorrow')).toBeInTheDocument()
    expect(input).toHaveAccessibleDescription('Tomorrow')
  })

  it('keeps a mistyped year in the box, marked invalid, without saving it (MOP-41)', () => {
    const onChange = vi.fn()
    render(<Harness initial="2026-10-28" onChange={onChange} />)
    const input = screen.getByLabelText('Due')
    fireEvent.change(input, { target: { value: '0080-10-28' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('0080-10-28')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Not a real date. Check the day, month and year.')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '2080-10-28' } })
    expect(onChange).toHaveBeenCalledWith('2080-10-28')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('says how overdue a past due date is', () => {
    render(<DateField label="Due" value={inDays(-2)} onChange={() => {}} />)
    expect(screen.getByText('Overdue by 2 days')).toHaveClass('is-overdue')
  })

  it('shows no words for an empty value', () => {
    render(<DateField label="Due" value="" onChange={() => {}} />)
    expect(screen.getByLabelText('Due')).not.toHaveAttribute('aria-describedby')
  })

  it('sets the value from the quick-dates popover', () => {
    const onChange = vi.fn()
    render(<Harness initial="" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'Quick dates' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const popover = screen.getByRole('dialog', { name: 'Quick dates' })
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Tomorrow' }))
    expect(onChange).toHaveBeenLastCalledWith(inDays(1))
    expect(popover).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(onChange).toHaveBeenLastCalledWith(today())

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(onChange).toHaveBeenLastCalledWith(inDays(7))

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('fires onChange when the native input changes', () => {
    const onChange = vi.fn()
    render(<DateField label="Due" value="" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2030-01-02' } })
    expect(onChange).toHaveBeenCalledWith('2030-01-02')
  })

  it('disables both the input and the quick-dates button', () => {
    render(<DateField label="Due" value="" onChange={() => {}} disabled />)
    expect(screen.getByLabelText('Due')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Quick dates' })).toBeDisabled()
  })
})
