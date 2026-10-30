// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { OstlerAPI, PlanningWorkItem, RendererProject } from '@shared/ostler-api'
import { summarizeCosts, type Cost } from '@shared/money'
import { orderKeyBetween } from '@shared/planning/order-key'
import { stillToBuy, type ShoppingInput, type ShoppingItem } from '@shared/shopping'
import type { Contact } from '@shared/contacts'
import { ShoppingView } from '@renderer/views/shopping/ShoppingView'
import { ShoppingPrintPage } from '@renderer/views/print/ShoppingPrintPage'
import { BudgetCard } from '@renderer/costs/BudgetCard'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import type { ProjectViewProps } from '@renderer/navigation/view-props'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { AnnouncerProvider, ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const project = {
  id: 'p1',
  name: 'Kitchen',
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

const shelves = { id: 't1', projectId: 'p1', title: 'Put up shelves' } as PlanningWorkItem
const ws = { projectId: 'p1', workItems: [shelves], milestones: [] } as unknown as PlanningWorkspace
const jones = { id: 'k1', name: 'Jones Hardware' } as Contact

/** An in-memory shopping list and costs behind the fake API, so a test sees what it wrote. */
function fakeShopping(initial: Array<Partial<ShoppingItem> & { name: string }>) {
  let next = 1
  let key: string | null = null
  const make = (input: Partial<ShoppingItem> & { name: string }): ShoppingItem => {
    key = orderKeyBetween(key, null)
    const id = input.id ?? `s${next++}`
    return {
      id,
      projectId: 'p1',
      quantity: 1,
      unit: '',
      estimate: null,
      contactId: null,
      supplierName: null,
      workItemId: null,
      orderKey: key,
      costId: null,
      boughtOn: null,
      pricePaid: null,
      createdAt: next,
      updatedAt: next,
      ...input
    }
  }
  let items = initial.map(make)
  let costs: Cost[] = []
  const sorted = () => [...items].sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1))
  const withCost = (item: ShoppingItem): ShoppingItem => {
    const cost = costs.find((entry) => entry.id === item.costId)
    return { ...item, boughtOn: cost?.date ?? null, pricePaid: cost?.amount ?? null }
  }
  const place = (id: string, input: ShoppingInput): string | null => {
    const others = sorted().filter((item) => item.id !== id)
    let index = -1
    if (input.beforeId) index = others.findIndex((item) => item.id === input.beforeId)
    else if (input.afterId !== undefined)
      index = input.afterId === null ? 0 : others.findIndex((item) => item.id === input.afterId) + 1
    if (index < 0) return null
    return orderKeyBetween(others[index - 1]?.orderKey ?? null, others[index]?.orderKey ?? null)
  }
  const api: Partial<OstlerAPI> = {
    getMoneySummary: async () => ({
      ok: true,
      value: { ...summarizeCosts(costs, 100_000, 'GBP'), stillToBuy: stillToBuy(items) }
    }),
    listContacts: async () => ({ ok: true, value: [jones] }),
    listShopping: async () => ({ ok: true, value: sorted().map(withCost) }),
    createShoppingItem: async (_projectId, input) => {
      const item = make({ ...(input as ShoppingItem) })
      items.push(item)
      return { ok: true, value: item }
    },
    updateShoppingItem: async (_projectId, itemId, input) => {
      const before = items.find((item) => item.id === itemId)!
      const { afterId: _after, beforeId: _before, ...fields } = input
      const orderKey = place(itemId, input) ?? before.orderKey
      const after = {
        ...before,
        ...fields,
        orderKey,
        supplierName: (fields.contactId ?? before.contactId) === jones.id ? jones.name : null
      } as ShoppingItem
      items = items.map((item) => (item.id === itemId ? after : item))
      return { ok: true, value: { before, after } }
    },
    deleteShoppingItem: async (_projectId, itemId) => {
      const gone = items.find((item) => item.id === itemId)!
      items = items.filter((item) => item.id !== itemId)
      return { ok: true, value: gone }
    },
    restoreShoppingItem: async (_projectId, item) => {
      items.push(item)
      return { ok: true, value: item }
    },
    buyShoppingItem: async (_projectId, itemId, input) => {
      const item = items.find((entry) => entry.id === itemId)!
      const cost: Cost = {
        id: `c${next++}`,
        projectId: 'p1',
        date: input.date,
        amount: input.pricePaid,
        description: item.name,
        category: 'Shopping',
        workItemId: item.workItemId,
        milestoneId: null,
        state: 'paid',
        createdAt: 1,
        updatedAt: 1
      }
      costs.push(cost)
      items = items.map((entry) => (entry.id === itemId ? { ...entry, costId: cost.id } : entry))
      return { ok: true, value: { item: withCost({ ...item, costId: cost.id }), cost } }
    },
    unbuyShoppingItem: async (_projectId, itemId) => {
      const item = items.find((entry) => entry.id === itemId)!
      const cost = costs.find((entry) => entry.id === item.costId)!
      costs = costs.filter((entry) => entry.id !== cost.id)
      items = items.map((entry) => (entry.id === itemId ? { ...entry, costId: null } : entry))
      return { ok: true, value: { item: { ...item, costId: null }, cost } }
    },
    rebuyShoppingItem: async (_projectId, itemId, cost) => {
      costs.push(cost)
      items = items.map((entry) => (entry.id === itemId ? { ...entry, costId: cost.id } : entry))
      return { ok: true, value: items.find((entry) => entry.id === itemId)! }
    }
  }
  return { api, items: () => sorted(), costs: () => costs }
}

