// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AskOstlerAnswer,
  AskOstlerOptions,
  AskOstlerProgress,
  LibraryItem,
  RendererProject
} from '@shared/ostler-api'
import { AskOstlerProvider } from '@renderer/components/ask-ostler/AskOstlerProvider'
import { CommandPalette } from '@renderer/components/CommandPalette'
import { SearchView } from '@renderer/views/search/SearchView'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const projects = [
  { id: 'alpha', name: 'Alpha launch', color: '#3b82f6', enabled: true, path: null },
  { id: 'beta', name: 'Beta house', color: '#10b981', enabled: true, path: null }
] as unknown as RendererProject[]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects })
}))

const ANSWER: AskOstlerAnswer = {
  askId: 'x',
  answer: 'We chose grey tiles [1], and the tiler starts on line 12 of the plan [2].',
  sources: [
    {
      number: 1,
      type: 'decision',
      projectId: 'alpha',
      id: 'd1',
      title: 'Bathroom tiles',
      workItemId: null
    },
    {
      number: 2,
      type: 'file',
      projectId: 'alpha',
      id: 'docs/plan.md',
      title: 'docs/plan.md',
      workItemId: null,
      path: 'docs/plan.md',
      startLine: 7,
      endLine: 17
    }
  ],
  sourcesCut: false,
  filesCutShort: false,
  earlierLeftOut: false
}

function Where() {
  const location = useLocation()
  return <span data-testid="where">{location.pathname + location.search}</span>
}

let progressListener: ((progress: AskOstlerProgress) => void) | null = null

function setup({
  ai = true,
  entry = '/home',
  view = 'palette' as 'palette' | 'search',
  askOstler = vi.fn(async (_id: string, _question: string, _options: AskOstlerOptions) => ({
    ok: true as const,
    value: ANSWER
  }))
} = {}) {
  const cancelAskOstler = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const createLibraryItem = vi.fn(
    async (projectId: string, input: { title: string; body?: string }) => ({
      ok: true as const,
      value: {
        id: 'note-1',
        projectId,
        kind: 'note',
        title: input.title,
        body: input.body
      } as unknown as LibraryItem
    })
  )
  const deleteLibraryItem = vi.fn(async (_projectId: string, _itemId: string) => ({
    ok: true as const,
    value: undefined
  }))
  installOstlerApi({
    createLibraryItem,
    deleteLibraryItem,
    search: async () => ({ ok: true, value: [] }),
    listSavedViews: async () => ({ ok: true, value: [] }),
    askOstler,
    cancelAskOstler,
    onAskOstlerProgress: (callback: (progress: AskOstlerProgress) => void) => {
      progressListener = callback
      return () => {
        progressListener = null
      }
    }
  })
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <StaticFeaturesProvider value={{ ai, agents: false }}>
          <AskOstlerProvider>
            <Routes>
              <Route
                path="*"
                element={
                  <>
                    {view === 'palette' ? (
                      <CommandPalette open onOpenChange={vi.fn()} onNewProject={vi.fn()} />
                    ) : (
                      <SearchView />
                    )}
                    <Where />
                  </>
                }
              />
            </Routes>
          </AskOstlerProvider>
        </StaticFeaturesProvider>
      </ToastProvider>
    </MemoryRouter>
  )
  return { askOstler, cancelAskOstler, createLibraryItem, deleteLibraryItem }
}

