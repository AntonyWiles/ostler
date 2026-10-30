import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  analyzeCsv,
  decodeCsv,
  detectDelimiter,
  guessColumns,
  guessDateFormat,
  parseCsv,
  parseImportDate,
  suggestFieldType
} from '../../src/shared/import/csv-import'
import { cleanImportedText, guessPriority, guessStatus } from '../../src/shared/import/import-plan'

const fixture = (name: string) =>
  new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'import', name)))
const utf8 = (text: string) => new TextEncoder().encode(text)
const known = { milestones: [], people: [] }

function analyze(text: string, options = {}, locale = 'en-GB') {
  return analyzeCsv({ text, encoding: 'utf-8' }, options, known, locale)
}

describe('decoding', () => {
  it('reads UTF-8 with a BOM and drops the BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Title\ncafé')])
    expect(decodeCsv(bytes)).toEqual({ text: 'Title\ncafé', encoding: 'utf-8' })
  })

  it('reads UTF-8 without a BOM', () => {
    expect(decodeCsv(utf8('Title\nnaïve'))).toEqual({ text: 'Title\nnaïve', encoding: 'utf-8' })
  })

  it('falls back to Windows-1252, as Excel writes, with café and naïve intact', () => {
    const { text, encoding } = decodeCsv(fixture('excel-1252.csv'))
    expect(encoding).toBe('windows-1252')
    expect(text).toContain('Café opening')
    expect(text).toContain('Naïve plan')
  })

  it('honours an encoding override', () => {
    const { text, encoding } = decodeCsv(utf8('café'), 'windows-1252')
    expect(encoding).toBe('windows-1252')
    expect(text).toBe('cafÃ©')
  })
})

describe('parsing', () => {
  it('keeps quoted commas, quotes and new lines in one field', () => {
    const rows = parseCsv('Title,Notes\r\n"Buy milk, eggs","He said ""hi""\r\nthen left"\r\n', ',')
    expect(rows).toEqual([
      ['Title', 'Notes'],
      ['Buy milk, eggs', 'He said "hi"\r\nthen left']
    ])
  })

  it('detects comma, semicolon and tab delimiters', () => {
    expect(detectDelimiter('Title,Status\nA,Done\n')).toBe(',')
    expect(detectDelimiter('Title;Status;Due\nA;Done;1/2/2026\n')).toBe(';')
    expect(detectDelimiter('Title\tStatus\nA\tDone\n')).toBe('\t')
  })

  it('ignores an empty trailing line', () => {
    const result = analyze('Title\r\nOne\r\nTwo\r\n\r\n')
    expect(result.preview.rowCount).toBe(2)
    expect(result.plan.tasks.map((task) => task.title)).toEqual(['One', 'Two'])
  })

  it('reads the Excel file: semicolons, a quoted new line and Windows-1252', () => {
    const decoded = decodeCsv(fixture('excel-1252.csv'))
    const { preview, plan } = analyzeCsv(decoded, {}, known, 'fr-FR')
    expect(preview.delimiter).toBe(';')
    expect(preview.dateFormat).toBe('dmy')
    expect(plan.tasks).toMatchObject([
      {
        title: 'Café opening',
        description: 'Prices, menu\nand staff',
        status: 'active',
        priority: 'high',
        dueDate: '2026-10-20'
      },
      { title: 'Naïve plan', status: 'done', priority: 'low', dueDate: '2026-12-31' }
    ])
  })

  it('strips control characters but keeps tabs and new lines', () => {
    expect(cleanImportedText('a\u0000b\u0007c\td\r\ne\u202ef')).toBe('abc\td\nef')
  })

  it('reads 10,000 rows within a second and a half', () => {
    const lines = ['Title,Status,Priority,Due,Labels']
    for (let index = 0; index < 10_000; index++)
      lines.push(
        `"Task ${index}, part ${index % 7}",In Progress,High,2026-10-${(index % 28) + 1},"a;b"`
      )
    const started = performance.now()
    const { preview, plan } = analyze(lines.join('\r\n'))
    const elapsed = performance.now() - started
    expect(preview.rowCount).toBe(10_000)
    expect(plan.tasks).toHaveLength(10_000)
    expect(preview.rows).toHaveLength(50)
    expect(elapsed).toBeLessThan(1500)
  })
})

