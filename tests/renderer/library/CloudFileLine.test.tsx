// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CloudFileLine } from '@renderer/views/project-detail/library/CloudFileLine'
import { installOstlerApi } from '../fixtures/ostler-api'

const URL = 'https://contoso-my.sharepoint.com/:w:/p/ann/EAbc'

describe('a Library link to a cloud file (integrations phase 3)', () => {
  it('shows the name the file has now, and offers it when the title differs', async () => {
    installOstlerApi({
      readCloudFile: async () => ({
        ok: true,
        value: { service: 'onedrive', name: 'Launch plan v2.docx', failure: null }
      })
    })
    const onRename = vi.fn()
    render(
      <CloudFileLine item={{ id: 'l1', url: URL, title: 'Launch plan' }} onRename={onRename} />
    )
    expect(await screen.findByText('In OneDrive, now named “Launch plan v2.docx”.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use this name' }))
    expect(onRename).toHaveBeenCalledWith('Launch plan v2.docx')
  })

  it('says how to see the name when no account can pick files there', async () => {
    installOstlerApi({
      readCloudFile: async () => ({
        ok: true,
        value: { service: 'onedrive', name: null, failure: 'noAccount' }
      })
    })
    render(<CloudFileLine item={{ id: 'l1', url: URL, title: 'Launch plan' }} onRename={vi.fn()} />)
    expect(await screen.findByText(/Connect an account that can pick files/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows nothing for an ordinary link', () => {
    const readCloudFile = vi.fn()
    installOstlerApi({ readCloudFile })
    const { container } = render(
      <CloudFileLine
        item={{ id: 'l1', url: 'https://example.com/a', title: 'A' }}
        onRename={vi.fn()}
      />
    )
    expect(container.textContent).toBe('')
    expect(readCloudFile).not.toHaveBeenCalled()
  })
})
