// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState, type ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  LinkedFromEntry,
  LinkTargetKind,
  SearchOptions,
  SearchResult
} from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { useItemLinkPicker } from '@renderer/hooks/useItemLinkPicker'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { CommentComposer } from '@renderer/views/planning/ActivityList'
import { DecisionFields, type DecisionDraftFields } from '@renderer/views/planning/DecisionFields'
import { LibraryEditor } from '@renderer/views/project-detail/library/LibraryEditor'
import { WorkItemDrawer } from '@renderer/views/planning/WorkItemDrawer'
import { LinkedFrom } from '@renderer/components/LinkedFrom'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, Drawer, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeWorkItem } from '../fixtures/planning-records'
import {
  emptyPlanningReads,
  renderPlanningWorkspace,
  withWorkspace
} from '../fixtures/planning-workspace'

afterEach(() => __resetDismissableStackForTests())

const S = BRAND.urlScheme
const P = '0f8fad5b-d9cb-469f-a165-70867728950e'
const TASK = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const MILESTONE = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b'

function hit(type: SearchResult['type'], id: string, title: string): SearchResult {
  return { type, id, projectId: P, title, snippet: [], workItemId: null, score: 0 } as SearchResult
}

/** Search as the picker calls it: the project's items, best first. */
function fakeSearch() {
  return vi.fn(async (_query: string, _options?: SearchOptions) => ({
    ok: true as const,
    value: [
      hit('task', TASK, 'Fix the header'),
      hit('comment', 'c1', 'Not offered'),
      hit('milestone', MILESTONE, 'Launch [beta]')
    ]
  }))
}

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}

const shell = (ui: ReactElement) => (
  <MemoryRouter>
    <ConfirmProvider>
      <ToastProvider>
        <StaticFeaturesProvider value={{ agents: false, ai: false }}>{ui}</StaticFeaturesProvider>
      </ToastProvider>
    </ConfirmProvider>
    <Routes>
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>
)

/** Types into a textarea as a person would: focused, caret at the end. */
function typeInto(area: HTMLTextAreaElement, text: string) {
  area.focus()
  fireEvent.change(area, { target: { value: text } })
  area.setSelectionRange(text.length, text.length)
  fireEvent.select(area)
}

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const links = useItemLinkPicker({ projectId: P, value, onChange: setValue, textRef: ref })
  return (
    <>
      <textarea
        aria-label="Text"
        ref={ref}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        {...links.inputProps}
      />
      {links.picker}
    </>
  )
}

const area = (name: string | RegExp) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement

