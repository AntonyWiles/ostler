/**
 * Calendars from connected accounts (docs/plans/integrations/overview.md, phase 1):
 * Google Calendar, Microsoft 365 and Outlook.com through Graph, and any CalDAV
 * server (iCloud included). Read only.
 *
 * Each calendar's events in a window around today come back as one iCalendar
 * text, so they go through the same reader, time zones and repeat handling as
 * a calendar file or link (`OutsideCalendarService`). Google and Graph expand
 * repeats themselves (single events); CalDAV returns the server's own
 * iCalendar, repeats and all.
 */
import type { AccountProvider } from '@shared/ostler-api'
import type { ConnectedAccountsService } from './connected-accounts-service'
import { calendarEvents, listCalendars, type DavSend } from './dav'

/** Time blocks Ostler copied into a calendar carry this (time-block-mirror.ts). */
const BLOCK_MARK = 'ostler-block-'

export interface AccountCalendarChoice {
  /** The provider's id for the calendar (a CalDAV calendar's address). Main only. */
  remoteId: string
  name: string
  /** `#rrggbb` when the provider says, else null. */
  color: string | null
}

const MAX_EVENTS = 5000
const MAX_PAGES = 20

type Accounts = Pick<ConnectedAccountsService, 'get' | 'call' | 'callJson' | 'serverOf'>

/** The calendars an account has. */
export async function listAccountCalendars(
  accounts: Accounts,
  accountId: string
): Promise<AccountCalendarChoice[]> {
  const account = accounts.get(accountId)
  switch (account.provider) {
    case 'google': {
      const answer = await accounts.callJson<{
        items?: {
          id?: string
          summary?: string
          summaryOverride?: string
          backgroundColor?: string
        }[]
      }>(accountId, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250')
      return (answer.items ?? [])
        .filter((item) => typeof item.id === 'string')
        .map((item) => ({
          remoteId: item.id as string,
          name: item.summaryOverride || item.summary || (item.id as string),
          color: hexColor(item.backgroundColor)
        }))
    }
    case 'microsoft': {
      const answer = await accounts.callJson<{
        value?: { id?: string; name?: string; hexColor?: string }[]
      }>(
        accountId,
        'https://graph.microsoft.com/v1.0/me/calendars?$top=100&$select=id,name,hexColor'
      )
      return (answer.value ?? [])
        .filter((item) => typeof item.id === 'string')
        .map((item) => ({
          remoteId: item.id as string,
          name: item.name || (item.id as string),
          color: hexColor(item.hexColor)
        }))
    }
    case 'caldav': {
      const server = accounts.serverOf(accountId)
      if (!server) return []
      const calendars = await listCalendars(davSend(accounts, accountId), server)
      return calendars.map((calendar) => ({
        remoteId: calendar.url,
        name: calendar.name,
        color: calendar.color
      }))
    }
    default:
      return []
  }
}

/** One calendar's events from `from` to `to`, as iCalendar text. */
export async function accountCalendarIcs(
  accounts: Accounts,
  accountId: string,
  remoteId: string,
  from: Date,
  to: Date
): Promise<string> {
  const provider: AccountProvider = accounts.get(accountId).provider
  switch (provider) {
    case 'google':
      return googleIcs(accounts, accountId, remoteId, from, to)
    case 'microsoft':
      return graphIcs(accounts, accountId, remoteId, from, to)
    case 'caldav': {
      const resources = await calendarEvents(davSend(accounts, accountId), remoteId, from, to)
      return mergeCalendars(resources.map((resource) => resource.data))
    }
    default:
      return wrap([])
  }
}

/** A `DavSend` that goes through the account: its password, its server only. */
export function davSend(accounts: Pick<Accounts, 'call'>, accountId: string): DavSend {
  return (url, call) => accounts.call(accountId, url, call)
}

// ─── Google ─────────────────────────────────────────────────────────────

interface GoogleEvent {
  id?: string
  status?: string
  summary?: string
  location?: string
  description?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
  hangoutLink?: string
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
  extendedProperties?: { private?: Record<string, string> }
}

async function googleIcs(
  accounts: Accounts,
  accountId: string,
  calendarId: string,
  from: Date,
  to: Date
): Promise<string> {
  const events: string[] = []
  let pageToken: string | null = null
  for (let page = 0; page < MAX_PAGES && events.length < MAX_EVENTS; page++) {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
    )
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')
    url.searchParams.set('timeMin', from.toISOString())
    url.searchParams.set('timeMax', to.toISOString())
    url.searchParams.set('maxResults', '2500')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const answer = await accounts.callJson<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      accountId,
      url.toString()
    )
    for (const item of answer.items ?? []) {
      if (item.status === 'cancelled' || !item.id || !item.start || !item.end) continue
      // Ostler's own copy of a time block: the block already shows.
      if (item.extendedProperties?.private?.ostlerBlock) continue
      const video = item.conferenceData?.entryPoints?.find(
        (entry) => entry.entryPointType === 'video'
      )?.uri
      const vevent = vEvent({
        uid: `${item.id}@google`,
        title: item.summary ?? '',
        location: item.location ?? '',
        description: withLink(plainText(item.description ?? ''), video ?? item.hangoutLink),
        start: item.start,
        end: item.end
      })
      if (vevent) events.push(vevent)
    }
    pageToken = answer.nextPageToken ?? null
    if (!pageToken) break
  }
  return wrap(events)
}

