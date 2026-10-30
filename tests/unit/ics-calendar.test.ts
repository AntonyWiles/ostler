import { describe, expect, it } from 'vitest'
import {
  IcsReadError,
  MAX_CALENDAR_EVENTS,
  readIcsCalendar,
  type IcsCalendarEvent
} from '../../src/shared/import/ics-read'
import { expandCalendarEvents, occurrenceLine } from '../../src/shared/calendar/expand-events'
import { parseRRule } from '../../src/shared/calendar/ics-rrule'
import type { CalendarEventRecord } from '../../src/shared/ostler-api/calendar-types'

const calendar = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join('\r\n')

const event = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']

/** Outlook's own zone for the UK, with a Windows name. */
const OUTLOOK_GMT = [
  'BEGIN:VTIMEZONE',
  'TZID:GMT Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T010000',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE'
]

function records(read: { events: IcsCalendarEvent[] }, calendarId = 'cal'): CalendarEventRecord[] {
  return read.events.map((item, index) => ({ ...item, id: `e${index}`, calendarId }))
}

function expand(
  text: string,
  from: string,
  to: string,
  timeZone = 'Europe/London',
  readZone = timeZone
) {
  const read = readIcsCalendar(text, { timeZone: readZone })
  return expandCalendarEvents(records(read), {
    from,
    to,
    timeZone,
    zonesFor: () => read.timeZones
  })
}

