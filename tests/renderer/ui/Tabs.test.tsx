// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tabs } from '@renderer/ui'

type Tab = 'overview' | 'tasks' | 'archived' | 'files'

function Harness({ orientation }: { orientation?: 'horizontal' | 'vertical' }) {
  const [value, setValue] = useState<Tab>('overview')
  return (
    <Tabs
      label="Project sections"
      orientation={orientation}
      value={value}
      onChange={setValue}
      items={[
        { value: 'overview', label: 'Overview', content: <p>Overview panel</p> },
        { value: 'tasks', label: 'Tasks', content: <p>Tasks panel</p> },
        { value: 'archived', label: 'Archived', disabled: true, content: <p>Archived panel</p> },
        { value: 'files', label: 'Files', content: <p>Files panel</p> }
      ]}
    />
  )
}

const tab = (name: string) => screen.getByRole('tab', { name })

describe('Tabs', () => {
  it('is a named tablist whose selected tab labels its panel', () => {
    render(<Harness />)
    expect(screen.getByRole('tablist', { name: 'Project sections' })).toBeInTheDocument()
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Overview' })).toHaveTextContent('Overview panel')
  })

  it('has one tab stop: the selected tab', () => {
    render(<Harness />)
    expect(tab('Overview')).toHaveAttribute('tabindex', '0')
    expect(tab('Tasks')).toHaveAttribute('tabindex', '-1')
  })

  it('moves and selects with the arrow keys, Home and End, skipping disabled tabs', () => {
    render(<Harness />)
    fireEvent.keyDown(tab('Overview'), { key: 'ArrowRight' })
    expect(tab('Tasks')).toHaveFocus()
    expect(tab('Tasks')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Tasks panel')

    fireEvent.keyDown(tab('Tasks'), { key: 'ArrowRight' })
    expect(tab('Files')).toHaveFocus()
    fireEvent.keyDown(tab('Files'), { key: 'ArrowRight' })
    expect(tab('Overview')).toHaveFocus()
    fireEvent.keyDown(tab('Overview'), { key: 'ArrowLeft' })
    expect(tab('Files')).toHaveFocus()
    fireEvent.keyDown(tab('Files'), { key: 'Home' })
    expect(tab('Overview')).toHaveFocus()
    fireEvent.keyDown(tab('Overview'), { key: 'End' })
    expect(tab('Files')).toHaveFocus()
  })

  it('stands the tabs in a column with Up and Down when vertical', () => {
    render(<Harness orientation="vertical" />)
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')
    fireEvent.keyDown(tab('Overview'), { key: 'ArrowDown' })
    expect(tab('Tasks')).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Tasks panel')
    fireEvent.keyDown(tab('Tasks'), { key: 'ArrowUp' })
    expect(tab('Overview')).toHaveFocus()
    // Left and Right are for a row of tabs.
    fireEvent.keyDown(tab('Overview'), { key: 'ArrowRight' })
    expect(tab('Overview')).toHaveFocus()
  })

  it('does not select a disabled tab on click', () => {
    render(<Harness />)
    expect(tab('Archived')).toBeDisabled()
    fireEvent.click(tab('Archived'))
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true')
  })
})
