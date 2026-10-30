// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryItem } from '@shared/ostler-api'
import type { SnipPreview } from '@shared/snip'
import { QuickAddProvider, useQuickAdd } from '@renderer/components/quick-add/QuickAddProvider'
import { MarkUpCopyButton } from '@renderer/components/markup/MarkUpCopyButton'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeWorkItem } from '../fixtures/planning-records'

/**
 * Mark up (N4.2b) where people meet it: quick add's Mark up replaces the
 * snip before Add, and Cancel keeps it as it was; Mark up a copy saves a new
 * item for the task and never touches the original.
 */

const project = { id: 'p1', name: 'Website', enabled: true, path: null }

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [project], loading: false, refreshProjects: async () => {} })
}))

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])

vi.mock('@renderer/components/markup/draw', () => ({
  annotationColours: () => ({ red: 'r', yellow: 'y', blue: 'b', green: 'g', black: 'k' }),
  appFontFamily: () => 'Segoe UI',
  drawMarkup: () => {},
  loadPicture: async () => ({
    image: { naturalWidth: 640, naturalHeight: 360 },
    release: () => {}
  }),
  flattenToPng: async () => PNG
}))

const SNIP: SnipPreview = {
  snipId: 'snip-1',
  thumbnail: 'data:image/png;base64,original',
  width: 640,
  height: 360
}

function Opener() {
  const quickAdd = useQuickAdd()
  return (
    <button type="button" onClick={() => quickAdd.open({ snip: SNIP })}>
      Open with snip
    </button>
  )
}

function renderQuickAdd() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <QuickAddProvider>
            <Opener />
          </QuickAddProvider>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Open with snip' }))
}

async function addABox() {
  const stage = await screen.findByRole('group', { name: /^The picture, 640 × 360/ })
  fireEvent.click(screen.getByRole('button', { name: 'Box' }))
  fireEvent.mouseDown(stage, { button: 0, clientX: 10, clientY: 10 })
  fireEvent.mouseMove(document, { clientX: 100, clientY: 100 })
  fireEvent.mouseUp(document, { clientX: 100, clientY: 100 })
}

beforeEach(() => {
  // jsdom has no canvas: the editor draws nothing, as when a context is lost.
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  localStorage.clear()
})

describe('Mark up from quick add', () => {
  it('replaces the snip before Add, and Add saves the marked-up one', async () => {
    const getSnipFullPicture = vi.fn(async () => ({
      ok: true as const,
      value: { bytes: Uint8Array.from([1, 2]), mimeType: 'image/png' }
    }))
    const replaceSnip = vi.fn(async () => ({
      ok: true as const,
      value: { ...SNIP, thumbnail: 'data:image/png;base64,marked' }
    }))
    const saveSnipToTask = vi.fn(async () => ({ ok: true as const, value: {} as never }))
    installOstlerApi({
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      createPlanningWorkItem: (async (projectId: string, input: { title: string }) => ({
        ok: true as const,
        value: makeWorkItem('w1', { projectId, title: input.title })
      })) as never,
      getSnipFullPicture,
      replaceSnip,
      saveSnipToTask,
      discardSnip: async () => ({ ok: true, value: undefined })
    })
    renderQuickAdd()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark up' }))
    await addABox()
    expect(getSnipFullPicture).toHaveBeenCalledWith('snip-1')
    fireEvent.click(screen.getByRole('button', { name: 'Use this picture' }))
    await waitFor(() => expect(replaceSnip).toHaveBeenCalledWith('snip-1', PNG))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Mark up the snip' })).toBeNull()
    )
    expect(screen.getByRole('img', { name: 'The snip, 640 × 360' }).getAttribute('src')).toBe(
      'data:image/png;base64,marked'
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Quick add a task' }), {
      target: { value: 'The total is wrong' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    await waitFor(() => expect(saveSnipToTask).toHaveBeenCalledWith('p1', 'w1', 'snip-1'))
  })

  it('Cancel in the editor keeps the snip as it was', async () => {
    const replaceSnip = vi.fn()
    installOstlerApi({
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      getSnipFullPicture: async () => ({
        ok: true,
        value: { bytes: Uint8Array.from([1]), mimeType: 'image/png' }
      }),
      replaceSnip,
      discardSnip: async () => ({ ok: true, value: undefined })
    })
    renderQuickAdd()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark up' }))
    await addABox()
    const editor = screen.getByRole('dialog', { name: 'Mark up the snip' })
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard marks' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Mark up the snip' })).toBeNull()
    )
    expect(replaceSnip).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: 'The snip, 640 × 360' }).getAttribute('src')).toBe(
      SNIP.thumbnail
    )
    // Quick add is still open with its snip.
    expect(screen.getByRole('dialog', { name: 'Snip to task' })).toBeTruthy()
  })
})

const IMAGE: LibraryItem = {
  id: 'item-1',
  projectId: 'p1',
  kind: 'image',
  title: 'Login page',
  summary: '',
  body: '',
  url: null,
  file: {
    fileName: 'Login page.png',
    mimeType: 'image/png',
    sizeBytes: 9,
    sha256: 'x',
    hasThumbnail: true,
    hasVisionCopy: false
  },
  aiAccess: 'when-selected',
  isPrimaryBrief: false,
  tags: [],
  revision: 1,
  createdAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
  archivedAt: null
}

describe('Mark up a copy', () => {
  it('saves a new item attached to the task, and leaves the original alone', async () => {
    const copy = { ...IMAGE, id: 'item-2', title: 'Login page (marked up)' }
    const saveMarkedUpCopy = vi.fn(async () => ({ ok: true as const, value: copy }))
    const updateLibraryItem = vi.fn()
    const getLibraryImage = vi.fn(async () => ({
      ok: true as const,
      value: { bytes: Uint8Array.from([1]), mimeType: 'image/png' }
    }))
    installOstlerApi({ getLibraryImage, saveMarkedUpCopy, updateLibraryItem })
    const onSaved = vi.fn()
    render(
      <ToastProvider>
        <ConfirmProvider>
          <MarkUpCopyButton item={IMAGE} workItemId="w1" compact onSaved={onSaved} />
        </ConfirmProvider>
      </ToastProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Mark up a copy of Login page' }))
    expect(await screen.findByRole('dialog', { name: 'Mark up a copy of Login page' })).toBeTruthy()
    expect(getLibraryImage).toHaveBeenCalledWith('p1', 'item-1')
    await addABox()
    fireEvent.click(screen.getByRole('button', { name: 'Save copy' }))
    await waitFor(() => expect(saveMarkedUpCopy).toHaveBeenCalledWith('p1', 'item-1', 'w1', PNG))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(copy))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('Marked-up copy saved')).toBeTruthy()
    expect(updateLibraryItem).not.toHaveBeenCalled()
  })

  it('is not offered on a picture a canvas cannot open', () => {
    installOstlerApi()
    const svg = { ...IMAGE, file: { ...IMAGE.file!, mimeType: 'image/svg+xml' } }
    render(
      <ToastProvider>
        <MarkUpCopyButton item={svg} />
      </ToastProvider>
    )
    expect(screen.queryByRole('button', { name: /Mark up a copy/ })).toBeNull()
  })
})
