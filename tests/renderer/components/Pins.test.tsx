// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreatePinInput,
  OstlerAPI,
  Pin,
  PinView,
  PlanningWorkItem,
  RendererProject
} from '@shared/ostler-api'
import { PinsProvider, usePins, type PinTarget } from '@renderer/pins/PinsProvider'
import { PinnedSection } from '@renderer/pins/PinnedSection'
import { OverviewShortcuts } from '@renderer/pins/OverviewShortcuts'
import { CommandPalette } from '@renderer/components/CommandPalette'
import { PlanningCard } from '@renderer/views/planning/PlanningCard'
import { ConfirmProvider, Menu, ToastProvider } from '@renderer/ui'
import { renderPlanningWorkspace } from '../fixtures/planning-workspace'
import { installOstlerApi } from '../fixtures/ostler-api'

const P1 = 'p1'

const projects: RendererProject[] = [
  {
    id: P1,
    name: 'Shop',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    hasAutomationToken: false,
    areaId: null,
    icon: null
  } as RendererProject
]

vi.mock('@renderer/context/OstlerContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/context/OstlerContext')>()),
  useOstler: () => ({ projects, areas: [], refreshProjects: async () => {} })
}))

function pinView(overrides: Partial<PinView>): PinView {
  return {
    id: 'pin-1',
    place: 'sidebar',
    projectId: P1,
    kind: 'task',
    targetId: 't1',
    orderKey: 'V',
    createdAt: 1,
    exists: true,
    title: 'Fix the header',
    archived: false,
    ...overrides
  }
}

/** A fake pin store behind the API, as main keeps it. */
function pinsApi(initial: PinView[] = []) {
  let pins = [...initial]
  let next = 100
  const api = {
    listPins: vi.fn(async (query: { place: string; projectId?: string }) => ({
      ok: true as const,
      value: pins.filter(
        (pin) =>
          pin.place === query.place &&
          (query.place === 'sidebar' || pin.projectId === query.projectId)
      )
    })),
    createPin: vi.fn(async (input: CreatePinInput) => {
      const made = pinView({
        id: `pin-${next++}`,
        place: input.place,
        kind: input.kind,
        targetId: input.targetId,
        projectId: input.projectId ?? P1,
        title: 'Made'
      })
      pins = [...pins, made]
      return { ok: true as const, value: made }
    }),
    deletePin: vi.fn(async (pinId: string) => {
      const gone = pins.find((pin) => pin.id === pinId)!
      pins = pins.filter((pin) => pin.id !== pinId)
      return { ok: true as const, value: gone as Pin }
    }),
    restorePin: vi.fn(async (pin: Pin) => {
      pins = [...pins, pin as PinView]
      return { ok: true as const, value: pin as PinView }
    }),
    movePin: vi.fn(async (pinId: string) => ({
      ok: true as const,
      value: pins.find((pin) => pin.id === pinId)!
    })),
    openLibraryItemExternally: vi.fn(async () => ({ ok: true as const, value: undefined }))
  }
  return api
}

function Where() {
  return <span data-testid="where">{useLocation().pathname + useLocation().search}</span>
}

function renderWithPins(ui: ReactElement, path = '/home') {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="*"
              element={
                <PinsProvider>
                  {ui}
                  <Where />
                </PinsProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>
  )
}

const where = () => screen.getByTestId('where').textContent