function wrap(element: ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/projects/p1/shopping']}>
      <StaticFeaturesProvider value={{ agents: false, ai: false }}>
        <AnnouncerProvider>
          <ToastProvider>
            <ConfirmProvider>{element}</ConfirmProvider>
          </ToastProvider>
        </AnnouncerProvider>
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

const names = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.shopping-row__name')?.textContent)

describe('the Shopping list (N6.3b)', () => {
  let shop: ReturnType<typeof fakeShopping>
  beforeEach(() => {
    shop = fakeShopping([
      {
        name: 'Wall plugs',
        quantity: 3,
        unit: 'packs',
        estimate: 450,
        contactId: 'k1',
        supplierName: 'Jones Hardware'
      },
      { name: 'Paint', estimate: 3000, workItemId: 't1' },
      { name: 'Brackets', contactId: 'k1', supplierName: 'Jones Hardware', estimate: 1200 }
    ])
    installOstlerApi(shop.api)
  })

  it('groups items by supplier, with No supplier last, and shows the estimate still to buy', async () => {
    wrap(<ShoppingView {...viewProps} />)
    const jonesList = await screen.findByRole('list', { name: 'Jones Hardware' })
    expect(names(jonesList)).toEqual(['Wall plugs', 'Brackets'])
    const none = screen.getByRole('list', { name: 'No supplier' })
    expect(names(none)).toEqual(['Paint'])
    expect(within(none).getByText('Put up shelves')).toBeInTheDocument()
    expect(within(jonesList).getByText('3 packs')).toBeInTheDocument()
    expect(screen.getByText('Still to buy: £46.50 (estimated)')).toBeInTheDocument()
  })

  it('adds an item from a single line, read for quantity, unit and price', async () => {
    wrap(<ShoppingView {...viewProps} />)
    await screen.findByText('Paint')
    fireEvent.change(screen.getByLabelText('Add item'), {
      target: { value: '2 rolls masking tape £3.20' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await screen.findByText('masking tape')
    expect(shop.items().find((item) => item.name === 'masking tape')).toMatchObject({
      quantity: 2,
      unit: 'rolls',
      estimate: 320
    })
  })

  it('moves an item within its group with Alt+Up and Alt+Down, and says so', async () => {
    wrap(<ShoppingView {...viewProps} />)
    const jonesList = await screen.findByRole('list', { name: 'Jones Hardware' })
    const brackets = within(jonesList).getAllByRole('listitem')[1]
    fireEvent.keyDown(brackets, { key: 'ArrowUp', altKey: true })
    await waitFor(() =>
      expect(names(screen.getByRole('list', { name: 'Jones Hardware' }))).toEqual([
        'Brackets',
        'Wall plugs'
      ])
    )
    // Focus stays on the row, so the move is said in the live region.
    await waitFor(() =>
      expect(document.querySelector('[data-announcer]')?.textContent?.trim()).toBe('Moved Brackets')
    )
    const moved = within(screen.getByRole('list', { name: 'Jones Hardware' })).getAllByRole(
      'listitem'
    )[0]
    fireEvent.keyDown(moved, { key: 'ArrowDown', altKey: true })
    await waitFor(() =>
      expect(names(screen.getByRole('list', { name: 'Jones Hardware' }))).toEqual([
        'Wall plugs',
        'Brackets'
      ])
    )
  })

  it('edits an item in place, and moves it to another supplier', async () => {
    wrap(<ShoppingView {...viewProps} />)
    await screen.findByText('Paint')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Paint' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Matt paint' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2,5' } })
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'k1' } })
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })
    await waitFor(() =>
      expect(names(screen.getByRole('list', { name: 'Jones Hardware' }))).toContain('Matt paint')
    )
    expect(shop.items().find((item) => item.name === 'Matt paint')).toMatchObject({
      quantity: 2.5,
      contactId: 'k1'
    })
  })

  it('deletes an item with Undo', async () => {
    wrap(<ShoppingView {...viewProps} />)
    await screen.findByText('Paint')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Paint' }))
    await waitFor(() => expect(screen.queryByText('Paint')).toBeNull())
    expect(shop.items()).toHaveLength(2)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await screen.findByText('Paint')
    expect(shop.items()).toHaveLength(3)
  })

  it('ticks an item as bought with the price paid, folds it under Bought, and unticks it', async () => {
    wrap(<ShoppingView {...viewProps} />)
    await screen.findByText('Paint')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bought Paint' }))
    const dialog = await screen.findByRole('dialog')
    const price = within(dialog).getByLabelText('Price paid (GBP)')
    expect(price).toHaveValue('30.00')
    fireEvent.change(price, { target: { value: '28.40' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tick as bought' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(shop.costs()).toMatchObject([
      { amount: 2840, description: 'Paint', category: 'Shopping', state: 'paid', workItemId: 't1' }
    ])
    await waitFor(() => expect(screen.queryByRole('list', { name: 'No supplier' })).toBeNull())
    expect(screen.getByText('Still to buy: £16.50 (estimated)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bought (1)' }))
    const bought = screen.getByRole('list', { name: 'Bought' })
    expect(within(bought).getByText(/£28\.40/)).toBeInTheDocument()

    fireEvent.click(within(bought).getByRole('checkbox', { name: 'Bought Paint' }))
    await waitFor(() => expect(shop.costs()).toEqual([]))
    await screen.findByRole('list', { name: 'No supplier' })
  })
})

