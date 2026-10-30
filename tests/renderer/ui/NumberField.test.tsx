// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NumberField } from '@renderer/ui'

describe('NumberField', () => {
  it('is a spinbutton named by its label, showing its unit', () => {
    render(
      <NumberField label="Estimate" value={3} onChange={() => {}} min={0} max={10} unit="days" />
    )
    const input = screen.getByRole('spinbutton', { name: 'Estimate' })
    expect(input).toHaveValue(3)
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '10')
    expect(screen.getByText('days')).toBeInTheDocument()
  })

  it('reports numbers, and null when emptied', () => {
    const onChange = vi.fn()
    render(<NumberField label="Estimate" value={3} onChange={onChange} />)
    const input = screen.getByRole('spinbutton', { name: 'Estimate' })
    fireEvent.change(input, { target: { value: '7' } })
    expect(onChange).toHaveBeenLastCalledWith(7)
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('clamps an out-of-range value on blur', () => {
    const onChange = vi.fn()
    const onBlur = vi.fn()
    const { rerender } = render(
      <NumberField label="Estimate" value={42} onChange={onChange} onBlur={onBlur} max={10} />
    )
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Estimate' }))
    expect(onChange).toHaveBeenCalledWith(10)
    expect(onBlur).toHaveBeenCalledOnce()
    rerender(<NumberField label="Estimate" value={-5} onChange={onChange} min={0} />)
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Estimate' }))
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('leaves an in-range or empty value alone on blur', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <NumberField label="Estimate" value={5} onChange={onChange} min={0} max={10} />
    )
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Estimate' }))
    rerender(<NumberField label="Estimate" value={null} onChange={onChange} min={0} max={10} />)
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Estimate' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('can be disabled', () => {
    render(<NumberField label="Estimate" value={1} onChange={() => {}} disabled />)
    expect(screen.getByRole('spinbutton', { name: 'Estimate' })).toBeDisabled()
  })
})