// ─── Microsoft Graph ───────────────────────────────────────────────────

interface GraphEvent {
  id?: string
  subject?: string
  isAllDay?: boolean
  isCancelled?: boolean
  bodyPreview?: string
  location?: { displayName?: string }
  start?: { dateTime?: string }
  end?: { dateTime?: string }
  onlineMeeting?: { joinUrl?: string } | null
  transactionId?: string | null
}

async function graphIcs(
  accounts: Accounts,
  accountId: string,
  calendarId: string,
  from: Date,
  to: Date
): Promise<string> {
  const events: string[] = []
  const first = new URL(
    `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView`
  )
  first.searchParams.set('startDateTime', from.toISOString())
  first.searchParams.set('endDateTime', to.toISOString())
  first.searchParams.set('$top', '500')
  first.searchParams.set(
    '$select',
    'id,subject,isAllDay,isCancelled,bodyPreview,location,start,end,onlineMeeting,transactionId'
  )
  let next: string | null = first.toString()
  for (let page = 0; next && page < MAX_PAGES && events.length < MAX_EVENTS; page++) {
    const answer: { value?: GraphEvent[]; '@odata.nextLink'?: string } = await accounts.callJson(
      accountId,
      next,
      // Every time in UTC: no Windows zone names to translate.
      { headers: { Prefer: 'outlook.timezone="UTC"' } }
    )
    for (const item of answer.value ?? []) {
      if (item.isCancelled || !item.id || !item.start?.dateTime || !item.end?.dateTime) continue
      if (item.transactionId?.startsWith(BLOCK_MARK)) continue
      const start = item.start.dateTime
      const end = item.end.dateTime
      const vevent = vEvent({
        uid: `${item.id}@microsoft`,
        title: item.subject ?? '',
        location: item.location?.displayName ?? '',
        description: withLink(item.bodyPreview ?? '', item.onlineMeeting?.joinUrl),
        start: item.isAllDay
          ? { date: start.slice(0, 10) }
          : { dateTime: `${start.slice(0, 19)}Z` },
        end: item.isAllDay ? { date: end.slice(0, 10) } : { dateTime: `${end.slice(0, 19)}Z` }
      })
      if (vevent) events.push(vevent)
    }
    next = answer['@odata.nextLink'] ?? null
  }
  return wrap(events)
}

// ─── iCalendar text ────────────────────────────────────────────────────

interface PlainEvent {
  uid: string
  title: string
  location: string
  description: string
  start: { date?: string; dateTime?: string }
  end: { date?: string; dateTime?: string }
}

/** One VEVENT, or null when its times can't be read. */
export function vEvent(event: PlainEvent): string | null {
  const start = icsTime(event.start)
  const end = icsTime(event.end)
  if (!start || !end) return null
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}`,
    `DTSTART${start}`,
    `DTEND${end}`,
    `SUMMARY:${escapeText(event.title)}`
  ]
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`)
  lines.push('END:VEVENT')
  return lines.join('\r\n')
}

function icsTime(time: { date?: string; dateTime?: string }): string | null {
  if (time.date && /^\d{4}-\d{2}-\d{2}$/.test(time.date)) {
    return `;VALUE=DATE:${time.date.replace(/-/g, '')}`
  }
  if (time.dateTime) {
    const instant = new Date(time.dateTime)
    if (Number.isNaN(instant.getTime())) return null
    return `:${instant
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')}`
  }
  return null
}

function wrap(events: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ostler//Account calendar//EN',
    ...events,
    'END:VCALENDAR',
    ''
  ].join('\r\n')
}

/** Many CalDAV resources (each its own VCALENDAR) as one calendar: their time zones and events. */
export function mergeCalendars(texts: string[]): string {
  const parts: string[] = []
  const zones = new Set<string>()
  for (const text of texts) {
    const lines = text.split(/\r?\n/)
    let block: string[] | null = null
    let kind: string | null = null
    for (const line of lines) {
      const begin = /^BEGIN:(VEVENT|VTIMEZONE)\s*$/i.exec(line)
      if (!block && begin) {
        block = [line]
        kind = begin[1].toUpperCase()
        continue
      }
      if (block) {
        block.push(line)
        if (new RegExp(`^END:${kind}\\s*$`, 'i').test(line)) {
          const joined = block.join('\r\n')
          if (kind === 'VTIMEZONE') {
            const id = /^TZID:(.*)$/im.exec(joined)?.[1]?.trim() ?? joined
            if (!zones.has(id)) {
              zones.add(id)
              parts.unshift(joined)
            }
          } else if (!new RegExp(`^UID:${BLOCK_MARK}`, 'im').test(joined)) {
            parts.push(joined)
          }
          block = null
          kind = null
        }
      }
    }
    if (parts.length > MAX_EVENTS) break
  }
  return wrap(parts)
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

/** Google descriptions can be HTML: keep the words and the links, drop the tags. */
function plainText(text: string): string {
  if (!/<[a-z!/]/i.test(text)) return text
  return text
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_whole, href: string, label: string) =>
      label.includes(href) ? label : `${label} ${href}`
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * The description, with the meeting link the provider gives apart put first
 * when it isn't in it (a long description is cut at 2,000 characters).
 */
function withLink(description: string, link: string | undefined): string {
  if (!link || description.includes(link)) return description
  return description ? `${link}\n${description}` : link
}

function hexColor(value: string | undefined): string | null {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null
}
