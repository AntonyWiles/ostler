// @vitest-environment jsdom
import { createRef, type ReactElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryItem } from '@shared/ostler-api'
import { LibraryDetail } from '@renderer/views/project-detail/library/LibraryDetail'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../fixtures/ostler-api'

afterEach(() => {
  __resetDismissableStackForTests()
  vi.clearAllMocks()
})

const P = '0f8fad5b-d9cb-469f-a165-70867728950e'
const STORED = 'library/files/prices.txt'

function item(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: '10000000-0000-4000-8000-000000000002',
    projectId: P,
    kind: 'document',
    title: 'Caterer prices',
    summary: '',
    body: '',
    url: null,
    file: {
      fileName: 'prices.txt',
      mimeType: 'text/plain',
      sizeBytes: 12,
      sha256: 'abc',
      hasThumbnail: false,
      hasVisionCopy: false
    },
    tags: [],
    aiAccess: 'when-selected',
    isPrimaryBrief: false,
    revision: 1,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides
  }
}

function install() {
  const api = {
    showLibraryItemInFolder: vi.fn(async () => ({ ok: true as const, value: undefined })),
    getLibraryItemFilePath: vi.fn(async () => ({ ok: true as const, value: STORED })),
    copyText: vi.fn(async () => ({ ok: true as const, value: undefined })),
    getLibraryItemText: async () => ({ ok: true as const, value: 'Prices' }),
    listItemWorkItems: async () => ({ ok: true as const, value: [] }),
    listItemAttachments: async () => ({ ok: true as const, value: [] })
  }
  installOstlerApi(api)
  return api
}

function renderDetail(libraryItem: LibraryItem, ai = false, onNotice = vi.fn()) {
  const noop = async () => {}
  const shell = (ui: ReactElement) => (
    <MemoryRouter>
      <ConfirmProvider>
        <ToastProvider>
          <StaticFeaturesProvider value={{ agents: false, ai }}>{ui}</StaticFeaturesProvider>
        </ToastProvider>
      </ConfirmProvider>
    </MemoryRouter>
  )
  render(
    shell(
      <LibraryDetail
        item={libraryItem}
        summaryRef={createRef()}
        onUpdate={noop}
        onSetPrimary={noop}
        onEdit={() => {}}
        onOpen={() => {}}
        onArchive={noop}
        onDelete={noop}
        onOpenWorkItem={() => {}}
        onNotice={onNotice}
      />
    )
  )
  return onNotice
}

describe('Library item file actions', () => {
  it('a file item shows its stored copy in the folder', async () => {
    const api = install()
    renderDetail(item())
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }))
    await waitFor(() => expect(api.showLibraryItemInFolder).toHaveBeenCalledWith(P, item().id))
  })

  it('the item menu copies the file path', async () => {
    const api = install()
    const onNotice = renderDetail(item())
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Caterer prices' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy path' }))
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith(STORED))
    expect(onNotice).toHaveBeenCalledWith('Path copied', false)
  })

  it('a link offers Copy link and no folder', async () => {
    const api = install()
    renderDetail(item({ kind: 'link', file: null, url: 'https://example.com/menu' }))
    expect(screen.queryByRole('button', { name: 'Show in folder' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Caterer prices' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy link' }))
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith('https://example.com/menu'))
  })

  it('who the AI reads it for sits in a closed section at the bottom', () => {
    install()
    renderDetail(item(), true)
    const section = document.querySelector('details.ostler-library-ai-section')
    expect(section).not.toBeNull()
    expect((section as HTMLDetailsElement).open).toBe(false)
  })
})
