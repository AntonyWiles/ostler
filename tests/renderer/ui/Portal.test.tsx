// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Portal } from '@renderer/ui'

describe('Portal', () => {
  it('renders into document.body, outside its parent', () => {
    const { container } = render(
      <div>
        <Portal>
          <p>Floating</p>
        </Portal>
      </div>
    )
    const node = screen.getByText('Floating')
    expect(container.contains(node)).toBe(false)
    expect(node.parentElement).toBe(document.body)
  })

  it('renders into a given container', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(
      <Portal container={host}>
        <p>Hosted</p>
      </Portal>
    )
    expect(screen.getByText('Hosted').parentElement).toBe(host)
    host.remove()
  })
})
