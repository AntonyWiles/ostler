// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlanTab } from '@renderer/views/workspace/PlanTab'
import { forgetOpenWhiteboards } from '@renderer/views/workspace/plan/open-whiteboards'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import type {
  ItemLinkInfo,
  LibraryItem,
  OstlerAPI,
  ProjectStateUpdate,
  RendererProject
} from '@shared/ostler-api'
import { t } from '@shared/i18n'
import {
  cleanWhiteboardObject,
  type CreateWhiteboardInput,
  type WhiteboardObjectInput
} from '@shared/whiteboard/model'
import { RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'
import { renderPlanningWorkspace } from '../../fixtures/planning-workspace'

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [], refreshProjects: async () => {} })
}))

vi.mock('@renderer/views/project-detail/ProjectBriefCard', () => ({
  ProjectBriefCard: () => null
}))

const project = {
  id: 'p1',
  name: 'Alpha',
  path: null,
  color: '#2563EB',
  hasAutomationToken: false,
  stage: 'planning'
} as unknown as RendererProject

function board(id: string, title: string, updatedAt = '2026-10-26T10:00:00.000Z'): LibraryItem {
  return {
    id,
    projectId: 'p1',
    kind: 'whiteboard',
    title,
    summary: '',
    body: '',
    url: null,
    file: null,
    aiAccess: 'full',
    isPrimaryBrief: false,
    tags: [],
    revision: 1,
    createdAt: updatedAt,
    updatedAt,
    archivedAt: null
  } as unknown as LibraryItem
}

/** A Library holding whiteboards, made and opened through the fake API. */
function whiteboardApi(
  boards: LibraryItem[],
  options: {
    missing?: boolean
    objects?: WhiteboardObjectInput[]
    links?: ItemLinkInfo[]
    openExternalLink?: OstlerAPI['openExternalLink']
  } = {}
) {
  const listeners = new Set<(update: ProjectStateUpdate) => void>()
  const created: string[] = []
  const inputs: CreateWhiteboardInput[] = []
  const api: Partial<OstlerAPI> = {
    getConfig: async () => ({ ok: true, value: RENDERER_DEFAULT_CONFIG }),
    listLibraryItems: async () => ({ ok: true, value: [...boards] }),
    createWhiteboard: async (_projectId, input) => {
      const item = board(`wb${boards.length + 1}`, input.title)
      boards.push(item)
      created.push(input.title)
      inputs.push(input)
      for (const listener of listeners) {
        listener({ projectId: 'p1', field: 'library', data: null } as ProjectStateUpdate)
      }
      return { ok: true, value: { item, objects: [] } }
    },
    getWhiteboard: async (_projectId, id) => {
      const item = boards.find((each) => each.id === id)
      if (!item || options.missing) {
        return { ok: false, error: t('errors:whiteboard.notAWhiteboard') }
      }
      const objects = (options.objects ?? []).map((object) => ({
        ...object,
        createdAt: '',
        updatedAt: ''
      }))
      return { ok: true, value: { item, objects } }
    },
    saveWhiteboard: async (_projectId, id) => ({
      ok: true,
      value: { item: boards.find((each) => each.id === id)!, savedAt: '' }
    }),
    getShareState: async () => ({ ok: true, value: null }),
    resolveItemLinks: async () => ({ ok: true, value: options.links ?? [] }),
    ...(options.openExternalLink ? { openExternalLink: options.openExternalLink } : {}),
    onProjectStateChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
  return { api, created, inputs }
}

/** Shows where the app is, and drops the query as the task drawer's route does. */
function Where() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <p data-testid="where">{location.pathname + location.search}</p>
      <button type="button" onClick={() => navigate('/projects/p1/plan/task/w1')}>
        Open a task
      </button>
    </>
  )
}

async function renderPlan(api: Partial<OstlerAPI>, entry = '/projects/p1/plan') {
  const ws = await renderPlanningWorkspace({ projectId: 'p1', api })
  return render(
    <StaticPeopleProvider people={[]}>
      <MemoryRouter initialEntries={[entry]}>
        <StaticFeaturesProvider value={{ agents: false, ai: false }}>
          <PlanTab
            project={project}
            ws={ws}
            features={{ hasFolder: false, agents: false, ai: false }}
            suggestTasks={{ busy: false, start: () => {} }}
          />
          <Where />
        </StaticFeaturesProvider>
      </MemoryRouter>
    </StaticPeopleProvider>
  )
}