describe('Ask Ostler', () => {
  Element.prototype.scrollIntoView = vi.fn()
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    progressListener = null
  })

  it('opens from the command palette and answers with links to its sources', async () => {
    const { askOstler } = setup()
    fireEvent.change(screen.getByRole('combobox', { name: 'Command palette search' }), {
      target: { value: 'ask' }
    })
    fireEvent.click(await screen.findByRole('option', { name: /Ask Ostler…/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Ask Ostler' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Question' }), {
      target: { value: 'What about the tiles?' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))

    expect(askOstler).toHaveBeenCalledWith(expect.any(String), 'What about the tiles?', {
      searchFiles: true,
      earlier: []
    })
    const cite = await within(dialog).findByRole('button', {
      name: 'Open source 1: Bathroom tiles'
    })
    expect(within(dialog).getByText('docs/plan.md, lines 7 to 17')).toBeTruthy()
    fireEvent.click(cite)
    expect(screen.getByTestId('where').textContent).toBe('/projects/alpha/decisions?decision=d1')
    expect(screen.queryByRole('dialog', { name: 'Ask Ostler' })).toBeNull()
  })

  it('opens a file source at its lines in the Files tab', async () => {
    setup()
    fireEvent.change(screen.getByRole('combobox', { name: 'Command palette search' }), {
      target: { value: 'ask' }
    })
    fireEvent.click(await screen.findByRole('option', { name: /Ask Ostler…/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask Ostler' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Question' }), {
      target: { value: 'tiles' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Open source 2: docs/plan.md' })
    )
    expect(screen.getByTestId('where').textContent).toBe(
      '/projects/alpha/files?file=docs%2Fplan.md&line=7'
    )
  })

  it("takes Search's words from the button beside its box", async () => {
    const { askOstler } = setup({ view: 'search', entry: '/search?q=grant' })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Ostler' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask Ostler' })
    expect(
      (within(dialog).getByRole('textbox', { name: 'Question' }) as HTMLInputElement).value
    ).toBe('grant')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    expect(askOstler).toHaveBeenCalledWith(expect.any(String), 'grant', {
      searchFiles: true,
      earlier: []
    })
    expect(await within(dialog).findByRole('button', { name: /Open source 1/ })).toBeTruthy()
  })

  it('shows the progress line, and Stop cancels the ask', async () => {
    const askOstler = vi.fn(
      (_id: string, _question: string, _options: AskOstlerOptions) => new Promise<never>(() => {})
    )
    const { cancelAskOstler } = setup({ view: 'search', entry: '/search?q=tiles', askOstler })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Ostler' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask Ostler' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    const askId = askOstler.mock.calls[0][0]

    act(() => progressListener?.({ askId, stage: 'searching', projectCount: 4 }))
    expect(within(dialog).getByRole('status').textContent).toBe('Searching 4 projects…')
    act(() => progressListener?.({ askId, stage: 'writing', projectCount: 4 }))
    expect(within(dialog).getByRole('status').textContent).toBe('Writing the answer…')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }))
    expect(cancelAskOstler).toHaveBeenCalledWith(askId)
    expect(within(dialog).queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(within(dialog).getByText("Stopped. Ask again when you're ready.")).toBeTruthy()
  })

  it('remembers the Search file contents switch', async () => {
    const { askOstler } = setup({ view: 'search', entry: '/search?q=tiles' })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Ostler' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask Ostler' })
    const toggle = within(dialog).getByRole('switch', { name: /Search file contents/ })
    expect((toggle as HTMLInputElement).checked).toBe(true)
    fireEvent.click(toggle)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    expect(askOstler).toHaveBeenCalledWith(expect.any(String), 'tiles', {
      searchFiles: false,
      earlier: []
    })
    expect(localStorage.getItem('ostler.askOstler.searchFiles')).toBe('false')
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /Open source 1/ })).toBeTruthy()
    )
  })

  it('is hidden while Ostler AI is off', async () => {
    setup({ ai: false, view: 'search', entry: '/search?q=tiles' })
    expect(screen.queryByRole('button', { name: 'Ask Ostler' })).toBeNull()
  })

  it('is not in the palette while Ostler AI is off', async () => {
    setup({ ai: false })
    fireEvent.change(screen.getByRole('combobox', { name: 'Command palette search' }), {
      target: { value: 'ask' }
    })
    await waitFor(() => expect(screen.queryByRole('option', { name: /Ask Ostler/ })).toBeNull())
  })

  describe('follow-up questions (N8.3b)', () => {
    const FOLLOW_UP: AskOstlerAnswer = {
      ...ANSWER,
      answer: 'The kitchen is in Beta [1].',
      sources: [
        {
          number: 1,
          type: 'task',
          projectId: 'beta',
          id: 't9',
          title: 'Kitchen tiles',
          workItemId: 't9'
        }
      ]
    }
    const twoAnswers = () =>
      vi.fn(async (_id: string, question: string, _options: AskOstlerOptions) => ({
        ok: true as const,
        value: question.includes('kitchen') ? FOLLOW_UP : ANSWER
      }))
    const openAndAsk = async (question: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask Ostler' }))
      const dialog = await screen.findByRole('dialog', { name: 'Ask Ostler' })
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Question' }), {
        target: { value: question }
      })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
      await within(dialog).findByRole('button', { name: 'Open source 1: Bathroom tiles' })
      return dialog
    }
    const followUp = async (dialog: HTMLElement, question: string) => {
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Follow-up question' }), {
        target: { value: question }
      })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
      await within(dialog).findByRole('button', { name: 'Open source 1: Kitchen tiles' })
    }
    const closeButton = (dialog: HTMLElement) =>
      within(dialog).getByRole('button', { name: /^close/i })

    it('asks a follow-up with the conversation so far, each answer keeping its own sources', async () => {
      const askOstler = twoAnswers()
      setup({ view: 'search', entry: '/search', askOstler })
      const dialog = await openAndAsk('Which tiles?')
      await followUp(dialog, 'What about the kitchen?')

      expect(askOstler).toHaveBeenLastCalledWith(expect.any(String), 'What about the kitchen?', {
        searchFiles: true,
        earlier: [{ question: 'Which tiles?', answer: ANSWER.answer }]
      })
      const answers = within(dialog).getAllByRole('region')
      expect(answers).toHaveLength(2)
      expect(within(answers[0]).getByRole('heading', { name: 'Which tiles?' })).toBeTruthy()
      expect(
        within(answers[0]).getByRole('button', { name: 'Open source 1: Bathroom tiles' })
      ).toBeTruthy()
      expect(
        within(answers[1]).getByRole('button', { name: 'Open source 1: Kitchen tiles' })
      ).toBeTruthy()
    })

    it('starts again with New question', async () => {
      setup({ view: 'search', entry: '/search', askOstler: twoAnswers() })
      const dialog = await openAndAsk('Which tiles?')
      fireEvent.click(within(dialog).getByRole('button', { name: 'New question' }))
      expect(within(dialog).queryAllByRole('region')).toHaveLength(0)
      expect(within(dialog).getByRole('textbox', { name: 'Question' })).toBeTruthy()
    })

    it('closes one question at once, and asks first with more', async () => {
      setup({ view: 'search', entry: '/search', askOstler: twoAnswers() })
      let dialog = await openAndAsk('Which tiles?')
      fireEvent.click(closeButton(dialog))
      expect(screen.queryByRole('dialog', { name: 'Ask Ostler' })).toBeNull()

      dialog = await openAndAsk('Which tiles?')
      await followUp(dialog, 'What about the kitchen?')
      fireEvent.click(closeButton(dialog))
      const warning = await screen.findByRole('alertdialog', {
        name: 'This conversation is not saved. Close?'
      })
      expect(within(warning).getByRole('button', { name: 'Save as a note' })).toBeTruthy()
      fireEvent.click(within(warning).getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('dialog', { name: 'Ask Ostler' })).toBeTruthy()

      fireEvent.click(closeButton(dialog))
      const again = await screen.findByRole('alertdialog')
      fireEvent.click(within(again).getAllByRole('button', { name: 'Close' }).at(-1)!)
      expect(screen.queryByRole('dialog', { name: 'Ask Ostler' })).toBeNull()
    })

    it('asks first even when closed the moment the second answer shows', async () => {
      setup({ view: 'search', entry: '/search', askOstler: twoAnswers() })
      const dialog = await openAndAsk('Which tiles?')
      // Close as soon as the answer is on the page, before React's passive
      // effects have run: a fast click, or a test that has just found it.
      const observer = new MutationObserver(() => {
        if (!within(dialog).queryByRole('button', { name: 'Open source 1: Kitchen tiles' })) return
        observer.disconnect()
        fireEvent.click(closeButton(dialog))
      })
      observer.observe(document.body, { childList: true, subtree: true })
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Follow-up question' }), {
        target: { value: 'What about the kitchen?' }
      })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
      expect(
        await screen.findByRole('alertdialog', { name: 'This conversation is not saved. Close?' })
      ).toBeTruthy()
      observer.disconnect()
    })

    it('saves from the close warning into a chosen project, opens the note, and undoes', async () => {
      const { createLibraryItem, deleteLibraryItem } = setup({
        view: 'search',
        entry: '/search',
        askOstler: twoAnswers()
      })
      const dialog = await openAndAsk('Which tiles?')
      await followUp(dialog, 'What about the kitchen?')
      fireEvent.click(closeButton(dialog))
      const warning = await screen.findByRole('alertdialog')
      fireEvent.click(within(warning).getByRole('button', { name: 'Save as a note' }))

      const save = await screen.findByRole('dialog', { name: 'Save as a note' })
      // Default: the project most sources came from (two of three are Alpha's).
      const project = within(save).getByRole('combobox', { name: 'Project' }) as HTMLSelectElement
      expect(project.value).toBe('alpha')
      expect((within(save).getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
        'Which tiles?'
      )
      fireEvent.change(project, { target: { value: 'beta' } })
      fireEvent.click(within(save).getByRole('button', { name: 'Save note' }))

      await waitFor(() => expect(createLibraryItem).toHaveBeenCalled())
      const [projectId, input] = createLibraryItem.mock.calls[0]
      expect(projectId).toBe('beta')
      expect(input).toMatchObject({ kind: 'note', title: 'Which tiles?' })
      expect(input).not.toHaveProperty('aiAccess')
      expect(input.body).toContain('## Which tiles?')
      expect(input.body).toContain('## What about the kitchen?')
      expect(input.body).toContain('Sources from: Alpha launch, Beta house.')
      await waitFor(() =>
        expect(screen.getByTestId('where').textContent).toBe('/projects/beta/library?item=note-1')
      )
      expect(screen.queryByRole('dialog', { name: 'Ask Ostler' })).toBeNull()
      fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
      await waitFor(() => expect(deleteLibraryItem).toHaveBeenCalledWith('beta', 'note-1'))
    })
  })
})