describe('guessing columns from headers', () => {
  it('maps a Jira export', () => {
    const rows = parseCsv(decodeCsv(fixture('jira.csv')).text, ',')
    const headers = rows[0]
    const columns = guessColumns(headers)
    expect(headers[columns.title!]).toBe('Summary')
    expect(headers[columns.status!]).toBe('Status')
    expect(headers[columns.priority!]).toBe('Priority')
    expect(headers[columns.assignee!]).toBe('Assignee')
    expect(headers[columns.labels!]).toBe('Labels')
    expect(headers[columns.due!]).toBe('Due Date')
    expect(headers[columns.estimate!]).toBe('Story Points')
    expect(headers[columns.description!]).toBe('Description')
  })

  it('reads a Jira export: repeated Labels columns and dates with month names', () => {
    const { plan } = analyzeCsv(decodeCsv(fixture('jira.csv')), {}, known, 'en-GB')
    expect(plan.tasks[0]).toMatchObject({
      title: 'Design the home page',
      status: 'active',
      priority: 'critical',
      assigneeName: 'Alex Chen',
      labels: ['design', 'web'],
      dueDate: '2026-10-20',
      estimate: 5,
      description: 'Hero, nav and footer'
    })
    expect(plan.tasks[1]).toMatchObject({ status: 'backlog', dueDate: '2026-11-03' })
    expect(plan.tasks[2]).toMatchObject({ status: 'done', priority: 'low' })
  })

  it('maps an Asana export', () => {
    const { preview, plan } = analyzeCsv(decodeCsv(fixture('asana.csv')), {}, known, 'en-US')
    const header = (field: keyof typeof preview.columns) => preview.headers[preview.columns[field]!]
    expect(header('title')).toBe('Name')
    expect(header('status')).toBe('Section/Column')
    expect(header('assignee')).toBe('Assignee')
    expect(header('due')).toBe('Due Date')
    expect(header('description')).toBe('Notes')
    expect(header('labels')).toBe('Tags')
    expect(preview.dateFormat).toBe('iso')
    expect(plan.tasks[0]).toMatchObject({
      title: 'Book the venue',
      startDate: '2026-10-01',
      dueDate: '2026-10-05',
      labels: ['venue']
    })
    expect(plan.tasks[1]).toMatchObject({ status: 'done', labels: ['food', 'party'] })
  })

  it('maps a Trello CSV export', () => {
    const { preview } = analyzeCsv(decodeCsv(fixture('trello.csv')), {}, known, 'en-GB')
    const header = (field: keyof typeof preview.columns) => preview.headers[preview.columns[field]!]
    expect(header('title')).toBe('Card Name')
    expect(header('status')).toBe('List Name')
    expect(header('labels')).toBe('Labels')
    expect(header('due')).toBe('Due Date')
    expect(header('description')).toBe('Card Description')
  })
})

describe('mapping values and dates', () => {
  it('guesses statuses and priorities from common words', () => {
    expect(
      ['To Do', 'In Progress', 'Code Review', 'Blocked', 'Closed', 'Whatever'].map(guessStatus)
    ).toEqual(['backlog', 'active', 'review', 'blocked', 'done', 'backlog'])
    expect(['Highest', 'Major', 'Normal', 'Trivial', ''].map(guessPriority)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
      'medium'
    ])
  })

  it('maps each distinct value through the chosen status and priority', () => {
    const text =
      'Title,State,Importance\nA,Waiting on client,P1\nB,Waiting on client,P9\nC,Shipped,\n'
    const guessed = analyze(text)
    expect(guessed.preview.statuses).toEqual([
      { value: 'Waiting on client', count: 2, mapped: 'blocked' },
      { value: 'Shipped', count: 1, mapped: 'done' }
    ])
    const chosen = analyze(text, {
      statusMap: { 'Waiting on client': 'review' },
      priorityMap: { P9: 'low' }
    })
    expect(chosen.plan.tasks.map((task) => [task.status, task.priority])).toEqual([
      ['review', 'high'],
      ['review', 'low'],
      ['done', 'medium']
    ])
  })

  it('reads dates in the chosen format and guesses it from the values or the locale', () => {
    expect(parseImportDate('03/04/2026', 'dmy')).toBe('2026-04-03')
    expect(parseImportDate('03/04/2026', 'mdy')).toBe('2026-03-04')
    expect(parseImportDate('2026-04-03', 'mdy')).toBe('2026-04-03')
    expect(parseImportDate('2026-04-03T10:00:00Z', 'iso')).toBe('2026-04-03')
    expect(parseImportDate('3.4.26', 'dmy')).toBe('2026-04-03')
    expect(parseImportDate('Oct 20, 2026', 'dmy')).toBe('2026-10-20')
    expect(parseImportDate('31/02/2026', 'dmy')).toBeNull()
    expect(parseImportDate('soon', 'dmy')).toBeNull()
    expect(guessDateFormat(['13/01/2026'], 'en-US')).toBe('dmy')
    expect(guessDateFormat(['01/13/2026'], 'en-GB')).toBe('mdy')
    expect(guessDateFormat(['01/02/2026'], 'en-US')).toBe('mdy')
    expect(guessDateFormat(['01/02/2026'], 'de-DE')).toBe('dmy')
    expect(guessDateFormat(['2026-01-02'], 'en-US')).toBe('iso')
  })

  it('splits labels and checklists, keeping ticks', () => {
    const { plan } = analyze('Title,Tags,Checklist\nA,"one; two, one","[x] Book\n[ ] Pay;Call"\n')
    expect(plan.tasks[0].labels).toEqual(['one', 'two'])
    expect(plan.tasks[0].checklist).toEqual([
      { text: 'Book', checked: true },
      { text: 'Pay', checked: false },
      { text: 'Call', checked: false }
    ])
  })

  it('lists milestones and people the import will create', () => {
    const { preview } = analyzeCsv(
      { text: 'Title,Milestone,Owner\nA,Beta,Ana\nB,beta,Bo\nC,Launch,ana\n', encoding: 'utf-8' },
      {},
      { milestones: ['Launch'], people: ['Bo'] },
      'en-GB'
    )
    expect(preview.newMilestones).toEqual(['Beta'])
    expect(preview.newPeople).toEqual(['Ana'])
  })
})

