// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlanningFieldDefinition,
  PlanningTaskType,
  ProjectReport,
  ReportTypeSeries
} from '@shared/ostler-api'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { TaskCustomFieldsSection } from '@renderer/views/planning/TaskCustomFieldsSection'
import { OverviewInsights } from '@renderer/views/planning/insights/OverviewInsights'
import { ProjectTaskTypesManager } from '@renderer/task-types/ProjectTaskTypesManager'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { overdueOnlyReport } from '../../fixtures/report'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

const field = (id: string, name: string, position: number): PlanningFieldDefinition => ({
  id,
  projectId: 'p1',
  name,
  type: 'text',
  options: [],
  position,
  createdAt: 0
})
const FIELDS = [field('f1', 'Steps', 0), field('f2', 'Version', 1), field('f3', 'Customer', 2)]

const bug: PlanningTaskType = {
  id: 'y1',
  projectId: 'p1',
  name: 'Bug',
  icon: 'bug',
  color: '#ef4444',
  position: 0,
  fieldIds: ['f2'],
  templateId: null,
  createdAt: 0,
  updatedAt: 0
}

describe('the drawer’s fields for a task type (N2.7b)', () => {
  let base: PlanningWorkspace
  beforeEach(async () => {
    base = await renderPlanningWorkspace()
  })

  const drawerFor = (editFieldValues: Record<string, unknown>) =>
    render(
      <TaskCustomFieldsSection
        ws={withWorkspace(base, {
          fields: FIELDS,
          taskTypes: [bug],
          editTypeId: 'y1',
          editFieldValues: editFieldValues as PlanningWorkspace['editFieldValues'],
          saveFailures: []
        })}
      />
    )

  it('shows only the type’s fields, counts the hidden ones with values, and shows them on request', () => {
    drawerFor({ f1: 'Click save', f2: '1.2', f3: 'Acme' })
    expect(screen.getByLabelText('Version')).toHaveValue('1.2')
    expect(screen.queryByLabelText('Steps')).toBeNull()
    const sentence = screen.getByText('2 more fields with values are hidden for Bug.')
    expect(sentence).toBeVisible()
    // The same note as the level's, so the two read alike.
    expect(sentence.closest('p')).toHaveClass('hidden-fields-note')
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }))
    // The hidden values were kept all along.
    expect(screen.getByLabelText('Steps')).toHaveValue('Click save')
    expect(screen.getByLabelText('Customer')).toHaveValue('Acme')
    expect(screen.getByText('Showing the fields Bug hides.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Hide them' }))
    expect(screen.queryByLabelText('Steps')).toBeNull()
  })

  it('counts only hidden fields that hold a value, never the empty ones', () => {
    // Customer is hidden too, but blank: it is not counted.
    drawerFor({ f1: 'Click save', f3: '  ' })
    expect(screen.getByText('1 more field with a value is hidden for Bug.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Show them' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Show all fields' })).toBeNull()
  })

  it('offers a quiet Show all fields when no hidden field holds a value', () => {
    drawerFor({ f2: '1.2' })
    expect(screen.queryByText(/hidden for Bug/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show them' })).toBeNull()
    const showAll = screen.getByRole('button', { name: 'Show all fields' })
    // The link alone, with no sentence beside it.
    expect(showAll.closest('p')).toHaveTextContent(/^Show all fields$/)
    fireEvent.click(showAll)
    expect(screen.getByLabelText('Steps')).toHaveValue('')
    expect(screen.getByLabelText('Customer')).toBeVisible()
    expect(screen.getByText('Showing the fields Bug hides.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Hide them' }))
    expect(screen.queryByLabelText('Steps')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show all fields' })).toBeVisible()
  })

  it('shows every field, with no note, for a task with no type', () => {
    render(
      <TaskCustomFieldsSection
        ws={withWorkspace(base, {
          fields: FIELDS,
          taskTypes: [bug],
          editTypeId: '',
          editFieldValues: {},
          saveFailures: []
        })}
      />
    )
    expect(screen.getByLabelText('Steps')).toBeVisible()
    expect(screen.getByLabelText('Customer')).toBeVisible()
    expect(screen.queryByText(/hidden for/)).toBeNull()
  })
})

describe('the Fields picker per task type (N2.7b)', () => {
  it('ticks the fields a type shows and the template it starts from', async () => {
    const updatePlanningTaskType = vi.fn(
      async (_id: string, updates: Partial<PlanningTaskType>) => ({
        ok: true as const,
        value: { ...bug, ...updates }
      })
    )
    installOstlerApi({
      getPlanningTaskTypes: async () => ({ ok: true, value: [{ ...bug, fieldIds: null }] }),
      getPlanningFields: async () => ({ ok: true, value: FIELDS }),
      getTaskTemplates: async () => ({
        ok: true,
        value: [
          {
            id: 'tpl1',
            projectId: 'p1',
            name: 'Bug report',
            body: { title: 'Bug: ' } as never,
            createdAt: 0,
            updatedAt: 0
          }
        ]
      }),
      updatePlanningTaskType
    } as never)
    render(
      <ToastProvider>
        <ProjectTaskTypesManager projectId="p1" onError={() => {}} onSaved={() => {}} />
      </ToastProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Bug' }))
    const fields = screen.getByRole('group', { name: 'Fields' })
    const every = within(fields).getByLabelText('Every field')
    expect(every).toBeChecked()
    expect(within(fields).queryByLabelText('Steps')).toBeNull()
    fireEvent.click(every)
    // Unticking "Every field" starts from all of them, ticked.
    expect(within(fields).getByLabelText('Steps')).toBeChecked()
    fireEvent.click(within(fields).getByLabelText('Steps'))
    fireEvent.click(within(fields).getByLabelText('Customer'))
    fireEvent.change(screen.getByLabelText('Starts from'), { target: { value: 'tpl1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save type' }))
    await waitFor(() =>
      expect(updatePlanningTaskType).toHaveBeenCalledWith(
        'y1',
        expect.objectContaining({ fieldIds: ['f2'], templateId: 'tpl1' })
      )
    )
  })
})

describe('Split by type on the Overview (N2.7b)', () => {
  const series = (key: string, name: string, color: string | null): ReportTypeSeries => ({
    key,
    name,
    icon: color ? 'bug' : null,
    color,
    typeIds: color ? [key] : []
  })

  function splitReport(): ProjectReport {
    const report = overdueOnlyReport({ id: 'w1', title: 'Late' })
    const weeks = [
      { weekStart: '2026-09-27', count: 3 },
      { weekStart: '2026-10-04', count: 1 }
    ]
    const buckets = [{ label: 'Under a day', minDays: 0, maxDays: 0, count: 4 }]
    return {
      ...report,
      throughput: {
        weeks,
        summary: '4 tasks finished in the last 30 days, about 2 a week.',
        byType: [
          {
            series: series('y1', 'Bug', '#ef4444'),
            weeks: [
              { weekStart: '2026-09-27', count: 2 },
              { weekStart: '2026-10-04', count: 1 }
            ],
            total: 3,
            summary: 'Bug: 3 tasks finished in the last 30 days, about 1.5 a week.'
          },
          {
            series: series('none', 'No type', null),
            weeks: [
              { weekStart: '2026-09-27', count: 1 },
              { weekStart: '2026-10-04', count: 0 }
            ],
            total: 1,
            summary: 'No type: 1 task finished in the last 30 days, about 0.5 a week.'
          }
        ]
      },
      cycleTime: {
        buckets,
        sampleSize: 4,
        summary: 'Half of the 4 tasks took a day or less.',
        byType: [
          {
            series: series('y1', 'Bug', '#ef4444'),
            buckets: [{ ...buckets[0], count: 3 }],
            sampleSize: 3,
            summary: 'Bug: Half of the 3 tasks took a day or less.'
          },
          {
            series: series('none', 'No type', null),
            buckets: [{ ...buckets[0], count: 1 }],
            sampleSize: 1,
            summary: 'No type: One task was finished.'
          }
        ]
      }
    }
  }

  it('draws a series per type, with a legend and a sentence for each', async () => {
    const report = splitReport()
    const ws = await renderPlanningWorkspace({
      api: { getProjectReport: async () => ({ ok: true, value: report }) }
    })
    render(<OverviewInsights ws={ws} onOpenMilestones={() => {}} />)
    const split = await screen.findByLabelText('Split by type')
    const throughput = screen.getByRole('figure', { name: 'Throughput' })
    expect(within(throughput).queryByText(/^Bug: 3 tasks/)).toBeNull()
    fireEvent.click(split)
    const legend = within(throughput).getByRole('list', { name: /legend/i })
    expect(within(legend).getByText('Bug')).toBeVisible()
    expect(within(legend).getByText('No type')).toBeVisible()
    // The type's icon is named, so the series is never colour alone.
    expect(within(legend).getByLabelText('Type: Bug')).toBeTruthy()
    expect(within(throughput).getByText(/^Bug: 3 tasks finished/)).toBeVisible()
    const cycle = screen.getByRole('figure', { name: 'Cycle time' })
    expect(within(cycle).getByText(/^No type: One task was finished/)).toBeVisible()
    expect(throughput.querySelectorAll('rect[data-series="y1"]')).toHaveLength(2)
  })

  it('offers no split for a project without types', async () => {
    const report = overdueOnlyReport({ id: 'w1', title: 'Late' })
    const ws = await renderPlanningWorkspace({
      api: { getProjectReport: async () => ({ ok: true, value: report }) }
    })
    render(<OverviewInsights ws={ws} onOpenMilestones={() => {}} />)
    await screen.findByRole('figure', { name: 'Throughput' })
    expect(screen.queryByLabelText('Split by type')).toBeNull()
  })
})
