// @vitest-environment jsdom
import { Suspense } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { lazyNamed, loadLazyComponents } from '@renderer/lib/lazy-named'

describe('lazyNamed', () => {
  it('loads its code on first render', async () => {
    const load = vi.fn(async () => ({ Panel: () => <p>The panel</p> }))
    const Panel = lazyNamed(load, 'Panel')
    expect(load).not.toHaveBeenCalled()
    render(
      <Suspense fallback={<p>Loading</p>}>
        <Panel />
      </Suspense>
    )
    expect(await screen.findByText('The panel')).toBeInTheDocument()
    expect(load).toHaveBeenCalled()
  })

  it('loads the code of every lazy component declared so far, all at once', async () => {
    let finish!: () => void
    const slow = vi.fn(
      () =>
        new Promise<{ Slow: () => null }>((resolve) => {
          finish = () => resolve({ Slow: () => null })
        })
    )
    const quick = vi.fn(async () => ({ Quick: () => null }))
    lazyNamed(slow, 'Slow')
    lazyNamed(quick, 'Quick')

    let loaded = false
    const loading = loadLazyComponents().then(() => (loaded = true))
    expect(slow).toHaveBeenCalledTimes(1)
    expect(quick).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(loaded).toBe(false)
    finish()
    await loading
    expect(loaded).toBe(true)
  })
})
