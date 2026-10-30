import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OutsideCalendarService } from '../../electron/services/outside-calendar-service'
import { PlanningService } from '../../electron/services/planning-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const ics = (...events: string[][]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']),
    'END:VCALENDAR',
    ''
  ].join('\r\n')

const STANDUP = ics([
  'UID:standup',
  'SUMMARY:Zebrafish stand-up',
  'DTSTART;TZID=Europe/London:20261019T093000',
  'DTEND;TZID=Europe/London:20261019T094500',
  'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR'
])
const REVIEW = ics([
  'UID:review',
  'SUMMARY:Design review',
  'DTSTART:20261021T130000Z',
  'DTEND:20261021T140000Z'
])

describe('OutsideCalendarService (N3.3a)', () => {
  const root = useTempDir('ostler-outside-calendars-')
  let databasePath: string
  let service: OutsideCalendarService
  let files: Record<string, string>

  const make = () =>
    new OutsideCalendarService(databasePath, {
      readFile: (file) => {
        if (!(file in files)) throw new Error('missing')
        return files[file]
      },
      timeZone: () => 'Europe/London'
    })

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(root())
    files = { 'C:\\cal\\work.ics': STANDUP, 'C:\\cal\\team.ics': REVIEW }
    service = make()
  })

  afterEach(() => {
    service.close()
  })

  const week = { from: '2026-10-19', to: '2026-10-25' }
  const titles = () => service.events(week).map((event) => `${event.startDate} ${event.title}`)

  it('adds a file, gives it a palette colour and counts what it read', () => {
    const work = service.addFile({ path: 'C:\\cal\\work.ics', name: '  Work  ' })
    expect(work).toMatchObject({
      name: 'Work',
      kind: 'file',
      path: 'C:\\cal\\work.ics',
      readCount: 1
    })
    expect(work.color).toBe('#3b82f6')
    expect(service.addFile({ path: 'C:\\cal\\team.ics', name: 'Team' }).color).toBe('#8b5cf6')
    expect(service.events(week)).toHaveLength(6)
    expect(() => service.addFile({ path: 'C:\\cal\\work.ics', name: '' })).toThrow()
    expect(() => service.update(work.id, { color: '#123456' })).toThrow()
  })

  it('reloading replaces only that calendar’s events', () => {
    const work = service.addFile({ path: 'C:\\cal\\work.ics', name: 'Work' })
    service.addFile({ path: 'C:\\cal\\team.ics', name: 'Team' })
    files['C:\\cal\\work.ics'] = ics([
      'UID:planning',
      'SUMMARY:Planning',
      'DTSTART:20261020T080000Z',
      'DTEND:20261020T090000Z'
    ])
    const reloaded = service.reload(work.id)
    expect(reloaded.readCount).toBe(1)
    expect(titles()).toEqual(['2026-10-20 Planning', '2026-10-21 Design review'])
    // The automation API replaces from text.
    service.replaceText(work.id, REVIEW.replace('Design review', 'Retro'))
    expect(titles()).toEqual(['2026-10-21 Design review', '2026-10-21 Retro'])
  })

  it('a calendar from text has no file to reload', () => {
    const api = service.addText({ name: 'API', text: REVIEW })
    expect(api.path).toBeNull()
    expect(() => service.reload(api.id)).toThrow()
  })

  it('hides, removes and undoes, and clears removals at the next start', () => {
    const work = service.addFile({ path: 'C:\\cal\\work.ics', name: 'Work' })
    service.update(work.id, { hidden: true })
    expect(service.events(week)).toEqual([])
    expect(service.events({ ...week, calendarId: work.id })).toHaveLength(5)
    service.update(work.id, { hidden: false, name: 'Office' })

    service.remove(work.id)
    expect(service.list()).toEqual([])
    expect(service.events(week)).toEqual([])
    expect(() => service.get(work.id)).toThrow()
    expect(service.restore(work.id).name).toBe('Office')
    expect(service.events(week)).toHaveLength(5)

    service.remove(work.id)
    service.close()
    service = make()
    expect(() => service.restore(work.id)).toThrow()
  })

  it('asks for a sensible range and the person’s zone', () => {
    service.addFile({ path: 'C:\\cal\\team.ics', name: 'Team' })
    expect(() => service.events({ from: '2026-10-25', to: '2026-10-19' })).toThrow()
    expect(() => service.events({ from: '2026-01-01', to: '2028-01-01' })).toThrow()
    const [inTokyo] = service.events({ ...week, timeZone: 'Asia/Tokyo' })
    expect(inTokyo.startTime).toBe('22:00')
    expect(service.events({ ...week, timeZone: 'Not/AZone' })[0].startTime).toBe('14:00')
  })

  it('keeps events out of search', () => {
    service.addFile({ path: 'C:\\cal\\work.ics', name: 'Work' })
    const planning = new PlanningService(databasePath, () => ['p1'])
    try {
      expect(planning.search.search('Zebrafish', {})).toEqual([])
    } finally {
      planning.close()
    }
  })
})

describe('events are kept apart (N3.3a)', () => {
  const repo = path.resolve(__dirname, '../..')
  const files = (dir: string): string[] =>
    fs
      .readdirSync(path.join(repo, dir), { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory()
          ? files(path.join(dir, entry.name))
          : /\.(ts|tsx)$/.test(entry.name)
            ? [path.join(dir, entry.name)]
            : []
      )

  it('only the calendar service and its repository read the events table', () => {
    const readers = [...files('electron'), ...files('src')].filter((file) =>
      fs.readFileSync(path.join(repo, file), 'utf8').includes('outside_calendar')
    )
    expect(readers.map((file) => file.replace(/\\/g, '/')).sort()).toEqual([
      'electron/services/database/migrations/0031-outside-calendars.ts',
      'electron/services/database/migrations/0047-calendar-links.ts',
      'electron/services/database/migrations/0064-account-calendars.ts',
      'electron/services/database/outside-calendar-repository.ts',
      // Names the calendar sources table so the personal share can carry it (D14); it never reads events.
      'electron/services/sync/synced-tables.ts'
    ])
  })

  // Ostler AI may read events; these places are not AI.
  it('search, exports (CSV, calendar file, web page) and the project file never reach events', () => {
    const kept = [
      'electron/services/search-service.ts',
      'electron/services/project-package-service.ts',
      'src/shared/project-package.ts',
      ...files('src/shared/export')
    ]
    for (const file of kept) {
      const text = fs.readFileSync(path.join(repo, file), 'utf8')
      expect(text, file).not.toMatch(
        /outside-calendar|OutsideCalendar|CalendarOccurrence|calendarEvents/
      )
    }
  })
})
