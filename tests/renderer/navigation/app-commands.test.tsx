// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useShortcuts } from '@renderer/navigation/shortcuts'
import { runAppCommand, useAppCommands } from '@renderer/shell/app-commands'
import { installOstlerApi } from '../fixtures/ostler-api'

function Shell({ children, newTask }: { children?: React.ReactNode; newTask: () => void }) {
  useShortcuts({ 'new-task': newTask })
  useAppCommands({ import: () => newTask() })
  return <>{children}</>
}

function Project({ newTask, print }: { newTask: () => void; print: () => void }) {
  useShortcuts({ 'new-task': newTask }, 'project')
  useAppCommands({ print }, 'project')
  return null
}

describe('menu commands (P8.2)', () => {
  it("run a shortcut's handler, the project's over the app's whichever mounted first", () => {
    installOstlerApi()
    const appNewTask = vi.fn()
    const projectNewTask = vi.fn()
    const print = vi.fn()
    const view = render(<Shell newTask={appNewTask} />)
    // The project mounts after the shell, as it does when someone opens one from Home.
    view.rerender(
      <Shell newTask={appNewTask}>
        <Project newTask={projectNewTask} print={print} />
      </Shell>
    )
    expect(runAppCommand({ kind: 'shortcut', id: 'new-task' })).toBe(true)
    expect(projectNewTask).toHaveBeenCalledTimes(1)
    expect(appNewTask).not.toHaveBeenCalled()
    expect(runAppCommand({ kind: 'print' })).toBe(true)
    expect(print).toHaveBeenCalledTimes(1)

    // Back outside the project, the app's handler takes the key again, and
    // nothing handles Print.
    view.rerender(<Shell newTask={appNewTask} />)
    runAppCommand({ kind: 'shortcut', id: 'new-task' })
    expect(appNewTask).toHaveBeenCalledTimes(1)
    expect(runAppCommand({ kind: 'print' })).toBe(false)
    view.unmount()
  })
})
