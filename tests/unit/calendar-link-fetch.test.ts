import { describe, expect, it, vi } from 'vitest'
import {
  CalendarLinkError,
  fetchCalendarLink,
  httpsOnlyFetch,
  normaliseCalendarLink,
  shortenCalendarLink,
  type CalendarFetch
} from '../../electron/services/calendar-link-fetch'

const LINK = 'https://outlook.office365.com/owa/calendar/abc/s3cr3t-token/calendar.ics'
const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'

function response(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(status === 304 || status === 204 ? null : body, { status, headers })
}

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(CalendarLinkError)
    expect(String((error as Error).message)).not.toContain('s3cr3t')
    return (error as CalendarLinkError).reason
  }
  throw new Error('expected a failure')
}

describe('normaliseCalendarLink (N3.3b)', () => {
  it('reads webcal:// as https://', () => {
    expect(normaliseCalendarLink('  webcal://p01-caldav.icloud.com/published/2/abc  ')).toBe(
      'https://p01-caldav.icloud.com/published/2/abc'
    )
    expect(normaliseCalendarLink('WEBCALS://example.com/a.ics')).toBe('https://example.com/a.ics')
    expect(normaliseCalendarLink(`${LINK}#part`)).toBe(LINK)
  })

  it('refuses http, other schemes, credentials and nonsense', () => {
    expect(() => normaliseCalendarLink('http://example.com/a.ics')).toThrow(/secure/)
    expect(() => normaliseCalendarLink('ftp://example.com/a.ics')).toThrow(/secure/)
    expect(() => normaliseCalendarLink('file:///C:/a.ics')).toThrow(/secure/)
    expect(() => normaliseCalendarLink('https://me:pw@example.com/a.ics')).toThrow(/password/)
    expect(() => normaliseCalendarLink('not a link')).toThrow()
    expect(() => normaliseCalendarLink('')).toThrow()
    expect(() => normaliseCalendarLink(42)).toThrow()
  })

  it('shortens a link to its host and last part, leaving out the secret', () => {
    expect(shortenCalendarLink(LINK)).toBe('outlook.office365.com/…/calendar.ics')
    expect(shortenCalendarLink('https://example.com/a.ics?token=s3cr3t')).toBe('example.com/a.ics')
    expect(shortenCalendarLink('https://example.com/')).toBe('example.com')
    expect(shortenCalendarLink(LINK)).not.toContain('s3cr3t')
  })
})

describe('fetchCalendarLink (N3.3b)', () => {
  it('sends only a User-Agent and the conditional headers, with no credentials', async () => {
    const fetch = vi.fn<CalendarFetch>(async () =>
      response(200, ICS, { ETag: '"v2"', 'Last-Modified': 'Sat, 17 Oct 2026 08:00:00 GMT' })
    )
    const result = await fetchCalendarLink(
      LINK,
      { etag: '"v1"', lastModified: 'Fri, 16 Oct 2026 08:00:00 GMT' },
      { fetch, userAgent: 'Ostler Test' }
    )
    expect(result).toEqual({
      notModified: false,
      text: ICS,
      etag: '"v2"',
      lastModified: 'Sat, 17 Oct 2026 08:00:00 GMT'
    })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(LINK)
    expect(init.headers).toEqual({
      'User-Agent': 'Ostler Test',
      'If-None-Match': '"v1"',
      'If-Modified-Since': 'Fri, 16 Oct 2026 08:00:00 GMT'
    })
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' })
  })

  it('sends no conditional headers the first time', async () => {
    const fetch = vi.fn<CalendarFetch>(async () => response(200, ICS))
    await fetchCalendarLink(LINK, {}, { fetch, userAgent: 'Ostler Test' })
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'User-Agent': 'Ostler Test' })
  })

  it('reports a 304 as not modified', async () => {
    const fetch = vi.fn<CalendarFetch>(async () => response(304))
    expect(
      await fetchCalendarLink(LINK, { etag: '"v1"' }, { fetch, userAgent: 'Ostler Test' })
    ).toEqual({ notModified: true })
  })

  it('follows up to three https redirects, and refuses a fourth or one to http', async () => {
    let hops = 0
    const redirecting = (limit: number, to = 'https://example.com/next'): CalendarFetch =>
      vi.fn(async () => (hops++ < limit ? response(302, '', { Location: to }) : response(200, ICS)))
    hops = 0
    expect(
      await fetchCalendarLink(LINK, {}, { fetch: redirecting(3), userAgent: 'Ostler Test' })
    ).toMatchObject({ notModified: false, text: ICS })
    hops = 0
    expect(
      await reason(fetchCalendarLink(LINK, {}, { fetch: redirecting(4), userAgent: 'Ostler Test' }))
    ).toBe('redirects')
    hops = 0
    expect(
      await reason(
        fetchCalendarLink(
          LINK,
          {},
          {
            fetch: redirecting(1, 'http://example.com/plain.ics'),
            userAgent: 'Ostler Test'
          }
        )
      )
    ).toBe('notHttps')
  })

  it('refuses an http link before fetching', async () => {
    const fetch = vi.fn<CalendarFetch>(async () => response(200, ICS))
    expect(
      await reason(
        fetchCalendarLink('http://example.com/a.ics', {}, { fetch, userAgent: 'Ostler Test' })
      )
    ).toBe('notHttps')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('the real fetch refuses anything but https without touching the network', async () => {
    await expect(httpsOnlyFetch('http://127.0.0.1:9/a.ics', {})).rejects.toMatchObject({
      reason: 'notHttps'
    })
    await expect(httpsOnlyFetch('file:///C:/a.ics', {})).rejects.toMatchObject({
      reason: 'notHttps'
    })
  })

  it('gives up after the timeout', async () => {
    const fetch: CalendarFetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener('abort', () => reject(new Error(`aborted ${LINK}`)))
      )
    expect(
      await reason(fetchCalendarLink(LINK, {}, { fetch, userAgent: 'Ostler Test', timeoutMs: 20 }))
    ).toBe('timeout')
  })

  it('refuses a body over the size limit, declared or streamed', async () => {
    const declared = vi.fn<CalendarFetch>(async () =>
      response(200, ICS, { 'Content-Length': '999999' })
    )
    expect(
      await reason(
        fetchCalendarLink(LINK, {}, { fetch: declared, userAgent: 'Ostler Test', maxBytes: 1000 })
      )
    ).toBe('tooBig')
    const streamed = vi.fn<CalendarFetch>(async () => response(200, 'x'.repeat(2000)))
    expect(
      await reason(
        fetchCalendarLink(LINK, {}, { fetch: streamed, userAgent: 'Ostler Test', maxBytes: 1000 })
      )
    ).toBe('tooBig')
  })

  it('names refusals, server errors and unreachable hosts without the link', async () => {
    for (const [status, expected] of [
      [401, 'refused'],
      [403, 'refused'],
      [404, 'refused'],
      [410, 'refused'],
      [500, 'server']
    ] as const) {
      const fetch = vi.fn<CalendarFetch>(async () => response(status))
      expect(await reason(fetchCalendarLink(LINK, {}, { fetch, userAgent: 'Ostler Test' }))).toBe(
        expected
      )
    }
    const offline = vi.fn<CalendarFetch>(async () => {
      throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${LINK}`)
    })
    expect(
      await reason(fetchCalendarLink(LINK, {}, { fetch: offline, userAgent: 'Ostler Test' }))
    ).toBe('unreachable')
  })
})
