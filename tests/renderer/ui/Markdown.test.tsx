// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { ItemLinkInfo, ItemLinkRef } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { Markdown, markdownUrlTransform } from '@renderer/ui'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { installOstlerApi } from '../fixtures/ostler-api'

const S = BRAND.urlScheme
const P = '0f8fad5b-d9cb-469f-a165-70867728950e'
const T = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const D = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b'

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}

function renderMarkdown(text: string, refreshKey?: unknown) {
  return render(
    <MemoryRouter>
      <Markdown refreshKey={refreshKey}>{text}</Markdown>
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
}

function fakeTitles(titles: Record<string, string | null>) {
  const resolve = vi.fn(async (refs: ItemLinkRef[]) => ({
    ok: true as const,
    value: refs.map((ref): ItemLinkInfo =>
      titles[ref.id]
        ? {
            ...ref,
            exists: true,
            title: titles[ref.id],
            ...(ref.kind === 'task' ? { status: 'ready' as const } : {})
          }
        : { ...ref, exists: false, title: null }
    )
  }))
  installOstlerApi({ resolveItemLinks: resolve })
  return resolve
}

describe('Markdown (N4.4a)', () => {
  it('keeps sanitising: scripts, javascript: and other schemes stay inert', () => {
    installOstlerApi()
    const { container } = renderMarkdown(
      [
        '<script>window.hacked = true</script>',
        '[js](javascript:alert(1))',
        '[data](data:text/html,hi)',
        '[file](file:///C:/Windows)',
        `[view](${S}://project/${P}/board)`,
        `[inbox](${S}://inbox)`,
        `[query](${S}://task/${P}/${T}?x=1)`,
        '[web](https://example.com)'
      ].join('\n\n')
    )
    expect(container.querySelector('script')).toBeNull()
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs.filter((href) => href)).toEqual(['https://example.com'])
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('lets only the item-link shapes of our scheme through the URL transform', () => {
    expect(markdownUrlTransform(`${S}://task/${P}/${T}`)).toBe(`${S}://task/${P}/${T}`)
    expect(markdownUrlTransform(`${S}://library/${P}/${D}`)).toBe(`${S}://library/${P}/${D}`)
    expect(markdownUrlTransform(`${S}://inbox`)).toBe('')
    expect(markdownUrlTransform(`${S.toUpperCase()}://task/${P}/x`)).toBe('')
    expect(markdownUrlTransform('javascript:alert(1)')).toBe('')
  })

  it('shows links as chips with current titles, in one call, and opens the item', async () => {
    const resolve = fakeTitles({ [T]: 'Fix the header', [D]: 'Use the new supplier' })
    renderMarkdown(
      `See [old words](${S}://task/${P}/${T}), [again](${S}://task/${P}/${T}) and [d](${S}://decision/${P}/${D}).`
    )
    expect(await screen.findAllByRole('button', { name: /Fix the header/ })).toHaveLength(2)
    expect(screen.queryByText('old words')).toBeNull()
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve.mock.calls[0][0]).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /Use the new supplier/ }))
    expect(screen.getByTestId('where').textContent).toBe(`/projects/${P}/decisions?decision=${D}`)
  })

  it('reads titles again after a rename, and shows a gone item as deleted', async () => {
    fakeTitles({ [T]: 'Old title' })
    const text = `[x](${S}://task/${P}/${T}) [y](${S}://milestone/${P}/${D})`
    const view = renderMarkdown(text, 1)
    await screen.findByRole('button', { name: /Old title/ })
    expect(screen.getByText('Deleted item')).toBeTruthy()

    fakeTitles({ [T]: 'New title' })
    view.rerender(
      <MemoryRouter>
        <Markdown refreshKey={2}>{text}</Markdown>
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /New title/ })).toBeTruthy())
  })

  it('asks nothing for a text without links', () => {
    const resolve = fakeTitles({})
    renderMarkdown('Just **words**.')
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('Markdown mentions (prompt 14)', () => {
  const ANA = '5b1f0d6e-1c3a-4e0a-9d0a-111111111111'
  const person = {
    id: ANA,
    name: 'Ana Silva',
    initials: 'AS',
    color: '#336699',
    isMe: false,
    archivedAt: null,
    weeklyCapacityHours: null,
    workingDays: [1, 2, 3, 4, 5],
    projectId: null,
    createdAt: 0,
    updatedAt: 0
  }

  it('lets a person link through and draws a chip from the id, not the words', () => {
    installOstlerApi()
    expect(markdownUrlTransform(`${S}://person/${ANA}`)).toBe(`${S}://person/${ANA}`)
    render(
      <StaticPeopleProvider people={[person]}>
        <Markdown>{`[@Someone Else](${S}://person/${ANA}) and [@Gone](${S}://person/missing-id)`}</Markdown>
      </StaticPeopleProvider>
    )
    expect(screen.getByText('@Ana Silva')).toBeTruthy()
    expect(screen.queryByText('@Someone Else')).toBeNull()
    expect(screen.getByText('Someone no longer here')).toBeTruthy()
  })
})
