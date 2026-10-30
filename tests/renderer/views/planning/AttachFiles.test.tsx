// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryItem } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { WorkItemDrawer } from '@renderer/views/planning/WorkItemDrawer'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, Markdown, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { makeWorkItem } from '../../fixtures/planning-records'
import {
  emptyPlanningReads,
  renderPlanningWorkspace,
  withWorkspace
} from '../../fixtures/planning-workspace'

afterEach(() => __resetDismissableStackForTests())

const S = BRAND.urlScheme
const P = '0f8fad5b-d9cb-469f-a165-70867728950e'
const PIC = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b'

const picture: LibraryItem = {
  id: PIC,
  projectId: P,
  kind: 'image',
  title: 'Pasted picture.png',
  summary: '',
  body: '',
  url: null,
  file: null,
  aiAccess: 'allowed',
  isPrimaryBrief: false,
  tags: [],
  revision: 1,
  createdAt: '2026-10-25T00:00:00.000Z',
  updatedAt: '2026-10-25T00:00:00.000Z',
  archivedAt: null
} as unknown as LibraryItem

const shell = (ui: ReactElement) => (
  <MemoryRouter>
    <ConfirmProvider>
      <ToastProvider>
        <StaticFeaturesProvider value={{ agents: false, ai: false }}>{ui}</StaticFeaturesProvider>
      </ToastProvider>
    </ConfirmProvider>
  </MemoryRouter>
)

/** jsdom's File cannot read its bytes, so this one says what they are. */
const png = () =>
  Object.assign(new File([], 'shot.png', { type: 'image/png' }), {
    arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer
  })

async function openDrawer(initialDescription = '') {
  const task = makeWorkItem('a', { title: 'Plan', projectId: P })
  const importLibraryFiles = vi.fn(async () => ({
    ok: true as const,
    value: [{ item: picture }]
  }))
  const attachToWorkItem = vi.fn(async () => ({ ok: true as const, value: [] }))
  const base = await renderPlanningWorkspace({
    api: {
      ...emptyPlanningReads(),
      getLinkedFrom: async () => ({ ok: true, value: [] }),
      importLibraryFiles: importLibraryFiles as never,
      attachToWorkItem: attachToWorkItem as never
    }
  })
  function Drawer() {
    const [description, setDescription] = useState(initialDescription)
    const ws = withWorkspace(base, {
      selectedWorkItem: task,
      selectedWorkItemId: task.id,
      workItems: [task],
      workItemsById: new Map([[task.id, task]]),
      editTitle: task.title,
      editStatus: task.status,
      editDependencyIds: [],
      editDescription: description,
      setEditDescription: setDescription
    })
    return <WorkItemDrawer ws={ws} />
  }
  render(shell(<Drawer />))
  return { task, importLibraryFiles, attachToWorkItem }
}

describe('a picture pasted into a task', () => {
  it('is attached, and shown in the description where the caret was', async () => {
    const { task, importLibraryFiles, attachToWorkItem } = await openDrawer('Before after')
    const description = screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement
    description.setSelectionRange(7, 7)
    fireEvent.paste(description, { clipboardData: { files: [png()], getData: () => '' } })
    await waitFor(() => expect(attachToWorkItem).toHaveBeenCalledWith(P, task.id, PIC, 'human'))
    expect(importLibraryFiles).toHaveBeenCalledWith(P, [
      expect.objectContaining({ fileName: 'shot.png', mimeType: 'image/png' })
    ])
    await waitFor(() =>
      expect(description.value).toBe(
        `Before ![Pasted picture.png](${S}://library/${P}/${PIC})after`
      )
    )
  })

  it('pasted elsewhere in the task is attached, and the description is left alone', async () => {
    const { attachToWorkItem } = await openDrawer('Kept')
    fireEvent.paste(screen.getByRole('textbox', { name: 'Title' }), {
      clipboardData: { files: [png()], getData: () => '' }
    })
    await waitFor(() => expect(attachToWorkItem).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Kept')
  })

  it('leaves a paste of text to the field', async () => {
    const { importLibraryFiles } = await openDrawer()
    fireEvent.paste(screen.getByRole('textbox', { name: 'Description' }), {
      clipboardData: { files: [], getData: () => 'words' }
    })
    expect(importLibraryFiles).not.toHaveBeenCalled()
  })
})

describe('a picture in Markdown', () => {
  it('shows a Library picture from its file, and nothing for another link of ours', () => {
    installOstlerApi({ resolveItemLinks: async () => ({ ok: true, value: [] }) })
    const { container } = render(
      <MemoryRouter>
        <Markdown>
          {`![Shot](${S}://library/${P}/${PIC})\n\n![Task](${S}://task/${P}/${PIC})\n\n![Web](https://example.com/a.png)`}
        </Markdown>
      </MemoryRouter>
    )
    const sources = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))
    expect(sources).toEqual([`ostler-library://${P}/${PIC}/file`, 'https://example.com/a.png'])
    expect(screen.getByRole('img', { name: 'Shot' })).toBeTruthy()
  })
})
