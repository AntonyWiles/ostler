// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ViewerNotice } from '@renderer/views/workspace/ProjectWorkspace'
import { installOstlerApi } from '../../fixtures/ostler-api'

describe('The sharing notice', () => {
  it('tells a Contributor what they can do', async () => {
    installOstlerApi({
      getShareState: async () => ({
        ok: true,
        value: { projectId: 'p1', myRole: 'contributor' } as never
      })
    })
    render(<ViewerNotice projectId="p1" />)
    expect(await screen.findByText(/You're a Contributor/)).toBeTruthy()
  })

  it('shows nothing to an Owner', async () => {
    installOstlerApi({
      getShareState: async () => ({
        ok: true,
        value: { projectId: 'p1', myRole: 'owner' } as never
      })
    })
    const { container } = render(<ViewerNotice projectId="p1" />)
    await Promise.resolve()
    expect(container.textContent).toBe('')
  })
})