describe('readIcsCalendar (N3.3a)', () => {
  it('reads an Outlook-shaped file: Windows zone names through its VTIMEZONE, folded lines', () => {
    const text = calendar(
      'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
      ...OUTLOOK_GMT,
      ...event(
        'UID:040000008200E00074C5B7101A82E008',
        'SUMMARY;LANGUAGE=en-gb:Design rev',
        ' iew',
        'DTSTART;TZID=GMT Standard Time:20260715T140000',
        'DTEND;TZID=GMT Standard Time:20260715T150000',
        'LOCATION:Room 4',
        'DESCRIPTION:Bring <b>the</b> plan\\nand notes'
      )
    )
    const read = readIcsCalendar(text, { timeZone: 'America/New_York' })
    expect(read.readCount).toBe(1)
    expect(read.events[0]).toMatchObject({
      title: 'Design review',
      location: 'Room 4',
      description: 'Bring <b>the</b> plan\nand notes',
      start: '2026-07-15T14:00:00',
      timeZone: 'GMT Standard Time',
      allDay: false
    })
    // 14:00 in summer in the UK is 13:00 UTC, 09:00 in New York.
    const [occurrence] = expand(text, '2026-07-15', '2026-07-15', 'America/New_York')
    expect(occurrence.start).toBe(Date.UTC(2026, 6, 15, 13))
    expect(occurrence.startTime).toBe('09:00')
    expect(occurrenceLine(occurrence)).toBe('09:00 Design review')
    // In winter the same zone is UTC+0.
    const winter = text.replace(/20260715/g, '20260115')
    expect(expand(winter, '2026-01-15', '2026-01-15', 'UTC')[0].startTime).toBe('14:00')
  })

  it('reads a Google-shaped file: an IANA TZID, UTC times and a weekly repeat', () => {
    const text = calendar(
      'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
      'X-WR-TIMEZONE:Europe/London',
      ...event(
        'DTSTART;TZID=Europe/London:20261019T093000',
        'DTEND;TZID=Europe/London:20261019T094500',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
        'UID:standup@google.com',
        'SUMMARY:Stand-up'
      ),
      ...event('DTSTART:20261020T160000Z', 'DTEND:20261020T170000Z', 'SUMMARY:Call', 'UID:c')
    )
    const occurrences = expand(text, '2026-10-19', '2026-10-25')
    expect(occurrences.map((item) => `${item.startDate} ${occurrenceLine(item)}`)).toEqual([
      '2026-10-19 09:30 Stand-up',
      '2026-10-20 17:00 Call',
      '2026-10-21 09:30 Stand-up',
      '2026-10-23 09:30 Stand-up'
    ])
  })

  it('reads an Apple-shaped file: floating times are the person’s own, all-day DTEND is the day after', () => {
    const text = calendar(
      'PRODID:-//Apple Inc.//macOS 15.0//EN',
      ...event('UID:a', 'SUMMARY:Lunch', 'DTSTART:20261021T123000', 'DURATION:PT1H'),
      ...event('UID:b', 'SUMMARY:Trip', 'DTSTART;VALUE=DATE:20261022', 'DTEND;VALUE=DATE:20261024')
    )
    const tokyo = expand(text, '2026-10-21', '2026-10-31', 'Asia/Tokyo')
    expect(tokyo.map((item) => [item.title, item.startDate, item.endDate, item.startTime])).toEqual(
      [
        ['Lunch', '2026-10-21', '2026-10-21', '12:30'],
        ['Trip', '2026-10-22', '2026-10-23', null]
      ]
    )
    expect(tokyo[0].endTime).toBe('13:30')
  })

  it('shows a timed event past midnight on both days', () => {
    const text = calendar(
      ...event('UID:n', 'SUMMARY:Night shift', 'DTSTART:20261021T220000Z', 'DTEND:20261022T060000Z')
    )
    const [shift] = expand(text, '2026-10-22', '2026-10-22', 'UTC')
    expect([shift.startDate, shift.endDate]).toEqual(['2026-10-21', '2026-10-22'])
    // Ending at midnight stays on one day.
    const toMidnight = text.replace('20261022T060000Z', '20261022T000000Z')
    expect(expand(toMidnight, '2026-10-21', '2026-10-22', 'UTC')[0].endDate).toBe('2026-10-21')
  })

  it('keeps a repeating series at its own wall time across a daylight-saving change', () => {
    const text = calendar(
      ...OUTLOOK_GMT,
      ...event(
        'UID:weekly',
        'SUMMARY:Review',
        'DTSTART;TZID=GMT Standard Time:20261019T090000',
        'DTEND;TZID=GMT Standard Time:20261019T100000',
        'RRULE:FREQ=WEEKLY;COUNT=3'
      )
    )
    const london = expand(text, '2026-10-01', '2026-11-30', 'Europe/London')
    expect(london.map((item) => `${item.startDate} ${item.startTime}`)).toEqual([
      '2026-10-19 09:00',
      '2026-10-26 09:00',
      '2026-11-02 09:00'
    ])
    // Seen from UTC, the clocks went back on 25 October.
    const utc = expand(text, '2026-10-01', '2026-11-30', 'UTC')
    expect(utc.map((item) => item.startTime)).toEqual(['08:00', '09:00', '09:00'])
  })

  it('leaves out EXDATEs, cancelled events and occurrences an override replaces', () => {
    const text = calendar(
      ...event(
        'UID:daily',
        'SUMMARY:Check-in',
        'DTSTART;TZID=Europe/London:20261019T100000',
        'DTEND;TZID=Europe/London:20261019T101500',
        'RRULE:FREQ=DAILY;UNTIL=20261023T090000Z',
        'EXDATE;TZID=Europe/London:20261020T100000,20261021T100000'
      ),
      ...event(
        'UID:daily',
        'RECURRENCE-ID;TZID=Europe/London:20261022T100000',
        'SUMMARY:Check-in (moved)',
        'DTSTART;TZID=Europe/London:20261022T150000',
        'DTEND;TZID=Europe/London:20261022T151500'
      ),
      ...event(
        'UID:daily',
        'RECURRENCE-ID:20261023T090000Z',
        'STATUS:CANCELLED',
        'DTSTART;TZID=Europe/London:20261023T100000'
      ),
      ...event('UID:gone', 'SUMMARY:Cancelled', 'STATUS:CANCELLED', 'DTSTART:20261019T120000Z')
    )
    const read = readIcsCalendar(text, { timeZone: 'Europe/London' })
    expect(read.skippedCount).toBe(1)
    expect(read.events.find((item) => item.recurrenceId === '2026-10-23T10:00:00')).toBeTruthy()
    const occurrences = expand(text, '2026-10-19', '2026-10-31')
    expect(occurrences.map((item) => `${item.startDate} ${occurrenceLine(item)}`)).toEqual([
      '2026-10-19 10:00 Check-in',
      '2026-10-22 15:00 Check-in (moved)'
    ])
  })

  it('shows a repeat it cannot follow once, and counts it', () => {
    const text = calendar(
      ...event('UID:h', 'SUMMARY:Hourly', 'DTSTART:20261019T090000Z', 'RRULE:FREQ=HOURLY'),
      ...event(
        'UID:w',
        'SUMMARY:Week 3',
        'DTSTART:20261019T090000Z',
        'RRULE:FREQ=YEARLY;BYWEEKNO=3'
      ),
      ...event(
        'UID:r',
        'SUMMARY:Extra dates',
        'DTSTART:20261019T090000Z',
        'RRULE:FREQ=DAILY',
        'RDATE:20261030T090000Z'
      )
    )
    const read = readIcsCalendar(text, { timeZone: 'UTC' })
    expect(read.shownOnceCount).toBe(3)
    expect(read.events.every((item) => item.rrule === null)).toBe(true)
    expect(expand(text, '2026-10-01', '2026-12-31', 'UTC')).toHaveLength(3)
  })

  it('refuses what is not a calendar, too many events, and an unfinished file', () => {
    expect(() => readIcsCalendar('hello', { timeZone: 'UTC' })).toThrow(IcsReadError)
    expect(() =>
      readIcsCalendar('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261019\r\n', {
        timeZone: 'UTC'
      })
    ).toThrow(IcsReadError)
    const many = calendar(
      ...Array.from({ length: MAX_CALENDAR_EVENTS + 1 }, () => 'BEGIN:VEVENT\r\nEND:VEVENT')
    )
    expect(() => readIcsCalendar(many, { timeZone: 'UTC' })).toThrow(IcsReadError)
  })

  it('keeps a description short and as text, and never follows a URL', () => {
    const long = 'x'.repeat(5000)
    const text = calendar(
      ...event(
        'UID:d',
        'SUMMARY:Long',
        'DTSTART:20261019T090000Z',
        `DESCRIPTION:${long}`,
        'URL:https://example.com/meeting',
        'ATTACH:https://example.com/file'
      )
    )
    const [read] = readIcsCalendar(text, { timeZone: 'UTC' }).events
    expect(read.description).toHaveLength(2000)
    expect(JSON.stringify(read)).not.toContain('example.com')
  })
})

