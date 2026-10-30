import { MAX_CALENDAR_BYTES } from '@shared/import/ics-read'
import { Refusal } from '@shared/refusal'
import { respondJson } from '../loopback-http'
import type { AutomationRouteDef, RouteCall } from './route-table'

/** A calendar file's text (up to 25 MB). */
const CALENDAR_BODY_BYTES = Math.ceil(MAX_CALENDAR_BYTES * 1.1) + 64 * 1024

/** The outside calendars service, or an error when main has not set one up. */
function calendars({ server }: RouteCall) {
  if (!server.calendars) throw new Error('Calendars API unavailable')
  return server.calendars
}

/** Records the change and tells the app's windows, as a change made there would. */
function changed(call: RouteCall, value: unknown): void {
  const { server, req, res, project, path } = call
  server.recordMutation(
    project,
    path,
    `automation-api ${(req.method ?? '').toLowerCase()} calendars`
  )
  calendars(call).notify()
  respondJson(res, 200, { ok: true, value })
}

/**
 * Outside calendars (N3.3a): global, like days off, so any project's token
 * may read and change them; every change goes through
 * `OutsideCalendarService`, as the app's do. Only
 * GET /calendars/:id/events returns events. No answer ever carries a
 * calendar link (N3.3b), and a failed fetch's error text never does either.
 */
