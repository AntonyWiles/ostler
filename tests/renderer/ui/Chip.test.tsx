// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Chip } from '@renderer/ui'

describe('Chip', () => {
  it('shows its text, with no remove button unless asked', () => {
    render(<Chip color="#f00">frontend</Chip>)
    expect(screen.getByText('frontend')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('names its remove button after the chip', () => {
    const onRemove = vi.fn()
    render(<Chip onRemove={onRemove}>frontend</Chip>)
    fireEvent.click(screen.getByRole('button', { name: 'Remove frontend' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('uses removeLabel when the content is not a string', () => {
    render(
      <Chip onRemove={() => {}} removeLabel="Ada">
        <strong>Ada</strong>
      </Chip>
    )
    expect(screen.getByRole('button', { name: 'Remove Ada' })).toBeInTheDocument()
  })
})