describe('typing [[ (N4.4a)', () => {
  it('offers the project items through search and inserts a link by keyboard', async () => {
    const search = fakeSearch()
    installOstlerApi({ search })
    render(shell(<Harness />))
    typeInto(area('Text'), 'See [[fix')

    const list = await screen.findByRole('listbox')
    const options = await screen.findAllByRole('option')
    // Comments and goals are not things a link points at.
    expect(options.map((option) => option.textContent)).toEqual([
      'Fix the headerTask',
      'Launch [beta]Milestone'
    ])
    expect(search).toHaveBeenCalledWith('fix', {
      projectId: P,
      types: ['task', 'milestone', 'decision', 'library'],
      limit: 8
    })
    expect(area('Text').getAttribute('aria-controls')).toBe(list.id)
    expect(area('Text').getAttribute('aria-activedescendant')).toBe(options[0].id)

    fireEvent.keyDown(area('Text'), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(area('Text'), { key: 'Enter' })
    expect(area('Text').value).toBe(`See [Launch \\[beta\\]](${S}://milestone/${P}/${MILESTONE})`)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('leaves the typed text on Esc, and closes only the picker', async () => {
    installOstlerApi({ search: fakeSearch() })
    const onClose = vi.fn()
    render(
      shell(
        <Drawer id="holder" open onClose={onClose} title="Holder">
          <Harness />
        </Drawer>
      )
    )
    typeInto(area('Text'), 'See [[fix')
    await screen.findByRole('option', { name: /Fix the header/ })
    fireEvent.keyDown(area('Text'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(area('Text').value).toBe('See [[fix')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('works in a comment', async () => {
    installOstlerApi({ search: fakeSearch() })
    const onSubmit = vi.fn(async () => true)
    render(shell(<CommentComposer projectId={P} onSubmit={onSubmit} />))
    typeInto(area('Comment'), '[[fix')
    await screen.findByRole('option', { name: /Fix the header/ })
    fireEvent.keyDown(area('Comment'), { key: 'Enter', ctrlKey: false })
    expect(area('Comment').value).toBe(`[Fix the header](${S}://task/${P}/${TASK})`)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("works in a decision's fields", async () => {
    installOstlerApi({ search: fakeSearch() })
    function Fields() {
      const [value, setValue] = useState<DecisionDraftFields>({
        title: 'Supplier',
        date: '2026-10-17',
        context: '',
        decision: '',
        alternativesConsidered: '',
        consequences: '',
        linkedWorkItemIds: []
      })
      return (
        <DecisionFields
          value={value}
          onChange={(patch) => setValue((current) => ({ ...current, ...patch }))}
          workItems={[]}
          projectId={P}
        />
      )
    }
    render(shell(<Fields />))
    typeInto(area(/^Consequences/), 'Moves [[fix')
    await screen.findByRole('option', { name: /Fix the header/ })
    fireEvent.keyDown(area(/^Consequences/), { key: 'Enter' })
    expect(area(/^Consequences/).value).toBe(`Moves [Fix the header](${S}://task/${P}/${TASK})`)
  })

  it('works in the Library editor', async () => {
    installOstlerApi({ search: fakeSearch() })
    render(
      shell(
        <LibraryEditor
          projectId={P}
          item={null}
          kind="note"
          onClose={() => {}}
          onSaved={() => {}}
        />
      )
    )
    const body = area(/Text/)
    typeInto(body, 'Notes [[fix')
    await screen.findByRole('option', { name: /Fix the header/ })
    fireEvent.keyDown(body, { key: 'Enter' })
    expect(body.value).toBe(`Notes [Fix the header](${S}://task/${P}/${TASK})`)
  })

  it("works in a task's description", async () => {
    const task = makeWorkItem('a', { title: 'Plan', projectId: P })
    const base = await renderPlanningWorkspace({
      api: { search: fakeSearch(), getLinkedFrom: async () => ({ ok: true, value: [] }) }
    })
    function Drawer() {
      const [description, setDescription] = useState('')
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const description = area('Description')
    typeInto(description, 'Needs [[fix')
    await screen.findByRole('option', { name: /Fix the header/ })
    fireEvent.keyDown(description, { key: 'Enter' })
    expect(description.value).toBe(`Needs [Fix the header](${S}://task/${P}/${TASK})`)
  })
})

describe('Linked from (N4.4a)', () => {
  const entries: LinkedFromEntry[] = [
    { sourceKind: 'task', sourceId: 't1', projectId: P, title: 'Plan', workItemId: 't1' },
    {
      sourceKind: 'comment',
      sourceId: 'c1',
      projectId: P,
      title: 'Fix the header',
      workItemId: 't2'
    },
    {
      sourceKind: 'decision',
      sourceId: 'd1',
      projectId: P,
      title: 'Use the new supplier',
      workItemId: null
    },
    { sourceKind: 'library', sourceId: 'l1', projectId: P, title: 'Meeting', workItemId: null }
  ]

  it.each<LinkTargetKind>(['task', 'milestone', 'decision', 'library'])(
    'lists what links to a %s, each opening its source',
    async (kind) => {
      const getLinkedFrom = vi.fn(async () => ({ ok: true as const, value: entries }))
      installOstlerApi({ getLinkedFrom })
      const onOpen = vi.fn()
      render(shell(<LinkedFrom kind={kind} id="x1" onOpen={onOpen} />))
      const region = await screen.findByRole('region', { name: 'Linked from' })
      expect(getLinkedFrom).toHaveBeenCalledWith(kind, 'x1')
      expect([...region.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
        'Task: Plan',
        'Comment on “Fix the header”',
        'Decision: Use the new supplier',
        'Library: Meeting'
      ])
      fireEvent.click(screen.getByRole('button', { name: 'Comment on “Fix the header”' }))
      expect(onOpen).toHaveBeenCalled()
      expect(screen.getByTestId('where').textContent).toBe(`/projects/${P}/tasks/t2`)
      fireEvent.click(screen.getByRole('button', { name: 'Library: Meeting' }))
      expect(screen.getByTestId('where').textContent).toBe(`/projects/${P}/library?item=l1`)
    }
  )

  it('shows nothing while nothing links here', async () => {
    const getLinkedFrom = vi.fn(async () => ({ ok: true as const, value: [] }))
    installOstlerApi({ getLinkedFrom })
    render(shell(<LinkedFrom kind="task" id="x1" />))
    await waitFor(() => expect(getLinkedFrom).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Linked from' })).toBeNull()
  })

  it("appears in a task's drawer", async () => {
    const task = makeWorkItem('a', { title: 'Fix the header', projectId: P })
    const base = await renderPlanningWorkspace({
      api: { ...emptyPlanningReads(), getLinkedFrom: async () => ({ ok: true, value: entries }) }
    })
    const ws = withWorkspace(base, {
      selectedWorkItem: task,
      selectedWorkItemId: task.id,
      workItems: [task],
      workItemsById: new Map([[task.id, task]]),
      editTitle: task.title,
      editStatus: task.status,
      editDependencyIds: []
    })
    render(shell(<WorkItemDrawer ws={ws} />))
    expect(
      await screen.findByRole('button', { name: 'Decision: Use the new supplier' })
    ).toBeTruthy()
  })
})
