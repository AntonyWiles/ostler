import {
  buildAutomationBaseUrl,
  buildHarnessBaseUrl,
  isHarnessPort
} from '../../src/shared/harness-url'

describe('harness agent connection URLs', () => {
  it('includes the configured port in an agent-facing base URL', () => {
    expect(buildHarnessBaseUrl(8934, 'project-123')).toBe(
      'http://127.0.0.1:8934/harness/project-123'
    )
  })

  it('rejects an unloaded or invalid port instead of creating a malformed URL', () => {
    expect(isHarnessPort(null)).toBe(false)
    expect(isHarnessPort(0)).toBe(false)
    expect(isHarnessPort(65536)).toBe(false)
    expect(() => buildHarnessBaseUrl(null as unknown as number, 'project-123')).toThrow(
      'Harness API port is unavailable'
    )
  })
})

describe('automation API connection URLs', () => {
  it('includes the configured port in the automation base URL', () => {
    expect(buildAutomationBaseUrl(8935, 'project-123')).toBe(
      'http://127.0.0.1:8935/automation/project-123'
    )
  })

  it('rejects an unloaded or invalid port instead of creating a malformed URL', () => {
    expect(() => buildAutomationBaseUrl(null as unknown as number, 'project-123')).toThrow(
      'Automation API port is unavailable'
    )
  })
})
