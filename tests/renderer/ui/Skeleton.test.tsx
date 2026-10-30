// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Skeleton, SKELETON_DELAY_MS } from '@renderer/ui'

describe('Skeleton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is hidden from assistive tech', () => {
    const { container } = render(<Skeleton />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('stays invisible for the first 300 ms, then appears', () => {
    expect(SKELETON_DELAY_MS).toBe(300)
    const { container } = render(<Skeleton />)
    const skeleton = container.firstElementChild!
    expect(skeleton).toHaveAttribute('data-visible', 'false')
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS - 1)
    })
    expect(skeleton).toHaveAttribute('data-visible', 'false')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(skeleton).toHaveAttribute('data-visible', 'true')
  })

  it('draws one bone per line, the last one shorter', () => {
    const { container } = render(<Skeleton lines={3} />)
    const bones = container.querySelectorAll<HTMLElement>('.ui-skeleton__bone')
    expect(bones).toHaveLength(3)
    expect(bones[2].style.width).toBe('60%')
  })

  it('draws a single bone for a block', () => {
    const { container } = render(<Skeleton shape="block" lines={4} width={100} height={20} />)
    expect(container.querySelectorAll('.ui-skeleton__bone')).toHaveLength(1)
  })
})