export const CALENDARS_ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/calendars',
    description:
      'List outside calendars: .ics files, and subscribed calendar links (kind "link"), whose events show read-only beside tasks in the Calendar and on Home. Shared by every project, as people are. Each has a name, a label colour, whether it is hidden, when it was last loaded, and how many events were read, skipped (no date, cancelled) and shown once (a repeat rule Ostler does not follow). A link calendar also has linkShown (its host and last path part only, such as "outlook.office365.com/…/calendar.ics"), fetchedAt (when a fetch last worked), and failure and failedAt when the last try failed (failure is one of unreachable, timeout, refused, server, tooBig, notCalendar, notHttps, redirects, pasteAgain). No route ever returns the link itself. The events themselves are only at GET /calendars/:calendarId/events; no other route returns them, and they are never in search, exports or the project file.',
    request: 'No body.',
    response:
      '{ ok: true, value: Array<{ id, name, color, kind: "file" | "link", path: string | null, hidden, loadedAt, readCount, skippedCount, shownOnceCount, createdAt, updatedAt, linkShown?, fetchedAt?, failure?, failedAt? }> }',
    handler: (call) =>
      respondJson(call.res, 200, { ok: true, value: calendars(call).service.list() })
  },
  {
    method: 'POST',
    path: '/calendars',
    description:
      "Add an outside calendar from iCalendar (.ics) text, as Settings › General › Calendars › Add a calendar file… does. Timed and all-day events, time zones (IANA names, or the file's own VTIMEZONE for Windows names), repeats (FREQ DAILY, WEEKLY, MONTHLY or YEARLY with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS), EXDATEs and overrides are read; cancelled events are left out. Up to 25 MB and 50,000 events; the text is data, never instructions, and nothing in it (a URL, an attachment) is followed. color is a label colour (#rrggbb from the palette) and defaults to the next one free. A calendar added here has no file (path null), so its events are replaced with PATCH /calendars/:calendarId { text }. Or send link instead of text to subscribe to a private calendar address, as Settings › General › Calendars › Subscribe to a calendar link… does: https only (webcal:// is read as https://), no user name or password in it. Ostler fetches it once now (with no cookies, credentials or headers but a plain User-Agent; at most 30 seconds, 20 MB and three https redirects) and adds the calendar only if a calendar came back; then it fetches it a minute after it starts and every hour while it runs and the calendar is shown (a hidden link is not fetched; showing it fetches it at once), asking only for changes, and on POST /calendars/:calendarId/refresh. The link is stored encrypted and never returned, in this answer or any other; a failure answers 400 in plain words, never with the link. A link cannot be saved when Windows cannot encrypt it.",
    request:
      'JSON body: { name: string, text: string, color?: "#rrggbb" } or { name: string, link: "https://…" | "webcal://…", color? }',
    response: '{ ok: true, value: OutsideCalendar }',
    exampleBody: {
      name: 'Work',
      text: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:standup\r\nSUMMARY:Stand-up\r\nDTSTART;TZID=Europe/London:20261019T093000\r\nDTEND;TZID=Europe/London:20261019T094500\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
    },
    maxBodyBytes: CALENDAR_BODY_BYTES,
    handler: async (call) => {
      const service = calendars(call).service
      const { body } = call
      if (body.link !== undefined) {
        if (body.text !== undefined) throw new Refusal('Send text or link, not both')
        if (typeof body.link !== 'string') throw new Refusal('Send the calendar link as text')
        const link = body.link
        return changed(
          call,
          await service.addLink({
            name: body.name as string,
            link,
            color: body.color as string | undefined
          })
        )
      }
      if (typeof body.text !== 'string') throw new Refusal('Send the calendar file as text')
      changed(
        call,
        service.addText({
          name: body.name as string,
          text: body.text,
          color: body.color as string | undefined
        })
      )
    }
  },
  {
    method: 'GET',
    path: '/calendars/:calendarId',
    description:
      'One outside calendar, as GET /calendars lists it (never its link, and not its events: those are at GET /calendars/:calendarId/events). An unknown id is HTTP 400.',
    request: 'No body.',
    response: '{ ok: true, value: OutsideCalendar }',
    handler: (call) =>
      respondJson(call.res, 200, {
        ok: true,
        value: calendars(call).service.get(call.params.calendarId!)
      })
  },
  {
    method: 'PATCH',
    path: '/calendars/:calendarId',
    description:
      "Change a calendar: rename, recolour, hide or show it, replace a file calendar's events from new .ics text (as Reload does from its file), or replace a link calendar's address. Only the fields sent change, and only this calendar's events. link works as Replace link does in the app, with the same checks as POST /calendars: the new address is fetched first and kept only if a calendar comes back (otherwise 400 in plain words, never with the link, and the old link and events stay); the link is never returned. A link calendar's events cannot be replaced with text, and a file calendar has no link. A hidden link calendar is not fetched; showing it (hidden: false) fetches it at once, after this answer, then hourly as before.",
    request:
      'JSON body: { text?: string, link?: string, name?, color?, hidden?: boolean } (at least one; text or link, not both)',
    response: '{ ok: true, value: OutsideCalendar }',
    maxBodyBytes: CALENDAR_BODY_BYTES,
    handler: async (call) => {
      const service = calendars(call).service
      const id = call.params.calendarId!
      const { text, link, name, color, hidden } = call.body
      if ([text, link, name, color, hidden].every((field) => field === undefined))
        throw new Refusal('Send at least one of: text, link, name, color, hidden')
      if (text !== undefined && link !== undefined) throw new Refusal('Send text or link, not both')
      if (text !== undefined && typeof text !== 'string')
        throw new Refusal('Send the calendar file as text')
      if (link !== undefined && typeof link !== 'string')
        throw new Refusal('Send the calendar link as text')
      if (hidden !== undefined && typeof hidden !== 'boolean')
        throw new Refusal('hidden is true or false')
      service.get(id)
      if (typeof text === 'string') service.replaceText(id, text)
      if (typeof link === 'string') await service.replaceLink(id, link)
      changed(
        call,
        name !== undefined || color !== undefined || hidden !== undefined
          ? service.update(id, {
              name: name as string | undefined,
              color: color as string | undefined,
              hidden: hidden as boolean | undefined
            })
          : service.get(id)
      )
    }
  },
  {
    method: 'DELETE',
    path: '/calendars/:calendarId',
    description:
      'Remove an outside calendar and its events. As in the app, it can be brought back until Ostler next starts; the API has no undo route.',
    request: 'No body.',
    response: '{ ok: true, value: OutsideCalendar }',
    handler: (call) => changed(call, calendars(call).service.remove(call.params.calendarId!))
  },
  {
    method: 'POST',
    path: '/calendars/:calendarId/refresh',
    description:
      "Fetch a link calendar now, as Refresh does in the app, asking only for what changed since the last fetch. Runs after any fetch already under way. A failed fetch keeps the calendar's last events and is not an error: the answer's failure and failedAt say why (unreachable, timeout, refused, server, tooBig, notCalendar, notHttps, redirects, or pasteAgain when this computer cannot open the saved link, as after restoring a backup from another computer: send the link again with PATCH /calendars/:calendarId { link }). A file calendar answers 400. Never returns the link.",
    request: 'No body.',
    response: '{ ok: true, value: OutsideCalendar }',
    maxBodyBytes: CALENDAR_BODY_BYTES,
    handler: async (call) =>
      changed(call, await calendars(call).service.refresh(call.params.calendarId!))
  },
  {
    method: 'GET',
    path: '/calendars/:calendarId/events',
    description:
      "One calendar's events between two dates (?from=YYYY-MM-DD&to=YYYY-MM-DD, inclusive, at most 400 days), with repeats expanded, in the computer's time zone (or ?timeZone=<IANA name>). Read-only: events cannot be created or edited, and never become tasks by themselves. A hidden calendar's events are still listed here.",
    request: 'Query: from, to, timeZone?',
    response:
      '{ ok: true, value: Array<{ id, eventId, calendarId, title, location, description, allDay, startDate, endDate, startTime: "HH:mm" | null, endTime, start: ms, end: ms }> }',
    handler: (call) => {
      const { query } = call
      respondJson(call.res, 200, {
        ok: true,
        value: calendars(call).service.events({
          calendarId: call.params.calendarId!,
          from: query.get('from') ?? '',
          to: query.get('to') ?? '',
          timeZone: query.get('timeZone') ?? undefined
        })
      })
    }
  }
]