describe('the Budget card with a shopping list (N6.3b)', () => {
  it('shows what is still to buy apart from planned costs', async () => {
    installOstlerApi(
      fakeShopping([
        { name: 'Worktop', estimate: 20_000 },
        { name: 'Taps', estimate: 3000 }
      ]).api
    )
    wrap(<BudgetCard projectId="p1" />)
    expect(await screen.findByText('Still to buy: £230.00 (estimated)')).toBeInTheDocument()
    // Planned stays the costs' own: nothing is counted twice.
    expect(screen.getByText('Planned').nextElementSibling).toHaveTextContent('£0.00')
  })
})

describe('the Shopping list print page (N6.3b)', () => {
  it('prints the unbought items by supplier with tick boxes, then says it is ready', async () => {
    const shop = fakeShopping([
      {
        name: 'Wall plugs',
        quantity: 3,
        unit: 'packs',
        estimate: 450,
        contactId: 'k1',
        supplierName: 'Jones Hardware'
      },
      { name: 'Sink', estimate: 12_000 }
    ])
    installOstlerApi({
      ...shop.api,
      getConfig: async () =>
        ({ ok: true, value: { projects: [{ id: 'p1', name: 'Kitchen' }] } }) as never
    })
    await act(async () => {
      await shop.api.buyShoppingItem!('p1', 's2', { pricePaid: 11_000, date: '2026-10-18' })
    })
    delete document.documentElement.dataset.printReady
    render(<ShoppingPrintPage route={{ projectId: 'p1', view: 'shopping', config: null }} />)
    expect(await screen.findByText('Kitchen · Shopping list')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Jones Hardware' })).toBeInTheDocument()
    expect(screen.getByText('Wall plugs')).toBeInTheDocument()
    expect(screen.queryByText('Sink')).toBeNull()
    await waitFor(() => expect(document.documentElement.dataset.printReady).toBe('1'))
  })
})
