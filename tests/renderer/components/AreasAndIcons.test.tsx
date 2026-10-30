// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { RendererProject } from '@shared/ostler-api'
import { PROJECT_ICONS, type ProjectIcon } from '@shared/project-icons'
import { Select } from '@renderer/ui'
import { projectSelectOptions } from '@renderer/components/areas/project-options'
import { ProjectIconPicker } from '@renderer/components/ProjectIconPicker'
import { ProjectMark } from '@renderer/components/ProjectMark'
import { PROJECT_ICON_GLYPHS } from '@renderer/components/project-icon-glyphs'
import { PortfolioView } from '@renderer/views/planning/PortfolioView'
import { installOstlerApi } from '../fixtures/ostler-api'

const areas = [
  { id: 'home', name: 'Home' },
  { id: 'work', name: 'Work' }
]
const projects = [
  { id: 'a', name: 'Garden', areaId: 'home' },
  { id: 'b', name: 'Budget', areaId: 'work' },
  { id: 'c', name: 'Novel', areaId: null },
  { id: 'd', name: 'Taxes', areaId: 'home' }
]

describe('project pickers (N5.1)', () => {
  it('show areas as groups in the one grouping, No area last', () => {
    render(
      <Select
        label="Project"
        options={[{ value: '', label: 'All projects' }, ...projectSelectOptions(projects, areas)]}
      />
    )
    const select = screen.getByLabelText('Project')
    const groups = [...select.querySelectorAll('optgroup')].map((group) => [
      group.label,
      [...group.querySelectorAll('option')].map((option) => option.textContent)
    ])
    expect(groups).toEqual([
      ['Home', ['Garden', 'Taxes']],
      ['Work', ['Budget']],
      ['No area', ['Novel']]
    ])
    // "All projects" stays outside any group.
    expect(select.firstElementChild?.tagName).toBe('OPTION')
  })

  it('still find any project by typing, and show no groups without areas', () => {
    render(<Select label="Project" options={projectSelectOptions(projects, [])} />)
    const select = screen.getByLabelText('Project')
    expect(select.querySelector('optgroup')).toBeNull()
    expect(within(select).getByRole('option', { name: 'Taxes' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'd' } })
    expect(select).toHaveValue('d')
  })
})

function Picker({ onChange }: { onChange: (icon: ProjectIcon | null) => void }) {
  const [value, setValue] = useState<ProjectIcon | null>('house')
  return (
    <ProjectIconPicker
      value={value}
      name="test-icon"
      onChange={(icon) => {
        setValue(icon)
        onChange(icon)
      }}
    />
  )
}

describe('ProjectIconPicker (N5.1)', () => {
  it('offers None and every curated icon by name, and picks one', () => {
    const onChange = vi.fn()
    render(<Picker onChange={onChange} />)
    expect(screen.getAllByRole('radio')).toHaveLength(PROJECT_ICONS.length + 1)
    expect(screen.getByRole('radio', { name: 'House' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Plane' }))
    expect(onChange).toHaveBeenLastCalledWith('plane')
    fireEvent.click(screen.getByRole('radio', { name: 'None' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('searches the icons by name', () => {
    render(<Picker onChange={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search icons' }), {
      target: { value: 'piggy' }
    })
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual([
      'None',
      'Piggy bank'
    ])
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search icons' }), {
      target: { value: 'zzz' }
    })
    expect(screen.getByText('No icons match')).toBeInTheDocument()
  })

  it('has a glyph for every curated id', () => {
    for (const icon of PROJECT_ICONS) expect(PROJECT_ICON_GLYPHS[icon]).toBeTruthy()
  })

  it("shows the icon in the project's colour, else the colour dot, and announces neither", () => {
    const { container } = render(
      <>
        <ProjectMark project={{ color: '#ef4444', icon: 'plane' }} />
        <ProjectMark project={{ color: '#ef4444', icon: null }} />
      </>
    )
    const [withIcon, dot] = [...container.children] as HTMLElement[]
    expect(withIcon.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(withIcon.style.color).toBe('rgb(239, 68, 68)')
    expect(dot.querySelector('svg')).toBeNull()
    expect(dot).toHaveAttribute('aria-hidden', 'true')
  })
})

function renderer(id: string, name: string, areaId: string | null): RendererProject {
  return {
    id,
    name,
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    hasAutomationToken: false,
    areaId,
    icon: null
  } as RendererProject
}

describe("Home's project cards (N5.1)", () => {
  it('group under area headings in the sidebar grouping', async () => {
    const empty = async () => ({ ok: true as const, value: [] as never })
    installOstlerApi({
      getPlanningWorkItems: empty,
      getPlanningMilestones: empty,
      getPlanningProjectMetrics: async () => ({
        ok: true as const,
        value: {
          itemCount: 0,
          completedCount: 0,
          averageLeadTimeMs: null,
          averageCycleTimeMs: null,
          averageQueueAgeMs: 0,
          totalBlockedTimeMs: 0,
          throughput: []
        }
      }),
      getHarnessState: async () => ({ ok: false as const, error: 'off' }),
      getPlanningProjectWorkItemMetrics: async () => ({ ok: true as const, value: {} })
    })
    render(
      <MemoryRouter>
        <PortfolioView
          projects={projects.map((entry) => renderer(entry.id, entry.name, entry.areaId))}
          areas={areas}
        />
      </MemoryRouter>
    )
    const headings = await screen.findAllByRole('heading', { level: 3 })
    expect(headings.map((heading) => heading.textContent)).toEqual(['Home', 'Work', 'No area'])
    const home = screen.getByRole('list', { name: 'Home' })
    expect(
      within(home)
        .getAllByRole('heading', { level: 4 })
        .map((heading) => heading.textContent)
    ).toEqual(['Garden', 'Taxes'])
  })
})
