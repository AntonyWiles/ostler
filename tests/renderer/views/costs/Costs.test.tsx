// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  OstlerAPI,
  PlanningMilestone,
  PlanningWorkItem,
  RendererProject
} from '@shared/ostler-api'
import { summarizeCosts, type Cost, type CostInput, type CostQuery } from '@shared/money'
import { CostsView } from '@renderer/views/costs/CostsView'
import { BudgetCard } from '@renderer/costs/BudgetCard'
import { TaskCostsSection } from '@renderer/costs/TaskCostsSection'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import type { ProjectViewProps } from '@renderer/navigation/view-props'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const project = {
  id: 'p1',
  name: 'Wedding',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: 0,
  lastActivity: null,
  hasAutomationToken: false
} as RendererProject

const hall = { id: 't1', projectId: 'p1', title: 'Book the hall' } as PlanningWorkItem
const milestone = { id: 'm1', projectId: 'p1', name: 'The day' } as PlanningMilestone
const ws = { projectId: 'p1', workItems: [hall], milestones: [milestone] } as PlanningWorkspace

/** An in-memory costs service behind the fake API, so a test sees what it wrote. */
function fakeMoney(initial: Cost[], budget: number | null = 100_000) {
  let costs = [...initial]
  let next = 100
  const matches = (cost: Cost, query: CostQuery = {}) =>
    (query.category === undefined || cost.category === query.category) &&
    (query.state === undefined || cost.state === query.state) &&
    (query.workItemId === undefined || cost.workItemId === query.workItemId)
  const api: Partial<OstlerAPI> = {
    getMoneySummary: async () => ({
      ok: true,
      value: summarizeCosts(costs, budget, 'GBP')
    }),
    getBudget: async () => ({
      ok: true,
      value: { projectId: 'p1', amount: budget, currency: 'GBP' }
    }),
    setBudget: async (_projectId, input) => {
      if (input.amount !== undefined) budget = input.amount
      return { ok: true, value: { projectId: 'p1', amount: budget, currency: 'GBP' } }
    },
    listCosts: async (_projectId, query) => ({
      ok: true,
      value: costs
        .filter((cost) => matches(cost, query))
        .sort((a, b) => a.date.localeCompare(b.date))
    }),
    listCostCategories: async () => ({
      ok: true,
      value: [...new Set(costs.map((cost) => cost.category).filter(Boolean))]
    }),
    createCost: async (_projectId, input: CostInput) => {
      const cost: Cost = {
        id: `c${next++}`,
        projectId: 'p1',
        date: input.date!,
        amount: input.amount!,
        description: input.description!,
        category: input.category ?? '',
        workItemId: input.workItemId ?? null,
        milestoneId: input.milestoneId ?? null,
        state: input.state ?? 'planned',
        createdAt: next,
        updatedAt: next
      }
      costs.push(cost)
      return { ok: true, value: cost }
    },
    updateCost: async (_projectId, costId, input) => {
      const before = costs.find((cost) => cost.id === costId)!
      const after = { ...before, ...input } as Cost
      costs = costs.map((cost) => (cost.id === costId ? after : cost))
      return { ok: true, value: { before, after } }
    },
    markCostPaid: async (_projectId, costId, input) => {
      const before = costs.find((cost) => cost.id === costId)!
      const after = { ...before, ...input, state: 'paid' } as Cost
      costs = costs.map((cost) => (cost.id === costId ? after : cost))
      return { ok: true, value: after }
    },
    deleteCost: async (_projectId, costId) => {
      const gone = costs.find((cost) => cost.id === costId)!
      costs = costs.filter((cost) => cost.id !== costId)
      return { ok: true, value: gone }
    },
    restoreCost: async (_projectId, cost) => {
      costs.push(cost)
      return { ok: true, value: cost }
    }
  }
  return { api, costs: () => costs }
}

