// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LibraryReadingLine } from '@renderer/views/settings/sections/DataSection'
import { installOstlerApi } from '../../fixtures/ostler-api'

describe('LibraryReadingLine', () => {
  it('says how far the background pass has read', async () => {
    installOstlerApi({
      getLibraryTextProgress: async () => ({ ok: true as const, value: { done: 12, total: 140 } })
    })
    render(<LibraryReadingLine />)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Reading 12 of 140 files for search'
    )
  })

  it('shows nothing when nothing is being read', async () => {
    let asked = false
    installOstlerApi({
      getLibraryTextProgress: async () => {
        asked = true
        return { ok: true as const, value: null }
      }
    })
    const { container } = render(<LibraryReadingLine />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(asked).toBe(true)
    expect(container).toBeEmptyDOMElement()
  })
})
