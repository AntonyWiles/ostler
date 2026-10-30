import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ session: {}, shell: { openExternal: vi.fn() } }))

const { isAllowedExternalUrl, openExternalUrl } = await import('../../electron/app/security')

describe('openExternalUrl', () => {
  it('allows http and https only', async () => {
    expect(isAllowedExternalUrl('https://example.com/a')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com')).toBe(true)
    for (const url of [
      'file:///C:/Windows/system32/calc.exe',
      'javascript:alert(1)',
      'mailto:a@b.c',
      'ms-settings:',
      'not a url'
    ]) {
      expect(isAllowedExternalUrl(url)).toBe(false)
    }
    await expect(openExternalUrl('file:///C:/x')).rejects.toThrow('Only http and https')
  })
})