function cost(overrides: Partial<Cost>): Cost {
  return {
    id: 'c1',
    projectId: 'p1',
    date: '2026-11-01',
    amount: 60_000,
    description: 'Hall deposit',
    category: 'Venue',
    workItemId: 't1',
    milestoneId: null,
    state: 'planned',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function wrap(element: ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/projects/p1/costs']}>
      <StaticFeaturesProvider value={{ agents: false, ai: false }}>
        <ToastProvider>
          <ConfirmProvider>{element}</ConfirmProvider>
        </ToastProvider>
      </StaticFeaturesProvider>
    </MemoryRouter>
  )
}

const viewProps = {
  project,
  ws,
  features: { hasFolder: false, agents: false, ai: false },
  suggestTasks: { busy: false, start: () => {} }
} as ProjectViewProps

describe('the Costs view (N6.3a)', () => {
  let money: ReturnType<typeof fakeMoney>
  beforeEach(() => {
    money = fakeMoney([
      cost({}),
      cost({
        id: 'c2',
        date: '2026-10-20',
        amount: 12_050,
        description: 'Bouquets',
        category: 'Flowers',
        workItemId: null,
        state: 'paid'
      })
    ])
    installOstlerApi(money.api)
  })

  it('lists costs by date with their task, state and amount, and the totals at the foot', async () => {
    wrap(<CostsView {...viewProps} />)
    const rows = await screen.findAllByRole('row', { name: /,/ })
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Bouquets, £120.50, Paid',
      'Hall deposit, £600.00, Planned'
    ])
    expect(within(rows[1]).getByText('Book the hall')).toBeInTheDocument()
    expect(screen.getByText('Paid £120.50 · Planned £600.00')).toBeInTheDocument()
    expect(screen.getByLabelText('Total')).toHaveTextContent('£720.50')
  })

  it('filters by category and by state', async () => {
    wrap(<CostsView {...viewProps} />)
    await screen.findByText('Bouquets')
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'paid' } })
    await waitFor(() => expect(screen.queryByText('Hall deposit')).toBeNull())
    fireEvent.change(screen.getByLabelText('State'), { target: { value: '*' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Venue' } })
    await waitFor(() => expect(screen.queryByText('Bouquets')).toBeNull())
    expect(screen.getByText('Hall deposit')).toBeInTheDocument()
  })

  it('adds a cost in place, read with the separators typed', async () => {
    wrap(<CostsView {...viewProps} />)
    await screen.findByText('Hall deposit')
    fireEvent.click(screen.getByRole('button', { name: 'Add cost' }))
    // The editing row's fields shrink to their columns at 900 px, and the
    // table scrolls sideways inside its own box rather than the page.
    const editing = screen.getByLabelText('Description').closest('tr')!
    expect(editing.classList).toContain('costs-table__row--editing')
    expect(editing.closest('table')!.parentElement!.classList).toContain('costs-table-scroll')
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Cake' } })
    fireEvent.change(screen.getByLabelText('Amount (GBP)'), { target: { value: '1,234.50' } })
    fireEvent.keyDown(screen.getByLabelText('Amount (GBP)'), { key: 'Enter' })
    await screen.findByText('Cake')
    expect(money.costs().find((entry) => entry.description === 'Cake')!.amount).toBe(123_450)
  })

  it('edits a cost in place from the keyboard, and Escape cancels', async () => {
    wrap(<CostsView {...viewProps} />)
    const rows = await screen.findAllByRole('row', { name: /,/ })
    rows[0].focus()
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1], { key: 'Enter' })
    const description = screen.getByLabelText('Description')
    fireEvent.change(description, { target: { value: 'Hall balance' } })
    fireEvent.keyDown(description, { key: 'Escape' })
    expect(screen.queryByLabelText('Description')).toBeNull()
    expect(screen.getByText('Hall deposit')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('row', { name: /Hall deposit/ }), { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Hall balance' } })
    fireEvent.keyDown(screen.getByLabelText('Description'), { key: 'Enter' })
    await screen.findByText('Hall balance')
  })

  it('marks a cost paid with the paid date and amount, and undoes it', async () => {
    wrap(<CostsView {...viewProps} />)
    await screen.findByText('Hall deposit')
    fireEvent.click(screen.getByRole('button', { name: 'Mark Hall deposit as paid' }))
    fireEvent.change(screen.getByLabelText('Amount paid (GBP)'), { target: { value: '580' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark as paid' }))
    await waitFor(() =>
      expect(money.costs().find((entry) => entry.id === 'c1')).toMatchObject({
        state: 'paid',
        amount: 58_000
      })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(money.costs().find((entry) => entry.id === 'c1')).toMatchObject({
        state: 'planned',
        amount: 60_000
      })
    )
  })

  it('deletes a cost with Undo', async () => {
    wrap(<CostsView {...viewProps} />)
    await screen.findByText('Hall deposit')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Hall deposit' }))
    await waitFor(() => expect(screen.queryByText('Hall deposit')).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await screen.findByText('Hall deposit')
  })
})

describe("the Overview's Budget card (N6.3a)", () => {
  it('shows budget, paid, planned, left and the largest categories', async () => {
    installOstlerApi(
      fakeMoney([cost({}), cost({ id: 'c2', amount: 10_000, category: 'Food', state: 'paid' })]).api
    )
    wrap(<BudgetCard projectId="p1" />)
    expect(await screen.findByText('£1,000.00')).toBeInTheDocument()
    expect(screen.getByText('Left')).toBeInTheDocument()
    expect(screen.getByText('£300.00')).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: 'Paid £100.00 and planned £600.00 of a budget of £1,000.00'
      })
    ).toBeInTheDocument()
    const categories = screen.getByRole('list', { name: 'By category' })
    expect(
      within(categories)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(['Venue£600.00', 'Food£100.00'])
  })

  it('says how far over budget it is, in words and the warning tone', async () => {
    installOstlerApi(fakeMoney([cost({ amount: 112_000 })]).api)
    wrap(<BudgetCard projectId="p1" />)
    const over = await screen.findByText('Over by £120.00')
    expect(over.closest('[data-tone]')).toHaveAttribute('data-tone', 'warning')
    expect(screen.getByText('Over budget')).toBeInTheDocument()
  })

  it('stays hidden with neither a budget nor costs', async () => {
    const api = fakeMoney([], null).api
    let asked = false
    installOstlerApi({
      ...api,
      getMoneySummary: async (...args) => {
        asked = true
        return api.getMoneySummary!(...args)
      }
    })
    const { container } = wrap(<BudgetCard projectId="p1" />)
    await waitFor(() => expect(asked).toBe(true))
    expect(container).toBeEmptyDOMElement()
  })
})

describe("the drawer's Costs section (N6.3a)", () => {
  it("lists the task's costs with their total and adds one for the task", async () => {
    const money = fakeMoney([
      cost({}),
      cost({ id: 'c2', description: 'Other task', workItemId: 't9' })
    ])
    installOstlerApi(money.api)
    wrap(<TaskCostsSection item={hall} milestones={[milestone]} />)
    expect(await screen.findByText('Hall deposit')).toBeInTheDocument()
    expect(screen.queryByText('Other task')).toBeNull()
    expect(screen.getByText('Paid £0.00 · Planned £600.00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add a cost' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Chairs' }
    })
    fireEvent.change(within(dialog).getByLabelText('Amount (GBP)'), { target: { value: '45' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add cost' }))
    await screen.findByText('Chairs')
    expect(money.costs().find((entry) => entry.description === 'Chairs')).toMatchObject({
      workItemId: 't1',
      amount: 4500
    })
  })
})