describe('parseRRule and expansion (N3.3a)', () => {
  const series = (start: string, rule: string, from: string, to: string, allDay = false) => {
    const text = calendar(
      ...event(
        'UID:s',
        'SUMMARY:S',
        allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
        `RRULE:${rule}`
      )
    )
    return expand(text, from, to, 'UTC').map((item) => item.startDate)
  }

  it('follows every supported part', () => {
    expect(parseRRule('FREQ=SECONDLY')).toBeNull()
    expect(parseRRule('FREQ=WEEKLY;BYHOUR=9')).toBeNull()
    expect(parseRRule('FREQ=MONTHLY;BYDAY=2TU;BYSETPOS=1;WKST=SU')).not.toBeNull()
    // INTERVAL and COUNT.
    expect(
      series('20261001T090000Z', 'FREQ=DAILY;INTERVAL=3;COUNT=4', '2026-10-01', '2026-12-31')
    ).toEqual(['2026-10-01', '2026-10-04', '2026-10-07', '2026-10-10'])
    // The second Tuesday of each month.
    expect(
      series('20261013T090000Z', 'FREQ=MONTHLY;BYDAY=2TU', '2026-10-01', '2027-01-31')
    ).toEqual(['2026-10-13', '2026-11-10', '2026-12-08', '2027-01-12'])
    // The last Friday.
    expect(
      series('20261030T090000Z', 'FREQ=MONTHLY;BYDAY=-1FR', '2026-10-01', '2026-12-31')
    ).toEqual(['2026-10-30', '2026-11-27', '2026-12-25'])
    // The last working day of the month (BYSETPOS).
    expect(
      series(
        '20261030T090000Z',
        'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
        '2026-10-01',
        '2027-01-31'
      )
    ).toEqual(['2026-10-30', '2026-11-30', '2026-12-31', '2027-01-29'])
    // BYMONTHDAY, including from the end.
    expect(
      series('20261015T090000Z', 'FREQ=MONTHLY;BYMONTHDAY=15,-1', '2026-10-01', '2026-11-30')
    ).toEqual(['2026-10-15', '2026-10-31', '2026-11-15', '2026-11-30'])
    // Yearly with BYMONTH and BYDAY: Thanksgiving.
    expect(
      series('20261126', 'FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', '2026-01-01', '2028-12-31', true)
    ).toEqual(['2026-11-26', '2027-11-25', '2028-11-23'])
    // Every other week on two days, until a date.
    expect(
      series(
        '20261005T090000Z',
        'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261031',
        '2026-10-01',
        '2026-12-31'
      )
    ).toEqual(['2026-10-05', '2026-10-08', '2026-10-19', '2026-10-22'])
    // Yearly on a date, not on 29 February in other years.
    expect(series('20240229', 'FREQ=YEARLY', '2024-01-01', '2028-12-31', true)).toEqual([
      '2024-02-29',
      '2028-02-29'
    ])
  })

  it('is exact at the edges of the range', () => {
    const days = series('20260101T090000Z', 'FREQ=DAILY', '2026-10-01', '2026-10-03')
    expect(days).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    // A long all-day event that began before the range still shows.
    const text = calendar(
      ...event(
        'UID:l',
        'SUMMARY:Holiday',
        'DTSTART;VALUE=DATE:20260928',
        'DTEND;VALUE=DATE:20261003'
      )
    )
    expect(expand(text, '2026-10-01', '2026-10-31', 'UTC').map((item) => item.endDate)).toEqual([
      '2026-10-02'
    ])
    expect(expand(text, '2026-10-03', '2026-10-31', 'UTC')).toEqual([])
  })

  it('expands a 5,000-event file with many repeats for a month quickly', () => {
    const lines: string[] = []
    for (let index = 0; index < 5000; index++)
      lines.push(
        ...event(
          `UID:${index}`,
          `SUMMARY:Meeting ${index}`,
          `DTSTART;TZID=Europe/London:2024${String((index % 12) + 1).padStart(2, '0')}10T${String(8 + (index % 9)).padStart(2, '0')}0000`,
          'DURATION:PT30M',
          index % 2 === 0 ? 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE' : 'RRULE:FREQ=MONTHLY;BYDAY=2TU'
        )
      )
    const text = calendar(...lines)
    const read = readIcsCalendar(text, { timeZone: 'Europe/London' })
    const list = records(read)
    const began = performance.now()
    const occurrences = expandCalendarEvents(list, {
      from: '2026-10-01',
      to: '2026-11-08',
      timeZone: 'Europe/London',
      zonesFor: () => []
    })
    const took = performance.now() - began
    expect(occurrences.length).toBeGreaterThan(10_000)
    expect(took).toBeLessThan(5000)
  })
})