describe('the dry run', () => {
  it('counts errors and warnings per row and leaves rows with errors out', () => {
    const { preview, plan } = analyze(
      [
        'Title,Due,Start,Estimate,Owner',
        'Good,2026-10-20,,3,Ana',
        ',2026-10-20,,,',
        'Odd dates,someday,2026-11-01,lots,"Ana, Bo"',
        'Late start,2026-10-01,2026-10-05,2000,'
      ].join('\n')
    )
    expect(preview.rowCount).toBe(4)
    expect(preview.importableCount).toBe(3)
    expect(preview.errorRowCount).toBe(1)
    expect(preview.errorCount).toBe(1)
    expect(preview.rows[1].errors).toEqual([{ field: 'title', message: 'The title is empty' }])
    expect(preview.rows[2].warnings.map((issue) => issue.field)).toEqual([
      'due',
      'estimate',
      'assignee'
    ])
    expect(preview.rows[3].warnings.map((issue) => issue.field)).toEqual(['start', 'estimate'])
    expect(preview.warningRowCount).toBe(2)
    expect(preview.warningCount).toBe(5)
    expect(plan.skipped).toBe(1)
    expect(plan.tasks[1]).toMatchObject({
      title: 'Odd dates',
      dueDate: null,
      startDate: '2026-11-01',
      estimate: null,
      assigneeName: 'Ana'
    })
    expect(plan.tasks[2]).toMatchObject({ startDate: null, dueDate: '2026-10-01', estimate: null })
  })

  it('cuts long text to the limits and says so', () => {
    const { preview, plan } = analyze(`Title\n"${'x'.repeat(250)}"\n`)
    expect(plan.tasks[0].title).toHaveLength(200)
    expect(preview.rows[0].warnings[0].message).toMatch(/cut to 200/)
  })

  it('refuses an import with no title column in every row', () => {
    const { preview, plan } = analyze('Notes\nhello\n', { columns: { title: null } })
    expect(preview.errorRowCount).toBe(1)
    expect(plan.tasks).toEqual([])
  })
})

describe('custom field columns (R2.2)', () => {
  it('suggests a type from a column’s values', () => {
    expect(suggestFieldType(['yes', 'no', ''])).toBe('checkbox')
    expect(suggestFieldType(['12', '3.5', '1,200'])).toBe('number')
    expect(suggestFieldType(['2026-10-20', '2026-11-01'])).toBe('date')
    expect(suggestFieldType(['Web', 'Data', 'Web', 'Web'])).toBe('choice')
    expect(suggestFieldType(['Web; Data', 'Data', 'Ops'])).toBe('choices')
    expect(suggestFieldType(['a long note', 'another one'])).toBe('text')
  })

  it('keeps a long value in a new Choice field as the option its name was shortened to', () => {
    const long = 'x'.repeat(100)
    const { plan } = analyzeCsv(
      {
        text: ['Title,Kind', `A,${long}`, 'B,Short'].join(String.fromCharCode(10)),
        encoding: 'utf-8'
      },
      { fieldColumns: { '1': { create: { name: 'Kind', type: 'choice' } } } },
      known,
      'en-GB'
    )
    const ref = Object.keys(plan.tasks[1].fieldTexts ?? {})[0]
    expect(ref).toBeDefined()
    expect(plan.tasks[0].fieldTexts?.[ref]).toBeDefined()
  })

  it('leaves columns no field takes out, and does not create past the limit of 20', () => {
    const fields = Array.from({ length: 20 }, (_, index) => ({
      id: `f${index}`,
      projectId: 'p',
      name: `Field ${index}`,
      type: 'text' as const,
      options: [],
      position: index,
      createdAt: 0
    }))
    const { preview, plan } = analyzeCsv(
      {
        text: ['Title,Field 3,Extra', 'A,hello,x'].join(String.fromCharCode(10)),
        encoding: 'utf-8'
      },
      { fieldColumns: { '2': { create: { name: 'Extra', type: 'text' } } } },
      { ...known, fields },
      'en-GB'
    )
    expect(preview.customColumns.map((column) => column.target)).toEqual([{ fieldId: 'f3' }, null])
    expect(plan.newFields).toBeUndefined()
    expect(plan.tasks[0].fieldTexts).toEqual({ f3: 'hello' })
  })
})
