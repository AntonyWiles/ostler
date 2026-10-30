import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LibraryItem, SearchResult } from '../../src/shared/ostler-api'
import { PlanningService } from '../../electron/services/planning-service'
import { LibraryRepository } from '../../electron/services/database/library-repository'
import { SearchService, likeSnippet } from '../../electron/services/search-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const HUMAN = { kind: 'human' } as const
const ids = (results: SearchResult[]) => results.map((result) => `${result.type}:${result.id}`)
const marked = (result: SearchResult | undefined) =>
  (result?.snippet ?? []).filter((part) => part.match).map((part) => part.text.toLowerCase())

describe('SearchService', () => {
  const tempDir = useTempDir('ostler-search-')
  let databasePath: string
  let service: PlanningService
  const projectIds = ['project-one', 'project-two']

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(tempDir())
    service = new PlanningService(databasePath, () => projectIds)
  })

  afterEach(() => {
    service.close()
  })

  const search = (query: string, options = {}) => service.search.search(query, options)
  const indexRows = () => {
    const db = new Database(databasePath, { readonly: true })
    try {
      return db
        .prepare(
          'SELECT entity_type, entity_id, title, body FROM search_index ORDER BY entity_type'
        )
        .all() as { entity_type: string; entity_id: string; title: string; body: string }[]
    } finally {
      db.close()
    }
  }
  const indexed = (type: string, id: string) =>
    indexRows().find((row) => row.entity_type === type && row.entity_id === id)

  function addLibraryNote(title: string, body: string, archived = false): LibraryItem {
    const db = new Database(databasePath)
    try {
      const repository = new LibraryRepository(db)
      const now = new Date().toISOString()
      const item: LibraryItem = {
        id: `lib-${title.replace(/\W/g, '')}`,
        projectId: 'project-one',
        kind: 'note',
        title,
        summary: '',
        body,
        url: null,
        file: null,
        aiAccess: 'when-selected',
        isPrimaryBrief: false,
        tags: [],
        revision: 1,
        createdAt: now,
        updatedAt: now,
        archivedAt: archived ? now : null
      } as LibraryItem
      repository.insertItem(item)
      repository.indexItem({
        itemId: item.id,
        projectId: item.projectId,
        title,
        summary: '',
        body,
        tags: [],
        extractedText: ''
      })
      return item
    } finally {
      db.close()
    }
  }

  it('keeps the index right through every task write, including purges', () => {
    const task = service.createWorkItem(
      'project-one',
      { title: 'Paint the fence', description: 'Green paint', labels: ['garden'] },
      HUMAN
    )
    expect(indexed('task', task.id)).toMatchObject({ title: 'Paint the fence' })
    expect(indexed('task', task.id)?.body).toContain('garden')

    service.updateWorkItem(task.id, { title: 'Paint the shed' }, HUMAN)
    expect(indexed('task', task.id)?.title).toBe('Paint the shed')

    service.renameLabel('project-one', 'garden', 'outdoors', HUMAN)
    expect(indexed('task', task.id)?.body).toContain('outdoors')

    const comment = service.addComment(task.id, 'Use the colour scheme we agreed', HUMAN)
    expect(indexed('comment', comment.id)?.body).toContain('colour scheme')
    service.updateComment(comment.id, 'Use the lighter colour scheme', HUMAN)
    expect(indexed('comment', comment.id)?.body).toContain('lighter')
    service.deleteComment(comment.id, HUMAN)
    expect(indexed('comment', comment.id)).toBeUndefined()
    service.restoreComment(comment.id, HUMAN)
    expect(indexed('comment', comment.id)).toBeDefined()

    // Archive and bin keep the record indexed; search hides it.
    service.moveWorkItemToBin(task.id, HUMAN, 1)
    expect(indexed('task', task.id)).toBeDefined()
    expect(search('shed')).toEqual([])
    expect(ids(search('shed', { includeArchived: true }))).toEqual([`task:${task.id}`])

    expect(service.purgeRecycleBin('project-one', Date.now())).toBe(1)
    expect(indexed('task', task.id)).toBeUndefined()
    expect(indexed('comment', comment.id)).toBeUndefined()

    const other = service.createWorkItem('project-one', { title: 'Mow the lawn' }, HUMAN)
    service.addComment(other.id, 'Sharpen the blades', HUMAN)
    service.deleteWorkItem(other.id, HUMAN)
    expect(
      indexRows().filter((row) => row.entity_type !== 'task' || row.entity_id === other.id)
    ).toEqual([])
  })

  it('keeps goals, milestones and decisions indexed through create, update and delete', () => {
    const goal = service.createGoal('project-one', { title: 'Relaunch', outcome: 'A new website' })
    const milestone = service.createMilestone('project-one', {
      name: 'Beta',
      outcome: 'Testers sign up',
      goalId: goal.id
    })
    const decision = service.createDecision('project-one', {
      title: 'Colours',
      decision: 'We use the teal colour scheme'
    })
    expect(indexed('goal', goal.id)?.body).toBe('A new website')
    expect(indexed('milestone', milestone.id)?.title).toBe('Beta')
    expect(indexed('decision', decision.id)?.body).toContain('teal')

    service.updateGoal(goal.id, { outcome: 'A faster website' })
    service.updateMilestone(milestone.id, { name: 'Public beta' })
    service.updateDecision(decision.id, { decision: 'We use the navy colour scheme' })
    expect(indexed('goal', goal.id)?.body).toBe('A faster website')
    expect(indexed('milestone', milestone.id)?.title).toBe('Public beta')
    expect(indexed('decision', decision.id)?.body).toContain('navy')

    // An archived goal or milestone is not found unless asked for.
    service.updateMilestone(milestone.id, { status: 'archived' })
    expect(search('public')).toEqual([])
    expect(search('public', { includeArchived: true })).toHaveLength(1)

    service.deleteDecision(decision.id)
    service.deleteMilestone(milestone.id)
    service.deleteGoal(goal.id)
    expect(indexRows()).toEqual([])
  })

  it('finds a comment, a decision and a Library note by one word, with snippets', () => {
    const task = service.createWorkItem('project-one', { title: 'Homepage' }, HUMAN)
    service.addComment(task.id, 'Where did we decide the colour scheme?', HUMAN)
    service.createDecision('project-one', {
      title: 'Brand',
      decision: 'The colour scheme is teal and sand'
    })
    addLibraryNote('Style guide', 'Fonts, spacing and the colour scheme for print')
    addLibraryNote('Old guide', 'The old colour scheme', true)

    const results = search('colour')
    expect(results.map((result) => result.type).sort()).toEqual(['comment', 'decision', 'library'])
    for (const result of results) expect(marked(result)).toContain('colour')
    const comment = results.find((result) => result.type === 'comment')!
    expect(comment).toMatchObject({ title: 'Homepage', workItemId: task.id })
    expect(search('colour', { types: ['library'] }).map((result) => result.type)).toEqual([
      'library'
    ])
    expect(search('colour', { projectId: 'project-two' })).toEqual([])
  })

  it('ranks a title match above a body match', () => {
    const body = service.createWorkItem(
      'project-one',
      { title: 'Write copy', description: 'Mention the newsletter signup' },
      HUMAN
    )
    const title = service.createWorkItem(
      'project-one',
      { title: 'Newsletter signup', description: 'Form on the footer' },
      HUMAN
    )
    expect(ids(search('newsletter'))).toEqual([`task:${title.id}`, `task:${body.id}`])
    expect(marked(search('newsletter')[1])).toEqual(['newsletter'])
  })

  it('never shows a raw SQLite error for FTS syntax in a query', () => {
    service.createWorkItem('project-one', { title: 'Fix "quotes" AND things' }, HUMAN)
    for (const query of ['"', 'AND', 'NEAR(', 'title:x', '*', '-', 'a OR', '"quotes" AND'])
      expect(() => search(query)).not.toThrow()
    expect(search('"quotes"')).toHaveLength(1)
  })

  it('returns the same set from the LIKE fallback when FTS5 is missing', () => {
    const task = service.createWorkItem(
      'project-one',
      { title: 'Order paint', description: 'Teal colour scheme samples' },
      HUMAN
    )
    service.addComment(task.id, 'The colour scheme samples arrived', HUMAN)
    service.createDecision('project-one', { title: 'Paint', decision: 'Colour scheme: teal' })
    service.createGoal('project-one', { title: 'Repaint', outcome: 'Nothing about schemes' })
    const archived = service.createWorkItem('project-one', { title: 'Old colour scheme' }, HUMAN)
    service.archiveWorkItem(archived.id, HUMAN)
    addLibraryNote('Palette', 'Every colour scheme we tried')

    const withFts = ids(search('colour scheme')).sort()
    expect(withFts).toHaveLength(4)

    const db = new Database(databasePath)
    try {
      db.exec('DROP TABLE search_index')
      db.exec('DROP TABLE library_search')
      const fallback = new SearchService(db, () => projectIds)
      expect(fallback.hasFullTextSearch).toBe(false)
      const results = fallback.search('colour scheme')
      expect(ids(results).sort()).toEqual(withFts)
      expect(marked(results[0])).toContain('colour')
      expect(ids(fallback.search('colour scheme', { includeArchived: true }))).toContain(
        `task:${archived.id}`
      )
      // Indexing does nothing without the table.
      expect(() => fallback.indexEntity('task', task.id)).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('marks every term in a fallback snippet', () => {
    expect(likeSnippet('We chose the Colour scheme in May', ['colour', 'may'])).toEqual([
      { text: 'We chose the ', match: false },
      { text: 'Colour', match: true },
      { text: ' scheme in ', match: false },
      { text: 'May', match: true }
    ])
    expect(likeSnippet('nothing here', ['colour'])).toEqual([])
  })
})

describe('search terms', () => {
  it('escapes LIKE wildcards and quotes FTS terms', async () => {
    const { likePattern, ftsMatchExpression, searchTerms } =
      await import('../../electron/services/database/search-terms')
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%')
    expect(searchTerms('"quoted" AND -- x')).toEqual(['quoted', 'AND', 'x'])
    expect(ftsMatchExpression(['a', 'AND'])).toBe('"a"* "AND"*')
  })
})