describe('pinning from menus (N5.2a)', () => {
  beforeEach(() => window.localStorage.clear())

  function MenuOf({ target }: { target: PinTarget }) {
    const pins = usePins()
    return <Menu label="Item actions" items={() => pins.menuItems(target)} />
  }

  it.each([
    ['task', 't1'],
    ['milestone', 'm1'],
    ['decision', 'd1'],
    ['library', 'l1'],
    ['saved-view', 'v1'],
    ['project-view', 'board']
  ] as const)('pins a %s to the sidebar and to the Overview', async (kind, targetId) => {
    const api = pinsApi()
    installOstlerApi(api as Partial<OstlerAPI>)
    renderWithPins(<MenuOf target={{ kind, targetId, projectId: P1, title: 'Thing' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Item actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin to sidebar' }))
    await waitFor(() =>
      expect(api.createPin).toHaveBeenCalledWith({
        place: 'sidebar',
        kind,
        targetId,
        projectId: P1
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Item actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin to Overview' }))
    await waitFor(() =>
      expect(api.createPin).toHaveBeenCalledWith({
        place: 'overview',
        kind,
        targetId,
        projectId: P1
      })
    )
  })

  it("offers Unpin once pinned, with undo, from a task card's menu", async () => {
    const base = await renderPlanningWorkspace()
    const api = pinsApi([pinView({ targetId: 'wi-1', title: 'Persist agent transcripts' })])
    installOstlerApi({ ...(api as Partial<OstlerAPI>) })
    const item = {
      ...base.workItems[0],
      id: 'wi-1',
      projectId: P1,
      title: 'Persist agent transcripts',
      status: 'ready',
      priority: 'medium',
      labels: [],
      acceptanceCriteria: [],
      checkedCriteria: [],
      dependencyIds: [],
      createdAt: Date.now()
    } as unknown as PlanningWorkItem
    renderWithPins(<PlanningCard item={item} ws={base} />)
    await waitFor(() => expect(api.listPins).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unpin from sidebar' }))
    await waitFor(() => expect(api.deletePin).toHaveBeenCalledWith('pin-1'))
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(api.restorePin).toHaveBeenCalled())
  })
})

describe('the Pinned section (N5.2a)', () => {
  beforeEach(() => window.localStorage.clear())
  Element.prototype.scrollIntoView = vi.fn()

  const three = [
    pinView({ id: 'a', title: 'Fix the header' }),
    pinView({ id: 'b', kind: 'milestone', targetId: 'm1', title: 'Launch', archived: false }),
    pinView({ id: 'c', kind: 'decision', targetId: 'gone', exists: false, title: null })
  ]

  it('shows nothing until something is pinned', async () => {
    const api = pinsApi()
    installOstlerApi(api as Partial<OstlerAPI>)
    renderWithPins(<PinnedSection projects={projects} collapsed={false} />)
    await waitFor(() => expect(api.listPins).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Pinned' })).toBeNull()
  })

  it('lists pins with current titles, says Gone with Unpin, and folds', async () => {
    const api = pinsApi(three)
    installOstlerApi(api as Partial<OstlerAPI>)
    renderWithPins(<PinnedSection projects={projects} collapsed={false} />)
    const region = await screen.findByRole('region', { name: 'Pinned' })
    const buttons = within(region)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent)
    expect(buttons).toEqual(['Pinned', 'Fix the header, Shop', 'Launch, Shop', 'Gone', 'Unpin'])
    fireEvent.click(within(region).getByRole('button', { name: 'Unpin' }))
    await waitFor(() => expect(api.deletePin).toHaveBeenCalledWith('c'))

    fireEvent.click(within(region).getByRole('button', { name: 'Pinned' }))
    expect(within(region).queryByRole('list')).toBeNull()
    expect(within(region).getByText('2 pins')).toBeTruthy()
  })

  it('moves a pin with Alt+arrow keys, its menu and by dragging', async () => {
    const api = pinsApi(three)
    installOstlerApi(api as Partial<OstlerAPI>)
    renderWithPins(<PinnedSection projects={projects} collapsed={false} />)
    const first = await screen.findByRole('button', { name: 'Fix the header, Shop' })
    fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true })
    await waitFor(() => expect(api.movePin).toHaveBeenCalledWith('a', { afterId: 'b' }))

    const launch = screen.getByRole('button', { name: 'Launch, Shop' })
    fireEvent.contextMenu(launch)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move down' }))
    await waitFor(() => expect(api.movePin).toHaveBeenCalledTimes(2))

    const store = new Map<string, string>()
    const dataTransfer = {
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? '',
      effectAllowed: ''
    }
    const items = () => screen.getByRole('region', { name: 'Pinned' }).querySelectorAll('li')
    fireEvent.dragStart(screen.getByRole('button', { name: 'Gone' }), { dataTransfer })
    fireEvent.drop(items()[0], { dataTransfer })
    await waitFor(() =>
      expect(api.movePin).toHaveBeenLastCalledWith('c', { beforeId: expect.any(String) })
    )
  })

  it('opens a task in its drawer, and asks before a link or a file leaves the app', async () => {
    const api = pinsApi([
      pinView({ id: 't', title: 'Fix the header' }),
      pinView({
        id: 'l',
        kind: 'library',
        targetId: 'l1',
        title: 'Shop admin',
        libraryKind: 'link',
        url: 'https://shop.example.com/admin'
      }),
      pinView({
        id: 'f',
        kind: 'library',
        targetId: 'f1',
        title: 'Price list',
        libraryKind: 'document'
      })
    ])
    installOstlerApi(api as Partial<OstlerAPI>)
    renderWithPins(<PinnedSection projects={projects} collapsed={false} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Fix the header, Shop' }))
    expect(where()).toBe('/projects/p1/tasks/t1')

    fireEvent.click(screen.getByRole('button', { name: 'Shop admin, Shop' }))
    const linkDialog = await screen.findByRole('alertdialog', { name: 'Open this link?' })
    // The address shows before anything opens.
    expect(linkDialog.textContent).toContain('https://shop.example.com/admin')
    expect(api.openLibraryItemExternally).not.toHaveBeenCalled()
    fireEvent.click(within(linkDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(api.openLibraryItemExternally).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Price list, Shop' }))
    const fileDialog = await screen.findByRole('alertdialog', {
      name: 'Open Price list in its app?'
    })
    fireEvent.click(within(fileDialog).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(api.openLibraryItemExternally).toHaveBeenCalledWith(P1, 'f1'))
  })
})

describe("the Overview's Shortcuts (N5.2a)", () => {
  it("shows the project's shortcuts and adds a new https link as one", async () => {
    const api = {
      ...pinsApi([
        pinView({
          id: 's',
          place: 'overview',
          kind: 'project-view',
          targetId: 'board',
          title: null
        })
      ]),
      listSavedViews: vi.fn(async () => ({ ok: true as const, value: [] })),
      search: vi.fn(async () => ({ ok: true as const, value: [] })),
      createLibraryItem: vi.fn(async () => ({
        ok: true as const,
        value: { id: 'new-link', title: 'Shop admin' }
      }))
    }
    installOstlerApi(api as unknown as Partial<OstlerAPI>)
    renderWithPins(<OverviewShortcuts project={projects[0]} />, '/projects/p1/overview')
    const region = await screen.findByRole('region', { name: 'Shortcuts' })
    await within(region).findByRole('button', { name: 'Board' })

    fireEvent.click(within(region).getByRole('button', { name: 'Add a shortcut' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a shortcut' })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'A new link' }))
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Shop admin' } })
    fireEvent.change(within(dialog).getByLabelText(/Address/), {
      target: { value: 'http://shop.example.com' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add shortcut' }))
    expect(await within(dialog).findByText('Enter an https address.')).toBeTruthy()
    expect(api.createLibraryItem).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText(/Address/), {
      target: { value: 'https://shop.example.com/admin' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add shortcut' }))
    await waitFor(() =>
      expect(api.createLibraryItem).toHaveBeenCalledWith(P1, {
        kind: 'link',
        title: 'Shop admin',
        url: 'https://shop.example.com/admin',
        body: ''
      })
    )
    await waitFor(() =>
      expect(api.createPin).toHaveBeenCalledWith({
        place: 'overview',
        kind: 'library',
        targetId: 'new-link',
        projectId: P1
      })
    )
  })

  it('pins an existing view of the project from Add a shortcut', async () => {
    const api = {
      ...pinsApi(),
      listSavedViews: vi.fn(async () => ({ ok: true as const, value: [] })),
      search: vi.fn(async () => ({ ok: true as const, value: [] }))
    }
    installOstlerApi(api as unknown as Partial<OstlerAPI>)
    renderWithPins(<OverviewShortcuts project={projects[0]} />, '/projects/p1/overview')
    fireEvent.click(await screen.findByRole('button', { name: 'Add a shortcut' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a shortcut' })
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'calen' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Calendar' }))
    await waitFor(() =>
      expect(api.createPin).toHaveBeenCalledWith({
        place: 'overview',
        kind: 'project-view',
        targetId: 'calendar',
        projectId: P1
      })
    )
  })
})

describe('pins in the command palette (N5.2a)', () => {
  Element.prototype.scrollIntoView = vi.fn()

  it('puts matching pins first, then everything else', async () => {
    const api = {
      ...pinsApi([pinView({ id: 'm', kind: 'milestone', targetId: 'm1', title: 'Shop launch' })]),
      listSavedViews: vi.fn(async () => ({ ok: true as const, value: [] })),
      search: vi.fn(async () => ({ ok: true as const, value: [] }))
    }
    installOstlerApi(api as unknown as Partial<OstlerAPI>)
    renderWithPins(<CommandPalette open onOpenChange={() => {}} onNewProject={() => {}} />)
    await waitFor(() => expect(api.listPins).toHaveBeenCalled())
    const search = screen.getByRole('combobox', { name: 'Command palette search' })
    await act(async () => {
      fireEvent.change(search, { target: { value: 'shop' } })
    })
    const options = await screen.findAllByRole('option')
    expect(options[0].textContent).toContain('Shop launch')
    // The project itself still matches, after the pin.
    expect(options.some((option) => option.textContent?.startsWith('Shop'))).toBe(true)
    fireEvent.click(options[0])
    expect(where()).toBe('/projects/p1/milestones?edit=milestone%3Am1')
  })

  it('pins something to the sidebar with Pin…', async () => {
    const api = {
      ...pinsApi(),
      listSavedViews: vi.fn(async () => ({ ok: true as const, value: [] })),
      search: vi.fn(async () => ({
        ok: true as const,
        value: [
          {
            type: 'decision' as const,
            id: 'd1',
            projectId: P1,
            title: 'Use the new supplier',
            snippet: [],
            workItemId: null,
            score: -1
          }
        ]
      }))
    }
    installOstlerApi(api as unknown as Partial<OstlerAPI>)
    renderWithPins(<CommandPalette open onOpenChange={() => {}} onNewProject={() => {}} />)
    const search = screen.getByRole('combobox', { name: 'Command palette search' })
    fireEvent.change(search, { target: { value: 'pin' } })
    await waitFor(() => expect(api.listPins).toHaveBeenCalled())
    const pick = screen
      .getAllByRole('option')
      .find((option) => option.textContent?.startsWith('Pin…'))!
    fireEvent.click(pick)
    fireEvent.change(search, { target: { value: 'supplier' } })
    fireEvent.click(await screen.findByRole('option', { name: /Use the new supplier/ }))
    await waitFor(() =>
      expect(api.createPin).toHaveBeenCalledWith({
        place: 'sidebar',
        kind: 'decision',
        targetId: 'd1',
        projectId: P1
      })
    )
  })
})
