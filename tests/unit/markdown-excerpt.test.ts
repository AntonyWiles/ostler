import { describe, expect, it } from 'vitest'
import { markdownExcerpt } from '../../src/shared/markdown-excerpt'

describe('markdownExcerpt', () => {
  it('shows a quoted reply as the reply, without the quote', () => {
    const body =
      '> **Tom (demo)** wrote:\n>\n> Delivery can only come on a weekday morning.\n\nI’ll book Tuesday morning.'
    expect(markdownExcerpt(body)).toBe('I’ll book Tuesday morning.')
  })

  it('shows a comment that is only a quote as the quoted text', () => {
    expect(markdownExcerpt('> **Tom** wrote:\n>\n> Plaster first.')).toBe(
      'Tom wrote: Plaster first.'
    )
  })

  it('drops Markdown marks and keeps link and image text', () => {
    expect(
      markdownExcerpt(
        '## Plan\n- **Oak** or _tile_, see [the quote](https://example.com)\n1. `fit` ![photo](x.png)\n~~old~~'
      )
    ).toBe('Plan Oak or tile, see the quote fit photo old')
  })

  it('leaves plain text and snake_case words alone', () => {
    expect(markdownExcerpt('Two extra sockets, 2 * 3 = 6, file_name_here')).toBe(
      'Two extra sockets, 2 * 3 = 6, file_name_here'
    )
  })
})
