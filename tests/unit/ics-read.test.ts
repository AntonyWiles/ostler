import { describe, expect, it } from 'vitest'
import { IcsReadError, MAX_ICS_EVENTS, readIcs } from '../../src/shared/import/ics-read'

const today = '2026-10-16'
const calendar = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join('\r\n')

describe('ics-read.ts (N3.2)', () => {
  it('reads a gov.uk-shaped file: all-day events with an exclusive DTEND', () => {
    const text = calendar(
      'PRODID:-//uk.gov//bank-holidays//EN',
      'BEGIN:VEVENT',
      'DTEND;VALUE=DATE:20261226',
      'DTSTART;VALUE=DATE:20261225',
      'SUMMARY:Christmas Day',
      'UID:2026-12-25-ChristmasDay@gov.uk',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTEND;VALUE=DATE:20261229',
      'DTSTART;VALUE=DATE:20261228',
      'SUMMARY:Boxing Day (substitute day)',
      'UID:2026-12-28@gov.uk',
      'END:VEVENT'
    )
    expect(readIcs(text, { today })).toEqual({
      events: [
        {
          uid: '2026-12-25-ChristmasDay@gov.uk',
          name: 'Christmas Day',
          firstDate: '2026-12-25',
          lastDate: '2026-12-25'
        },
        {
          uid: '2026-12-28@gov.uk',
          name: 'Boxing Day (substitute day)',
          firstDate: '2026-12-28',
          lastDate: '2026-12-28'
        }
      ],
      skipped: []
    })
  })

  it('reads an Outlook-shaped file: folded lines, escapes, alarms and a run of days', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'SUMMARY;LANGUAGE=en-gb:Summer\\, by the sea',
      'DTSTART;VALUE=DATE:20260803',
      'DTEND;VALUE=DATE:20260815',
      'DESCRIPTION:A long line that Outlook folds onto the next one and the reader',
      '  joins back together',
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'SUMMARY:Not the event',
      'END:VALARM',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'SUMMARY:Early May bank ',
      ' holiday',
      'DTSTART:20270503',
      'END:VEVENT'
    )
    const { events } = readIcs(text, { today })
    expect(events).toEqual([
      { uid: null, name: 'Summer, by the sea', firstDate: '2026-08-03', lastDate: '2026-08-14' },
      { uid: null, name: 'Early May bank holiday', firstDate: '2027-05-03', lastDate: '2027-05-03' }
    ])
  })

  it('expands a Google-shaped yearly repeat for the next five years', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20201225',
      'DTEND;VALUE=DATE:20201226',
      'RRULE:FREQ=YEARLY',
      'SUMMARY:Christmas Day',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260101',
      'RRULE:FREQ=YEARLY;COUNT=2',
      'SUMMARY:New Year',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20250704',
      'RRULE:FREQ=YEARLY;INTERVAL=2;UNTIL=20290101',
      'SUMMARY:Every other year',
      'END:VEVENT'
    )
    const { events, skipped } = readIcs(text, { today })
    expect(skipped).toEqual([])
    const dates = (name: string) =>
      events.filter((event) => event.name === name).map((event) => event.firstDate)
    expect(dates('Christmas Day')).toEqual([
      '2026-12-25',
      '2027-12-25',
      '2028-12-25',
      '2029-12-25',
      '2030-12-25',
      '2031-12-25'
    ])
    expect(dates('New Year')).toEqual(['2026-01-01', '2027-01-01'])
    expect(dates('Every other year')).toEqual(['2027-07-04'])
  })

  it('skips timed events and other repeats, naming them', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'DTSTART:20261225T090000Z',
      'DTEND:20261225T100000Z',
      'SUMMARY:Meeting',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261123',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH',
      'SUMMARY:Thanksgiving',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'SUMMARY:No date',
      'END:VEVENT'
    )
    expect(readIcs(text, { today })).toEqual({
      events: [],
      skipped: [
        { name: 'Meeting', reason: 'timed' },
        { name: 'Thanksgiving', reason: 'repeat' },
        { name: 'No date', reason: 'no-date' }
      ]
    })
  })

  it('refuses what is not a calendar, too big, too long a line or cut short', () => {
    expect(() => readIcs('hello', { today })).toThrow(IcsReadError)
    expect(() => readIcs('x'.repeat(6 * 1024 * 1024), { today })).toThrow(/too big/)
    expect(() => readIcs(calendar(`SUMMARY:${'x'.repeat(20_000)}`), { today })).toThrow(
      /line too long/
    )
    expect(() =>
      readIcs(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261225'].join('\r\n'), {
        today
      })
    ).toThrow(/middle of an event/)
    const many = Array.from(
      { length: MAX_ICS_EVENTS + 1 },
      () => 'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261225\r\nEND:VEVENT'
    )
    expect(() => readIcs(calendar(...many), { today })).toThrow(/10,000/)
  })

  it('never follows a URL or attachment: they are just ignored', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261225',
      'URL:https://example.com/track',
      'ATTACH:https://example.com/file',
      'SUMMARY:Christmas Day',
      'END:VEVENT'
    )
    expect(readIcs(text, { today }).events).toHaveLength(1)
  })
})
