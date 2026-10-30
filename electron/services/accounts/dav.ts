/**
 * CalDAV and CardDAV (overview, "Providers": Apple iCloud and any CalDAV/CardDAV
 * server such as Fastmail, Nextcloud or Synology). One small client: find the
 * account's principal, its calendar and address-book homes, list calendars
 * and address books, read events in a date range and every card, and write
 * one event (phase 6).
 *
 * Every request goes through a `DavSend`, which in the app is
 * `ConnectedAccountsService.call`: the account's password is added there and
 * only the server's own hosts can be reached.
 */
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'
import {
  accountRequest,
  AccountCallError,
  type AccountFetch,
  type AccountResponse
} from './account-fetch'
import type { AccountCall } from './connected-accounts-service'
import { escapeXml, findAll, findFirst, parseXml, textOf, type XmlElement } from './dav-xml'

export type DavSend = (url: string, call: AccountCall) => Promise<AccountResponse>

export interface DavCalendar {
  url: string
  name: string
  /** `#rrggbb` when the server says, else null. */
  color: string | null
}

export interface DavAddressBook {
  url: string
  name: string
}

export interface DavResource {
  url: string
  etag: string | null
  data: string
}

const ICLOUD = /(^|\.)icloud\.com$/i
const ICLOUD_CARDDAV = 'https://contacts.icloud.com'

/** The address a person typed, as Ostler keeps it: https, no user name, no fragment. */
export function normaliseDavServer(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Refusal(t('errors:accounts.needsServer'))
  }
  let text = input.trim()
  if (!/^[a-z]+:\/\//i.test(text)) text = `https://${text}`
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Refusal(t('errors:accounts.badServer'))
  }
  if (url.protocol !== 'https:') throw new Refusal(t('errors:accounts.serverNotHttps'))
  if (url.username || url.password) throw new Refusal(t('errors:accounts.badServer'))
  url.hash = ''
  url.search = ''
  return url.toString()
}

/** The hosts a CalDAV account may reach: its server, or every iCloud host for iCloud. */
export function davHosts(server: string): string[] {
  const host = new URL(server).hostname.toLowerCase()
  return ICLOUD.test(host) ? ['.icloud.com', 'icloud.com'] : [host]
}

/** Checks the server answers for this user (a 401 is a wrong password). */
export async function verifyDavAccount(
  server: string,
  context: { authorization: string; hosts: string[]; fetch: AccountFetch; userAgent: string }
): Promise<void> {
  const send: DavSend = (url, call) =>
    accountRequest(url, {
      ...call,
      headers: { ...call.headers, Authorization: context.authorization },
      hosts: context.hosts,
      fetch: context.fetch,
      userAgent: context.userAgent
    })
  await principalOf(send, server)
}

/** The account's principal address, from the server or its `.well-known/caldav`. */
export async function principalOf(send: DavSend, server: string): Promise<string> {
  const body = propfindBody(['<d:current-user-principal/>'])
  for (const url of [server, new URL('/.well-known/caldav', server).toString()]) {
    try {
      const response = await propfind(send, url, body, '0')
      const href = firstHref(response.xml, 'current-user-principal')
      if (href) return new URL(href, response.url).toString()
    } catch (error) {
      if (error instanceof AccountCallError && error.reason === 'expired') throw error
    }
  }
  throw new AccountCallError('refused')
}

/** The calendars that hold events (not task lists). */
export async function listCalendars(send: DavSend, server: string): Promise<DavCalendar[]> {
  const principal = await principalOf(send, server)
  const home = await homeSet(send, principal, 'calendar-home-set', 'urn:ietf:params:xml:ns:caldav')
  const response = await propfind(
    send,
    home,
    propfindBody(
      [
        '<d:resourcetype/>',
        '<d:displayname/>',
        '<c:supported-calendar-component-set/>',
        '<x:calendar-color/>'
      ],
      'xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:x="http://apple.com/ns/ical/"'
    ),
    '1'
  )
  const calendars: DavCalendar[] = []
  for (const entry of findAll(response.xml, 'response')) {
    const href = textOf(entry, 'href')
    const type = findFirst(entry, 'resourcetype')
    if (!href || !type || !findFirst(type, 'calendar')) continue
    const components = findAll(entry, 'comp').map((comp) => comp.attributes.name?.toUpperCase())
    if (components.length > 0 && !components.includes('VEVENT')) continue
    const url = new URL(href, response.url).toString()
    calendars.push({
      url,
      name: textOf(entry, 'displayname') || lastSegment(url),
      color: davColor(textOf(entry, 'calendar-color'))
    })
  }
  return calendars
}

