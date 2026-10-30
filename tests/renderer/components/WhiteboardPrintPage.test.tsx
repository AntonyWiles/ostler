// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryItem, WhiteboardDocument } from '@shared/ostler-api'
import { cleanWhiteboardObject, type WhiteboardObject } from '@shared/whiteboard/model'
import { WhiteboardPrintPage } from '@renderer/views/print/WhiteboardPrintPage'
import { installOstlerApi } from '../fixtures/ostler-api'

/**
 * Print a whiteboard (plan `docs/plans/whiteboards/`, prompt 17, D15): the title is the page's
 * heading, every object is drawn by the scene, and the page tells main it is ready only after
 * every picture has loaded or failed. A board that cannot be read is an error.
 */

const PROJECT = '11111111-1111-4111-8111-111111111111'
const BOARD = '44444444-4444-4444-8444-444444444444'
const PICTURE = '22222222-2222-4222-8222-222222222222'

function object(fields: Record<string, unknown>): WhiteboardObject {
  return cleanWhiteboardObject({
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    z: 0,
    ...fields
  }) as WhiteboardObject
}

const objects = [
  object({ id: 'note', kind: 'note', text: 'Buy milk' }),
  object({ id: 'shape', kind: 'shape', x: 260, z: 1 }),
  object({
    id: 'picture',
    kind: 'image',
    x: 520,
    width: 120,
    height: 80,
    z: 2,
    data: { imageItemId: PICTURE }
  })
]

const route = { projectId: PROJECT, whiteboardId: BOARD }

function boardDocument(): WhiteboardDocument {
  return {
    item: {
      id: BOARD,
      projectId: PROJECT,
      kind: 'whiteboard',
      title: 'Launch plan'
    } as LibraryItem,
    objects
  } as WhiteboardDocument
}

beforeEach(() => {
  delete document.documentElement.dataset.printReady
  // jsdom has no canvas; text is measured by estimate.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WhiteboardPrintPage', () => {
  it('heads the page with the title and draws every object', async () => {
    installOstlerApi({ getWhiteboard: async () => ({ ok: true, value: boardDocument() }) })
    const { container } = render(<WhiteboardPrintPage route={route} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Launch plan' })).toBeTruthy()
    const drawn = [...container.querySelectorAll('[data-object-id]')].map((element) =>
      element.getAttribute('data-object-id')
    )
    expect(drawn.sort()).toEqual(['note', 'picture', 'shape'])
    expect(container.querySelector('image')?.getAttribute('href')).toContain(PICTURE)
  })

  it('is ready only after the picture has loaded', async () => {
    installOstlerApi({ getWhiteboard: async () => ({ ok: true, value: boardDocument() }) })
    const { container } = render(<WhiteboardPrintPage route={route} />)
    await screen.findByRole('heading', { level: 1, name: 'Launch plan' })
    const image = container.querySelector('image')
    expect(image).not.toBeNull()
    // Several frames pass with the picture still loading: not ready.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(document.documentElement.dataset.printReady).toBeUndefined()
    fireEvent.load(image!)
    await waitFor(() => expect(document.documentElement.dataset.printReady).toBe('1'))
  })

  it('is ready at once for a board without pictures', async () => {
    const value = { ...boardDocument(), objects: objects.filter((o) => o.kind !== 'image') }
    installOstlerApi({ getWhiteboard: async () => ({ ok: true, value }) })
    render(<WhiteboardPrintPage route={route} />)
    await waitFor(() => expect(document.documentElement.dataset.printReady).toBe('1'))
  })

  it('marks an error and says why when the board cannot be read', async () => {
    installOstlerApi({
      getWhiteboard: async () => ({ ok: false, error: 'This is not a whiteboard.' })
    })
    render(<WhiteboardPrintPage route={route} />)
    expect((await screen.findByRole('alert')).textContent).toBe('This is not a whiteboard.')
    expect(document.documentElement.dataset.printReady).toBe('error')
  })
})
