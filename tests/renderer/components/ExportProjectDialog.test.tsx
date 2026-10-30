// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectExportOptions, RendererProject } from '@shared/ostler-api'
import { ExportProjectDialog } from '@renderer/components/ExportProjectDialog'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const project = { id: 'web', name: 'Website' } as RendererProject

function setup() {
  const exports: ProjectExportOptions[] = []
  installOstlerApi({
    exportProject: async (_projectId, options) => {
      exports.push(options)
      return { ok: true, value: 'C:\\Users\\me\\Documents\\Website.ostler-project' }
    }
  })
  const onClose = vi.fn()
  render(
    <ToastProvider>
      <ExportProjectDialog project={project} onClose={onClose} />
    </ToastProvider>
  )
  return { exports, onClose }
}

describe('ExportProjectDialog', () => {
  it('exports an ordinary project file with no password', async () => {
    const { exports } = setup()
    expect(screen.queryByLabelText('Password')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Choose where…' }))
    await waitFor(() => expect(exports).toEqual([{ comments: true }]))
  })

  it('protects with a password: twice, at least 8 characters, after the no-recovery warning', async () => {
    const { exports, onClose } = setup()
    fireEvent.click(screen.getByLabelText('Protect with a password'))
    expect(
      screen.getByText(
        'There is no way to recover a lost password. Without it, this file cannot be opened by anyone, including you.'
      )
    ).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Choose where…' })
    const first = screen.getByLabelText('Password')
    const second = screen.getByLabelText('Password again')
    expect(first).toHaveAttribute('type', 'password')
    expect(save).toBeDisabled()

    fireEvent.change(first, { target: { value: 'short' } })
    expect(first).toHaveAccessibleDescription(/at least 8 characters/)
    expect(save).toBeDisabled()

    fireEvent.change(first, { target: { value: 'Correct-Horse-Battery' } })
    expect(first).toHaveAccessibleDescription(/Strong/)
    fireEvent.change(second, { target: { value: 'Correct-Horse' } })
    expect(screen.getByText('The two passwords are not the same.')).toBeInTheDocument()
    expect(save).toBeDisabled()

    fireEvent.change(second, { target: { value: 'Correct-Horse-Battery' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() =>
      expect(exports).toEqual([{ comments: true, password: 'Correct-Horse-Battery' }])
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('clears the password when protection is turned off', () => {
    setup()
    fireEvent.click(screen.getByLabelText('Protect with a password'))
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'something long' } })
    fireEvent.click(screen.getByLabelText('Protect with a password'))
    fireEvent.click(screen.getByLabelText('Protect with a password'))
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })
})