/** The events of a calendar that touch a range (UTC, `YYYYMMDDTHHMMSSZ`), as iCalendar text. */
export async function calendarEvents(
  send: DavSend,
  calendarUrl: string,
  from: Date,
  to: Date
): Promise<DavResource[]> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="${davTime(from)}" end="${davTime(to)}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`
  return report(send, calendarUrl, body, 'calendar-data')
}

/** The address books of the account. iCloud keeps them on its contacts server. */
export async function listAddressBooks(send: DavSend, server: string): Promise<DavAddressBook[]> {
  const base = ICLOUD.test(new URL(server).hostname) ? ICLOUD_CARDDAV : server
  let principal: string
  try {
    principal = await principalOf(send, base)
  } catch (error) {
    if (error instanceof AccountCallError && error.reason === 'expired') throw error
    principal = await principalOf(send, new URL('/.well-known/carddav', base).toString())
  }
  const home = await homeSet(
    send,
    principal,
    'addressbook-home-set',
    'urn:ietf:params:xml:ns:carddav'
  )
  const response = await propfind(
    send,
    home,
    propfindBody(['<d:resourcetype/>', '<d:displayname/>']),
    '1'
  )
  const books: DavAddressBook[] = []
  for (const entry of findAll(response.xml, 'response')) {
    const href = textOf(entry, 'href')
    const type = findFirst(entry, 'resourcetype')
    if (!href || !type || !findFirst(type, 'addressbook')) continue
    const url = new URL(href, response.url).toString()
    books.push({ url, name: textOf(entry, 'displayname') || lastSegment(url) })
  }
  return books
}

/** Every card in an address book, as vCard text. */
export async function addressBookCards(send: DavSend, bookUrl: string): Promise<DavResource[]> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop><d:getetag/><card:address-data/></d:prop>
</card:addressbook-query>`
  return report(send, bookUrl, body, 'address-data')
}

// ─── Requests ─────────────────────────────────────────────────────────

async function propfind(
  send: DavSend,
  url: string,
  body: string,
  depth: '0' | '1'
): Promise<{ xml: XmlElement; url: string }> {
  const response = await send(url, {
    method: 'PROPFIND',
    headers: { Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' },
    body
  })
  return { xml: parseOrFail(response.text), url }
}

async function report(
  send: DavSend,
  url: string,
  body: string,
  dataName: string
): Promise<DavResource[]> {
  const response = await send(url, {
    method: 'REPORT',
    headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body
  })
  const xml = parseOrFail(response.text)
  const resources: DavResource[] = []
  for (const entry of findAll(xml, 'response')) {
    const href = textOf(entry, 'href')
    const data = findFirst(entry, dataName)?.text
    if (!href || !data || !data.trim()) continue
    resources.push({
      url: new URL(href, url).toString(),
      etag: textOf(entry, 'getetag'),
      data
    })
  }
  return resources
}

async function homeSet(
  send: DavSend,
  principal: string,
  name: string,
  namespace: string
): Promise<string> {
  const response = await propfind(
    send,
    principal,
    propfindBody([`<h:${name}/>`], `xmlns:h="${escapeXml(namespace)}"`),
    '0'
  )
  const href = firstHref(response.xml, name)
  if (!href) throw new AccountCallError('refused')
  return new URL(href, response.url).toString()
}

function propfindBody(props: string[], extraNamespaces = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" ${extraNamespaces}><d:prop>${props.join('')}</d:prop></d:propfind>`
}

function firstHref(xml: XmlElement, property: string): string | null {
  const found = findFirst(xml, property)
  return found ? textOf(found, 'href') : null
}

function parseOrFail(text: string): XmlElement {
  try {
    return parseXml(text)
  } catch {
    throw new AccountCallError('server')
  }
}

function davTime(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

function davColor(value: string | null): string | null {
  const match = value ? /^#([0-9a-f]{6})/i.exec(value) : null
  return match ? `#${match[1].toLowerCase()}` : null
}

function lastSegment(url: string): string {
  const parts = new URL(url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[parts.length - 1] ?? url)
}