const where = () => screen.getByTestId('where').textContent
const entry = () => screen.getByRole('button', { name: /^Whiteboards/ })
const boardHeading = (name: string) => screen.findByRole('heading', { level: 2, name })
const newDialog = () => screen.findByRole('dialog', { name: 'New whiteboard' })
/** New whiteboard, then Create in its dialog. */
async function makeWhiteboard() {
  fireEvent.click(await screen.findByRole('button', { name: 'New whiteboard' }))
  fireEvent.click(within(await newDialog()).getByRole('button', { name: 'Create' }))
}
/** The Whiteboards pane, then New whiteboard: its dialog. */
async function openNewDialog() {
  fireEvent.click(entry())
  fireEvent.click(await screen.findByRole('button', { name: 'New whiteboard' }))
  return newDialog()
}

// A board left open on one case's Plan would open again on the next one's.
afterEach(() => forgetOpenWhiteboards())

describe('Plan, Whiteboards', () => {
  it('opens the board again after another view, until Back to the plan closes it', async () => {
    const { api } = whiteboardApi([board('wb1', 'Ideas')])
    const first = await renderPlan(api, '/projects/p1/plan?whiteboard=wb1')
    expect(await boardHeading('Ideas')).toBeInTheDocument()
    // Board, or any other view, then back to the Plan.
    first.unmount()
    const second = await renderPlan(api)
    expect(await boardHeading('Ideas')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to the plan' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Ideas' })).toBeNull())
    second.unmount()
    await renderPlan(api)
    expect(screen.getByRole('navigation', { name: 'Plan steps' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Ideas' })).toBeNull()
  })

  it('lists the Whiteboards entry below the steps, not as a step', async () => {
    const { api } = whiteboardApi([board('wb1', 'Ideas'), board('wb2', 'Map')])
    await renderPlan(api)

    const steps = screen.getByRole('navigation', { name: 'Plan steps' })
    const names = within(steps)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(names.some((name) => name?.startsWith('Whiteboards'))).toBe(false)
    expect(names.at(-1)).toMatch(/^StartTo do4 steps to go$/)
    expect(steps.compareDocumentPosition(entry()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(entry()).not.toHaveTextContent('To do')
    expect(entry()).not.toHaveTextContent('Done')
    expect(await within(entry()).findByText('2 whiteboards')).toBeInTheDocument()
  })

  it('lists whiteboards newest first, and makes Whiteboard 1 then Whiteboard 2', async () => {
    const { api, created } = whiteboardApi([])
    await renderPlan(api)

    fireEvent.click(entry())
    expect(entry()).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('heading', { level: 2, name: 'Whiteboards' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'No whiteboards yet' })).toBeInTheDocument()

    await makeWhiteboard()
    expect(await boardHeading('Whiteboard 1')).toBeInTheDocument()
    expect(where()).toBe('/projects/p1/plan?whiteboard=wb1')

    fireEvent.click(screen.getByRole('button', { name: 'Back to the plan' }))
    await makeWhiteboard()
    expect(await boardHeading('Whiteboard 2')).toBeInTheDocument()
    expect(created).toEqual(['Whiteboard 1', 'Whiteboard 2'])

    fireEvent.click(screen.getByRole('button', { name: 'Back to the plan' }))
    const rows = await screen.findAllByRole('button', { name: /^Open Whiteboard/ })
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Open Whiteboard 1',
      'Open Whiteboard 2'
    ])
  })

  it('opens a whiteboard over the whole page and puts it in the address', async () => {
    const { api } = whiteboardApi([
      board('wb1', 'Old', '2026-10-01T10:00:00.000Z'),
      board('wb2', 'New', '2026-10-20T10:00:00.000Z')
    ])
    await renderPlan(api)

    fireEvent.click(entry())
    const rows = await screen.findAllByRole('button', { name: /^Open (New|Old)$/ })
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Open New', 'Open Old'])
    fireEvent.click(screen.getByRole('button', { name: 'Open Old' }))

    expect(await boardHeading('Old')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Plan steps' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Whiteboards/ })).not.toBeInTheDocument()
    expect(where()).toBe('/projects/p1/plan?whiteboard=wb1')
  })

  it('goes back to the list with Back to the plan, removing the parameter', async () => {
    const { api } = whiteboardApi([board('wb1', 'Ideas')])
    await renderPlan(api, '/projects/p1/plan?whiteboard=wb1')
    expect(await boardHeading('Ideas')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to the plan' }))

    expect(where()).toBe('/projects/p1/plan')
    expect(entry()).toHaveAttribute('aria-current', 'true')
    expect(await screen.findByRole('button', { name: 'Open Ideas' })).toBeInTheDocument()
  })

  it('opens the whiteboard the address names', async () => {
    const { api } = whiteboardApi([board('wb1', 'Ideas'), board('wb2', 'Map')])
    await renderPlan(api, '/projects/p1/plan?whiteboard=wb2')

    expect(await boardHeading('Map')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Whiteboard: Map' })).toBeInTheDocument()
  })

  it('keeps the whiteboard open when the parameter goes', async () => {
    const { api } = whiteboardApi([board('wb1', 'Ideas')])
    await renderPlan(api, '/projects/p1/plan?whiteboard=wb1')
    expect(await boardHeading('Ideas')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open a task' }))

    expect(where()).toBe('/projects/p1/plan/task/w1')
    expect(screen.getByRole('heading', { level: 2, name: 'Ideas' })).toBeInTheDocument()
  })

  it('opens the New whiteboard dialog for ?newWhiteboard=1, and Create opens the board', async () => {
    const { api, created } = whiteboardApi([board('wb1', 'Whiteboard 1')])
    await renderPlan(api, '/projects/p1/plan?newWhiteboard=1')

    const dialog = await newDialog()
    expect(entry()).toHaveAttribute('aria-current', 'true')
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('Whiteboard 2')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await boardHeading('Whiteboard 2')).toBeInTheDocument()
    expect(where()).toBe('/projects/p1/plan?whiteboard=wb2')
    expect(created).toEqual(['Whiteboard 2'])

    fireEvent.click(screen.getByRole('button', { name: 'Back to the plan' }))
    expect(entry()).toHaveAttribute('aria-current', 'true')
    expect(await screen.findByRole('button', { name: 'Open Whiteboard 2' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(created).toEqual(['Whiteboard 2'])
  })

  it('removes ?newWhiteboard=1 on Cancel and makes nothing', async () => {
    const { api, created } = whiteboardApi([])
    await renderPlan(api, '/projects/p1/plan?newWhiteboard=1')

    fireEvent.click(within(await newDialog()).getByRole('button', { name: 'Cancel' }))

    expect(where()).toBe('/projects/p1/plan')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(entry()).toHaveAttribute('aria-current', 'true')
    expect(created).toEqual([])
  })

  it('opens New whiteboard with the default title and the five templates, Blank chosen', async () => {
    const { api } = whiteboardApi([board('wb1', 'Whiteboard 1')])
    await renderPlan(api)

    const dialog = await openNewDialog()
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('Whiteboard 2')
    const group = within(dialog).getByRole('group', { name: 'Start from' })
    expect(within(group).getAllByRole('radio')).toHaveLength(5)
    for (const name of [
      'Blank',
      'Brainstorm',
      'Retrospective',
      'Project kick-off',
      'Journey map'
    ]) {
      expect(within(group).getByRole('radio', { name })).toBeInTheDocument()
    }
    expect(within(group).getByRole('radio', { name: 'Blank' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Retrospective' })).toHaveAccessibleDescription(
      'Look back together: what went well, what could be better and what to try next.'
    )
  })

  it('makes a Retrospective board with its title and three frames', async () => {
    const { api, inputs } = whiteboardApi([])
    await renderPlan(api)

    const dialog = await openNewDialog()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Retrospective' }))
    expect(within(dialog).getByRole('radio', { name: 'Retrospective' })).toBeChecked()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await boardHeading('Whiteboard 1')).toBeInTheDocument()
    expect(inputs).toHaveLength(1)
    const objects = inputs[0].objects ?? []
    expect(objects.map((object) => object.kind).sort()).toEqual(['frame', 'frame', 'frame', 'text'])
    expect(objects.find((object) => object.kind === 'text')?.text).toBe('Retrospective')
  })

  it('makes nothing on Cancel', async () => {
    const { api, created } = whiteboardApi([])
    await renderPlan(api)

    fireEvent.click(within(await openNewDialog()).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(where()).toBe('/projects/p1/plan')
    expect(created).toEqual([])
  })

  it('shows a refusal in the dialog and keeps it open', async () => {
    const { api } = whiteboardApi([])
    api.createWhiteboard = async () => ({ ok: false, error: 'The title is too long.' })
    await renderPlan(api)

    const dialog = await openNewDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await within(dialog).findByText('The title is too long.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'New whiteboard' })).toBeInTheDocument()
  })

  it('imports a whiteboard file, closes and opens the new board (prompt 16)', async () => {
    const boards = [board('wb1', 'Whiteboard 1')]
    const { api } = whiteboardApi(boards)
    api.importWhiteboardFile = async () => {
      const item = board('wb2', 'Launch plan')
      boards.push(item)
      return { ok: true, value: item }
    }
    await renderPlan(api)

    const dialog = await openNewDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import a whiteboard file…' }))

    expect(await boardHeading('Launch plan')).toBeInTheDocument()
    expect(where()).toBe('/projects/p1/plan?whiteboard=wb2')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows an import refusal in the dialog and keeps it open (prompt 16)', async () => {
    const { api } = whiteboardApi([])
    api.importWhiteboardFile = async () => ({
      ok: false,
      error: t('errors:whiteboard.file.not-whiteboard')
    })
    await renderPlan(api)

    const dialog = await openNewDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import a whiteboard file…' }))

    expect(
      await within(dialog).findByText("This file isn't a whiteboard file.")
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'New whiteboard' })).toBeInTheDocument()
  })

  it('says so when the whiteboard is not there, with a way back', async () => {
    const { api } = whiteboardApi([board('wb1', 'Ideas')], { missing: true })
    await renderPlan(api, '/projects/p1/plan?whiteboard=wb1')

    expect(
      await screen.findByRole('heading', { name: "This whiteboard isn't here any more" })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the plan' }))
    expect(where()).toBe('/projects/p1/plan')
    expect(await screen.findByRole('button', { name: 'Open Ideas' })).toBeInTheDocument()
  })
})

describe('Plan, opening a whiteboard object’s link (prompt 12)', () => {
  const PROJECT = '11111111-2222-4333-8444-555555555555'
  const TASK = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const TASK_LINK = `ostler://task/${PROJECT}/${TASK}`
  const note = (link: string) =>
    cleanWhiteboardObject({
      id: 'n',
      kind: 'note',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      z: 1,
      text: 'Buy milk',
      link
    })
  const taskInfo = (exists: boolean): ItemLinkInfo =>
    ({
      kind: 'task',
      projectId: PROJECT,
      id: TASK,
      exists,
      title: 'Fix the header'
    }) as ItemLinkInfo

  /** Presses O on the board's one note. */
  async function openTheLink() {
    const object = await screen.findByRole('button', { name: /^Note: Buy milk/ })
    act(() => object.focus())
    fireEvent.keyDown(object, { key: 'o' })
  }

  it('opens a linked task in its drawer, and the board stays open under it', async () => {
    const { api } = whiteboardApi([board('wb1', 'Ideas')], {
      objects: [note(TASK_LINK)],
      links: [taskInfo(true)]
    })
    await renderPlan(api, '/projects/p1/plan?whiteboard=wb1')
    await openTheLink()

    await waitFor(() => expect(where()).toBe(`/projects/${PROJECT}/tasks/${TASK}`))
    expect(screen.getByRole('heading', { level: 2, name: 'Ideas' })).toBeInTheDocument()
  })

  it('stays put for a deleted item', async () => {
    const { api } = whiteboardApi([board('wb1', 'Ideas')], {
      objects: [note(TASK_LINK)],
      links: [taskInfo(false)]
    })
    await renderPlan(api, '/projects/p1/plan?whiteboard=wb1')
    await screen.findByRole('button', { name: 'Note: Buy milk, linked to a deleted item' })
    await openTheLink()
    await act(async () => {})

    expect(where()).toBe('/projects/p1/plan?whiteboard=wb1')
  })

  it('opens a web address in the browser', async () => {
    const openExternalLink = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const { api } = whiteboardApi([board('wb1', 'Ideas')], {
      objects: [note('https://example.com/plans')],
      openExternalLink
    })
    await renderPlan(api, '/projects/p1/plan?whiteboard=wb1')
    await openTheLink()

    await waitFor(() => expect(openExternalLink).toHaveBeenCalledWith('https://example.com/plans'))
    expect(where()).toBe('/projects/p1/plan?whiteboard=wb1')
  })
})
