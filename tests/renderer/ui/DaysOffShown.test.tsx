// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DayOff, Person } from '@shared/ostler-api'
import { CalendarGrid } from '@renderer/ui'
import { StaticDaysOffProvider } from '@renderer/context/DaysOffContext'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { TaskDueDateField } from '@renderer/views/planning/TaskScheduleFields'

const sam: Person = {
  id: 'sam',
  name: 'Sam',
  initials: 'S',
  color: '#3b82f6',
  isMe: false,
  archivedAt: null,
  weeklyCapacityHours: null,
  workingDays: [1, 2, 3, 4, 5],
  projectId: null,
  createdAt: 0,
  updatedAt: 0
}

const daysOff: DayOff[] = [
  {
    id: 'x',
    personId: null,
    firstDate: '2026-12-25',
    lastDate: '2026-12-25',
    name: 'Christmas Day',
    sourceFile: null,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: 'l',
    personId: 'sam',
    firstDate: '2026-12-21',
    lastDate: '2026-12-23',
    name: 'Leave',
    sourceFile: null,
    createdAt: 0,
    updatedAt: 0
  }
]

const day = (date: string) =>
  document.querySelector<HTMLElement>(`[role="gridcell"][data-date="${date}"]`)!

describe('days off on screen (N3.2)', () => {
  it('shades and names everyone’s day off, and notes a person’s leave quietly', () => {
    render(
      <CalendarGrid<{ id: string; start: string; end: string }>
        label="Test calendar"
        mode="month"
        weekStart={1}
        focusedDate="2026-12-15"
        onFocusedDateChange={() => {}}
        today="2026-12-01"
        items={[]}
        renderItem={() => null}
        dayOff={(date) =>
          date === '2026-12-25'
            ? { name: 'Christmas Day', people: [] }
            : date === '2026-12-22'
              ? { name: null, people: ['Sam'] }
              : null
        }
      />
    )
    expect(day('2026-12-25')).toHaveClass('is-day-off')
    expect(day('2026-12-25')).not.toHaveClass('is-weekend')
    expect(day('2026-12-25').getAttribute('aria-label')).toContain('day off: Christmas Day')
    expect(day('2026-12-25')).toHaveTextContent('Christmas Day')
    expect(day('2026-12-22')).not.toHaveClass('is-day-off')
    expect(day('2026-12-22')).toHaveTextContent('Sam off')
    expect(day('2026-12-22').getAttribute('aria-label')).toContain('Sam off')
    expect(day('2026-12-26')).toHaveClass('is-weekend')
  })

  it('says under a due date that it falls on a day off, for everyone or the assignee', () => {
    const field = (value: string, assigneeId: string | null) => (
      <StaticPeopleProvider people={[sam]}>
        <StaticDaysOffProvider daysOff={daysOff}>
          <TaskDueDateField
            value={value}
            assigneeId={assigneeId}
            startDate=""
            onChange={() => {}}
          />
        </StaticDaysOffProvider>
      </StaticPeopleProvider>
    )
    const { rerender } = render(field('2026-12-25', null))
    expect(screen.getByText('Christmas Day: a day off')).toBeInTheDocument()
    expect(screen.getByLabelText('Due date')).toHaveAccessibleDescription(
      expect.stringContaining('Christmas Day: a day off')
    )
    rerender(field('2026-12-22', 'sam'))
    expect(screen.getByText('Leave: a day off for Sam')).toBeInTheDocument()
    rerender(field('2026-12-22', null))
    expect(screen.queryByText(/a day off/)).not.toBeInTheDocument()
  })
})
