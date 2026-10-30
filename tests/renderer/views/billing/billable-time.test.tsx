// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningWorkItem, RendererProject, TimeEntry } from '@shared/ostler-api'
import {
  buildTimeReport,
  type Billing,
  type BillingSettings,
  type UnmarkedBilling
} from '@shared/time/billing'
import { TimeReportView } from '@renderer/views/time-report/TimeReportView'
import { TimeReportPrintPage } from '@renderer/views/print/TimeReportPrintPage'
import { TimeEntryEditor } from '@renderer/time/TimeEntryEditor'
import { TaskTimeSection } from '@renderer/time/TaskTimeSection'
import { TimerProvider } from '@renderer/time/TimerProvider'
import { ProjectBillingFields } from '@renderer/billing/ProjectBillingFields'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import type { ProjectViewProps } from '@renderer/navigation/view-props'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const project = {
  id: 'p1',
  name: 'Studio',
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

const TASK = {
  id: 't1',
  projectId: 'p1',
  title: 'Design',
  estimate: null,
  archivedAt: null,
  deletedAt: null
} as unknown as PlanningWorkItem

const ws = { projectId: 'p1', workItems: [TASK], milestones: [] } as unknown as PlanningWorkspace

function entry(partial: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'e1',
    projectId: 'p1',
    workItemId: 't1',
    workItemTitle: 'Design',
    personId: null,
    startedAt: new Date(2026, 9, 2, 9, 0).getTime(),
    durationSeconds: 5400,
    note: 'Sketches',
    source: 'manual',
    billable: true,
    billingId: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial
  }
}

/** An in-memory billing service behind the fake API, built on the shared report rules. */
function fakeBilling(initial: TimeEntry[], rate: number | null = 6000) {
  let entries = [...initial]
  let billings: Billing[] = []
  const settings = (): BillingSettings => ({
    projectId: 'p1',
    hourlyRate: rate,
    newTimeBillable: true,
    currency: 'GBP'
  })
  const api: Partial<OstlerAPI> = {
    getBillingSettings: async () => ({ ok: true, value: settings() }),
    setBillingSettings: vi.fn(async (_projectId, input) => {
      if (input.hourlyRate !== undefined) rate = input.hourlyRate
      return { ok: true as const, value: settings() }
    }),
    getTimeReport: vi.fn(async (_projectId: string, from: string, to: string) => ({
      ok: true as const,
      value: buildTimeReport({ projectId: 'p1', from, to, entries, settings: settings(), billings })
    })),
    markBilled: vi.fn(async (_projectId: string, range: { from: string; to: string }) => {
      const billing: Billing = {
        id: 'b1',
        projectId: 'p1',
        ...range,
        markedAt: new Date(2026, 9, 31).getTime(),
        entryCount: 1,
        billableSeconds: 5400,
        hourlyRate: rate,
        amount: 9000,
        currency: 'GBP'
      }
      billings = [billing]
      entries = entries.map((candidate) =>
        candidate.billable ? { ...candidate, billingId: 'b1' } : candidate
      )
      return { ok: true as const, value: billing }
    }),
    unmarkBilling: vi.fn(async () => {
      const unmarked: UnmarkedBilling = { billing: billings[0], entryIds: ['e1'] }
      billings = []
      entries = entries.map((candidate) => ({ ...candidate, billingId: null }))
      return { ok: true as const, value: unmarked }
    }),
    restoreBilling: vi.fn(async (_projectId: string, unmarked: UnmarkedBilling) => {
      billings = [unmarked.billing]
      entries = entries.map((candidate) =>
        unmarked.entryIds.includes(candidate.id) ? { ...candidate, billingId: 'b1' } : candidate
      )
      return { ok: true as const, value: unmarked.billing }
    }),
    exportTimeReportCsv: vi.fn(async () => ({ ok: true as const, value: 'C:\\report.csv' })),
    printTimeReport: vi.fn(async () => ({ ok: true as const, value: null })),
    getPeople: async () => ({ ok: true, value: [] }),
    getConfig: async () => ({ ok: false, error: 'not needed' })
  }
  return { api, entries: () => entries }
}

function wrap(element: ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/projects/p1/time-report']}>
      <StaticFeaturesProvider value={{ agents: false, ai: false }}>
        <ToastProvider>
          <ConfirmProvider>{element}</ConfirmProvider>
        </ToastProvider>
      </StaticFeaturesProvider>
    </MemoryRouter>
  )
}

