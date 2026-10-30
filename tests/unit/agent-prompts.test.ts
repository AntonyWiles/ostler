import { describe, expect, it } from 'vitest'
import {
  buildAutomationConnectionText,
  buildAutomationTaskPrompt,
  buildHarnessSessionPrompt,
  buildMcpHttpClientConfig,
  buildMcpStdioClientConfig,
  buildMcpUrl,
  formatMcpStdioCommand,
  mcpServerName,
  maskSecret,
  maskSecrets
} from '../../src/shared/agent-prompts'

describe('agent prompts', () => {
  it('masks every occurrence of every secret, keeping the last four characters', () => {
    expect(maskSecret('abcdefgh1234')).toBe('••••1234')
    expect(maskSecrets('a TOKEN-9999 b TOKEN-9999', ['TOKEN-9999', undefined, ''])).toBe(
      'a ••••9999 b ••••9999'
    )
  })

  it('builds a session prompt that carries the session token for the agent', () => {
    const prompt = buildHarnessSessionPrompt(
      4100,
      'p1',
      { id: 's1', token: 'session-token-abcd', workspace: null },
      { title: 'Do it', details: null }
    )
    expect(prompt).toContain('Bearer session-token-abcd')
    expect(prompt).toContain('http://127.0.0.1:4100/harness/p1/help')
    expect(maskSecrets(prompt, ['session-token-abcd'])).not.toContain('session-token-abcd')
  })

  it("names the agent's own folder and says nothing of reservations", () => {
    const prompt = buildHarnessSessionPrompt(
      4100,
      'p1',
      {
        id: 's1',
        token: 'session-token-abcd',
        workspace: { worktreePath: 'C:/copies/fix-it', baseBranch: 'main', baseCommit: 'abc123' }
      },
      { title: 'Fix it', details: 'Carefully' }
    )
    expect(prompt).toContain('Session ID: s1')
    expect(prompt).toContain('Your folder: C:/copies/fix-it')
    expect(prompt).toContain('starting from main at abc123')
    expect(prompt).toContain('Details: Carefully')
    expect(prompt).not.toMatch(/reserv/i)
    expect(prompt).not.toContain('/session/start')
  })

  it('builds the connection texts', () => {
    expect(buildAutomationConnectionText(8935, 'p1', 'automation-secret')).toBe(
      [
        'Base URL: http://127.0.0.1:8935/automation/p1',
        'Project ID: p1',
        'Authorization: Bearer automation-secret',
        '',
        'First call GET /help (with the Authorization header) to see the available routes and how to use them.'
      ].join('\n')
    )
  })

  it('fills every placeholder of the automation task prompt', () => {
    const prompt = buildAutomationTaskPrompt(8935, 'p1', 'automation-secret', 'Add a goal')
    expect(prompt).not.toContain('{{')
    expect(prompt).toContain('Call GET http://127.0.0.1:8935/automation/p1/help first')
    expect(prompt).toContain('Bearer automation-secret')
    expect(prompt.endsWith('Add a goal')).toBe(true)
  })

  describe('MCP client settings (D39)', () => {
    const project = { id: 'p1', name: 'House move: Spring' }
    const launch = {
      command: 'C:\\Program Files\\Ostler\\Ostler.exe',
      args: ['--mcp-stdio', '--project', 'p1']
    }

    it('gives the HTTP form the endpoint and the token, under the project’s name', () => {
      expect(buildMcpUrl(8935, 'p1')).toBe('http://127.0.0.1:8935/automation/p1/mcp')
      expect(JSON.parse(buildMcpHttpClientConfig(8935, project, 'secret-token'))).toEqual({
        mcpServers: {
          'ostler-house-move-spring': {
            type: 'http',
            url: 'http://127.0.0.1:8935/automation/p1/mcp',
            headers: { Authorization: 'Bearer secret-token' }
          }
        }
      })
      expect(() => buildMcpHttpClientConfig(0, project, 'secret-token')).toThrow()
    })

    it('gives the stdio form the command and no token', () => {
      const text = buildMcpStdioClientConfig(project, launch)
      expect(JSON.parse(text)).toEqual({
        mcpServers: { 'ostler-house-move-spring': launch }
      })
      expect(text).not.toMatch(/token|Bearer/i)
      expect(
        JSON.parse(
          buildMcpStdioClientConfig(project, { ...launch, env: { OSTLER_USER_DATA: 'D:\\n' } })
        ).mcpServers['ostler-house-move-spring'].env
      ).toEqual({ OSTLER_USER_DATA: 'D:\\n' })
    })

    it('names a server by its project, or its id when the name has no letters', () => {
      expect(mcpServerName('Café plans', 'p1')).toBe('ostler-cafe-plans')
      expect(mcpServerName('!!!', 'p1')).toBe('ostler-p1')
    })

    it('quotes the parts of the command that need it', () => {
      expect(formatMcpStdioCommand(launch)).toBe(
        '"C:\\Program Files\\Ostler\\Ostler.exe" --mcp-stdio --project p1'
      )
    })
  })
})
