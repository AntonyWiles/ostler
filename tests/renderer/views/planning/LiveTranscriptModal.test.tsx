// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { LiveTranscriptModal } from '@renderer/views/planning/LiveTranscriptModal'
import type { HarnessSession, SessionTranscriptEntry } from '@shared/ostler-api'
import { installOstlerApi } from '../../fixtures/ostler-api'

describe('LiveTranscriptModal', () => {
  const mockSession: HarnessSession = {
    id: 'sess-test-1',
    token: 'tok-123',
    startedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    status: 'active',
    statusNote: 'Refactoring auth module',
    blocked: false,
    workspace: {
      branchName: 'nexus/session/sess-test-1',
      worktreePath: 'C:\\ostler\\data\\workspaces\\sess-test-1',
      baseBranch: 'main',
      baseCommit: 'commit-123'
    },
    title: 'Refactor Auth Module',
    provenance: 'embedded',
    embeddedRuntime: {
      kind: 'opencode',
      version: '1.18.23',
      processPort: 4200,
      openCodeSessionId: 'oc-1',
      toolCallCount: 3,
      maxToolCallsPerMinute: 50,
      toolCallsInLastMinute: 1,
      turnCount: 2,
      usage: { totalTokens: 8200 }
    }
  }

  const sampleEntries: SessionTranscriptEntry[] = [
    {
      role: 'user',
      content: 'Refactor authentication error handling in auth-service.ts',
      timestamp: '2026-08-27T10:00:00.000Z'
    },
    {
      role: 'tool',
      content: 'Executed tool: read_file',
      timestamp: '2026-08-27T10:00:05.000Z'
    },
    {
      role: 'assistant',
      content: '[Question to human] Should we preserve legacy AuthError subclasses?',
      timestamp: '2026-08-27T10:00:10.000Z'
    },
    {
      role: 'user',
      content: '[Human Answer] Yes, keep them deprecated but present.',
      timestamp: '2026-08-27T10:00:20.000Z'
    },
    {
      role: 'system',
      content: '[Defense-in-depth blocked] Tool bash on target /etc/shadow: path outside workspace',
      timestamp: '2026-08-27T10:00:25.000Z'
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    installOstlerApi({
      getHarnessSessionTranscript: vi.fn().mockResolvedValue({
        ok: true,
        value: sampleEntries
      })
    })
  })

  it('renders header, runtime stats, and transcript entries', async () => {
    const onClose = vi.fn()
    render(<LiveTranscriptModal projectId="proj-1" session={mockSession} onClose={onClose} />)

    expect(screen.getByText('Live agent transcript')).toBeInTheDocument()
    expect(screen.getByText('4200')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/1 \/ 50 per minute/)).toBeInTheDocument()
    expect(screen.getByText('8,200')).toBeInTheDocument()

    await waitFor(() => {
      expect(
        screen.getByText('Refactor authentication error handling in auth-service.ts')
      ).toBeInTheDocument()
      expect(screen.getByText('Executed tool: read_file')).toBeInTheDocument()
      expect(
        screen.getByText('[Question to human] Should we preserve legacy AuthError subclasses?')
      ).toBeInTheDocument()
      expect(
        screen.getByText('[Human Answer] Yes, keep them deprecated but present.')
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          '[Defense-in-depth blocked] Tool bash on target /etc/shadow: path outside workspace'
        )
      ).toBeInTheDocument()
    })
  })

  it('filters transcript entries by role', async () => {
    render(<LiveTranscriptModal projectId="proj-1" session={mockSession} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Executed tool: read_file')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('radio', { name: 'Tool' }))

    expect(screen.getByText('Executed tool: read_file')).toBeInTheDocument()
    expect(
      screen.queryByText('Refactor authentication error handling in auth-service.ts')
    ).not.toBeInTheDocument()
  })

  it('calls onClose from the Close button', async () => {
    const onClose = vi.fn()
    render(<LiveTranscriptModal projectId="proj-1" session={mockSession} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Live agent transcript')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reads as bubbles with each tool call collapsed to its first line', async () => {
    installOstlerApi({
      getHarnessSessionTranscript: vi.fn().mockResolvedValue({
        ok: true,
        value: [
          {
            role: 'tool',
            content: 'bash: npm test\n12 passed\n0 failed',
            timestamp: '2026-08-27T10:00:05.000Z'
          }
        ]
      })
    })
    render(<LiveTranscriptModal projectId="proj-1" session={mockSession} onClose={vi.fn()} />)

    const firstLine = await screen.findByText('bash: npm test')
    const entry = firstLine.closest('details')
    expect(entry).not.toBeNull()
    expect(entry!.open).toBe(false)
    expect(screen.getByText('Tool call')).toBeInTheDocument()
  })
})