const viewProps = { project, ws } as unknown as ProjectViewProps

describe('the Time report (N6.4)', () => {
  let fake: ReturnType<typeof fakeBilling>

  beforeEach(() => {
    vi.useRealTimers()
    fake = fakeBilling([
      entry(),
      entry({ id: 'e2', durationSeconds: 1800, billable: false, note: 'Admin' })
    ])
    installOstlerApi(fake.api)
  })

  it('reports this month by default, then any range, with totals by task', async () => {
    wrap(<TimeReportView {...viewProps} />)
    await waitFor(() => expect(fake.api.getTimeReport).toHaveBeenCalled())
    const [, from, to] = vi.mocked(fake.api.getTimeReport!).mock.calls[0]
    expect(from).toMatch(/^\d{4}-\d{2}-01$/)
    expect(to >= from).toBe(true)

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } })
    await waitFor(() =>
      expect(fake.api.getTimeReport).toHaveBeenLastCalledWith('p1', '2026-10-01', '2026-10-31')
    )
    const totals = await screen.findByLabelText('Totals')
    expect(within(totals).getByText(/^2\s?h$/)).toBeTruthy()
    expect(within(totals).getByText(/^1\.5\s?h$/)).toBeTruthy()
    expect(within(totals).getByText('£90.00')).toBeTruthy()
    expect(screen.getByText('Hourly rate: £60.00')).toBeTruthy()

    const unbilled = screen.getByRole('table', { name: 'Not yet billed' })
    expect(within(unbilled).getByText('Design')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Entries for Design' })).toBeNull()
    fireEvent.click(within(unbilled).getByRole('button', { name: 'Show entries for Design' }))
    const listed = screen.getByRole('list', { name: 'Entries for Design' })
    expect(within(listed).getByText(/Sketches/)).toBeTruthy()
    expect(within(listed).getByText(/Admin · Not billable/)).toBeTruthy()
  })

  it('asks before marking as billed, then lists the billing, and unmarks it with Undo', async () => {
    wrap(<TimeReportView {...viewProps} />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } })
    await screen.findByRole('table', { name: 'Not yet billed' })

    fireEvent.click(screen.getByRole('button', { name: 'Mark as billed' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Mark this time as billed?' })
    expect(within(dialog).getByText(/1\.5\s?h \(£90\.00\)/)).toBeTruthy()
    expect(fake.api.markBilled).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as billed' }))
    await waitFor(() =>
      expect(fake.api.markBilled).toHaveBeenCalledWith('p1', {
        from: '2026-10-01',
        to: '2026-10-31'
      })
    )
    expect(await screen.findByRole('table', { name: 'Billed' })).toBeTruthy()
    const unmark = await screen.findByRole('button', {
      name: /Unmark the billing from 1 Oct 2026 to 31 Oct 2026/
    })
    fireEvent.click(unmark)
    await waitFor(() => expect(fake.api.unmarkBilling).toHaveBeenCalledWith('p1', 'b1'))
    const toast = await screen.findByText('Billing unmarked')
    fireEvent.click(
      within(toast.closest('[role="status"], .ui-toast') as HTMLElement).getByRole('button', {
        name: 'Undo'
      })
    )
    await waitFor(() => expect(fake.api.restoreBilling).toHaveBeenCalled())
    expect(fake.entries()[0].billingId).toBe('b1')
  })

  it('does not mark when the person cancels', async () => {
    wrap(<TimeReportView {...viewProps} />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } })
    await screen.findByRole('table', { name: 'Not yet billed' })
    fireEvent.click(screen.getByRole('button', { name: 'Mark as billed' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Mark this time as billed?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(fake.api.markBilled).not.toHaveBeenCalled()
  })

  it('prints, saves a PDF and exports CSV for the range', async () => {
    wrap(<TimeReportView {...viewProps} />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } })
    await screen.findByRole('table', { name: 'Not yet billed' })
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    await waitFor(() =>
      expect(fake.api.printTimeReport).toHaveBeenCalledWith({
        projectId: 'p1',
        from: '2026-10-01',
        to: '2026-10-31',
        output: 'printer'
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }))
    await waitFor(() =>
      expect(fake.api.printTimeReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ output: 'pdf' })
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() =>
      expect(fake.api.exportTimeReportCsv).toHaveBeenCalledWith('p1', '2026-10-01', '2026-10-31')
    )
  })

  it('refuses a range that ends before it starts', async () => {
    wrap(<TimeReportView {...viewProps} />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-31' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } })
    expect(await screen.findByText(/first day on or before the last/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Mark as billed' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('prints every task with its entries and says when it is ready', async () => {
    render(
      <TimeReportPrintPage route={{ projectId: 'p1', from: '2026-10-01', to: '2026-10-31' }} />
    )
    expect(await screen.findByRole('list', { name: 'Entries for Design' })).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    await waitFor(() => expect(document.documentElement.dataset.printReady).toBe('1'))
  })
})

describe('the Billable tick (N6.4)', () => {
  it("starts a new entry with the project's default and saves it", async () => {
    const createTimeEntry = vi.fn(async () => ({ ok: true as const, value: entry() }))
    installOstlerApi({
      getBillingSettings: async () => ({
        ok: true,
        value: { projectId: 'p1', hourlyRate: null, newTimeBillable: true, currency: 'GBP' }
      }),
      createTimeEntry
    })
    render(
      <TimeEntryEditor
        task={{ projectId: 'p1', id: 't1', title: 'Design' }}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )
    const tick = screen.getByRole('checkbox', { name: 'Billable' }) as HTMLInputElement
    await waitFor(() => expect(tick.checked).toBe(true))
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '1h' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add time' }))
    await waitFor(() =>
      expect(createTimeEntry).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ billable: true, durationSeconds: 3600 })
      )
    )
  })

  it('locks a billed entry in the editor', () => {
    installOstlerApi({})
    render(
      <TimeEntryEditor
        entry={entry({ billingId: 'b1' })}
        task={{ projectId: 'p1', id: 't1', title: 'Design' }}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )
    expect(screen.getByText(/This time has been billed/)).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'Billable' }) as HTMLInputElement).disabled).toBe(
      true
    )
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("ticks and unticks an entry in the drawer's Time section", async () => {
    let entries = [entry({ billable: false }), entry({ id: 'e2', billingId: 'b1' })]
    const updateTimeEntry = vi.fn(async (_projectId: string, id: string, input) => {
      entries = entries.map((candidate) =>
        candidate.id === id ? { ...candidate, ...input } : candidate
      )
      return { ok: true as const, value: entries.find((candidate) => candidate.id === id)! }
    })
    installOstlerApi({
      getTimer: async () => ({ ok: true, value: { running: null, interrupted: null } }),
      getTaskTimeEntries: async () => ({ ok: true, value: entries }),
      updateTimeEntry
    })
    render(
      <ToastProvider>
        <MemoryRouter>
          <TimerProvider>
            <TaskTimeSection item={TASK} />
          </TimerProvider>
        </MemoryRouter>
      </ToastProvider>
    )
    const ticks = await screen.findAllByRole('checkbox', { name: /^Billable: 1\.5/ })
    expect(ticks).toHaveLength(1)
    expect(screen.getByText('Billed')).toBeTruthy()
    fireEvent.click(ticks[0])
    await waitFor(() =>
      expect(updateTimeEntry).toHaveBeenCalledWith('p1', 'e1', { billable: true })
    )
  })
})

describe("Project settings' billing fields (N6.4)", () => {
  it('saves the hourly rate in minor units and the default', async () => {
    const fake = fakeBilling([], null)
    installOstlerApi(fake.api)
    render(
      <ToastProvider>
        <ProjectBillingFields projectId="p1" />
      </ToastProvider>
    )
    const rate = await screen.findByLabelText('Hourly rate')
    fireEvent.change(rate, { target: { value: '65.50' } })
    fireEvent.blur(rate)
    await waitFor(() =>
      expect(fake.api.setBillingSettings).toHaveBeenCalledWith('p1', { hourlyRate: 6550 })
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /New time is billable/ }))
    await waitFor(() =>
      expect(fake.api.setBillingSettings).toHaveBeenLastCalledWith('p1', {
        newTimeBillable: false
      })
    )
    fireEvent.change(rate, { target: { value: 'lots' } })
    fireEvent.blur(rate)
    expect(await screen.findByText(/Enter an hourly rate/)).toBeTruthy()
  })
})
