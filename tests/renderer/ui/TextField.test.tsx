// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TextField } from '@renderer/ui'

function Controlled({ onValue }: { onValue: (value: string) => void }) {
  const [value, setValue] = useState('hello')
  return (
    <TextField
      label="Title"
      clearable
      value={value}
      onChange={(event) => {
        setValue(event.target.value)
        onValue(event.target.value)
      }}
    />
  )
}

describe('TextField', () => {
  it('is a textbox named by its label', () => {
    render(<TextField label="Title" defaultValue="" />)
    expect(screen.getByRole('textbox', { name: 'Title' })).not.toHaveAttribute('aria-invalid')
  })

  it('links the hint to the input', () => {
    render(<TextField label="Title" hint="Keep it short" />)
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveAccessibleDescription(
      'Keep it short'
    )
  })

  it('marks the input invalid and describes it with the error', () => {
    render(<TextField label="Title" hint="Keep it short" error="Title is required" />)
    const input = screen.getByRole('textbox', { name: 'Title' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Title is required Keep it short')
  })

  it('clears with the clear button, firing onChange with an empty string', () => {
    const onValue = vi.fn()
    render(<Controlled onValue={onValue} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onValue).toHaveBeenCalledWith('')
    const input = screen.getByRole('textbox', { name: 'Title' })
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('calls onClear instead when given', () => {
    const onClear = vi.fn()
    render(<TextField label="Title" clearable value="x" onChange={() => {}} onClear={onClear} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('is disabled without a clear button', () => {
    render(<TextField label="Title" clearable disabled value="x" onChange={() => {}} />)
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })
})
