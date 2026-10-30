import { Readable } from 'stream'
import { describe, expect, it, vi } from 'vitest'
import { bearerToken, readJsonRecord, respondJson } from '../../electron/services/loopback-http'

function request(body = '', authorization?: string) {
  return Object.assign(Readable.from(body ? [body] : []), {
    headers: { authorization }
  })
}

describe('loopback HTTP helpers', () => {
  it('reads object JSON and rejects malformed or oversized bodies', async () => {
    await expect(readJsonRecord(request('{"task":"test"}') as never)).resolves.toEqual({
      task: 'test'
    })
    await expect(readJsonRecord(request('{') as never)).rejects.toThrow(
      'Request body must be valid JSON'
    )
    await expect(readJsonRecord(request('{"tooLarge":true}') as never, 4)).rejects.toThrow(
      'Request body too large'
    )
  })

  it('extracts bearer credentials without accepting other schemes', () => {
    expect(bearerToken(request('', 'Bearer session-token') as never)).toBe('session-token')
    expect(bearerToken(request('', 'Basic credentials') as never)).toBe('')
  })

  it('writes a complete JSON response', () => {
    const writeHead = vi.fn()
    const end = vi.fn()
    respondJson({ writeHead, end } as never, 200, { ok: true })
    expect(writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'application/json',
      'Content-Length': 11
    })
    expect(end).toHaveBeenCalledWith('{"ok":true}')
  })
})
